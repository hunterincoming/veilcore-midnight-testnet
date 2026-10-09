// The client API for the VeilCore royalties contract, protocol 4 (contract/src/veilcore-royalties.compact).
// SPDX-License-Identifier: Apache-2.0
//
// We never touch the money; we prove the books. No circuit of the contract moves tokens. A
// breeder posts an offer, naming the unit its amounts are counted in ("USD cents", "JPY"),
// and hands licensees an OFFER CARD (the rate and its salt, which the chain only commits
// to). A grower makes a LICENCE CARD from it (viewing and spending keys for that offer) and
// hands it to the breeder with payment, however they already pay; the breeder ISSUES the
// licence from the card. For royalties, the grower hands the breeder a TOP-UP REQUEST (the
// offer and a code naming nobody) with payment; the breeder ISSUES that much credit to it.
// Each period is settled in private against that credit. The breeder reads every settlement
// of their own licensees with the licence cards. A buyer or regulator checks a licence, and
// a settled period, with a PRESENTATION REQUEST. A licensee can hand a PRESENTATION CARD to
// someone who answers verifiers for them: it proves, never spends.
//
// Rules the contract cannot enforce, enforced here:
//   1. Deal only with an offer whose record is the live head of an anchored identity in the
//      main VeilCore contract, and whose pedigree matches it (ledger 8 has no calls
//      between contracts). Checked when asking for a licence and in a verifier's check.
//   2. Never prove while the latest licence, credit note or receipt on chain is one of
//      yours: the root a proof publishes would then name your own transaction.
//   3. Open the rate from the offer card before asking for a licence or settling: a card
//      whose rate does not match the chain's commitment, or is zero, is refused.
//   4. Say how few offers a private issuance could be from (issuePreview), before the
//      breeder issues.
//
// Every card read from a file is checked and normalised (lower-case hex, 32 bytes) before
// it is used or kept. Offers, licences, credit and settlements that may already have landed
// (a timeout) are not repeated without being asked. A settle, merge, presentation or private
// issuance whose proof went stale on the way (a seal retired its root) is proved and sent
// once more (isStaleRootError: not yet checked against a real node; a retry after an
// on-chain failure pays a second fee).
//
// Two runs on one computer share this store. Every write of it (this client's own, and
// midnight-js's write-back after a transaction) is merged with what is on disk, and each
// run also remembers everything it kept, so one run's write never drops another's
// licences, codes, notes, receipts or keys (mergeHeld).
//
// Secrets kept between runs (admin and issuer secrets, licence secrets, credit notes) live
// in this client's encrypted store; each call's input is kept in memory only
// (transientInput). Design and limits: docs/royalties-design.md.

import { type ContractAddress, sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type StateValue } from '@midnight-ntwrk/midnight-js-protocol/onchain-runtime';
import { createHash } from 'node:crypto';
import { type Logger } from 'pino';
import {
  createCircuitMaintenanceTxInterfaces,
  createUnprovenDeployTx,
  findDeployedContract,
  submitTxAsync,
} from '@midnight-ntwrk/midnight-js-contracts';
import {
  CompiledVeilcoreRoyalties,
  ROYALTIES_PROVABLE_CIRCUITS,
  type HeldLicence,
  type HeldLinkTerms,
  type HeldReceipt,
  type NoteOpening,
  type OfferOpening,
  type RoyaltiesHeld,
  type RoyaltiesLedger,
  type RoyaltiesPrivateState,
  type RoyaltyInput,
  type RoyaltyOffer,
  changeNonceOf,
  compiledRoyaltiesDeploying,
  issuerLeafOf,
  emptyRoyaltiesHeld,
  emptyRoyaltiesPrivateState,
  licenceKeyOf,
  noteOf,
  offerLeafOf,
  WEIGHT_DENOMINATOR,
  unitOf,
  royaltiesLedger,
  royaltiesPureCircuits as R,
} from '../../contract/src/royalties.js';
import { ledger as veilcoreLedger } from '../../contract/src/managed/veilcore/contract/index.js';
import { assertRoyaltiesDeployAllowed, assertRoyaltiesJoinAllowed } from './deploy-guard.js';
import { FIRST_FRAGMENT, addMissingKeys, deployInFragments, unknownCircuits } from './deploy-fragments.js';
import { type AuthorityView, isProvablyRetired, retireMaintenanceAuthorityProvably } from './maintenance.js';
import { singleCallState } from './presentation-lookup.js';
import { type SealResult, SEAL_INTERVAL_SECONDS, type TxRef } from './veilcore-api.js';
import {
  type DeployedRoyaltiesContract,
  type RoyaltiesContract,
  type RoyaltiesProviders,
  royaltiesPrivateStateKey,
} from './royalties-types.js';
import * as utils from './utils/index.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const unhex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s.trim().toLowerCase().replace(/^0x/, ''), 'hex'));
const ZERO32 = (): Uint8Array => new Uint8Array(32);
const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0);
const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

export const LICENSE_SLOTS = 16777216n;
/** The scalar field masked units live in (BLS12-381). */
export const FIELD_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const DAY = 86400n;
const SEAL_AHEAD_SECONDS = 200;
const SEAL_SKEW_SECONDS = 30;
/** SETTLE_GRACE in the contract: 30 days after an offer ends before its licences can be cleared. */
export const SETTLE_GRACE = 30n * DAY;
/**
 * REVOCATION_SEAL_INTERVAL in the contract: a revocation retires the licence tree's old roots
 * (and is sealed) at most once an hour, since each such seal voids proofs in flight.
 */
export const REVOCATION_SEAL_INTERVAL = 3600n;
/** SLOW_SEAL_INTERVAL in the contract: every tree's old roots are retired at most daily. */
const DAILY_SEAL_INTERVAL = DAY;
/** PAYEE_CHANGE_INTERVAL in the contract: a link's payee key changes it at most once in 30 days. */
export const PAYEE_CHANGE_INTERVAL = 30n * DAY;
/** How many of this party's own leaves are remembered for rule 2. */
const MINE_CAP = 4096;
/** How many ended licences one tidy-up clears (each is its own transaction, paid by whoever runs it). */
export const CLEAR_ENDED_CAP = 20;
const keepMine = (old: readonly string[] | undefined, add: readonly string[]): string[] =>
  [...(old ?? []), ...add].slice(-MINE_CAP);

/** 32 bytes as lower-case hex, from text that may carry 0x or upper case; refused otherwise. */
export const hex32 = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`${what} is missing.`);
  const s = v.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error(`${what} is not 32 bytes of hex.`);
  return s;
};
/** A whole number written as text, at least `min`. */
const whole = (v: unknown, what: string, min = 0n): string => {
  if (typeof v !== 'string' || !/^\d{1,30}$/.test(v.trim())) throw new Error(`${what} is not a whole number.`);
  if (BigInt(v.trim()) < min) throw new Error(`${what} is below ${min}.`);
  return String(BigInt(v.trim()));
};
/** A short fingerprint of a top-up code or a licence key, for the two sides to compare by phone. */
export const codeFingerprint = (code: string): string =>
  createHash('sha256').update(unhex(code)).digest('hex').slice(0, 8);
/** The licence card's fingerprint: its licence key's, to compare by phone before it is issued. */
export const licenceFingerprint = (licence: string): string => codeFingerprint(licence);

// ─────────────────────────────────────────────────────────────── cards and requests

/** What a breeder gives licensees with the terms. Private to them: it holds the rate. */
export type OfferCard = {
  readonly kind: 'veilcore-offer-card';
  readonly contract: string;
  readonly offer: string;
  /** The unit the offer counts amounts in (unitOf, hex): "USD cents", "JPY", "NIGHT". */
  readonly unit: string;
  readonly rateCommit: string;
  readonly expires: string;
  readonly rate: string;
  readonly rateSalt: string;
  /** Whether the offer's ancestors take a share of royalties (then its credit names the offer). Missing means no. */
  readonly split?: boolean;
};

/**
 * What a parent breeder hands the breeder of a new variety bred from theirs: the exact
 * terms of the descent link they will confirm. The child proposes these; the parent's
 * client confirms only a link whose terms match the card it made.
 */
export type LinkTermsCard = HeldLinkTerms;

/** One place in a variety's pedigree chart, as a client shows it before anything is issued. */
export type ChartPlace = {
  readonly place: number;
  /** 1 = parent, 2 = grandparent, 3 = great-grandparent. */
  readonly generation: number;
  readonly link: string;
  readonly parent: string;
  /** The unit the link's fee and share are counted in (unitOf, hex). */
  readonly unit: string;
  /** The share this place takes, in basis points (halved per generation beyond the parent). */
  readonly effectiveShare: number;
  readonly fee: bigint;
  readonly until: bigint;
};

/** What a licensee gives the breeder with the signed terms: it lets the breeder read their settlements. */
export type LicenceCard = {
  readonly kind: 'veilcore-licence-card';
  readonly contract: string;
  readonly offer: string;
  readonly licence: string;
  readonly viewKey: string;
  readonly spendKey: string;
  /** The licence's end date (part of its key), so the card checks out after the offer is removed. */
  readonly expires?: string;
};

/**
 * What a licensee gives its breeder with a payment for royalties: the offer and a code
 * naming nobody. The breeder issues that much credit to the code (issueCredit).
 */
export type TopUpRequest = {
  readonly kind: 'veilcore-topup-request';
  readonly contract: string;
  readonly offer: string;
  readonly code: string;
};

/**
 * What a licensee hands someone who answers verifiers for them (a grower under a seed
 * company's licence, say): the presentation key and the public spending key of one
 * licence, and the settlements it lists. It can never spend credit or settle. But the
 * presentation key also makes the viewing key: whoever holds the card can read the units
 * of every settlement of this licence, past and FUTURE, and answer as this licence about
 * any of them, for as long as the licence lives. The only way to cut a holder off is to
 * end the licence (the breeder revokes it). Hand it only to whom you would let see your
 * books for this licence and answer for you.
 */
export type PresentationCard = {
  readonly kind: 'veilcore-presentation-card';
  readonly contract: string;
  readonly offer: string;
  readonly licence: string;
  readonly present: string;
  readonly spendKey: string;
  readonly expires: string;
  readonly receipts: readonly { readonly period: string; readonly units: string; readonly change: string }[];
};

/** What a verifier asks for. */
export type PresentationRequest = {
  readonly contract: string;
  readonly offer: string;
  readonly period: string;
  readonly minUnits: string;
  readonly validAt: string;
  readonly scope: string;
  readonly challenge: string;
  /**
   * Whether the licence must still be live at validAt. False (only with a period) asks
   * whether that period was settled under a licence from the offer, even one that has
   * since ended (its last season). Missing means true.
   */
  readonly live?: boolean;
};

/** An offer card from a file, checked and normalised (lower-case hex), or refused. */
export const normaliseOfferCard = (v: unknown): OfferCard => {
  const c = v as Partial<OfferCard> | null;
  if (c === null || typeof c !== 'object' || c.kind !== 'veilcore-offer-card')
    throw new Error('That is not an offer card.');
  return {
    kind: 'veilcore-offer-card',
    contract: hex32(c.contract, "The offer card's contract"),
    offer: hex32(c.offer, "The offer card's offer id"),
    unit: hex32(c.unit, "The offer card's unit"),
    rateCommit: hex32(c.rateCommit, "The offer card's rate commitment"),
    expires: whole(c.expires, "The offer card's end date"),
    rate: whole(c.rate, "The offer card's rate"),
    rateSalt: hex32(c.rateSalt, "The offer card's rate salt"),
    split: c.split === true,
  };
};

/** A licence card from a file, checked and normalised, or refused. */
export const normaliseLicenceCard = (v: unknown): LicenceCard => {
  const c = v as Partial<LicenceCard> | null;
  if (c === null || typeof c !== 'object' || c.kind !== 'veilcore-licence-card')
    throw new Error('That is not a licence card.');
  return {
    kind: 'veilcore-licence-card',
    contract: hex32(c.contract, "The licence card's contract"),
    offer: hex32(c.offer, "The licence card's offer id"),
    licence: hex32(c.licence, "The licence card's licence key"),
    viewKey: hex32(c.viewKey, "The licence card's viewing key"),
    spendKey: hex32(c.spendKey, "The licence card's spending key"),
    ...(c.expires !== undefined ? { expires: whole(c.expires, "The licence card's end date") } : {}),
  };
};

/** A top-up request from a file, checked and normalised, or refused. */
export const normaliseTopUpRequest = (v: unknown): TopUpRequest => {
  const r = v as Partial<TopUpRequest> | null;
  if (r === null || typeof r !== 'object' || r.kind !== 'veilcore-topup-request')
    throw new Error('That is not a top-up request.');
  return {
    kind: 'veilcore-topup-request',
    contract: hex32(r.contract, "The request's contract"),
    offer: hex32(r.offer, "The request's offer id"),
    code: hex32(r.code, 'The top-up code'),
  };
};

/** A link terms card from a file, checked and normalised, or refused. */
export const normaliseLinkTerms = (v: unknown): LinkTermsCard => {
  const c = v as Partial<LinkTermsCard> | null;
  if (c === null || typeof c !== 'object' || c.kind !== 'veilcore-link-terms')
    throw new Error('That is not a link terms card.');
  return {
    kind: 'veilcore-link-terms',
    contract: hex32(c.contract, "The terms card's contract"),
    parent: hex32(c.parent, "The terms card's parent record"),
    unit: hex32(c.unit, "The terms card's unit"),
    fee: whole(c.fee, "The terms card's fee"),
    share: whole(c.share, "The terms card's share"),
    generations: whole(c.generations, "The terms card's generations", 1n),
    until: whole(c.until, "The terms card's end date"),
    payee: hex32(c.payee, "The terms card's payee key"),
    ...(c.child !== undefined ? { child: hex32(c.child, "The terms card's child record") } : {}),
  };
};

/** A presentation card from a file, checked and normalised, or refused. */
export const normalisePresentationCard = (v: unknown): PresentationCard => {
  const c = v as Partial<PresentationCard> | null;
  if (c === null || typeof c !== 'object' || c.kind !== 'veilcore-presentation-card')
    throw new Error('That is not a presentation card.');
  if (!Array.isArray(c.receipts)) throw new Error("The presentation card's settlements are missing.");
  return {
    kind: 'veilcore-presentation-card',
    contract: hex32(c.contract, "The presentation card's contract"),
    offer: hex32(c.offer, "The presentation card's offer id"),
    licence: hex32(c.licence, "The presentation card's licence key"),
    present: hex32(c.present, "The presentation card's presentation key"),
    spendKey: hex32(c.spendKey, "The presentation card's spending key"),
    expires: whole(c.expires, "The presentation card's end date"),
    receipts: c.receipts.map((r: { period?: unknown; units?: unknown; change?: unknown }) => {
      if (typeof r?.period !== 'string') throw new Error('A settlement on the presentation card has no period.');
      periodBytes(r.period);
      return {
        period: r.period,
        units: whole(r.units, "A settlement's units", 1n),
        change: hex32(r.change, "A settlement's change note"),
      };
    }),
  };
};

export type PresentationVerdict = {
  readonly accepted: boolean;
  readonly lines: readonly string[];
  readonly holder?: string;
};

/** One settlement a breeder read: which licence, which period, how many units. */
export type SettlementReading = {
  readonly licence: string;
  readonly offer: string;
  /** The period label, if it was one of those asked about (a label can be checked, not read back). */
  readonly period?: string;
  readonly units: bigint;
  readonly receipt: string;
  /**
   * Which of the licence's settlements this is (0, 1, 2 ...), or undefined when the numbers
   * before it are not all on chain: the licensee skipped a number (a client never does).
   */
  readonly number?: number;
};

/** The fields of an offer an issuance or settlement opens privately. */
type OfferFields = Pick<OfferCard, 'offer' | 'unit' | 'rateCommit' | 'expires' | 'split'>;

export const openingOf = (c: OfferFields): OfferOpening => ({
  offer: unhex(c.offer),
  unit: unhex(c.unit),
  rateCommit: unhex(c.rateCommit),
  expires: BigInt(c.expires),
  split: c.split === true,
});

/** The fields of a posted offer, as an issuance opens them. */
const fieldsOf = (id: Uint8Array, o: RoyaltyOffer): OfferFields => ({
  offer: hex(id),
  unit: hex(o.unit),
  rateCommit: hex(o.rateCommit),
  expires: String(o.expires),
  split: o.split,
});

/** Whether a card's public fields are the offer's on chain. */
const sameAsChain = (card: OfferFields, onChain: RoyaltyOffer): boolean =>
  hex(onChain.unit) === card.unit.toLowerCase() &&
  hex(onChain.rateCommit) === card.rateCommit.toLowerCase() &&
  onChain.expires === BigInt(card.expires) &&
  onChain.split === (card.split === true);

/** Refuse an offer card that does not match the chain, or whose rate does not open its commitment. */
export const checkOfferCard = (card: OfferCard, onChain?: RoyaltyOffer): void => {
  if (card.kind !== 'veilcore-offer-card') throw new Error('That is not an offer card.');
  const rate = BigInt(card.rate);
  if (rate <= 0n) throw new Error('That offer card has no royalty rate: nothing could settle against credit for it.');
  if (hex(R.rateCommit(rate, unhex(card.rateSalt))) !== card.rateCommit.toLowerCase())
    throw new Error("That offer card's rate does not match its rate commitment. Do not use it.");
  if (onChain !== undefined && !sameAsChain(card, onChain))
    throw new Error('That offer card does not match the offer on chain. Do not use it.');
};

/** A period label as 32 bytes: the text, UTF-8, zero-padded (1 to 32 bytes). */
export const periodBytes = (label: string): Uint8Array => {
  const b = Buffer.from(label.trim(), 'utf8');
  if (b.length === 0 || b.length > 32) throw new Error('A period label is 1 to 32 bytes of text, e.g. 2026-Q4.');
  const out = ZERO32();
  out.set(b);
  return out;
};

export const newPresentationRequest = (args: {
  readonly contract: string;
  readonly offer: Uint8Array;
  readonly period?: string;
  readonly minUnits?: bigint;
  readonly validForSeconds?: number;
  readonly scope?: Uint8Array;
  /** False (only with a period): the period settled under a licence from the offer, even one since ended. */
  readonly live?: boolean;
}): PresentationRequest => {
  const noPeriod = args.period === undefined || args.period === '';
  if (args.live === false && noPeriod)
    throw new Error('A request that does not ask for a live licence must ask for a settled period.');
  return {
    contract: args.contract.toLowerCase(),
    offer: hex(args.offer),
    period: hex(noPeriod ? ZERO32() : periodBytes(args.period ?? '')),
    minUnits: String(args.minUnits ?? 0n),
    validAt: String(Math.floor(Date.now() / 1000) + (args.validForSeconds ?? 3600)),
    scope: hex(args.scope ?? utils.randomBytes(32)),
    challenge: hex(utils.randomBytes(32)),
    live: args.live !== false,
  };
};

/** A request from a file, checked and normalised, or refused (never repeating its contents). */
export const normalised = (r: PresentationRequest): PresentationRequest & { readonly live: boolean } => {
  const live = r.live !== false;
  const out = {
    contract: hex32(r.contract, "The request's contract"),
    offer: hex32(r.offer, "The request's offer id"),
    period: hex32(r.period, "The request's period"),
    minUnits: whole(r.minUnits, "The request's units"),
    validAt: whole(r.validAt, "The request's time"),
    scope: hex32(r.scope, "The request's scope"),
    challenge: hex32(r.challenge, "The request's challenge"),
    live,
  };
  if (!live && isZero(unhex(out.period))) throw new Error('That request asks for neither a live licence nor a period.');
  return out;
};

/**
 * The earliest block time at which a seal would seal the revocations waiting in `l` (as
 * sealRevocations decides): an hour after the last revocation seal, or at the daily seal if
 * that comes first. Undefined when none is waiting.
 */
export const revocationSealableAt = (l: RoyaltiesLedger): bigint | undefined =>
  l.unsealedChanges ? sealableAt(l) : undefined;

/** When a seal of a waiting revocation or replaced issuer is due: the hourly rule, or the daily seal. */
const sealableAt = (l: RoyaltiesLedger): bigint => {
  const hourly = l.lastRevocationReset + REVOCATION_SEAL_INTERVAL;
  const lastSeal = l.lastSealTime + BigInt(SEAL_INTERVAL_SECONDS);
  const daily = l.lastSlowSealTime + DAILY_SEAL_INTERVAL;
  const viaDaily = daily > lastSeal ? daily : lastSeal;
  return hourly < viaDaily ? hourly : viaDaily;
};

/**
 * The earliest block time at which a seal would seal what is waiting in `l`: a revocation
 * or a replaced credit issuer (the same hourly rule covers both). Undefined when neither is.
 */
const keyChangeSealableAt = (l: RoyaltiesLedger): bigint | undefined =>
  l.unsealedChanges || l.issuerChanges ? sealableAt(l) : undefined;

/**
 * What revocations say about a presentation of `offer`, from the contract state right after
 * it (`atProof`) and now. Only that offer's revocations count.
 */
export const revocationVerdict = (
  offer: Uint8Array,
  atProof: RoyaltiesLedger,
  now: RoyaltiesLedger,
): { readonly gone: boolean; readonly unsealed: boolean; readonly revokedSince: boolean } => {
  const at = (l: RoyaltiesLedger): bigint => (l.offerRevokedAt.member(offer) ? l.offerRevokedAt.lookup(offer) : 0n);
  return {
    gone: !now.offers.member(offer),
    unsealed: at(atProof) > atProof.sealedRevocations,
    revokedSince: at(now) > at(atProof),
  };
};

/** Whether a record can stand behind an offer, read from the main VeilCore contract now. */
export type RecordStanding =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly why: 'not-anchored' | 'moved' | 'no-contract';
      /** For 'moved': the identity has been recovered from theft (the offer may be the thief's). */
      readonly recovered?: boolean;
    };

export const recordStanding = (main: ReturnType<typeof veilcoreLedger>, record: Uint8Array): RecordStanding => {
  const origin = main.originOf.member(record) ? main.originOf.lookup(record) : record;
  if (!main.recoveryOf.member(origin)) return { ok: false, why: 'not-anchored' };
  const live = main.headOf.member(origin)
    ? hex(main.headOf.lookup(origin)) === hex(record)
    : hex(origin) === hex(record);
  if (live) return { ok: true };
  const recovered = main.recoveriesOf.member(origin) && main.recoveriesOf.lookup(origin).read() > 0n;
  return { ok: false, why: 'moved', recovered };
};

/**
 * What a standing means for trusting an offer that already has licences (a
 * verifier's check): refused if the record is not anchored, or was recovered from theft
 * (the offer may have been posted by the thief); a plain key change only warns, since the
 * breeder still runs the offer and its licensees cannot move. Purchases refuse anything
 * but the live head.
 */
export const standingVerdict = (s: RecordStanding): { readonly refuse?: string; readonly warn?: string } =>
  s.ok
    ? {}
    : s.why === 'no-contract'
      ? { refuse: 'there is no VeilCore contract at that address to check the record against' }
      : s.why === 'not-anchored'
        ? { refuse: "the offer's record is not an anchored record in the VeilCore contract" }
        : s.recovered === true
          ? {
              refuse:
                "the offer's record has since been recovered from theft: the offer may be the thief's (the breeder " +
                'must post it again from the current record)',
            }
          : {
              warn: "the offer's record is no longer its identity's current record (a key change since it was posted)",
            };

type MainLedger = ReturnType<typeof veilcoreLedger>;
const identityOf = (main: MainLedger, r: Uint8Array): Uint8Array =>
  main.originOf.member(r) ? main.originOf.lookup(r) : r;
const headOfIdentity = (main: MainLedger, id: Uint8Array): Uint8Array =>
  main.headOf.member(id) ? main.headOf.lookup(id) : id;

export type PedigreeStanding =
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly why: string };

/**
 * Rule 4 (descent), for a record and every ancestor in its chart, up to three generations:
 * - a parent the chart names that the main VeilCore contract does not confirm is shown as
 *   a warning (it is paid by this variety; a confirmed link can never be dropped, so
 *   refusing would strand the variety for good);
 * - a confirmed parent the chart leaves out is refused if the two agreed terms here (a
 *   confirmed link the child chose not to include), and otherwise shown as "takes nothing
 *   here" (a parent that never set terms, or never uses this contract, strands nobody).
 * Warns when a parent record has since been recovered from theft, since links it
 * confirmed may have been made by the thief.
 */
export const pedigreeStanding = (
  main: MainLedger,
  roy: RoyaltiesLedger,
  record: Uint8Array,
  depth = 3,
): PedigreeStanding => {
  const warnings: string[] = [];
  const short = (b: Uint8Array): string => hex(b).slice(0, 10);
  const check = (r: Uint8Array, d: number): string | undefined => {
    const id = identityOf(main, r);
    const confirmed = main.parentsOf.member(id) ? [...main.parentsOf.lookup(id)].map(hex).sort() : [];
    if (!roy.stacks.member(r)) {
      if (confirmed.length > 0) warnings.push(`record ${short(r)} has parents but no chart here: they take nothing`);
      return undefined;
    }
    const chart = roy.stacks.lookup(r);
    const named: string[] = [];
    for (const lid of chart.slice(0, 2)) {
      if (isZero(lid)) continue;
      const l = roy.links.lookup(lid);
      if (hex(identityOf(main, l.child)) !== hex(id))
        return `record ${short(r)} uses a pedigree chart of another identity`;
      const pid = identityOf(main, l.parent);
      named.push(hex(pid));
      if (hex(headOfIdentity(main, pid)) !== hex(l.parent))
        warnings.push(
          main.recoveriesOf.member(pid) && main.recoveriesOf.lookup(pid).read() > 0n
            ? `parent record ${short(l.parent)} has since been recovered from theft: its link may have been made by the thief`
            : `parent record ${short(l.parent)} is no longer its identity's current record (a key change since): ` +
                'its link stands, but check it was made before the change',
        );
    }
    // A chart paying someone the main contract does not confirm as a parent costs the
    // breeder of this variety (by that link's fee), not a real ancestor:
    // shown, not refused, since a link once confirmed can never be dropped.
    for (const n of named)
      if (!confirmed.includes(n))
        warnings.push(
          `record ${short(r)}'s chart pays ${n.slice(0, 10)}, which the VeilCore contract does not confirm as its parent`,
        );
    for (const p of confirmed) {
      if (named.includes(p)) continue;
      const agreed = [...roy.links].some(
        ([, k]) => k.confirmed && hex(identityOf(main, k.child)) === hex(id) && hex(identityOf(main, k.parent)) === p,
      );
      if (agreed)
        return `record ${short(r)}'s pedigree chart leaves out a parent it agreed terms with (it does not name the parents it owes)`;
      warnings.push(`parent ${p.slice(0, 10)} of record ${short(r)} takes nothing through this contract`);
    }
    if (d > 1)
      for (const lid of chart.slice(0, 2)) {
        if (isZero(lid)) continue;
        const why = check(roy.links.lookup(lid).parent, d - 1);
        if (why !== undefined) return why;
      }
    return undefined;
  };
  const why = check(record, depth);
  return why === undefined ? { ok: true, warnings } : { ok: false, why };
};

/** A record's pedigree chart, place by place, for showing before anything is issued. */
export const chartOf = (roy: RoyaltiesLedger, record: Uint8Array): ChartPlace[] =>
  roy.stacks.member(record) ? chartOfPlaces(roy, roy.stacks.lookup(record)) : [];

/** Fourteen chart places (link ids, zero for none), as ChartPlaces. */
const chartOfPlaces = (roy: RoyaltiesLedger, chart: readonly Uint8Array[]): ChartPlace[] =>
  chart
    .map((lid, place) => ({ lid, place }))
    .filter(({ lid }) => !isZero(lid) && roy.links.member(lid))
    .map(({ lid, place }) => {
      const l = roy.links.lookup(lid);
      const generation = place < 2 ? 1 : place < 6 ? 2 : 3;
      return {
        place,
        generation,
        link: hex(lid),
        parent: hex(l.parent),
        unit: hex(l.unit),
        effectiveShare: Number(l.share) / 2 ** (generation - 1),
        fee: place < 2 ? l.fee : 0n,
        until: l.until,
      };
    });

const chartSplits = (roy: RoyaltiesLedger, record: Uint8Array): boolean =>
  roy.stacks.member(record) &&
  roy.stacks
    .lookup(record)
    .some(
      (lid) =>
        !isZero(lid) &&
        roy.links.member(lid) &&
        roy.links.lookup(lid).share > 0n &&
        roy.links.lookup(lid).until > nowSeconds(),
    );

/**
 * How many offers a private issuance could be from, as anyone can count them: ordinary
 * offers (a rate, no ancestors' share) that have issued at least one licence. The issuance
 * publishes nothing that tells them apart, but it cannot be from any other offer.
 */
export const issueCandidates = (l: RoyaltiesLedger): number =>
  [...l.offers].filter(
    ([id, o]) => !isZero(o.rateCommit) && !o.split && l.soldOf.member(id) && l.soldOf.lookup(id).read() > 0n,
  ).length;

/** What to tell the breeder when a private issuance has few offers to hide among. */
export const candidateWarning = (n: number): string | undefined =>
  n <= 1
    ? 'yours is the only offer on this contract that has issued licences and takes royalties, so anyone can tell ' +
      'this credit is for it (not for which licensee, or how much)'
    : n <= 3
      ? `only ${n} offers on this contract have issued licences and take royalties, so anyone can tell this credit ` +
        'is for one of those few (not which licensee, or how much)'
      : undefined;

export type OfferView = RoyaltyOffer & {
  readonly id: Uint8Array;
  /** Licences sold so far, and how many of those the chain still holds (not revoked or cleared). */
  readonly sold: bigint;
  readonly live: bigint;
  readonly remaining: bigint;
};

const offerView = (l: RoyaltiesLedger, id: Uint8Array, o: RoyaltyOffer): OfferView => {
  const sold = l.soldOf.member(id) ? l.soldOf.lookup(id).read() : 0n;
  const live = l.liveOf.member(id) ? l.liveOf.lookup(id).read() : 0n;
  return { ...o, id, sold, live, remaining: o.count > sold ? o.count - sold : 0n };
};

export type OfferTerms = {
  readonly terms: Uint8Array;
  /** The unit amounts are counted in, as text: "USD cents", "EUR cents", "JPY", "NIGHT". */
  readonly unit: string;
  /** The list price, in the unit: what the ancestors' shares of each licence are worked out on. */
  readonly price: bigint;
  /** Royalty per unit of produce, in the offer's unit; 0 for none. */
  readonly rate: bigint;
  readonly count: bigint;
  readonly expires: bigint;
  readonly revocable: boolean;
};

/**
 * Rule 2 refused: sending now would let anyone watching guess the proof is yours (see
 * assertNotLatest). Callers may wait, or send anyway with `evenIfLinkable`.
 */
export class WouldLinkError extends Error {
  constructor(
    message: string,
    /** True when a merge of this client's credit already landed before the refusal. */
    readonly afterOwnMerge = false,
  ) {
    super(message);
    this.name = 'WouldLinkError';
  }
}

/**
 * Refused because the same thing may already have been done (a licence, credit or a settlement
 * that timed out may have landed). Callers may ask, then call again with `again`.
 */
export class AlreadyDoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyDoneError';
  }
}

/** The trees a proof can use, by the ledger cell naming each one's newest leaf. */
type Tree = 'sale' | 'note' | 'receipt';

/** A note this client can spend, with the licence whose secret spends it. */
type Spendable = { readonly note: NoteOpening; readonly lic: HeldLicence; readonly key: string };

/** What a presentation needs of one licence: its keys, end date and settlements on chain. */
type Prover = {
  readonly present: Uint8Array;
  readonly spend: Uint8Array;
  readonly expires: bigint;
  readonly receipts: readonly { readonly period: string; readonly units: bigint; readonly change: Uint8Array }[];
};
const proverLeaf = (p: Prover, offer: Uint8Array): Uint8Array =>
  R.licenseKey(R.licenseCommit(R.viewOf(p.present), p.spend, offer), offer, p.expires);

/**
 * One ancestor's due from one licence or credit, as `owed` records it: the base amount
 * (`total`), the place's cut of it in 40,000ths (`weight`), and a parent's fee for a licence.
 * The due is total x weight / 40,000; add the numerators of many rows, then divide once
 * (owedTotal), so nothing is lost to rounding.
 */
export type OwedRow = {
  /** The licence key or credit note that owes it. */
  readonly key: string;
  readonly kind: 'licence' | 'credit';
  readonly offer: string;
  /** The descendant variety's record. */
  readonly record: string;
  readonly place: number;
  readonly generation: number;
  readonly link: string;
  /** The ancestor's record, as the link names it. */
  readonly parent: string;
  readonly total: bigint;
  readonly weight: bigint;
  /** The unit the base amount and the share are counted in (unitOf, hex). */
  readonly unit: string;
  /** A parent's fee for a licence, in its link's unit. */
  readonly fee: bigint;
  readonly feeUnit: string;
};

/**
 * What rows add up to, per unit, exactly: the shares' numerators summed and divided once
 * (rounded down only at the end), plus the fees.
 */
export const owedTotal = (rows: readonly OwedRow[]): Map<string, bigint> => {
  const shares = new Map<string, bigint>();
  const fees = new Map<string, bigint>();
  for (const r of rows) {
    shares.set(r.unit, (shares.get(r.unit) ?? 0n) + r.total * r.weight);
    if (r.fee > 0n) fees.set(r.feeUnit, (fees.get(r.feeUnit) ?? 0n) + r.fee);
  }
  const out = new Map<string, bigint>();
  for (const [u, n] of shares) out.set(u, n / WEIGHT_DENOMINATOR);
  for (const [u, f] of fees) out.set(u, (out.get(u) ?? 0n) + f);
  for (const [u, v] of out) if (v === 0n) out.delete(u);
  return out;
};

const sameNote = (x: { nonce: string; amount: string }, n: NoteOpening): boolean =>
  x.nonce === hex(n.nonce) && x.amount === String(n.amount);

// ─────────────────────────────────────────────────────────────── one store, two runs

/** `a`'s items, then `b`'s not already in `a` (by `key`); an item in both is `join`ed. */
const unionBy = <T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
  key: (x: T) => string,
  join: (x: T, y: T) => T = (x) => x,
): T[] => {
  const out = new Map<string, T>();
  for (const x of a ?? []) out.set(key(x), x);
  for (const y of b ?? []) {
    const k = key(y);
    const x = out.get(k);
    out.set(k, x === undefined ? y : join(x, y));
  }
  return [...out.values()];
};

/**
 * Two stores' `held` as one: every licence, code, note, receipt, offer card, admin secret,
 * link terms and own leaf in either (by identity), so a write from one run never drops what
 * another kept. Nothing is ever removed from `held`; a note spent in either is spent. Where
 * both hold a value under one key (an admin secret, a card), `b`'s is kept; the verifier
 * seed is the first one written.
 */
export const mergeHeld = (a: RoyaltiesHeld, b: RoyaltiesHeld): RoyaltiesHeld => {
  const holders: Record<string, readonly { readonly holder: string; readonly at: string }[]> = {};
  for (const offer of new Set([...Object.keys(a.seenHolders ?? {}), ...Object.keys(b.seenHolders ?? {})]))
    holders[offer] = unionBy(a.seenHolders?.[offer], b.seenHolders?.[offer], (x) => `${x.holder}:${x.at}`).slice(-256);
  const out: RoyaltiesHeld = {
    ...a,
    ...b,
    admins: { ...a.admins, ...b.admins },
    issuerKeys: unionBy(a.issuerKeys, b.issuerKeys, (x) => `${x.offer}:${x.secret}`),
    issued: unionBy(a.issued, b.issued, (x) => x.note),
    licences: unionBy(a.licences, b.licences, (x) => `${x.offer}:${x.secret}`),
    receipts: unionBy(a.receipts, b.receipts, (x) => x.leaf),
    offerCards: { ...a.offerCards, ...b.offerCards },
    codes: unionBy(a.codes, b.codes, (x) => `${x.offer}:${x.nonce}`),
    notes: unionBy(
      a.notes,
      b.notes,
      (x) => `${x.offer}:${x.licence ?? ''}:${x.nonce}:${x.amount}`,
      (x, y) => ({ ...x, spent: x.spent || y.spent }),
    ),
    linkTerms: { ...a.linkTerms, ...b.linkTerms },
    seenHolders: holders,
    mine: unionBy(a.mine, b.mine, (x) => x).slice(-MINE_CAP),
  };
  const seed = a.verifierSeed ?? b.verifierSeed;
  return seed === undefined ? out : { ...out, verifierSeed: seed };
};

/** How much a `held` holds (to tell whether a merge added anything). */
const heldSize = (h: RoyaltiesHeld): number =>
  Object.keys(h.admins).length +
  (h.issuerKeys ?? []).length +
  (h.issued ?? []).length +
  h.licences.length +
  h.receipts.length +
  Object.keys(h.offerCards ?? {}).length +
  (h.codes ?? []).length +
  (h.notes ?? []).length +
  (h.notes ?? []).filter((n) => n.spent).length +
  Object.keys(h.linkTerms ?? {}).length +
  Object.values(h.seenHolders ?? {}).reduce((a, l) => a + l.length, 0) +
  (h.mine ?? []).length +
  (h.verifierSeed === undefined ? 0 : 1);

type StateStore = RoyaltiesProviders['privateStateProvider'];

/**
 * The royalties store, with every write of the royalties state merged with what is on disk
 * first (mergeHeld), so that midnight-js writing back the state it read when a transaction
 * started (minutes earlier) never drops what another run on this computer kept meanwhile.
 */
export const mergingPrivateStateProvider = (store: StateStore): StateStore =>
  new Proxy(store, {
    get(target, name, receiver) {
      if (name === 'set')
        return async (id: string, state: RoyaltiesPrivateState): Promise<void> => {
          if (id !== royaltiesPrivateStateKey || state === null || typeof state !== 'object' || !('held' in state))
            return target.set(id as never, state);
          const disk = await target.get(id);
          const held =
            disk?.held === undefined ? state.held : mergeHeld({ ...emptyRoyaltiesHeld(), ...disk.held }, state.held);
          return target.set(id, { ...state, held });
        };
      return Reflect.get(target, name, receiver) as unknown;
    },
  });

/** The circuits proved against roots a seal can retire (issueCredit: the issuer tree's), sent once more if the root went stale. */
const REPROVE_ON_STALE = new Set(['settle', 'proveLicense', 'mergeNotes', 'issueCredit']);

/** An error and every error it wraps (cause, and the errors of an AggregateError), outermost first. */
const errorChain = (e: unknown): unknown[] => {
  const out: unknown[] = [];
  const walk = (x: unknown): void => {
    if (x === undefined || x === null || out.includes(x) || out.length > 32) return;
    out.push(x);
    if (typeof x === 'object') {
      walk((x as { cause?: unknown }).cause);
      const inner = (x as { errors?: unknown }).errors;
      if (Array.isArray(inner)) for (const y of inner) walk(y);
    }
  };
  walk(e);
  return out;
};

/** The contract's own refusal when a proof's root is not in a tree's history: "... or the path is stale". */
const STALE_ROOT = /or the path is stale/i;

/**
 * Whether a call failed because a root it proved against was retired before it landed (a
 * seal in between): the contract's root-check refusal ("... or the path is stale") anywhere
 * in the error chain (message or cause, however midnight-js or the node wraps it, e.g.
 * "Unexpected error submitting ..."), or a transaction midnight-js reports failed on chain
 * (CallTxFailedError, which does not say why). Never when anything in the chain speaks of
 * a timeout: a call that timed out may have landed.
 *
 * Not yet checked on a real network: what a node returns for a stale proof is assumed, not
 * observed (the preprod run does not cover it). A failure caught at submission costs
 * nothing; one recorded on chain has paid its fee, so the one retry can cost a second fee.
 */
export const isStaleRootError = (e: unknown): boolean => {
  const chain = errorChain(e);
  const text = (x: unknown): string => (x instanceof Error ? x.message : typeof x === 'string' ? x : '');
  if (chain.some((x) => /timed out|timeout/i.test(text(x)))) return false;
  return chain.some((x) => (x instanceof Error && x.name === 'CallTxFailedError') || STALE_ROOT.test(text(x)));
};

// ─────────────────────────────────────────────────────────────── the client

export class RoyaltiesAPI {
  readonly deployedContractAddress: ContractAddress;

  private constructor(
    public readonly deployedContract: DeployedRoyaltiesContract,
    private readonly providers: RoyaltiesProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
  }

  // ─────────────────────────────────────────── reading

  async currentLedger(): Promise<RoyaltiesLedger> {
    const state = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (state === null || state === undefined) throw new Error('No royalties contract state on chain.');
    return royaltiesLedger(state.data);
  }

  async offers(): Promise<OfferView[]> {
    const l = await this.currentLedger();
    return [...l.offers].map(([id, o]) => offerView(l, id, o));
  }

  async offer(id: Uint8Array): Promise<OfferView> {
    const l = await this.currentLedger();
    if (!l.offers.member(id)) throw new Error('No such offer on this contract.');
    return offerView(l, id, l.offers.lookup(id));
  }

  /**
   * Rule 1 for asking for a licence from an offer whose breeder's record is `record`: it
   * must be the live head of an anchored identity, and the pedigree must match. Returns the
   * warnings to show.
   */
  private async offerChecks(record: Uint8Array, mainAddress: ContractAddress): Promise<string[]> {
    const warnings: string[] = [];
    const standing = await this.recordStandingIn(mainAddress, record);
    if (!standing.ok)
      throw new Error(
        standing.why === 'moved'
          ? "That offer's record is no longer its identity's current record in the VeilCore contract. The breeder " +
              'must post the offer again from the current record. Nothing was sent.'
          : standing.why === 'not-anchored'
            ? "That offer's record is not an anchored record in the VeilCore contract. Nothing was sent."
            : `No VeilCore contract at ${mainAddress} to check the record against. Nothing was sent.`,
      );
    const v = standingVerdict(standing);
    if (v.refuse !== undefined) throw new Error(`Refused: ${v.refuse}. Nothing was sent.`);
    if (v.warn !== undefined) warnings.push(v.warn);
    const ped = await this.pedigreeIn(mainAddress, record);
    if (!ped.ok) throw new Error(`Refused: ${ped.why}. Nothing was sent.`);
    return [...warnings, ...ped.warnings];
  }

  async recordStandingIn(mainAddress: ContractAddress, record: Uint8Array): Promise<RecordStanding> {
    const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
    if (state === null || state === undefined) return { ok: false, why: 'no-contract' };
    return recordStanding(veilcoreLedger(state.data), record);
  }

  /** Rule 4 against the main contract at `mainAddress` now. */
  async pedigreeIn(mainAddress: ContractAddress, record: Uint8Array): Promise<PedigreeStanding> {
    const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
    if (state === null || state === undefined) return { ok: false, why: `no VeilCore contract at ${mainAddress}` };
    return pedigreeStanding(veilcoreLedger(state.data), await this.currentLedger(), record);
  }

  /**
   * What the royalties contract holds between `child`'s identity and `parent`'s (read with
   * the main contract): 'agreed' (a confirmed link, in the child's chart or not yet final),
   * 'left-out' (a confirmed link, but the child's current record's chart does not pay it),
   * or 'none'.
   */
  async agreedDescent(
    mainAddress: ContractAddress,
    child: Uint8Array,
    parent: Uint8Array,
  ): Promise<'agreed' | 'left-out' | 'none'> {
    const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
    if (state === null || state === undefined) return 'none';
    const main = veilcoreLedger(state.data);
    const [c, p] = [hex(identityOf(main, child)), hex(identityOf(main, parent))];
    const l = await this.currentLedger();
    const agreed = [...l.links].filter(
      ([, k]) => k.confirmed && hex(identityOf(main, k.child)) === c && hex(identityOf(main, k.parent)) === p,
    );
    if (agreed.length === 0) return 'none';
    const head = headOfIdentity(main, identityOf(main, child));
    if (!l.stacks.member(head)) return 'agreed';
    const chart = l.stacks.lookup(head).slice(0, 2).map(hex);
    return agreed.some(([id]) => chart.includes(hex(id))) ? 'agreed' : 'left-out';
  }

  /** A record's pedigree chart on this contract. */
  async chart(record: Uint8Array): Promise<ChartPlace[]> {
    return chartOf(await this.currentLedger(), record);
  }

  /**
   * What licences and credit issued off chain owe ancestors, as the contract recorded it
   * when each was issued: one row per ancestor place per licence or credit. `parent` keeps
   * the rows owed to that ancestor record; `record` the rows owed by that descendant
   * variety. Whether they were paid happens off chain, between the two.
   */
  async owed(
    filter: { readonly parent?: Uint8Array; readonly record?: Uint8Array; readonly mainAddress?: ContractAddress } = {},
  ): Promise<OwedRow[]> {
    const l = await this.currentLedger();
    // With the main contract, an ancestor is matched by identity: a link made by an earlier
    // record of the same identity (before a key change) still counts as owed to it.
    let sameParent = (r: Uint8Array): boolean => filter.parent !== undefined && hex(r) === hex(filter.parent);
    if (filter.parent !== undefined && filter.mainAddress !== undefined) {
      const state = await this.providers.publicDataProvider.queryContractState(filter.mainAddress);
      if (state !== null && state !== undefined) {
        const main = veilcoreLedger(state.data);
        const want = hex(identityOf(main, filter.parent));
        sameParent = (r) => hex(identityOf(main, r)) === want;
      }
    }
    const rows: OwedRow[] = [];
    for (const [key, e] of l.owed) {
      if (filter.record !== undefined && hex(e.record) !== hex(filter.record)) continue;
      if (!l.stacks.member(e.record)) continue;
      const chart = l.stacks.lookup(e.record);
      chart.forEach((lid, place) => {
        const weight = e.weights[place] ?? 0n;
        const fee = place < 2 ? (e.fees[place] ?? 0n) : 0n;
        if (isZero(lid) || (weight === 0n && fee === 0n) || !l.links.member(lid)) return;
        const k = l.links.lookup(lid);
        if (filter.parent !== undefined && !sameParent(k.parent)) return;
        rows.push({
          key: hex(key),
          kind: l.everSold.member(key) ? 'licence' : 'credit',
          offer: hex(e.offer),
          record: hex(e.record),
          place,
          generation: place < 2 ? 1 : place < 6 ? 2 : 3,
          link: hex(lid),
          parent: hex(k.parent),
          total: e.total,
          weight,
          unit: hex(e.unit),
          fee,
          feeUnit: hex(k.unit),
        });
      });
    }
    return rows;
  }

  /**
   * What this client holds: the store, merged with everything this run has kept (another
   * run's write can have dropped some of it from disk; it is written back at once).
   */
  async held(): Promise<RoyaltiesHeld> {
    const ps = await this.providers.privateStateProvider.get(royaltiesPrivateStateKey);
    const disk = { ...emptyRoyaltiesHeld(), ...(ps?.held ?? {}) };
    const merged = mergeHeld(disk, this.kept);
    this.kept = merged;
    if (heldSize(merged) > heldSize(disk))
      await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input: ps?.input ?? {}, held: merged });
    return merged;
  }

  /** Everything this run has read or kept, so another run's write cannot make it forget. */
  private kept: RoyaltiesHeld = emptyRoyaltiesHeld();

  /** This licensee's unspent credit on an offer, as far as this client knows it. */
  async credit(offer: Uint8Array): Promise<bigint> {
    return (await this.spendable(offer)).reduce((a, s) => a + s.note.amount, 0n);
  }

  /** Settlements this client made on `offer` that are on chain (a sent one that never landed is left out). */
  async settlements(offer: Uint8Array): Promise<HeldReceipt[]> {
    const l = await this.currentLedger();
    return (await this.held()).receipts.filter(
      (r) => r.offer === hex(offer) && l.receipts.findPathForLeaf(unhex(r.leaf)) !== undefined,
    );
  }

  // ─────────────────────────────────────────── breeder: offers

  /**
   * Post an offer from the record `recordSecret` stands for. Makes the admin secret, the
   * credit issuer secret and the rate salt; returns the offer card to hand licensees with
   * the terms. The admin secret must also be written on paper: without it the offer can
   * never be closed, its licences revoked or issued, or its credit issuer replaced. The
   * issuer secret stays on this computer (a lost one is replaced by the admin, 86).
   * Licences and credit are issued here for payments made off chain, in the offer's unit.
   * Refused (AlreadyDoneError) unless `again` when this client already posted an offer on
   * chain from the same record with the same terms fingerprint, price and number for sale,
   * ending within a day of the same time: a post that timed out may have landed.
   */
  async postOffer(
    recordSecret: Uint8Array,
    t: OfferTerms,
    mainAddress?: ContractAddress,
    opts: { readonly again?: boolean } = {},
  ): Promise<
    TxRef & {
      readonly offer: Uint8Array;
      readonly adminSecret: Uint8Array;
      readonly issuerSecret: Uint8Array;
      readonly card: OfferCard;
    }
  > {
    if (t.terms.length !== 32 || isZero(t.terms)) throw new Error('The terms fingerprint is 32 bytes, not all zero.');
    const unit = unitOf(t.unit);
    if (t.price <= 0n || t.count <= 0n)
      throw new Error('The list price and the number of licences must be more than zero.');
    if (t.price >= 1n << 64n || t.rate >= 1n << 64n) throw new Error('That amount is too large.');
    if (t.rate < 0n) throw new Error('The royalty rate cannot be negative.');
    if (t.expires <= nowSeconds()) throw new Error('The end date must be in the future.');
    if (t.expires >= 1n << 62n) throw new Error('That end date is too far ahead.');
    if (t.count >= 1n << 32n) throw new Error('At most 4294967295 licences per offer.');
    if (mainAddress !== undefined) {
      const standing = await this.recordStandingIn(mainAddress, R.recordCommit(recordSecret));
      if (!standing.ok)
        throw new Error(
          'Your record is not the current record of an anchored identity in the VeilCore contract, so growers would ' +
            'refuse this offer. Anchor it (or act as your current record) first. Nothing was sent.',
        );
    }
    const adminSecret = utils.randomBytes(32);
    const issuerSecret = utils.randomBytes(32);
    const rateSalt = utils.randomBytes(32);
    const nonce = utils.randomBytes(32);
    const offer = R.offerId(R.recordCommit(recordSecret), nonce);
    const rateCommit = t.rate === 0n ? ZERO32() : R.rateCommit(t.rate, rateSalt);
    const before = await this.currentLedger();
    const record = R.recordCommit(recordSecret);
    if (opts.again !== true) {
      const same = Object.keys((await this.held()).admins).find((id) => {
        if (!before.offers.member(unhex(id))) return false;
        const o = before.offers.lookup(unhex(id));
        const apart = o.expires > t.expires ? o.expires - t.expires : t.expires - o.expires;
        return (
          hex(o.record) === hex(record) &&
          hex(o.terms) === hex(t.terms) &&
          o.price === t.price &&
          o.count === t.count &&
          apart < DAY
        );
      });
      if (same !== undefined)
        throw new AlreadyDoneError(
          `This computer already posted an offer from this record with the same terms fingerprint, price, number ` +
            `for sale and end date: offer ${same} (perhaps a post that timed out did land; 77 writes its card ` +
            'again). Nothing was sent.',
        );
    }
    if (
      !before.stacks.member(record) &&
      ((before.linksConfirmed.member(record) && before.linksConfirmed.lookup(record) > 0n) ||
        (before.linksPending.member(record) && before.linksPending.lookup(record) > 0n))
    )
      throw new Error(
        'This record has descent links: finalise its ancestors first (it cannot be changed afterwards). Nothing was sent.',
      );
    if (mainAddress !== undefined) {
      const ped = await this.pedigreeIn(mainAddress, record);
      if (before.stacks.member(record) && !ped.ok)
        throw new Error(`Buyers would refuse this offer: ${ped.why}. Nothing was sent.`);
      if (!before.stacks.member(record)) {
        const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
        const main = state ? veilcoreLedger(state.data) : undefined;
        const id = main ? identityOf(main, record) : record;
        if (main?.pendingParentOf.member(id))
          throw new Error(
            'A parentage proposal of this record is still waiting in the VeilCore contract. Posting now would make ' +
              '"no ancestors" final forever: link and finalise first. Nothing was sent.',
          );
        const agreedElsewhere =
          main !== undefined &&
          [...before.links].some(([, k]) => k.confirmed && hex(identityOf(main, k.child)) === hex(id));
        if (agreedElsewhere)
          throw new Error(
            'Your identity agreed descent terms here under another record: finalise that record and take over its ' +
              'chart (adoptStack) before posting, or growers will refuse this offer forever. Nothing was sent.',
          );
        if (main?.parentsOf.member(id) && main.parentsOf.lookup(id).size() > 0n)
          this.logger?.warn(
            'This record has confirmed parents but no links here: posting makes that final, and they take nothing.',
          );
      }
    }
    const split = chartSplits(before, record);
    if (split && t.rate === 0n)
      throw new Error(
        "This record's ancestors take a share of royalties, so its offers must take royalties. Nothing was sent.",
      );
    const card: OfferCard = {
      kind: 'veilcore-offer-card',
      contract: this.deployedContractAddress.toLowerCase(),
      offer: hex(offer),
      unit: hex(unit),
      rateCommit: hex(rateCommit),
      expires: String(t.expires),
      rate: String(t.rate),
      rateSalt: hex(rateSalt),
      split,
    };
    const issuerSlot = await this.freeIssuerSlot();
    // Kept before the call, so an interrupted post still leaves the secrets and card here.
    await this.updateHeld((h) => ({
      ...h,
      admins: { ...h.admins, [hex(offer)]: hex(adminSecret) },
      issuerKeys: [...(h.issuerKeys ?? []), { offer: hex(offer), secret: hex(issuerSecret) }],
      offerCards: { ...h.offerCards, [hex(offer)]: card },
      mine: keepMine(h.mine, [hex(issuerLeafOf(openingOf(card), issuerSecret))]),
    }));
    const tx = await this.call(
      'postOffer',
      { recordSecret, ...(t.rate > 0n ? { rate: { rate: t.rate, salt: rateSalt } } : {}) },
      (c) =>
        c.callTx.postOffer(
          nonce,
          R.adminCommit(adminSecret),
          t.terms,
          unit,
          t.price,
          rateCommit,
          t.count,
          t.expires,
          t.revocable,
          R.adminCommit(issuerSecret),
          issuerSlot,
        ),
    );
    return { ...tx, offer, adminSecret, issuerSecret, card };
  }

  async closeOffer(offer: Uint8Array, adminSecret?: Uint8Array): Promise<TxRef> {
    const admin = adminSecret ?? (await this.adminFor(offer));
    return this.call('closeOffer', { adminSecret: admin }, (c) => c.callTx.closeOffer(offer));
  }

  async revokeLicense(license: Uint8Array, adminSecret?: Uint8Array): Promise<TxRef & SealResult> {
    const l = await this.currentLedger();
    if (!l.licenseOffer.member(license)) throw new Error('No such live licence. Nothing was sent.');
    const admin = adminSecret ?? (await this.adminFor(l.licenseOffer.lookup(license)));
    const tx = await this.call('revokeLicense', { adminSecret: admin }, (c) => c.callTx.revokeLicense(license));
    return { ...tx, ...(await this.seal()) };
  }

  // ─────────────────────────────────────────── breeder: issuing (payment off chain)

  /**
   * As the BREEDER: issue the licence a licensee's card describes, once they have paid
   * (off chain). The card's keys must make its licence key for this offer (so the breeder
   * can read its settlements); no money moves. On a variety with ancestors, what the
   * licence owes them (each share of the list price, each parent's fee) is recorded on chain
   * in the same call. A licence already on chain is not issued again (an issuance that timed
   * out may have landed: then there is nothing to do).
   */
  async issueLicence(raw: LicenceCard, adminSecret?: Uint8Array): Promise<TxRef & { readonly license: Uint8Array }> {
    const card = normaliseLicenceCard(raw);
    if (card.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That licence card is for another royalties contract. Nothing was sent.');
    const offer = unhex(card.offer);
    const o = await this.offer(offer);
    const admin = adminSecret ?? (await this.adminFor(offer));
    if (card.expires !== undefined && BigInt(card.expires) !== o.expires)
      throw new Error(
        "That licence card's end date is not the offer's: the licensee must make it again. Nothing was sent.",
      );
    // The contract makes the licence key from this commitment and the offer, so a licence can
    // only ever be issued on the offer it names.
    const commitment = R.licenseCommit(unhex(card.viewKey), unhex(card.spendKey), offer);
    const license = R.licenseKey(commitment, offer, o.expires);
    if (hex(license) !== card.licence)
      throw new Error(
        "That licence card's keys do not make its licence key: it is not the licensee's real card. Nothing was sent.",
      );
    const l = await this.currentLedger();
    if (l.everSold.member(license))
      throw new AlreadyDoneError('That licence is already on chain (issued or bought). Nothing was sent.');
    if (!o.open) throw new Error('That offer is closed. Nothing was sent.');
    if (o.expires <= nowSeconds()) throw new Error('That offer has ended. Nothing was sent.');
    if (o.remaining === 0n) throw new Error('That offer has no licences left. Nothing was sent.');
    const slot = await this.freeSlot();
    const tx = await this.call('issueLicense', { adminSecret: admin }, (c) =>
      c.callTx.issueLicense(offer, commitment, slot),
    );
    return { ...tx, license };
  }

  /**
   * What issuing credit on `offer` would show, for the breeder to see first: the ancestors
   * whose share it records (empty for a variety none of whose ancestors takes a royalty share
   * now), and, for a private issuance, how many offers on this contract it could be from.
   */
  async issuePreview(
    offer: Uint8Array,
  ): Promise<{ readonly places: ChartPlace[]; readonly candidates?: number; readonly warning?: string }> {
    const l = await this.currentLedger();
    if (!l.offers.member(offer)) throw new Error('No such offer on this contract.');
    const o = l.offers.lookup(offer);
    if (o.split)
      return {
        places: chartOf(l, o.record).filter(
          (p) => p.until > nowSeconds() && p.unit === hex(o.unit) && p.effectiveShare > 0,
        ),
      };
    const candidates = issueCandidates(l);
    return { places: [], candidates, warning: candidateWarning(candidates) };
  }

  /**
   * As the BREEDER (the offer's credit issuer): issue `amount` of credit to a licensee's
   * top-up request, for a payment they made off chain, in the offer's unit. No money moves;
   * the note on chain is the licensee's receipt that the breeder acknowledged the payment.
   * For an ordinary offer, what is published names neither the offer nor the amount; but it
   * can only be from an offer that has issued licences, and where there are few of those,
   * anyone can narrow it to them (issuePreview counts them). For a variety whose ancestors
   * take a royalty share it names the offer and the amount, and records each share as owed.
   * The request names nobody: compare its code's fingerprint with the licensee by another
   * channel, since a swapped code credits whoever made it. The same code and amount can be
   * issued once; a second request is needed to issue more. Kept in this computer's books
   * (issuedTotal) before it is sent.
   */
  async issueCredit(
    raw: TopUpRequest,
    amount: bigint,
  ): Promise<TxRef & { readonly note: Uint8Array; readonly fingerprint: string }> {
    const req = normaliseTopUpRequest(raw);
    if (amount <= 0n) throw new Error('Credit must be more than zero. Nothing was sent.');
    if (amount >= 1n << 64n) throw new Error('That amount is too large. Nothing was sent.');
    if (req.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That request is for another royalties contract. Nothing was sent.');
    const offer = unhex(req.offer);
    const o = await this.offer(offer);
    if (isZero(o.rateCommit))
      throw new Error('That offer takes no royalties: there is no credit to issue. Nothing was sent.');
    const issuer = await this.issuerFor(offer);
    const op = openingOf(fieldsOf(offer, o));
    const code = unhex(req.code);
    const note = R.noteCommit(code, offerLeafOf(op), amount);
    const fingerprint = codeFingerprint(req.code);
    const l = await this.currentLedger();
    if (l.noteSeen.member(note))
      throw new AlreadyDoneError(
        `Credit of exactly ${amount} to that request is already on chain (perhaps an issuance that timed out did ` +
          'land). A code and amount are issued once: to issue more, ask the licensee for a new request. Nothing was sent.',
      );
    if (!o.split) {
      const w = candidateWarning(issueCandidates(l));
      if (w !== undefined) this.logger?.warn(w);
    }
    // Kept before the call: a timeout can come after it landed. Only notes the chain shows count.
    await this.updateHeld((h) => ({
      ...h,
      issued: [
        ...(h.issued ?? []),
        { offer: hex(offer), note: hex(note), amount: String(amount), fingerprint, at: String(nowSeconds()) },
      ],
    }));
    const tx = o.split
      ? await this.call('issueCreditSplit', { issuerSecret: issuer, code }, (c) =>
          c.callTx.issueCreditSplit(offer, amount),
        )
      : await this.call('issueCredit', { issuerSecret: issuer, opening: op, code, amount }, (c) =>
          c.callTx.issueCredit(),
        );
    return { ...tx, note, fingerprint };
  }

  /** Credit this computer issued on `offer` that is on chain (its own books: what it acknowledged). */
  async issuedTotal(offer: Uint8Array): Promise<{ readonly total: bigint; readonly count: number }> {
    const l = await this.currentLedger();
    const landed = ((await this.held()).issued ?? []).filter(
      (x) => x.offer === hex(offer) && l.noteSeen.member(unhex(x.note)),
    );
    return { total: landed.reduce((a, x) => a + BigInt(x.amount), 0n), count: landed.length };
  }

  /**
   * As the offer's ADMIN: name a new credit issuer key (made and kept here), when the old
   * one is lost or may be stolen. The old key stops issuing at the next seal that is due
   * (at most an hour; sealed here when it can be). Credit already issued stays valid: the
   * breeder's own books (what it issued, against what was settled) show any it did not issue.
   */
  async changeCreditIssuer(offer: Uint8Array, adminSecret?: Uint8Array): Promise<TxRef & SealResult> {
    const o = await this.offer(offer);
    const admin = adminSecret ?? (await this.adminFor(offer));
    const secret = utils.randomBytes(32);
    const card = fieldsOf(offer, o);
    // Kept before the call: whichever key the chain names is the one used.
    await this.updateHeld((h) => ({
      ...h,
      issuerKeys: [...(h.issuerKeys ?? []), { offer: hex(offer), secret: hex(secret) }],
      mine: keepMine(h.mine, [hex(issuerLeafOf(openingOf(card), secret))]),
    }));
    const tx = await this.call('changeCreditIssuer', { adminSecret: admin }, (c) =>
      c.callTx.changeCreditIssuer(offer, R.adminCommit(secret)),
    );
    return { ...tx, ...(await this.seal()) };
  }

  /**
   * A licence card checked against the chain: its keys must make a licence sold from its
   * offer. Works after the offer is removed too, from the end date on the card.
   */
  async checkLicenceCard(raw: LicenceCard): Promise<void> {
    const card = normaliseLicenceCard(raw);
    if (card.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That licence card is for another royalties contract.');
    const l = await this.currentLedger();
    const offer = unhex(card.offer);
    const expires =
      card.expires !== undefined
        ? BigInt(card.expires)
        : l.offers.member(offer)
          ? l.offers.lookup(offer).expires
          : undefined;
    if (expires === undefined)
      throw new Error('That licence card has no end date and its offer is gone: ask the licensee for a new card.');
    const key = R.licenseKey(R.licenseCommit(unhex(card.viewKey), unhex(card.spendKey), offer), offer, expires);
    if (hex(key) !== card.licence.toLowerCase())
      throw new Error("That licence card's keys do not make its licence key: it is not the licensee's real card.");
    if (!l.everSold.member(key))
      throw new Error('No licence with that key was ever bought or issued on this contract.');
  }

  /**
   * Every settlement on this contract made under one of `cards`. The contract keeps each
   * settlement (its masked units and receipt), so this reads the current state only and
   * misses none. A settlement whose period is not among `periods` is still reported, with
   * no period: the label cannot be read back, only checked. Cards that fail their check
   * are skipped and listed in `refused` (as is a card for an offer this computer does not
   * run, unless `anyOffer`); the same licence twice is read once. A settlement is matched
   * to a card by unmasking its units with the card's viewing key (a wrong key gives a value
   * far outside any unit count); its period is named when its receipt checks out against a
   * listed label. Each says which of the licence's settlements it is (`number`, from its
   * lookup tag), so a skipped number shows.
   */
  async readSettlements(
    cards: readonly unknown[],
    periods: readonly string[],
    opts: { readonly anyOffer?: boolean } = {},
  ): Promise<{
    readonly found: SettlementReading[];
    readonly refused: readonly { card: unknown; licence?: string; why: string }[];
  }> {
    const ok: LicenceCard[] = [];
    const refused: { card: unknown; licence?: string; why: string }[] = [];
    const admins = (await this.held()).admins;
    for (const raw of cards) {
      let c: LicenceCard;
      try {
        c = normaliseLicenceCard(raw);
      } catch (e) {
        refused.push({ card: raw, why: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (ok.some((x) => x.licence === c.licence)) continue;
      try {
        await this.checkLicenceCard(c);
        if (opts.anyOffer !== true && admins[c.offer] === undefined)
          throw new Error(
            `its offer ${c.offer.slice(0, 10)} is not one this computer runs (if it is yours, posted elsewhere, read it there)`,
          );
        ok.push(c);
      } catch (e) {
        refused.push({ card: c, licence: c.licence, why: e instanceof Error ? e.message : String(e) });
      }
    }
    const labels = periods.map((p) => ({ p, bytes: periodBytes(p) }));
    const found: SettlementReading[] = [];
    const l = await this.currentLedger();
    for (const [change, st] of l.settlements) {
      for (const card of ok) {
        const view = unhex(card.viewKey);
        const units = (st.unitsMasked - R.unitsMask(view, change) + FIELD_MODULUS) % FIELD_MODULUS;
        if (units === 0n || units >= 1n << 64n) continue;
        const offer = unhex(card.offer);
        const leafFor = (b: Uint8Array): string => hex(R.receiptLeaf(R.receiptCommit(view, b), offer, units, change));
        const period = labels.find((x) => leafFor(x.bytes) === hex(st.receipt))?.p;
        let number: number | undefined;
        for (let n = 0; n < 4096 && number === undefined; n++) {
          const tag = R.settleTag(view, BigInt(n));
          if (hex(tag) === hex(st.tag)) number = n;
          else if (!l.settlementByTag.member(tag)) break;
        }
        found.push({ licence: card.licence, offer: card.offer, period, units, receipt: hex(st.receipt), number });
        break;
      }
    }
    return { found, refused };
  }

  // ─────────────────────────────────────────── licensee: licence and credit

  /** Keep an offer card (checked against the chain) for later credit and settlements. */
  async keepOfferCard(raw: OfferCard): Promise<void> {
    const card = normaliseOfferCard(raw);
    if (card.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That offer card is for another royalties contract.');
    const o = await this.offer(unhex(card.offer));
    if (!isZero(o.rateCommit)) checkOfferCard(card, o);
    await this.updateHeld((h) => ({ ...h, offerCards: { ...h.offerCards, [card.offer]: card } }));
  }

  /** The offer card this client holds for `offer` (made here, or kept when asking for a licence), to write out again. */
  async offerCard(offer: Uint8Array): Promise<OfferCard> {
    return this.cardOf(offer);
  }

  /**
   * Rule 1 for asking for a licence from `offer` (the record must be the live head of an
   * anchored identity; the pedigree must match).
   * Returns the warnings to show before the grower goes on.
   */
  async licenceChecks(offer: Uint8Array, mainAddress: ContractAddress): Promise<string[]> {
    const o = await this.offer(offer);
    return this.offerChecks(o.record, mainAddress);
  }

  /**
   * As a GROWER, for an offer whose breeder issues licences: make a licence (a fresh
   * secret, kept here) and the licence card to hand the breeder with payment. No
   * transaction: the breeder issues the licence from the card (issueLicence), and can then
   * read its settlements. Refused unless the card matches the chain and opens its rate, the
   * offer is open with licences left, and its record stands in the main contract (the live
   * head of an anchored identity). Refused (AlreadyDoneError) if this client already holds a licence from the
   * offer, live or not yet issued, unless `again`: write that one's card again (78).
   */
  async requestLicence(
    raw: OfferCard,
    mainAddress: ContractAddress,
    opts: { readonly again?: boolean } = {},
  ): Promise<{ readonly license: Uint8Array; readonly licenceCard: LicenceCard; readonly warnings: string[] }> {
    const card = normaliseOfferCard(raw);
    const offer = unhex(card.offer);
    if (card.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That offer card is for another royalties contract.');
    const o = await this.offer(offer);
    if (!isZero(o.rateCommit)) checkOfferCard(card, o);
    if (!o.open) throw new Error('That offer is closed.');
    if (o.expires <= nowSeconds()) throw new Error('That offer has ended.');
    if (o.remaining === 0n) throw new Error('That offer has no licences left.');
    if (
      opts.again !== true &&
      ((await this.liveLicences(offer)).length > 0 || (await this.pendingLicences(offer)).length > 0)
    )
      throw new AlreadyDoneError(
        'This computer already holds a licence from that offer, issued or still waiting to be (78 writes its card ' +
          'again).',
      );
    const warnings = await this.offerChecks(o.record, mainAddress);
    const secret = utils.randomBytes(32);
    const license = licenceKeyOf(secret, offer, o.expires);
    await this.updateHeld((h) => ({
      ...h,
      offerCards: { ...h.offerCards, [card.offer]: card },
      licences: [...h.licences, { offer: hex(offer), secret: hex(secret), expires: String(o.expires) }],
      mine: keepMine(h.mine, [hex(license)]),
    }));
    return { license, licenceCard: this.cardFor(secret, offer, license, o.expires), warnings };
  }

  /**
   * The licence card for this client's licence from `offer` (live, ended but not cleared,
   * or asked for and not issued yet), to hand the breeder again.
   */
  async licenceCard(offer: Uint8Array): Promise<LicenceCard> {
    const lic = (await this.liveLicences(offer, true)).at(-1) ?? (await this.pendingLicences(offer)).at(-1);
    if (lic === undefined)
      throw new Error(
        'This client holds no licence from that offer (none asked for or bought here, revoked, ended or never landed).',
      );
    return this.cardFor(
      unhex(lic.secret),
      offer,
      licenceKeyOf(unhex(lic.secret), offer, BigInt(lic.expires)),
      BigInt(lic.expires),
    );
  }

  /**
   * A top-up request to hand the breeder with a payment for royalties: the offer, a fresh
   * code naming nobody, and the code's fingerprint (to compare by phone).
   */
  async topUpRequest(
    offer: Uint8Array,
  ): Promise<TopUpRequest & { readonly nonce: string; readonly fingerprint: string }> {
    const lic = await this.licenceFor(offer);
    const card = await this.cardOf(offer);
    const nonce = utils.randomBytes(32);
    const licence = hex(licenceKeyOf(unhex(lic.secret), offer, BigInt(lic.expires)));
    await this.updateHeld((h) => ({
      ...h,
      codes: [...(h.codes ?? []), { offer: card.offer, licence, nonce: hex(nonce) }],
    }));
    const code = hex(R.topUpCode(R.spendKey(unhex(lic.secret), offer), nonce));
    return {
      kind: 'veilcore-topup-request',
      contract: this.deployedContractAddress.toLowerCase(),
      offer: card.offer,
      code,
      nonce: hex(nonce),
      fingerprint: codeFingerprint(code),
    };
  }

  /**
   * Record credit issued or paid against a top-up request this client made: the amount the
   * breeder issued, or someone paid. Checked on chain before it is kept. Tries every open
   * code for the offer when `nonceHex` is not given.
   */
  async claimTopUp(offer: Uint8Array, nonceHex: string | undefined, amount: bigint): Promise<NoteOpening> {
    const card = await this.cardOf(offer);
    const l = await this.currentLedger();
    const h0 = await this.held();
    const lics = this.licencesOf(h0, offer);
    const codes = (h0.codes ?? []).filter(
      (c) => c.offer === card.offer && (nonceHex === undefined || c.nonce === nonceHex.toLowerCase()),
    );
    let alreadyRecorded = false;
    for (const code of codes) {
      const note: NoteOpening = { nonce: unhex(code.nonce), amount };
      for (const { lic, key } of lics) {
        if (code.licence !== undefined && code.licence !== key) continue;
        const cm = noteOf(unhex(lic.secret), note.nonce, openingOf(card), amount);
        if (!l.noteSeen.member(cm)) continue;
        // Recording the same credit twice changes nothing (and never revives a spent note).
        if ((h0.notes ?? []).some((x) => x.offer === card.offer && sameNote(x, note))) {
          alreadyRecorded = true;
          continue;
        }
        await this.updateHeld((h) => ({
          ...h,
          notes: [
            ...(h.notes ?? []),
            { offer: card.offer, licence: key, nonce: code.nonce, amount: String(amount), spent: false },
          ],
          mine: keepMine(h.mine, [hex(cm)]),
        }));
        return note;
      }
    }
    throw new Error(
      alreadyRecorded
        ? `Every top-up of exactly ${amount} that landed for your codes on that offer is already recorded.`
        : `No credit of exactly ${amount} has landed (issued or paid) for your top-up codes on that offer yet.`,
    );
  }

  /**
   * Settle a period privately: spends credit covering units x rate (merging two notes first
   * if no single one covers it), keeps the change, records the receipt. Moves no money.
   * Uses only credit of a licence that has not settled that period yet: if every licence
   * held here with credit already has a settlement on chain for it, refused
   * (AlreadyDoneError) unless `again` (a settlement that timed out may have landed).
   */
  async settle(
    offer: Uint8Array,
    rawPeriod: string,
    units: bigint,
    opts: { readonly evenIfLinkable?: boolean; readonly again?: boolean } = {},
  ): Promise<TxRef> {
    if (units <= 0n) throw new Error('A settlement covers at least one unit.');
    if (units >= 1n << 64n) throw new Error('That is too many units for one settlement.');
    const period = rawPeriod.trim();
    const pb = periodBytes(period);
    const card = await this.cardOf(offer);
    // Which licences held here already have a settlement on chain for this period.
    const settledBy = new Map<string, bigint[]>();
    const h = await this.held();
    for (const r of await this.settlements(offer)) {
      if (r.change === undefined || hex(periodBytes(r.period)) !== hex(pb)) continue;
      for (const { lic, key } of this.licencesOf(h, offer)) {
        const leaf = R.receiptLeaf(
          R.receiptCommit(R.viewKey(unhex(lic.secret), offer), pb),
          offer,
          BigInt(r.units),
          unhex(r.change),
        );
        if (hex(leaf) === r.leaf) settledBy.set(key, [...(settledBy.get(key) ?? []), BigInt(r.units)]);
      }
    }
    const rate = BigInt(card.rate);
    const owed = units * rate;
    await this.assertNotLatest(['sale', 'note'], opts);
    const find = async (): Promise<{ pick?: Spendable; pair?: [Spendable, Spendable]; blocked: boolean }> => {
      const l = await this.currentLedger();
      // Only credit whose licence the chain still holds (live, or ended within the grace) can settle.
      const held = (await this.spendable(offer, l)).filter((s) => l.licenseOffer.member(unhex(s.key)));
      const usable = held
        .filter((s) => opts.again === true || !settledBy.has(s.key))
        .sort((a, b) => (a.note.amount < b.note.amount ? -1 : a.note.amount > b.note.amount ? 1 : 0));
      const blocked = usable.length < held.length;
      const pick = usable.find((s) => s.note.amount >= owed);
      if (pick !== undefined) return { pick, blocked };
      for (const key of new Set(usable.map((s) => s.key))) {
        const mine = usable.filter((s) => s.key === key);
        const [x, y] = [mine.at(-1), mine.at(-2)];
        if (x !== undefined && y !== undefined && x.note.amount + y.note.amount >= owed)
          return { pair: [x, y], blocked };
      }
      return { blocked };
    };
    const first = await find();
    const pair = first.pair;
    let pick = first.pick;
    if (pick === undefined && pair === undefined && first.blocked)
      throw new AlreadyDoneError(
        `You already settled ${period} on that offer (${[...settledBy.values()]
          .flat()
          .map((u) => `${u} unit(s)`)
          .join(', ')}): perhaps a settlement that timed out did land. Nothing was sent.`,
      );
    if (pick === undefined && pair !== undefined) {
      await this.merge(offer, pair[0], pair[1]);
      await this.assertNotLatest(['sale', 'note'], { ...opts, afterOwnMerge: true });
      ({ pick } = await find());
    }
    if (pick === undefined)
      throw new Error(
        `Your credit on that offer does not cover ${units} unit(s) at the agreed rate. Top up first. Nothing was sent.`,
      );
    const spent = pick.note;
    const secret = unhex(pick.lic.secret);
    const op = openingOf(card);
    const change: NoteOpening = {
      nonce: changeNonceOf(secret, spent.nonce, op, spent.amount),
      amount: spent.amount - owed,
    };
    const changeCm = noteOf(secret, change.nonce, op, change.amount);
    const view = R.viewKey(secret, offer);
    const receipt = R.receiptLeaf(R.receiptCommit(view, periodBytes(period)), offer, units, changeCm);
    // The next free settlement number of this licence: the breeder's lookup tag.
    const l = await this.currentLedger();
    let index = 0n;
    while (l.settlementByTag.member(R.settleTag(view, index))) index++;
    // Kept before the call: a timeout can come after the settlement landed, and the change
    // would otherwise be lost. Only notes and receipts the chain shows are ever counted.
    await this.updateHeld((h) => ({
      ...h,
      notes: [
        ...(h.notes ?? []),
        { offer: card.offer, licence: pick.key, nonce: hex(change.nonce), amount: String(change.amount), spent: false },
      ],
      receipts: [
        ...h.receipts,
        { offer: card.offer, period, units: String(units), leaf: hex(receipt), change: hex(changeCm) },
      ],
      mine: keepMine(h.mine, [hex(changeCm), hex(receipt)]),
    }));
    const tx = await this.call(
      'settle',
      {
        licenseSecret: secret,
        opening: op,
        expires: BigInt(pick.lic.expires),
        note: spent,
        rate: { rate, salt: unhex(card.rateSalt) },
        period: periodBytes(period),
        units,
        index,
      },
      (c) => c.callTx.settle(),
    );
    await this.markSpent(card.offer, [spent]);
    return tx;
  }

  // ─────────────────────────────────────────── descent (royalties on offspring)

  /**
   * As a PARENT: make the terms card for a variety bred from your record. No transaction.
   * The payee key is made here and kept; the child's breeder proposes exactly these terms.
   * Name the child's record (`child`) when you know it: any other record's client refuses
   * the card, and so does yours when confirming.
   */
  async linkTerms(
    parentSecret: Uint8Array,
    t: {
      /** The unit the fee and share are counted in, as text (the child's offers must name the same). */
      readonly unit: string;
      readonly fee: bigint;
      readonly share: bigint;
      readonly generations: bigint;
      readonly until: bigint;
      readonly child?: Uint8Array;
    },
  ): Promise<LinkTermsCard> {
    if (t.share < 0n || t.share > 5000n) throw new Error('A share is 0 to 5000 basis points (at most half).');
    if (t.generations < 1n || t.generations > 3n) throw new Error('A link runs for 1 to 3 generations.');
    if (t.fee < 0n || t.fee >= 1n << 64n) throw new Error('The fee is out of range.');
    if (t.until <= nowSeconds()) throw new Error('The end date must be in the future.');
    if (t.until >= 1n << 62n) throw new Error('That end date is too far ahead.');
    const unit = unitOf(t.unit);
    if (t.child !== undefined && t.child.length !== 32) throw new Error("The child's record is 32 bytes.");
    const payeeSecret = utils.randomBytes(32);
    const card: LinkTermsCard = {
      kind: 'veilcore-link-terms',
      contract: this.deployedContractAddress.toLowerCase(),
      parent: hex(R.recordCommit(parentSecret)),
      unit: hex(unit),
      fee: String(t.fee),
      share: String(t.share),
      generations: String(t.generations),
      until: String(t.until),
      payee: hex(R.payeeCommit(payeeSecret)),
      ...(t.child !== undefined ? { child: hex(t.child) } : {}),
    };
    await this.updateHeld((h) => ({
      ...h,
      linkTerms: { ...h.linkTerms, [card.payee]: { terms: card, payeeSecret: hex(payeeSecret) } },
    }));
    return card;
  }

  /**
   * What proposing the link on `card` would take on, for showing first: the parent's
   * record, and every place of the parent's own chart that would pass down with it. Refuses
   * a card that cannot work for this record (another contract, another child named, a
   * parent whose ancestors are not final, a unit clashing with this record's other links).
   * With `mainAddress`, refuses a parent other than the one this record has proposed or
   * confirmed as parent in the VeilCore contract, and warns when it has proposed none.
   */
  async checkLinkTerms(
    childSecret: Uint8Array,
    raw: LinkTermsCard,
    mainAddress?: ContractAddress,
  ): Promise<{ readonly card: LinkTermsCard; readonly inherited: ChartPlace[]; readonly warnings: string[] }> {
    const card = normaliseLinkTerms(raw);
    if (card.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That terms card is for another royalties contract. Nothing was sent.');
    const child = R.recordCommit(childSecret);
    if (card.child !== undefined && card.child !== hex(child))
      throw new Error('That terms card was made for another record, not yours. Nothing was sent.');
    if (card.parent === hex(child)) throw new Error('A record is not its own parent. Nothing was sent.');
    if (BigInt(card.share) > 5000n || BigInt(card.generations) > 3n)
      throw new Error('Those terms are outside what the contract allows. Nothing was sent.');
    if (BigInt(card.until) <= nowSeconds()) throw new Error('Those terms have already ended. Nothing was sent.');
    const l = await this.currentLedger();
    if (l.stacks.member(child))
      throw new Error("Your record's ancestors are already final: no new links. Nothing was sent.");
    const parent = unhex(card.parent);
    if (!l.stacks.member(parent))
      throw new Error(
        "That parent's own ancestors are not final yet, so it could not confirm. Ask its breeder to finalise first. " +
          'Nothing was sent.',
      );
    const warnings: string[] = [];
    // Every share this record's chart could hold must be owed in one unit.
    const units = new Set<string>();
    if (l.shareUnitOf.member(child)) units.add(hex(l.shareUnitOf.lookup(child)));
    for (const [, k] of l.links)
      if (hex(k.child) === hex(child) && k.share > 0n && hex(k.parent) !== card.parent) units.add(hex(k.unit));
    if (BigInt(card.share) > 0n) units.add(card.unit);
    // What the parent's chart passes down: its parents while their links run two generations,
    // its grandparents while theirs run three (as finaliseStack builds it).
    const pst = l.stacks.lookup(parent);
    const carried = (lid: Uint8Array, g: bigint): Uint8Array =>
      !isZero(lid) && l.links.member(lid) && l.links.lookup(lid).generations >= g ? lid : ZERO32();
    const passed: Uint8Array[] = Array.from({ length: 14 }, () => ZERO32());
    [pst[0], pst[1]].forEach((x, i) => (passed[2 + i] = carried(x, 2n)));
    [pst[2], pst[3], pst[4], pst[5]].forEach((x, i) => (passed[6 + i] = carried(x, 3n)));
    const inherited = chartOfPlaces(l, passed);
    for (const p of inherited) if (p.effectiveShare > 0 && p.until > nowSeconds()) units.add(p.unit);
    if (units.size > 1)
      throw new Error(
        "Those terms would leave your variety's ancestors owed in two units, so no offer of it could ever be posted. " +
          'Agree one unit with every parent. Nothing was sent.',
      );
    if (mainAddress !== undefined) {
      const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
      if (state === null || state === undefined)
        throw new Error(`No VeilCore contract at ${mainAddress} to check the parent against. Nothing was sent.`);
      const main = veilcoreLedger(state.data);
      const id = identityOf(main, child);
      const pid = hex(identityOf(main, parent));
      const proposed = main.pendingParentOf.member(id) ? [hex(main.pendingParentOf.lookup(id))] : [];
      const confirmed = main.parentsOf.member(id) ? [...main.parentsOf.lookup(id)].map(hex) : [];
      const known = [...proposed, ...confirmed];
      if (known.length > 0 && !known.includes(pid))
        throw new Error(
          `That card's parent (record ${card.parent.slice(0, 10)}) is not the parent your record proposed or has in ` +
            'the VeilCore contract. A confirmed link can never be removed. Nothing was sent.',
        );
      if (known.length === 0)
        warnings.push(
          `your record has proposed no parent in the VeilCore contract yet: check that record ${card.parent.slice(0, 10)} ` +
            'is the parent you mean (a confirmed link can never be removed), and propose exactly it there',
        );
      if (!main.recoveryOf.member(identityOf(main, parent)))
        throw new Error("That card's parent record is not anchored in the VeilCore contract. Nothing was sent.");
      // An old record of the parent's identity (replaced by a key change, or recovered from a
      // thief) can still confirm with its old secret: whoever holds that secret would be paid.
      if (hex(headOfIdentity(main, identityOf(main, parent))) !== card.parent)
        throw new Error(
          "That card's parent record is no longer its identity's current record (a key change or a recovery from " +
            "theft since): whoever holds the old secret could confirm it and be paid. Ask the parent's breeder for " +
            'terms from their current record. Nothing was sent.',
        );
    }
    return { card, inherited, warnings };
  }

  /** As a CHILD: propose the link on the parent's terms card. Binds nothing until the parent confirms. */
  async proposeLink(
    childSecret: Uint8Array,
    raw: LinkTermsCard,
    mainAddress?: ContractAddress,
  ): Promise<TxRef & { readonly link: Uint8Array }> {
    const { card, warnings } = await this.checkLinkTerms(childSecret, raw, mainAddress);
    for (const w of warnings) this.logger?.warn(w);
    const child = R.recordCommit(childSecret);
    const tx = await this.call('proposeLink', { recordSecret: childSecret }, (c) =>
      c.callTx.proposeLink(
        unhex(card.parent),
        unhex(card.unit),
        BigInt(card.fee),
        BigInt(card.share),
        BigInt(card.generations),
        BigInt(card.until),
        unhex(card.payee),
      ),
    );
    return { ...tx, link: R.linkId(child, unhex(card.parent)) };
  }

  /** As a CHILD: withdraw a link the parent has not confirmed. */
  async withdrawLink(childSecret: Uint8Array, parent: Uint8Array): Promise<TxRef> {
    return this.call('withdrawLink', { recordSecret: childSecret }, (c) => c.callTx.withdrawLink(parent));
  }

  /**
   * As a PARENT: confirm a child's link, only if its terms are exactly a card you made
   * (and, if the card names a child, only for that child). Your own ancestors must be
   * final first (posting an offer finalises an empty chart).
   */
  async confirmLink(parentSecret: Uint8Array, child: Uint8Array): Promise<TxRef> {
    const parent = R.recordCommit(parentSecret);
    const l = await this.currentLedger();
    const id = R.linkId(child, parent);
    if (!l.links.member(id)) throw new Error('No link proposed from that record to yours. Nothing was sent.');
    const link = l.links.lookup(id);
    const mine = (await this.held()).linkTerms?.[hex(link.payee)];
    const t = mine?.terms;
    if (
      t === undefined ||
      t.parent !== hex(parent) ||
      t.unit !== hex(link.unit) ||
      BigInt(t.fee) !== link.fee ||
      BigInt(t.share) !== link.share ||
      BigInt(t.generations) !== link.generations ||
      BigInt(t.until) !== link.until
    )
      throw new Error('That link does not carry terms you offered on this computer. Nothing was sent.');
    if (t.child !== undefined && t.child !== hex(child))
      throw new Error('You made those terms for another record. Nothing was sent.');
    if (!l.stacks.member(parent))
      throw new Error(
        'Finalise your own ancestors first (a variety with no parents: post an offer, or finalise an empty chart). ' +
          'Nothing was sent.',
      );
    // The contract confirms only these exact terms, so a link changed after this check is refused on chain.
    const termsHash = R.linkTermsHash(
      unhex(t.unit),
      BigInt(t.fee),
      BigInt(t.share),
      BigInt(t.generations),
      BigInt(t.until),
      link.payee,
    );
    return this.call('confirmLink', { recordSecret: parentSecret }, (c) => c.callTx.confirmLink(child, termsHash));
  }

  /**
   * What finalising would make final: every confirmed link of this record (the contract
   * demands all of them), each checked against the main contract. Refused while a
   * parentage proposal or a link is still waiting, or when a parent agreed terms with an
   * earlier record of this identity (take over that chart instead). A main-contract parent
   * with no link here is left out with a warning (it takes nothing). `concerns` are what
   * the child should stop for, though the contract would still accept the chart (and the
   * links can never be dropped, so refusing would strand the variety): a link whose parent
   * the main contract does not confirm (growers and verifiers will see the chart owe a non-parent), or
   * whose parent record was since recovered from theft (the thief may be paid). The way out
   * of either is a key change in the main contract: the new record has no links.
   */
  async finalisePreview(
    childSecret: Uint8Array,
    mainAddress: ContractAddress,
  ): Promise<{
    readonly links: readonly Uint8Array[];
    readonly places: ChartPlace[];
    readonly warnings: string[];
    readonly concerns: string[];
  }> {
    const child = R.recordCommit(childSecret);
    const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
    if (state === null || state === undefined)
      throw new Error(`No VeilCore contract at ${mainAddress}. Nothing was sent.`);
    const main = veilcoreLedger(state.data);
    const l = await this.currentLedger();
    if (l.stacks.member(child)) throw new Error("Your record's ancestors are already final.");
    const id = identityOf(main, child);
    if (main.pendingParentOf.member(id))
      throw new Error(
        'A parentage proposal of your record is still waiting in the VeilCore contract (withdraw it, or wait for ' +
          'the answer). Nothing was sent.',
      );
    if (l.linksPending.member(child) && l.linksPending.lookup(child) > 0n)
      throw new Error('A link of your record is still waiting for its parent. Nothing was sent.');
    const parents = main.parentsOf.member(id) ? [...main.parentsOf.lookup(id)].map(hex) : [];
    const mine = [...l.links].filter(([, k]) => k.confirmed && hex(k.child) === hex(child));
    const warnings: string[] = [];
    const concerns: string[] = [];
    for (const [, k] of mine) {
      const pid = identityOf(main, k.parent);
      const short = hex(k.parent).slice(0, 10);
      if (!parents.includes(hex(pid)))
        concerns.push(
          `parent record ${short} confirmed a link, but the VeilCore contract does not confirm it as your record's ` +
            'parent: growers and verifiers will see your chart owe a non-parent',
        );
      if (hex(headOfIdentity(main, pid)) !== hex(k.parent)) {
        if (main.recoveriesOf.member(pid) && main.recoveriesOf.lookup(pid).read() > 0n)
          concerns.push(
            `parent record ${short} has since been recovered from theft: its link may have been confirmed by the thief, ` +
              'who would then be paid',
          );
        else warnings.push(`Parent record ${short} is no longer its identity's current record (a key change since).`);
      }
    }
    for (const p of parents) {
      if (mine.some(([, k]) => hex(identityOf(main, k.parent)) === p)) continue;
      // A link agreed under an earlier record of this identity cannot be used from this one.
      const elsewhere = [...l.links].some(
        ([, k]) => k.confirmed && hex(identityOf(main, k.child)) === hex(id) && hex(identityOf(main, k.parent)) === p,
      );
      if (elsewhere)
        throw new Error(
          `Parent ${p.slice(0, 10)} agreed terms with an earlier record of yours: finalise that record and take ` +
            'over its chart (adoptStack) instead. Nothing was sent.',
        );
      warnings.push(`Parent ${p.slice(0, 10)} set no terms here: it will take nothing from this variety.`);
    }
    const links = mine.map(([lid]) => lid);
    // The chart the contract would build, for showing first.
    const chart: Uint8Array[] = Array.from({ length: 14 }, () => ZERO32());
    const carried = (lid: Uint8Array, g: bigint): Uint8Array =>
      !isZero(lid) && l.links.member(lid) && l.links.lookup(lid).generations >= g ? lid : ZERO32();
    const parentChart = (lid: Uint8Array | undefined): Uint8Array[] =>
      lid === undefined ? Array.from({ length: 14 }, () => ZERO32()) : [...l.stacks.lookup(l.links.lookup(lid).parent)];
    const [a, b] = [parentChart(links[0]), parentChart(links[1])];
    const places = [
      links[0] ?? ZERO32(),
      links[1] ?? ZERO32(),
      carried(a[0], 2n),
      carried(a[1], 2n),
      carried(b[0], 2n),
      carried(b[1], 2n),
      ...[a[2], a[3], a[4], a[5], b[2], b[3], b[4], b[5]].map((x) => carried(x, 3n)),
    ];
    places.forEach((x, i) => (chart[i] = x));
    return { links, places: chartOfPlaces(l, chart), warnings, concerns };
  }

  /**
   * As a CHILD: make your ancestors final (see finalisePreview for what is checked). Refused
   * while there are concerns, unless `despite`. Cannot be undone.
   */
  async finaliseStack(
    childSecret: Uint8Array,
    mainAddress: ContractAddress,
    opts: { readonly despite?: boolean } = {},
  ): Promise<TxRef> {
    const { links, warnings, concerns } = await this.finalisePreview(childSecret, mainAddress);
    if (concerns.length > 0 && opts.despite !== true)
      throw new Error(
        `Not made final: ${concerns.join('; ')}. A key change in the VeilCore contract gives a new record with no ` +
          'links, if you would rather start again. Nothing was sent.',
      );
    for (const w of [...warnings, ...concerns]) this.logger?.warn(w);
    const [a, b] = [links[0] ?? ZERO32(), links[1] ?? ZERO32()];
    return this.call('finaliseStack', { recordSecret: childSecret }, (c) => c.callTx.finaliseStack(a, b));
  }

  /** A record that replaced `earlier` (same identity in the main contract) takes over its chart. */
  async adoptStack(newSecret: Uint8Array, earlier: Uint8Array, mainAddress: ContractAddress): Promise<TxRef> {
    const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
    if (state === null || state === undefined)
      throw new Error(`No VeilCore contract at ${mainAddress}. Nothing was sent.`);
    const main = veilcoreLedger(state.data);
    if (hex(identityOf(main, R.recordCommit(newSecret))) !== hex(identityOf(main, earlier)))
      throw new Error('Those two records are not one identity in the VeilCore contract. Nothing was sent.');
    return this.call('adoptStack', { recordSecret: newSecret }, (c) => c.callTx.adoptStack(earlier));
  }

  /** The payee key kept here for a link, checked against the chain and the 30-day limit. */
  private async payeeFor(link: Uint8Array): Promise<{ readonly secret: Uint8Array; readonly now: bigint }> {
    const l = await this.currentLedger();
    if (!l.links.member(link)) throw new Error('No such link. Nothing was sent.');
    const k = l.links.lookup(link);
    const kept = (await this.held()).linkTerms?.[hex(k.payee)];
    if (kept === undefined) throw new Error("This computer does not hold that link's payee key. Nothing was sent.");
    const now = nowSeconds();
    if (k.changedAt + PAYEE_CHANGE_INTERVAL > now)
      throw new Error(
        `That link was changed less than 30 days ago: it can be changed again from ${new Date(
          Number(k.changedAt + PAYEE_CHANGE_INTERVAL) * 1000,
        ).toISOString()}. Nothing was sent.`,
      );
    // The contract takes a time within the last five minutes of the block time; a minute back allows for clocks.
    return { secret: unhex(kept.payeeSecret), now: now - 60n };
  }

  /**
   * As a PARENT: lower a link's terms (a smaller share or fee, an earlier end), with the
   * payee key kept here. Never raises them; once in 30 days. Lowering is final. (Shares are
   * recorded exactly, so no share is ever too small to record: lowering stalls nothing.)
   */
  async relaxLink(
    link: Uint8Array,
    to: { readonly share?: bigint; readonly fee?: bigint; readonly until?: bigint },
  ): Promise<TxRef> {
    const l = await this.currentLedger();
    if (!l.links.member(link)) throw new Error('No such link. Nothing was sent.');
    const k = l.links.lookup(link);
    const share = to.share ?? k.share;
    const fee = to.fee ?? k.fee;
    const until = to.until ?? k.until;
    if (share > k.share || fee > k.fee || until > k.until)
      throw new Error("A link's terms can only be lowered. Nothing was sent.");
    if (share < 0n || fee < 0n) throw new Error('Terms cannot be negative. Nothing was sent.');
    if (share === k.share && fee === k.fee && until === k.until)
      throw new Error('Nothing would change. Nothing was sent.');
    const { secret, now } = await this.payeeFor(link);
    return this.call('relaxLink', { adminSecret: secret }, (c) => c.callTx.relaxLink(link, share, fee, until, now));
  }

  // ─────────────────────────────────────────── presentations

  /**
   * A presentation request from this verifier. Its scope is the same every time this
   * verifier asks about the same offer (made from a seed kept in this client's store), so
   * one licence answering for several growers shows the same holder tag each time. The
   * cost: anyone on chain can also see that equal tags repeat. A period label is matched
   * exactly: where the terms charge per delivery, ask for that delivery's label, or one
   * settled season can vouch for any number of deliveries.
   */
  async presentationRequest(args: {
    readonly offer: Uint8Array;
    readonly period?: string;
    readonly minUnits?: bigint;
    readonly validForSeconds?: number;
    readonly live?: boolean;
  }): Promise<PresentationRequest> {
    let seed = (await this.held()).verifierSeed;
    if (seed === undefined) {
      const fresh = hex(utils.randomBytes(32));
      seed = fresh;
      await this.updateHeld((h) => ({ ...h, verifierSeed: h.verifierSeed ?? fresh }));
      seed = (await this.held()).verifierSeed ?? fresh;
    }
    const scope = createHash('sha256')
      .update('veilcore:royalties:v2:verifier-scope')
      .update(unhex(seed))
      .update(args.offer)
      .digest();
    return newPresentationRequest({ ...args, contract: this.deployedContractAddress, scope: Uint8Array.from(scope) });
  }

  /** Each licence held here for `offer`, as what a presentation needs (keys, end date, settlements on chain). */
  private async proversFor(offer: Uint8Array): Promise<Prover[]> {
    const h = await this.held();
    const settled = await this.settlements(offer);
    return h.licences
      .filter((x) => x.offer === hex(offer))
      .map((lic) => {
        const secret = unhex(lic.secret);
        const present = R.presentKey(secret, offer);
        return {
          present,
          spend: R.spendKey(secret, offer),
          expires: BigInt(lic.expires),
          receipts: settled.flatMap((r) => {
            if (r.change === undefined) return [];
            const units = BigInt(r.units);
            const leaf = R.receiptLeaf(
              R.receiptCommit(R.viewOf(present), periodBytes(r.period)),
              offer,
              units,
              unhex(r.change),
            );
            return hex(leaf) === r.leaf ? [{ period: r.period, units, change: unhex(r.change) }] : [];
          }),
        };
      });
  }

  /**
   * A presentation card for the newest licence held here from `offer` (live, or ended and
   * not yet cleared), with every settlement of it on chain. For someone who answers
   * verifiers for you: it proves, never spends. Anyone holding it can answer as this licence.
   */
  async presentationCard(offer: Uint8Array): Promise<PresentationCard> {
    const l = await this.currentLedger();
    const held = (await this.proversFor(offer)).filter((p) => l.licenseOffer.member(proverLeaf(p, offer)));
    const p = held.at(-1);
    if (p === undefined) throw new Error('This client holds no licence from that offer that the chain still holds.');
    return {
      kind: 'veilcore-presentation-card',
      contract: this.deployedContractAddress.toLowerCase(),
      offer: hex(offer),
      licence: hex(proverLeaf(p, offer)),
      present: hex(p.present),
      spendKey: hex(p.spend),
      expires: String(p.expires),
      receipts: p.receipts.map((r) => ({ period: r.period, units: String(r.units), change: hex(r.change) })),
    };
  }

  /**
   * Answer a verifier's request with a licence held here (or, with `card`, the licence a
   * presentation card is for) that the chain still holds and, if the request asks for a
   * live licence, that is live past the time asked; if it asks about a period, with a
   * settlement on chain covering it (rule 2 applies, judged by this client's own
   * transactions: a delegate cannot see the licensee's).
   */
  async prove(
    request: PresentationRequest,
    opts: { readonly units?: bigint; readonly evenIfLinkable?: boolean; readonly card?: PresentationCard } = {},
  ): Promise<TxRef> {
    const req = normalised(request);
    if (req.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That request is for another royalties contract. Nothing was sent.');
    const offer = unhex(req.offer);
    const validAt = BigInt(req.validAt);
    if (validAt <= nowSeconds()) throw new Error('That request has expired: ask the verifier for a new one.');
    let provers: Prover[];
    if (opts.card !== undefined) {
      const card = normalisePresentationCard(opts.card);
      if (card.contract !== req.contract) throw new Error('That presentation card is for another royalties contract.');
      if (card.offer !== req.offer)
        throw new Error('That presentation card is for another offer than the one asked about.');
      provers = [
        {
          present: unhex(card.present),
          spend: unhex(card.spendKey),
          expires: BigInt(card.expires),
          receipts: card.receipts.map((r) => ({ period: r.period, units: BigInt(r.units), change: unhex(r.change) })),
        },
      ];
    } else provers = await this.proversFor(offer);
    const l = await this.currentLedger();
    const usable = provers.filter(
      (p) => l.licenseOffer.member(proverLeaf(p, offer)) && (!req.live || p.expires > validAt),
    );
    if (usable.length === 0)
      throw new Error(
        req.live
          ? 'No licence from that offer is held here that is live at the time the verifier asks about.'
          : 'No licence from that offer is held here that the chain still holds.',
      );
    const period = unhex(req.period);
    let pick: { p: Prover; r?: { units: bigint; change: Uint8Array } } = { p: usable[usable.length - 1] };
    if (!isZero(period)) {
      // A settlement on chain for this period covering what is asked (the most units,
      // unless told which), newest licence first.
      const found = [...usable].reverse().flatMap((p) =>
        p.receipts
          .filter((r) => hex(periodBytes(r.period)) === req.period)
          .filter((r) => (opts.units === undefined ? true : r.units === opts.units))
          .filter((r) => {
            const leaf = R.receiptLeaf(R.receiptCommit(R.viewOf(p.present), period), offer, r.units, r.change);
            return l.receipts.findPathForLeaf(leaf) !== undefined;
          })
          .map((r) => ({ p, r })),
      );
      if (found.length === 0)
        throw new Error(
          opts.units === undefined
            ? 'No settlement on chain for that period under a licence held here.'
            : `No settlement of exactly ${opts.units} unit(s) for that period under a licence held here.`,
        );
      const best = found.reduce((a, b) => (b.r.units > a.r.units ? b : a));
      if (best.r.units < BigInt(req.minUnits))
        throw new Error('Your settlement for that period covers fewer units than asked.');
      pick = best;
    }
    await this.assertNotLatest(isZero(period) ? ['sale'] : ['sale', 'receipt'], opts);
    const { p, r } = pick;
    return this.call(
      'proveLicense',
      {
        offer,
        present: p.present,
        spend: p.spend,
        expires: p.expires,
        challenge: unhex(req.challenge),
        ...(r !== undefined ? { period, units: r.units, change: r.change } : {}),
      },
      (c) => c.callTx.proveLicense(period, BigInt(req.minUnits), validAt, unhex(req.scope), req.live),
    );
  }

  /**
   * The verifier checks the licensee's transaction against the request it made. Only
   * revocations on the offer asked about matter (the contract tracks them per offer).
   * With `mainAddress`, NOT accepted when the offer's record no longer stands in the main
   * contract (not anchored, or recovered from theft) or its pedigree does not match.
   */
  async verifyPresentation(
    request: PresentationRequest,
    txId: string,
    indexerUri: string,
    mainAddress?: ContractAddress,
  ): Promise<PresentationVerdict> {
    const req = normalised(request);
    if (req.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That request is for another royalties contract: join that one to check it.');
    const found = await singleCallState(
      indexerUri,
      this.deployedContractAddress,
      txId,
      ['proveLicense'],
      'That transaction is not a single presentation on this royalties contract.',
    );
    const offer = unhex(req.offer);
    const cells = royaltiesLedger(found.state.data);
    const expected = R.presentationTag(
      offer,
      unhex(req.period),
      BigInt(req.minUnits),
      BigInt(req.validAt),
      unhex(req.scope),
      unhex(req.challenge),
      req.live,
    );
    const now = await this.currentLedger();
    const { gone, unsealed, revokedSince } = revocationVerdict(offer, cells, now);
    if (gone)
      return {
        accepted: false,
        lines: ['FAILED That offer has ended and been removed, so this answer cannot be judged now.'],
      };
    const lines: string[] = [];
    const tagOk = hex(cells.lastPresentation) === hex(expected);
    const settled = `that period settled for at least ${req.minUnits} unit(s)`;
    lines.push(
      tagOk
        ? isZero(unhex(req.period))
          ? 'ok     A live licence from the offer you asked about, live at the time you asked.'
          : req.live
            ? `ok     A live licence from that offer, and ${settled}.`
            : `ok     A licence from that offer (it may have ended since), and ${settled} under it.`
        : 'FAILED This transaction does not answer your request (another offer, period, time, scope or challenge).',
    );
    if (unsealed) {
      const at = revocationSealableAt(now);
      lines.push(
        'WAIT   A licence from this offer was revoked and not yet sealed when this was proved, so this answer ' +
          'cannot be trusted. ' +
          (at === undefined
            ? 'It has been sealed since: ask for a new answer.'
            : `It can be sealed (anyone can, menu 68) from ${new Date(Number(at) * 1000).toISOString()} ` +
              '(a revocation is sealed at most once an hour, so it can take up to an hour); ask for a new answer after that.'),
      );
    }
    if (revokedSince)
      lines.push('WAIT   A licence from this offer has been revoked since this was proved. Ask for a new answer.');
    const holder = hex(cells.lastPresentationHolder);
    lines.push(`holder ${holder} (repeats if the same licence answers you again in this scope)`);
    if (tagOk) {
      const seen = ((await this.held()).seenHolders?.[req.offer] ?? []).filter(
        (x) => x.holder === holder && x.at !== txId,
      );
      if (seen.length > 0)
        lines.push(
          `NOTE   This licence has answered you before (transaction ${seen.map((x) => x.at).join(', ')}). ` +
            'If that was for another grower, one licence is vouching for both.',
        );
      await this.updateHeld((h) => {
        const list = h.seenHolders?.[req.offer] ?? [];
        return list.some((x) => x.holder === holder && x.at === txId)
          ? h
          : { ...h, seenHolders: { ...h.seenHolders, [req.offer]: [...list, { holder, at: txId }].slice(-256) } };
      });
    }
    lines.push(
      'note   This shows that someone holding a live licence (or its presentation card) answered, not that the ' +
        'person in front of you holds it.',
    );
    let standsOk = true;
    if (mainAddress !== undefined) {
      const record = now.offers.lookup(offer).record;
      const v = standingVerdict(await this.recordStandingIn(mainAddress, record));
      if (v.refuse !== undefined) {
        standsOk = false;
        lines.push(`FAILED ${v.refuse}.`);
      } else if (v.warn !== undefined) lines.push(`note   ${v.warn}.`);
      const ped = await this.pedigreeIn(mainAddress, record);
      if (!ped.ok) {
        standsOk = false;
        lines.push(`FAILED The variety's pedigree does NOT match the VeilCore contract: ${ped.why}.`);
      } else {
        lines.push("ok     The variety's pedigree matches the VeilCore contract.");
        for (const w of ped.warnings) lines.push(`note   ${w}`);
      }
    }
    return { accepted: tagOk && !unsealed && !revokedSince && standsOk, lines, holder };
  }

  // ─────────────────────────────────────────── upkeep

  /**
   * Seal when it does something. A waiting revocation is sealed at most once an hour (each
   * such seal voids proofs in flight): before then, no seal is sent, and `sealableAt` says
   * when it can be (the contract would accept a seal sooner, but it would leave the
   * revocation waiting). `sealed` means the trees were sealed and no revocation is waiting.
   */
  async seal(): Promise<SealResult> {
    const l = await this.currentLedger();
    if (!l.unsealedChanges && !l.issuerChanges && !l.rootsSinceSeal) return { sealed: false, waiting: false };
    const now = nowSeconds();
    const skew = BigInt(SEAL_SKEW_SECONDS);
    let earliest: bigint;
    if (l.unsealedChanges || l.issuerChanges) {
      // Only a seal that seals the revocation (or the replaced issuer) is worth sending.
      earliest = (keyChangeSealableAt(l) ?? 0n) + skew;
    } else earliest = l.lastSealTime + BigInt(SEAL_INTERVAL_SECONDS) + skew;
    if (now < earliest) return { sealed: false, waiting: true, sealableAt: Number(earliest) };
    try {
      await this.call('sealRevocations', {}, (c) => c.callTx.sealRevocations(now + BigInt(SEAL_AHEAD_SECONDS)));
      const after = await this.currentLedger();
      if (!after.unsealedChanges && !after.issuerChanges) return { sealed: true, waiting: false };
      const at = keyChangeSealableAt(after);
      return { sealed: false, waiting: true, ...(at !== undefined ? { sealableAt: Number(at + skew) } : {}) };
    } catch (e) {
      this.logger?.info(`seal not made now: ${e instanceof Error ? e.message : String(e)}`);
      const after = await this.currentLedger();
      const at = keyChangeSealableAt(after);
      return {
        sealed: false,
        waiting: after.unsealedChanges || after.issuerChanges || after.rootsSinceSeal,
        ...(at !== undefined ? { sealableAt: Number(at + skew) } : {}),
      };
    }
  }

  /**
   * Send the seal that stops a replaced credit issuer key, if one is waiting and due: until a
   * seal is sent, the old key can still issue. Clients call this on every royalties action.
   * Returns the seal's result, or undefined when nothing was waiting or it is not due yet.
   */
  async sealIfIssuerChangeDue(): Promise<SealResult | undefined> {
    const l = await this.currentLedger();
    if (!l.issuerChanges) return undefined;
    const at = keyChangeSealableAt(l);
    if (at === undefined || nowSeconds() < at + BigInt(SEAL_SKEW_SECONDS)) return undefined;
    return this.seal();
  }

  /** When a seal that stops a replaced credit issuer key can be sent (undefined: none is waiting). */
  async issuerChangeSealableAt(): Promise<bigint | undefined> {
    const l = await this.currentLedger();
    return l.issuerChanges ? keyChangeSealableAt(l) : undefined;
  }

  /**
   * How many ended licences (30 days past their offer's end) could be cleared now, and how
   * many ended offers have no licence left and could be removed.
   */
  async clearable(): Promise<{ readonly licences: number; readonly offers: number }> {
    const now = nowSeconds();
    const l = await this.currentLedger();
    const past = new Set([...l.offers].filter(([, o]) => o.expires + SETTLE_GRACE <= now).map(([id]) => hex(id)));
    return {
      licences: [...l.licenseOffer].filter(([, id]) => past.has(hex(id))).length,
      offers: [...l.offers].filter(
        ([id, o]) => o.expires <= now && (!l.liveOf.member(id) || l.liveOf.lookup(id).read() === 0n),
      ).length,
    };
  }

  /**
   * Clear licences 30 days past their offer's end, then remove ended offers with none left:
   * at most `max` transactions in all (each is its own transaction, paid by whoever runs
   * this; anyone may). Offers cost nothing to post, so this never runs unbounded.
   */
  async clearEnded(max = CLEAR_ENDED_CAP): Promise<{ readonly licences: number; readonly offers: number }> {
    const now = nowSeconds();
    const l = await this.currentLedger();
    const clearable = new Set([...l.offers].filter(([, o]) => o.expires + SETTLE_GRACE <= now).map(([id]) => hex(id)));
    const attempt = async (what: string, f: () => Promise<unknown>): Promise<boolean> => {
      try {
        await f();
        return true;
      } catch (e) {
        this.logger?.info(`${what} not done now: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    };
    let budget = max;
    let licences = 0;
    for (const [k, id] of [...l.licenseOffer]) {
      if (!clearable.has(hex(id))) continue;
      if (budget-- <= 0) break;
      if (await attempt('clearEnded', () => this.call('clearEnded', {}, (c) => c.callTx.clearEnded(k)))) licences++;
    }
    const after = await this.currentLedger();
    let offers = 0;
    for (const [id, o] of [...after.offers]) {
      if (o.expires > now || (after.liveOf.member(id) && after.liveOf.lookup(id).read() > 0n)) continue;
      if (budget-- <= 0) break;
      if (await attempt('removeEnded', () => this.call('removeEnded', {}, (c) => c.callTx.removeEnded(id)))) offers++;
    }
    return { licences, offers };
  }

  // ─────────────────────────────────────────── plumbing

  private cardFor(secret: Uint8Array, offer: Uint8Array, license: Uint8Array, expires: bigint): LicenceCard {
    return {
      expires: String(expires),
      kind: 'veilcore-licence-card',
      contract: this.deployedContractAddress.toLowerCase(),
      offer: hex(offer),
      licence: hex(license),
      viewKey: hex(R.viewKey(secret, offer)),
      spendKey: hex(R.spendKey(secret, offer)),
    };
  }

  private async cardOf(offer: Uint8Array): Promise<OfferCard> {
    const card = (await this.held()).offerCards?.[hex(offer)];
    if (card === undefined)
      throw new Error('This client holds no offer card for that offer: load the one the breeder gave you.');
    return card;
  }

  /**
   * Rule 2: refuse while the newest leaf of a tree this proof uses is this client's own.
   * Every proof publishes the root it used; a root whose newest leaf is yours points at the
   * transaction that put it there. Only the trees the circuit proves against count:
   * settle uses licences and notes, merge uses notes, a presentation uses licences (and
   * receipts when it asks about a period). A private issuance is not held back: the issuer
   * tree changes only when offers are posted, so its root says nothing an issuance does not
   * (issuePreview counts the offers it could be from instead).
   */
  private async assertNotLatest(
    trees: readonly Tree[],
    opts: { readonly afterOwnMerge?: boolean; readonly evenIfLinkable?: boolean } = {},
  ): Promise<void> {
    if (opts.evenIfLinkable === true) return;
    const l = await this.currentLedger();
    const mine = new Set((await this.held()).mine ?? []);
    const latest: Record<Tree, [Uint8Array, string, string]> = {
      sale: [l.lastSale, 'licence', 'licence issued on this contract'],
      note: [l.lastNote, 'credit note', 'credit issued, settlement or merge'],
      receipt: [l.lastReceipt, 'settlement', 'settlement'],
    };
    for (const t of trees) {
      const [leaf, what, next] = latest[t];
      if (mine.has(hex(leaf)))
        throw new WouldLinkError(
          `${opts.afterOwnMerge === true ? 'Your credit was merged into one note (that transaction landed). ' : ''}Your own ${what} is still ` +
            `the newest on chain, so anyone watching could guess this proof is yours. After someone else's next ` +
            `${next} it could be theirs as well; the more people use the contract, the better that hides it. ` +
            (opts.afterOwnMerge === true ? 'The settlement itself was not sent.' : 'Nothing was sent.'),
          opts.afterOwnMerge === true,
        );
    }
  }

  /** Merge two notes of the same licence into one (kept before the call, as in settle). */
  private async merge(offer: Uint8Array, a: Spendable, b: Spendable): Promise<void> {
    if (a.key !== b.key) throw new Error('Only notes of the same licence can be merged.');
    const card = await this.cardOf(offer);
    const secret = unhex(a.lic.secret);
    const op = openingOf(card);
    const merged: NoteOpening = {
      nonce: changeNonceOf(secret, a.note.nonce, op, a.note.amount),
      amount: a.note.amount + b.note.amount,
    };
    await this.updateHeld((h) => ({
      ...h,
      notes: [
        ...(h.notes ?? []),
        { offer: card.offer, licence: a.key, nonce: hex(merged.nonce), amount: String(merged.amount), spent: false },
      ],
      mine: keepMine(h.mine, [hex(noteOf(secret, merged.nonce, op, merged.amount))]),
    }));
    await this.call('mergeNotes', { licenseSecret: secret, opening: op, note: a.note, note2: b.note }, (c) =>
      c.callTx.mergeNotes(),
    );
    await this.markSpent(card.offer, [a.note, b.note]);
  }

  private async markSpent(offer: string, spent: readonly NoteOpening[]): Promise<void> {
    await this.updateHeld((h) => ({
      ...h,
      notes: (h.notes ?? []).map((x) =>
        x.offer === offer && spent.some((n) => sameNote(x, n)) ? { ...x, spent: true } : x,
      ),
    }));
  }

  /** Every licence held for `offer`, with its licence key. */
  private licencesOf(h: RoyaltiesHeld, offer: Uint8Array): { readonly lic: HeldLicence; readonly key: string }[] {
    return h.licences
      .filter((x) => x.offer === hex(offer))
      .map((lic) => ({ lic, key: hex(licenceKeyOf(unhex(lic.secret), offer, BigInt(lic.expires))) }));
  }

  /**
   * Unspent notes for `offer` this client holds, each with the licence that spends it, checked
   * against the chain: the note landed and its nullifier has not. A note sent but never landed,
   * or a licence bought but never landed, is simply never matched.
   */
  private async spendable(offer: Uint8Array, ledger?: RoyaltiesLedger): Promise<Spendable[]> {
    const h = await this.held();
    const card = h.offerCards?.[hex(offer)];
    if (card === undefined) return [];
    const l = ledger ?? (await this.currentLedger());
    const op = openingOf(card);
    const lics = this.licencesOf(h, offer);
    const out: Spendable[] = [];
    const counted = new Set<string>();
    for (const n of h.notes ?? []) {
      if (n.offer !== hex(offer) || n.spent) continue;
      const note: NoteOpening = { nonce: unhex(n.nonce), amount: BigInt(n.amount) };
      for (const { lic, key } of lics) {
        if (n.licence !== undefined && n.licence !== key) continue;
        const secret = unhex(lic.secret);
        const cm = noteOf(secret, note.nonce, op, note.amount);
        if (!l.noteSeen.member(cm)) continue;
        if (!counted.has(hex(cm)) && !l.nullifiers.member(R.nullifier(R.nullifierKey(secret), cm))) {
          counted.add(hex(cm));
          out.push({ note, lic, key });
        }
        break;
      }
    }
    return out;
  }

  private async adminFor(offer: Uint8Array): Promise<Uint8Array> {
    const s = (await this.held()).admins[hex(offer)];
    if (s === undefined || hex(R.adminCommit(unhex(s))) !== hex((await this.offer(offer)).admin))
      throw new Error('This client holds no admin secret that runs that offer now: type it in. Nothing was sent.');
    return unhex(s);
  }

  /** The credit issuer secret kept here that the chain names for `offer` now. */
  private async issuerFor(offer: Uint8Array): Promise<Uint8Array> {
    const want = hex((await this.offer(offer)).issuer);
    const k = ((await this.held()).issuerKeys ?? []).find(
      (x) => x.offer === hex(offer) && hex(R.adminCommit(unhex(x.secret))) === want,
    );
    if (k === undefined)
      throw new Error(
        'This computer holds no credit issuer key for that offer (posted elsewhere, or replaced since): issue from ' +
          "the computer that holds it, or name a new one here with the offer's admin secret (86). Nothing was sent.",
      );
    return unhex(k.secret);
  }

  /** Licences held for `offer` that the chain has never seen (asked for, not issued yet), oldest first. */
  private async pendingLicences(offer: Uint8Array): Promise<HeldLicence[]> {
    const l = await this.currentLedger();
    return (await this.held()).licences.filter(
      (x) =>
        x.offer === hex(offer) &&
        !l.everSold.member(licenceKeyOf(unhex(x.secret), offer, BigInt(x.expires))) &&
        BigInt(x.expires) > nowSeconds(),
    );
  }

  /** A free place in the issuer tree (below 2^32), for a new offer. */
  private async freeIssuerSlot(): Promise<bigint> {
    const l = await this.currentLedger();
    for (let i = 0; i < 64; i++) {
      const s = BigInt(Buffer.from(utils.randomBytes(4)).readUInt32BE(0));
      if (!l.issuerSlotTaken.member(s)) return s;
    }
    throw new Error('Could not find a free issuer place. Try again.');
  }

  /** Licences held for `offer` that the chain shows live (or, `allowEnded`, ended but not cleared), oldest first. */
  private async liveLicences(offer: Uint8Array, allowEnded = false): Promise<HeldLicence[]> {
    const l = await this.currentLedger();
    return (await this.held()).licences.filter(
      (x) =>
        x.offer === hex(offer) &&
        l.licenseOffer.member(licenceKeyOf(unhex(x.secret), offer, BigInt(x.expires))) &&
        (allowEnded || BigInt(x.expires) > nowSeconds()),
    );
  }

  /** The newest licence held for `offer` that the chain shows live (or, `allowEnded`, ended but not cleared). */
  private async licenceFor(offer: Uint8Array, allowEnded = false): Promise<HeldLicence> {
    const live = await this.liveLicences(offer, allowEnded);
    if (live.length === 0)
      throw new Error(
        'This client holds no live licence from that offer (none bought here, revoked, ended or never landed).',
      );
    return live[live.length - 1];
  }

  private async freeSlot(): Promise<bigint> {
    const l = await this.currentLedger();
    for (let i = 0; i < 64; i++) {
      const b = utils.randomBytes(4);
      const s = BigInt(((b[0] << 16) | (b[1] << 8) | b[2]) >>> 0) % LICENSE_SLOTS;
      if (!l.licenseAtSlot.member(s)) return s;
    }
    throw new Error('Could not find a free licence slot. Try again.');
  }

  private async updateHeld(f: (h: RoyaltiesHeld) => RoyaltiesHeld): Promise<void> {
    const next = f(await this.held());
    this.kept = mergeHeld(this.kept, next);
    // Merged with the disk as it is now, not as it was read: another run may have written since.
    const ps = await this.providers.privateStateProvider.get(royaltiesPrivateStateKey);
    const disk = { ...emptyRoyaltiesHeld(), ...(ps?.held ?? {}) };
    await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, {
      input: ps?.input ?? {},
      held: mergeHeld(disk, this.kept),
    });
  }

  /** How many transactions this client has started building (a refusal before one starts sends nothing). */
  private callsStarted = 0;

  /**
   * Send one call. midnight-js reads the private state when the call starts and writes it
   * back when the transaction is final, minutes later: whatever another run kept meanwhile
   * is merged back in afterwards (held() merges the disk with what this run kept, which
   * includes the state before the call). A settle, merge or presentation whose root went
   * stale on the way (a seal retired it: at most once an hour for a revocation, and daily)
   * is proved again against the current trees and sent once more.
   */
  private async call(
    circuit: string,
    input: RoyaltyInput,
    call: (c: DeployedRoyaltiesContract) => Promise<{ public: TxRef & { nextContractState: StateValue } }>,
  ): Promise<TxRef> {
    this.callsStarted++;
    let txData;
    try {
      for (let attempt = 0; ; attempt++) {
        await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input, held: await this.held() });
        try {
          txData = await call(this.deployedContract);
          break;
        } catch (e) {
          if (attempt > 0 || !REPROVE_ON_STALE.has(circuit) || !isStaleRootError(e)) throw e;
          this.logger?.info(
            `${circuit}: the root it proved against was retired before it landed (a seal); proving it again once.`,
          );
        }
      }
    } finally {
      await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input: {}, held: await this.held() });
    }
    const { txId, txHash, blockHeight } = txData.public;
    this.logger?.info({ transactionAdded: { circuit, txHash, blockHeight } });
    return { txId, txHash, blockHeight };
  }

  private static async authorityOf(
    providers: RoyaltiesProviders,
    address: ContractAddress,
  ): Promise<AuthorityView & { readonly retired: boolean }> {
    const state = await providers.publicDataProvider.queryContractState(address);
    if (state === null || state === undefined) throw new Error(`No royalties contract state at ${address}.`);
    const a = state.maintenanceAuthority;
    return { committee: a.committee, threshold: a.threshold, counter: a.counter, retired: isProvablyRetired(a) };
  }

  async authority(): Promise<AuthorityView & { readonly retired: boolean }> {
    return RoyaltiesAPI.authorityOf(this.providers, this.deployedContractAddress);
  }

  // ─────────────────────────────────────────── deploy and join

  static async deploy(
    providers: RoyaltiesProviders,
    logger?: Logger,
    firstFragment = FIRST_FRAGMENT,
  ): Promise<RoyaltiesAPI> {
    assertRoyaltiesDeployAllowed(logger);
    let deployTxId: string | undefined;
    const address = await deployInFragments({
      providers,
      circuits: ROYALTIES_PROVABLE_CIRCUITS,
      firstFragment,
      create: (keep) =>
        createUnprovenDeployTx(providers, {
          compiledContract: compiledRoyaltiesDeploying(keep),
          initialPrivateState: emptyRoyaltiesPrivateState(),
          // A key that exists only to add the circuit keys; it is retired, provably, below.
          signingKey: sampleSigningKey(),
        }),
      submit: async (unprovenTx) => (deployTxId = await submitTxAsync(providers, { unprovenTx })),
      store: async (candidate, unsubmitted) => {
        providers.privateStateProvider.setContractAddress(candidate);
        await providers.privateStateProvider.set(
          royaltiesPrivateStateKey,
          unsubmitted.private.initialPrivateState as RoyaltiesPrivateState,
        );
        await providers.privateStateProvider.setSigningKey(candidate, unsubmitted.private.signingKey);
      },
      finish: 'Finish a royalties deploy',
      logger,
    });
    logger?.info(`Royalties deploy transaction id: ${deployTxId}. Keep it with the royalties contract address.`);
    return RoyaltiesAPI.finishDeploy(providers, address, logger);
  }

  static confirmIntervalMs = 2_000;

  static async finishDeploy(
    providers: RoyaltiesProviders,
    address: ContractAddress,
    logger?: Logger,
  ): Promise<RoyaltiesAPI> {
    assertRoyaltiesDeployAllowed(logger);
    let api: RoyaltiesAPI;
    try {
      if (!(await RoyaltiesAPI.authorityOf(providers, address)).retired) {
        const maintenance = createCircuitMaintenanceTxInterfaces(providers, CompiledVeilcoreRoyalties, address);
        type Circuit = keyof typeof maintenance;
        await addMissingKeys({
          providers,
          address,
          circuits: ROYALTIES_PROVABLE_CIRCUITS,
          insert: async (circuit) =>
            maintenance[circuit as Circuit].insertVerifierKey(
              await providers.zkConfigProvider.getVerifierKey(circuit as Circuit),
            ),
          finish: 'Finish a royalties deploy',
          logger,
        });
      }
      api = await RoyaltiesAPI.join(providers, address, logger, { deploying: true });
    } catch (e) {
      logger?.error(
        `The royalties contract IS on chain at ${address}, but not every circuit key was added. Do NOT deploy it ` +
          'again: run again with the same password and wallet, choose "Finish a royalties deploy", and give it this address.',
      );
      throw e;
    }
    // Deploy behaviour is unchanged: the authority is retired, so this contract can never be
    // changed. The founders want upgradability; versioned upgrades are designed on another
    // branch, not here.
    try {
      await retireMaintenanceAuthorityProvably(providers, address, logger, RoyaltiesAPI.confirmIntervalMs);
    } catch (e) {
      logger?.error(
        `The royalties contract at ${address} has every circuit key, but its maintenance authority is NOT retired ` +
          'yet. Do not pay through it until it is: choose "Finish a royalties deploy" with this address.',
      );
      throw e;
    }
    if (!(await api.authority()).retired)
      throw new Error(`The royalties contract at ${address} still shows a maintenance authority.`);
    logger?.info(
      `Royalties contract ready at ${address}: all ${ROYALTIES_PROVABLE_CIRCUITS.length} circuit keys on chain, ` +
        'maintenance authority an empty committee (nobody can change it).',
    );
    return api;
  }

  static async join(
    providers: RoyaltiesProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
    options: { readonly deploying?: boolean } = {},
  ): Promise<RoyaltiesAPI> {
    if (options.deploying !== true) assertRoyaltiesJoinAllowed(contractAddress, logger);
    // Every write of the private state, midnight-js's own included, merges with the disk.
    providers = { ...providers, privateStateProvider: mergingPrivateStateProvider(providers.privateStateProvider) };
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(royaltiesPrivateStateKey);
    const deployed = await findDeployedContract<RoyaltiesContract>(providers, {
      contractAddress,
      compiledContract: CompiledVeilcoreRoyalties,
      privateStateId: royaltiesPrivateStateKey,
      initialPrivateState: existing ?? emptyRoyaltiesPrivateState(),
    });
    const extra = await unknownCircuits(providers, contractAddress, ROYALTIES_PROVABLE_CIRCUITS);
    if (extra.length > 0)
      throw new Error(`The contract carries circuits this build does not have: ${extra.join(', ')}. Do not use it.`);
    const api = new RoyaltiesAPI(deployed, providers, logger);
    const a = await api.authority();
    if (!a.retired)
      logger?.warn(
        `This royalties contract still has a maintenance authority (${a.committee.length} key(s), threshold ` +
          `${a.threshold}): whoever holds it could change what its circuits accept. Do not pay through it until it is retired.`,
      );
    return api;
  }
}
