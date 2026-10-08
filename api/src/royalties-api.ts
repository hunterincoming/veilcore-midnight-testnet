// The client API for the VeilCore royalties contract, version 2 (contract/src/veilcore-royalties.compact).
// SPDX-License-Identifier: Apache-2.0
//
// Public money, private books. A breeder posts an offer and hands licensees an OFFER CARD
// (the rate and its salt, which the chain only commits to). A grower buys a licence and
// hands the breeder a LICENCE CARD (viewing and spending keys for that offer). Royalty
// credit is topped up in public, by the grower or by anyone holding the grower's TOP-UP
// REQUEST; each period is settled in private against that credit. The breeder reads every
// settlement of their own licensees with the licence cards. A buyer or regulator checks a
// licence, and a settled period, with a PRESENTATION REQUEST.
//
// Rules the contract cannot enforce, enforced here:
//   1. Buy only from an offer whose record is the live head of an anchored identity in the
//      main VeilCore contract (ledger 8 has no calls between contracts).
//   2. Never prove while the latest sale, credit note or receipt on chain is one of yours:
//      the root a proof publishes would then name your own transaction.
//   3. Open the rate from the offer card before paying: credit against a rate that does
//      not match, or is zero, could never be settled (the contract refuses it too).
//
// Secrets kept between runs (admin secrets, licence secrets, credit notes) live in this
// client's encrypted store; each call's input is kept in memory only (transientInput).
// Design and limits: docs/royalties-design.md.

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
  emptyRoyaltiesHeld,
  emptyRoyaltiesPrivateState,
  licenceKeyOf,
  noteOf,
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

/** NIGHT's token colour, as an offer names it. */
export const NIGHT_COLOR = ZERO32();
export const LICENSE_SLOTS = 16777216n;
/** The scalar field masked units live in (BLS12-381). */
export const FIELD_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const DAY = 86400n;
const SEAL_AHEAD_SECONDS = 200;
const SEAL_SKEW_SECONDS = 30;
/** SETTLE_GRACE in the contract: 30 days after an offer ends before its licences can be cleared. */
const SETTLE_GRACE = 30n * DAY;

// ─────────────────────────────────────────────────────────────── cards and requests

/** What a breeder gives licensees and payers with the terms. Private to them: it holds the rate. */
export type OfferCard = {
  readonly kind: 'veilcore-offer-card';
  readonly contract: string;
  readonly offer: string;
  readonly payTo: string;
  readonly color: string;
  readonly rateCommit: string;
  readonly expires: string;
  readonly rate: string;
  readonly rateSalt: string;
  /** Whether the offer's ancestors take a share of royalties (then top-ups name the offer). Missing means no. */
  readonly split?: boolean;
};

/**
 * What a parent breeder hands the breeder of a new variety bred from theirs: the exact
 * terms of the descent link they will confirm. The child proposes these; the parent's
 * client confirms only a link whose terms match the card it made.
 */
export type LinkTermsCard = HeldLinkTerms;

/** One place in a variety's pedigree chart, as a client shows it before anyone pays. */
export type ChartPlace = {
  readonly place: number;
  /** 1 = parent, 2 = grandparent, 3 = great-grandparent. */
  readonly generation: number;
  readonly link: string;
  readonly parent: string;
  readonly payTo: string;
  readonly color: string;
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

/** What a licensee gives whoever tops up their credit: the offer card and a code naming nobody. */
export type TopUpRequest = {
  readonly kind: 'veilcore-topup-request';
  readonly card: OfferCard;
  readonly code: string;
};

/** What a verifier asks for (as in version 1). */
export type PresentationRequest = {
  readonly contract: string;
  readonly offer: string;
  readonly period: string;
  readonly minUnits: string;
  readonly validAt: string;
  readonly scope: string;
  readonly challenge: string;
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
};

export const openingOf = (c: OfferCard): OfferOpening => ({
  offer: unhex(c.offer),
  payTo: unhex(c.payTo),
  color: unhex(c.color),
  rateCommit: unhex(c.rateCommit),
  expires: BigInt(c.expires),
  split: c.split === true,
});

/** Refuse an offer card that does not match the chain, or whose rate does not open its commitment. */
export const checkOfferCard = (card: OfferCard, onChain?: RoyaltyOffer): void => {
  if (card.kind !== 'veilcore-offer-card') throw new Error('That is not an offer card.');
  const rate = BigInt(card.rate);
  if (rate <= 0n) throw new Error('That offer card has no royalty rate: nothing could settle against credit for it.');
  if (hex(R.rateCommit(rate, unhex(card.rateSalt))) !== card.rateCommit.toLowerCase())
    throw new Error("That offer card's rate does not match its rate commitment. Do not pay against it.");
  if (onChain !== undefined) {
    const same =
      hex(onChain.payTo.bytes) === card.payTo.toLowerCase() &&
      hex(onChain.color) === card.color.toLowerCase() &&
      hex(onChain.rateCommit) === card.rateCommit.toLowerCase() &&
      onChain.expires === BigInt(card.expires) &&
      onChain.split === (card.split === true);
    if (!same) throw new Error('That offer card does not match the offer on chain. Do not pay against it.');
  }
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
}): PresentationRequest => ({
  contract: args.contract.toLowerCase(),
  offer: hex(args.offer),
  period: hex(args.period === undefined || args.period === '' ? ZERO32() : periodBytes(args.period)),
  minUnits: String(args.minUnits ?? 0n),
  validAt: String(Math.floor(Date.now() / 1000) + (args.validForSeconds ?? 3600)),
  scope: hex(args.scope ?? utils.randomBytes(32)),
  challenge: hex(utils.randomBytes(32)),
});

const normalised = (r: PresentationRequest): PresentationRequest => {
  const h = (s: string): string => s.trim().toLowerCase().replace(/^0x/, '');
  return {
    contract: h(r.contract),
    offer: h(r.offer),
    period: h(r.period),
    minUnits: r.minUnits.trim(),
    validAt: r.validAt.trim(),
    scope: h(r.scope),
    challenge: h(r.challenge),
  };
};

/**
 * The time a top-up says the offer is open until: always the start of the day after
 * tomorrow (UTC), the same for every top-up that day, so it names no offer. Undefined when
 * the offer ends before then: top-ups close for an offer's last two days, since any other
 * value would point at its end date. Credit already held still settles.
 */
export const roundedValidUntil = (expires: bigint, now = nowSeconds()): bigint | undefined => {
  const dayAfterTomorrow = (now / DAY + 2n) * DAY;
  return expires >= dayAfterTomorrow ? dayAfterTomorrow : undefined;
};

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
  | { readonly ok: false; readonly why: 'not-anchored' | 'moved' | 'no-contract' };

export const recordStanding = (main: ReturnType<typeof veilcoreLedger>, record: Uint8Array): RecordStanding => {
  const origin = main.originOf.member(record) ? main.originOf.lookup(record) : record;
  if (!main.recoveryOf.member(origin)) return { ok: false, why: 'not-anchored' };
  const live = main.headOf.member(origin)
    ? hex(main.headOf.lookup(origin)) === hex(record)
    : hex(origin) === hex(record);
  return live ? { ok: true } : { ok: false, why: 'moved' };
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
 * Rule 4 (descent): a record's pedigree chart names, identity for identity, exactly the
 * parents the main VeilCore contract confirms for it NOW, and so does every ancestor's,
 * up to three generations. A confirmed parent left out of the chart (or one named that the
 * main contract does not confirm) means refuse. Warns when a parent record has since been
 * recovered from theft, since links it confirmed may have been made by the thief.
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
    if (!roy.stacks.member(r))
      return confirmed.length === 0
        ? undefined
        : `record ${short(r)} has parents confirmed in the VeilCore contract, but its ancestors are not final here`;
    const chart = roy.stacks.lookup(r);
    const named: string[] = [];
    for (const lid of chart.slice(0, 2)) {
      if (isZero(lid)) continue;
      const l = roy.links.lookup(lid);
      if (hex(identityOf(main, l.child)) !== hex(id))
        return `record ${short(r)} uses a pedigree chart of another identity`;
      const pid = identityOf(main, l.parent);
      named.push(hex(pid));
      if (
        main.recoveriesOf.member(pid) &&
        main.recoveriesOf.lookup(pid).read() > 0n &&
        hex(headOfIdentity(main, pid)) !== hex(l.parent)
      )
        warnings.push(
          `parent record ${short(l.parent)} has since been recovered from theft: its link may have been made by the thief`,
        );
    }
    named.sort();
    if (named.length !== confirmed.length || named.some((x, i) => x !== confirmed[i]))
      return `record ${short(r)}'s pedigree chart does not name the parents the VeilCore contract confirms for it`;
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

/** A record's pedigree chart, place by place, for showing before anyone pays. */
export const chartOf = (roy: RoyaltiesLedger, record: Uint8Array): ChartPlace[] => {
  if (!roy.stacks.member(record)) return [];
  return roy.stacks
    .lookup(record)
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
        payTo: hex(l.payTo.bytes),
        color: hex(l.color),
        effectiveShare: Number(l.share) / 2 ** (generation - 1),
        fee: place < 2 ? l.fee : 0n,
        until: l.until,
      };
    });
};

const chartSplits = (roy: RoyaltiesLedger, record: Uint8Array): boolean =>
  roy.stacks.member(record) &&
  roy.stacks.lookup(record).some((lid) => !isZero(lid) && roy.links.member(lid) && roy.links.lookup(lid).share > 0n);

export type OfferView = RoyaltyOffer & { readonly id: Uint8Array };

export type OfferTerms = {
  readonly terms: Uint8Array;
  readonly color: Uint8Array;
  readonly price: bigint;
  /** Royalty per unit, in the token's smallest unit; 0 for none through the contract. */
  readonly rate: bigint;
  readonly payTo: Uint8Array;
  readonly count: bigint;
  readonly expires: bigint;
  readonly revocable: boolean;
};

/**
 * Rule 2 refused: sending now would let anyone watching guess the proof is yours (see
 * assertNotLatest). Callers may wait, or send anyway with `evenIfLinkable`.
 */
export class WouldLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WouldLinkError';
  }
}

/** The trees a proof can use, by the ledger cell naming each one's newest leaf. */
type Tree = 'sale' | 'note' | 'receipt';

/** A note this client can spend, with the licence whose secret spends it. */
type Spendable = { readonly note: NoteOpening; readonly lic: HeldLicence; readonly key: string };

const sameNote = (x: { nonce: string; amount: string }, n: NoteOpening): boolean =>
  x.nonce === hex(n.nonce) && x.amount === String(n.amount);

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
    return [...(await this.currentLedger()).offers].map(([id, o]) => ({ ...o, id }));
  }

  async offer(id: Uint8Array): Promise<OfferView> {
    const l = await this.currentLedger();
    if (!l.offers.member(id)) throw new Error('No such offer on this contract.');
    return { ...l.offers.lookup(id), id };
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

  /** A record's pedigree chart on this contract. */
  async chart(record: Uint8Array): Promise<ChartPlace[]> {
    return chartOf(await this.currentLedger(), record);
  }

  async held(): Promise<RoyaltiesHeld> {
    const ps = await this.providers.privateStateProvider.get(royaltiesPrivateStateKey);
    return { ...emptyRoyaltiesHeld(), ...(ps?.held ?? {}) };
  }

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
   * Post an offer from the record `recordSecret` stands for. Makes the admin secret and the
   * rate salt; returns the offer card to hand licensees with the terms. The admin secret
   * must also be written on paper: without it the offer can never be closed or revoked.
   */
  async postOffer(
    recordSecret: Uint8Array,
    t: OfferTerms,
    mainAddress?: ContractAddress,
  ): Promise<TxRef & { readonly offer: Uint8Array; readonly adminSecret: Uint8Array; readonly card: OfferCard }> {
    if (t.terms.length !== 32 || isZero(t.terms)) throw new Error('The terms fingerprint is 32 bytes, not all zero.');
    if (t.payTo.length !== 32) throw new Error('The payout wallet is a 32-byte unshielded address.');
    if (t.price <= 0n || t.count <= 0n) throw new Error('The price and the number for sale must be more than zero.');
    if (t.rate < 0n) throw new Error('The royalty rate cannot be negative.');
    if (t.expires <= nowSeconds()) throw new Error('The end date must be in the future.');
    if (mainAddress !== undefined) {
      const standing = await this.recordStandingIn(mainAddress, R.recordCommit(recordSecret));
      if (!standing.ok)
        throw new Error(
          'Your record is not the current record of an anchored identity in the VeilCore contract, so buyers would ' +
            'refuse this offer. Anchor it (or act as your current record) first. Nothing was sent.',
        );
    }
    const adminSecret = utils.randomBytes(32);
    const rateSalt = utils.randomBytes(32);
    const nonce = utils.randomBytes(32);
    const offer = R.offerId(R.recordCommit(recordSecret), nonce);
    const rateCommit = t.rate === 0n ? ZERO32() : R.rateCommit(t.rate, rateSalt);
    const before = await this.currentLedger();
    const record = R.recordCommit(recordSecret);
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
    }
    const split = chartSplits(before, record);
    if (split && t.rate === 0n)
      throw new Error(
        "This record's ancestors take a share of royalties, so its offers must take royalties through the contract. Nothing was sent.",
      );
    const card: OfferCard = {
      kind: 'veilcore-offer-card',
      contract: this.deployedContractAddress.toLowerCase(),
      offer: hex(offer),
      payTo: hex(t.payTo),
      color: hex(t.color),
      rateCommit: hex(rateCommit),
      expires: String(t.expires),
      rate: String(t.rate),
      rateSalt: hex(rateSalt),
      split,
    };
    // Kept before the call, so an interrupted post still leaves the admin secret and card here.
    await this.updateHeld((h) => ({
      ...h,
      admins: { ...h.admins, [hex(offer)]: hex(adminSecret) },
      offerCards: { ...h.offerCards, [hex(offer)]: card },
    }));
    const tx = await this.call('postOffer', { recordSecret }, (c) =>
      c.callTx.postOffer(
        nonce,
        R.adminCommit(adminSecret),
        t.terms,
        t.color,
        t.price,
        rateCommit,
        { bytes: t.payTo },
        t.count,
        t.expires,
        t.revocable,
      ),
    );
    return { ...tx, offer, adminSecret, card };
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

  /**
   * A licence card checked against the chain: its keys must make a licence sold from its
   * offer. Works after the offer is removed too, from the end date on the card.
   */
  async checkLicenceCard(card: LicenceCard): Promise<void> {
    if (card.kind !== 'veilcore-licence-card') throw new Error('That is not a licence card.');
    if (card.contract.toLowerCase() !== this.deployedContractAddress.toLowerCase())
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
    if (!l.everSold.member(key)) throw new Error('No licence with that key was ever sold on this contract.');
  }

  /**
   * Every settlement on this contract made under one of `cards`. The contract keeps each
   * settlement (its masked units and receipt), so this reads the current state only and
   * misses none. A settlement whose period is not among `periods` is still reported, with
   * no period: the label cannot be read back, only checked. Cards that fail their check
   * are skipped and listed in `refused`; the same licence twice is read once.
   */
  async readSettlements(
    cards: readonly LicenceCard[],
    periods: readonly string[],
  ): Promise<{ readonly found: SettlementReading[]; readonly refused: readonly { card: LicenceCard; why: string }[] }> {
    const ok: LicenceCard[] = [];
    const refused: { card: LicenceCard; why: string }[] = [];
    for (const c of cards) {
      if (ok.some((x) => x.licence.toLowerCase() === c.licence.toLowerCase())) continue;
      try {
        await this.checkLicenceCard(c);
        ok.push(c);
      } catch (e) {
        refused.push({ card: c, why: e instanceof Error ? e.message : String(e) });
      }
    }
    const labels = periods.map((p) => ({ p, bytes: periodBytes(p) }));
    const found: SettlementReading[] = [];
    for (const [change, st] of (await this.currentLedger()).settlements) {
      for (const card of ok) {
        const view = unhex(card.viewKey);
        const units = (st.unitsMasked - R.unitsMask(view, change) + FIELD_MODULUS) % FIELD_MODULUS;
        if (units === 0n || units >= 1n << 64n) continue;
        const offer = unhex(card.offer);
        const leafFor = (b: Uint8Array): string => hex(R.receiptLeaf(R.receiptCommit(view, b), offer, units));
        const period = labels.find((x) => leafFor(x.bytes) === hex(st.receipt))?.p;
        found.push({ licence: card.licence, offer: card.offer, period, units, receipt: hex(st.receipt) });
        break;
      }
    }
    return { found, refused };
  }

  // ─────────────────────────────────────────── licensee: licence and credit

  /** Keep an offer card (checked against the chain) for later top-ups and settlements. */
  async keepOfferCard(card: OfferCard): Promise<void> {
    if (card.contract.toLowerCase() !== this.deployedContractAddress.toLowerCase())
      throw new Error('That offer card is for another royalties contract.');
    const o = await this.offer(unhex(card.offer));
    if (!isZero(o.rateCommit)) checkOfferCard(card, o);
    await this.updateHeld((h) => ({ ...h, offerCards: { ...h.offerCards, [card.offer.toLowerCase()]: card } }));
  }

  /**
   * Buy one licence from the offer the card describes. Refused unless the card matches the
   * chain and opens its rate, and the offer's record is the live head of an anchored
   * identity in the main contract. Returns the licence card to hand the breeder.
   */
  async buyLicense(
    card: OfferCard,
    mainAddress: ContractAddress,
  ): Promise<TxRef & { readonly license: Uint8Array; readonly licenceCard: LicenceCard }> {
    const offer = unhex(card.offer);
    const o = await this.offer(offer);
    if (card.contract.toLowerCase() !== this.deployedContractAddress.toLowerCase())
      throw new Error('That offer card is for another royalties contract. Nothing was sent.');
    if (!isZero(o.rateCommit)) checkOfferCard(card, o);
    if (!o.open) throw new Error('That offer is closed. Nothing was sent.');
    if (o.expires <= nowSeconds()) throw new Error('That offer has ended. Nothing was sent.');
    if (o.remaining === 0n) throw new Error('That offer is sold out. Nothing was sent.');
    const standing = await this.recordStandingIn(mainAddress, o.record);
    if (!standing.ok)
      throw new Error(
        standing.why === 'moved'
          ? "That offer's record is no longer its identity's current record in the VeilCore contract. The breeder " +
              'must post the offer again from the current record. Nothing was sent.'
          : standing.why === 'not-anchored'
            ? "That offer's record is not an anchored record in the VeilCore contract. Nothing was sent."
            : `No VeilCore contract at ${mainAddress} to check the record against. Nothing was sent.`,
      );
    const ped = await this.pedigreeIn(mainAddress, o.record);
    if (!ped.ok) throw new Error(`Refused: ${ped.why}. Nothing was sent.`);
    for (const w of ped.warnings) this.logger?.warn(w);
    const secret = utils.randomBytes(32);
    const license = licenceKeyOf(secret, offer, o.expires);
    const slot = await this.freeSlot();
    // Kept before the call: a timeout can come after the purchase landed. Only licences the
    // chain shows live are ever used, so one that never landed is harmless.
    await this.updateHeld((h) => ({
      ...h,
      offerCards: { ...h.offerCards, [card.offer.toLowerCase()]: card },
      licences: [...h.licences, { offer: hex(offer), secret: hex(secret), expires: String(o.expires) }],
      mine: [...(h.mine ?? []), hex(license)].slice(-512),
    }));
    const tx = await this.call(
      'buyLicense',
      { licenseSecret: secret, split: { record: o.record, color: o.color, total: o.price, now: nowSeconds() } },
      (c) => c.callTx.buyLicense(offer, slot),
    );
    return { ...tx, license, licenceCard: this.cardFor(secret, offer, license, o.expires) };
  }

  /** The licence card for this client's live licence from `offer`, to hand the breeder again. */
  async licenceCard(offer: Uint8Array): Promise<LicenceCard> {
    const lic = await this.licenceFor(offer);
    return this.cardFor(
      unhex(lic.secret),
      offer,
      licenceKeyOf(unhex(lic.secret), offer, BigInt(lic.expires)),
      BigInt(lic.expires),
    );
  }

  /** A top-up request for someone else to pay: the offer card and a fresh code. */
  async topUpRequest(offer: Uint8Array): Promise<TopUpRequest & { readonly nonce: string }> {
    const lic = await this.licenceFor(offer);
    const card = await this.cardOf(offer);
    const nonce = utils.randomBytes(32);
    const licence = hex(licenceKeyOf(unhex(lic.secret), offer, BigInt(lic.expires)));
    await this.updateHeld((h) => ({
      ...h,
      codes: [...(h.codes ?? []), { offer: card.offer, licence, nonce: hex(nonce) }],
    }));
    return {
      kind: 'veilcore-topup-request',
      card,
      code: hex(R.topUpCode(R.spendKey(unhex(lic.secret), offer), nonce)),
      nonce: hex(nonce),
    };
  }

  /** Pay a top-up request (anyone). The amount goes to the breeder's wallet in this transaction. */
  async payTopUp(req: TopUpRequest, amount: bigint, mainAddress?: ContractAddress): Promise<TxRef> {
    if (req.kind !== 'veilcore-topup-request') throw new Error('That is not a top-up request.');
    if (amount <= 0n) throw new Error('A top-up must be more than zero. Nothing was sent.');
    if (req.card.contract.toLowerCase() !== this.deployedContractAddress.toLowerCase())
      throw new Error('That request is for another royalties contract. Nothing was sent.');
    const o = await this.offer(unhex(req.card.offer));
    checkOfferCard(req.card, o);
    const op = openingOf(req.card);
    const rate = { rate: BigInt(req.card.rate), salt: unhex(req.card.rateSalt) };
    if (mainAddress !== undefined) {
      const ped = await this.pedigreeIn(mainAddress, o.record);
      if (!ped.ok) throw new Error(`Refused: ${ped.why}. Nothing was sent.`);
      for (const w of ped.warnings) this.logger?.warn(w);
    }
    if (o.split) {
      // The ancestors take a share: this top-up names the offer, and pays each share in the same call.
      if (o.expires <= nowSeconds()) throw new Error('That offer has ended. Nothing was sent.');
      return this.call(
        'topUpSplit',
        {
          code: unhex(req.code),
          rate,
          split: { record: o.record, color: o.color, total: amount, now: nowSeconds() },
        },
        (c) => c.callTx.topUpSplit(op.offer, amount),
      );
    }
    const until = roundedValidUntil(op.expires);
    if (until === undefined)
      throw new Error(
        'That offer ends within two days, so top-ups for it are closed (one now would show which offer it is). ' +
          'Credit already held can still be settled. Nothing was sent.',
      );
    return this.call('topUp', { opening: op, code: unhex(req.code), rate }, (c) =>
      c.callTx.topUp({ bytes: op.payTo }, op.color, amount, until),
    );
  }

  /**
   * Top up your own credit: makes the code, pays, and keeps the note. Paying from the wallet
   * that bought the licence links the two on chain; a processor paying for you does not.
   */
  async topUpOwn(offer: Uint8Array, amount: bigint): Promise<TxRef> {
    const req = await this.topUpRequest(offer);
    const tx = await this.payTopUp(req, amount);
    await this.claimTopUp(offer, req.nonce, amount);
    return tx;
  }

  /**
   * Record credit someone paid against a top-up request this client made: the amount they
   * paid. Checked on chain before it is kept. Tries every open code for the offer when
   * `nonceHex` is not given.
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
          mine: [...(h.mine ?? []), hex(cm)].slice(-512),
        }));
        return note;
      }
    }
    throw new Error(
      alreadyRecorded
        ? `Every top-up of exactly ${amount} that landed for your codes on that offer is already recorded.`
        : `No credit of exactly ${amount} has landed for your top-up codes on that offer yet.`,
    );
  }

  /**
   * Settle a period privately: spends credit covering units x rate (merging two notes first
   * if no single one covers it), keeps the change, records the receipt. Moves no money.
   */
  async settle(
    offer: Uint8Array,
    period: string,
    units: bigint,
    opts: { readonly evenIfLinkable?: boolean } = {},
  ): Promise<TxRef> {
    if (units <= 0n) throw new Error('A settlement covers at least one unit.');
    periodBytes(period);
    const card = await this.cardOf(offer);
    const rate = BigInt(card.rate);
    const owed = units * rate;
    await this.assertNotLatest(['sale', 'note'], opts);
    const find = async (): Promise<{ pick?: Spendable; pair?: [Spendable, Spendable] }> => {
      const l = await this.currentLedger();
      // Only credit whose licence the chain still holds (live, or ended within the grace) can settle.
      const usable = (await this.spendable(offer, l))
        .filter((s) => l.licenseOffer.member(unhex(s.key)))
        .sort((a, b) => (a.note.amount < b.note.amount ? -1 : a.note.amount > b.note.amount ? 1 : 0));
      const pick = usable.find((s) => s.note.amount >= owed);
      if (pick !== undefined) return { pick };
      for (const key of new Set(usable.map((s) => s.key))) {
        const mine = usable.filter((s) => s.key === key);
        const [x, y] = [mine.at(-1), mine.at(-2)];
        if (x !== undefined && y !== undefined && x.note.amount + y.note.amount >= owed) return { pair: [x, y] };
      }
      return {};
    };
    const first = await find();
    const pair = first.pair;
    let pick = first.pick;
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
    const receipt = R.receiptLeaf(R.receiptCommit(R.viewKey(secret, offer), periodBytes(period)), offer, units);
    // Kept before the call: a timeout can come after the settlement landed, and the change
    // would otherwise be lost. Only notes and receipts the chain shows are ever counted.
    await this.updateHeld((h) => ({
      ...h,
      notes: [
        ...(h.notes ?? []),
        { offer: card.offer, licence: pick.key, nonce: hex(change.nonce), amount: String(change.amount), spent: false },
      ],
      receipts: [...h.receipts, { offer: card.offer, period, units: String(units), leaf: hex(receipt) }],
      mine: [...(h.mine ?? []), hex(changeCm), hex(receipt)].slice(-512),
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
   */
  async linkTerms(
    parentSecret: Uint8Array,
    t: {
      readonly color: Uint8Array;
      readonly fee: bigint;
      readonly share: bigint;
      readonly generations: bigint;
      readonly until: bigint;
      readonly payTo: Uint8Array;
    },
  ): Promise<LinkTermsCard> {
    if (t.share < 0n || t.share > 5000n) throw new Error('A share is 0 to 5000 basis points (at most half).');
    if (t.generations < 1n || t.generations > 3n) throw new Error('A link runs for 1 to 3 generations.');
    if (t.fee < 0n) throw new Error('The fee cannot be negative.');
    if (t.until <= nowSeconds()) throw new Error('The end date must be in the future.');
    if (t.payTo.length !== 32) throw new Error('The payout wallet is a 32-byte unshielded address.');
    const payeeSecret = utils.randomBytes(32);
    const card: LinkTermsCard = {
      kind: 'veilcore-link-terms',
      contract: this.deployedContractAddress.toLowerCase(),
      parent: hex(R.recordCommit(parentSecret)),
      color: hex(t.color),
      fee: String(t.fee),
      share: String(t.share),
      generations: String(t.generations),
      until: String(t.until),
      payTo: hex(t.payTo),
      payee: hex(R.payeeCommit(payeeSecret)),
    };
    await this.updateHeld((h) => ({
      ...h,
      linkTerms: { ...h.linkTerms, [card.payee]: { terms: card, payeeSecret: hex(payeeSecret) } },
    }));
    return card;
  }

  /** As a CHILD: propose the link on the parent's terms card. Binds nothing until the parent confirms. */
  async proposeLink(childSecret: Uint8Array, card: LinkTermsCard): Promise<TxRef & { readonly link: Uint8Array }> {
    if (card.kind !== 'veilcore-link-terms') throw new Error('That is not a link terms card.');
    if (card.contract.toLowerCase() !== this.deployedContractAddress.toLowerCase())
      throw new Error('That terms card is for another royalties contract. Nothing was sent.');
    const child = R.recordCommit(childSecret);
    const l = await this.currentLedger();
    if (l.stacks.member(child))
      throw new Error("Your record's ancestors are already final: no new links. Nothing was sent.");
    const tx = await this.call('proposeLink', { recordSecret: childSecret }, (c) =>
      c.callTx.proposeLink(
        unhex(card.parent),
        unhex(card.color),
        BigInt(card.fee),
        BigInt(card.share),
        BigInt(card.generations),
        BigInt(card.until),
        { bytes: unhex(card.payTo) },
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
   * As a PARENT: confirm a child's link, only if its terms are exactly a card you made.
   * Your own ancestors must be final first (posting an offer finalises an empty chart).
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
      t.color !== hex(link.color) ||
      BigInt(t.fee) !== link.fee ||
      BigInt(t.share) !== link.share ||
      BigInt(t.generations) !== link.generations ||
      BigInt(t.until) !== link.until ||
      t.payTo !== hex(link.payTo.bytes)
    )
      throw new Error('That link does not carry terms you offered on this computer. Nothing was sent.');
    if (!l.stacks.member(parent))
      throw new Error(
        'Finalise your own ancestors first (or post an offer, which finalises an empty chart). Nothing was sent.',
      );
    return this.call('confirmLink', { recordSecret: parentSecret }, (c) => c.callTx.confirmLink(child));
  }

  /**
   * As a CHILD: make your ancestors final, from exactly the parents the main VeilCore
   * contract confirms for your record. Refused while a parentage proposal or a link is
   * still waiting, or while a confirmed parent has no confirmed link. Cannot be undone.
   */
  async finaliseStack(childSecret: Uint8Array, mainAddress: ContractAddress): Promise<TxRef> {
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
        'A parentage proposal of your record is still waiting in the VeilCore contract. Nothing was sent.',
      );
    if (l.linksPending.member(child) && l.linksPending.lookup(child) > 0n)
      throw new Error('A link of your record is still waiting for its parent. Nothing was sent.');
    const parents = main.parentsOf.member(id) ? [...main.parentsOf.lookup(id)] : [];
    const chosen: Uint8Array[] = [];
    for (const p of parents) {
      const found = [...l.links].find(
        ([, k]) => k.confirmed && hex(k.child) === hex(child) && hex(identityOf(main, k.parent)) === hex(p),
      );
      if (found === undefined)
        throw new Error(
          `Parent ${hex(p).slice(0, 10)} is confirmed in the VeilCore contract but has no confirmed link here. Nothing was sent.`,
        );
      chosen.push(found[0]);
    }
    const [a, b] = [chosen[0] ?? ZERO32(), chosen[1] ?? ZERO32()];
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

  /** As a PARENT: move where a link you confirmed is paid, with the payee key kept here. */
  async movePayee(link: Uint8Array, payTo: Uint8Array): Promise<TxRef> {
    const l = await this.currentLedger();
    if (!l.links.member(link)) throw new Error('No such link. Nothing was sent.');
    const kept = (await this.held()).linkTerms?.[hex(l.links.lookup(link).payee)];
    if (kept === undefined) throw new Error("This computer does not hold that link's payee key. Nothing was sent.");
    return this.call('movePayee', { adminSecret: unhex(kept.payeeSecret) }, (c) =>
      c.callTx.movePayee(link, { bytes: payTo }),
    );
  }

  // ─────────────────────────────────────────── presentations

  /**
   * A presentation request from this verifier. Its scope is the same every time this
   * verifier asks about the same offer (made from a seed kept in this client's store), so
   * one licence answering for several growers shows the same holder tag each time. The
   * cost: anyone on chain can also see that equal tags repeat.
   */
  async presentationRequest(args: {
    readonly offer: Uint8Array;
    readonly period?: string;
    readonly minUnits?: bigint;
    readonly validForSeconds?: number;
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

  /**
   * Answer a verifier's request with a licence held here that is live past the time asked
   * and, if a period is asked, has a settlement on chain covering it (rule 2 applies).
   */
  async prove(
    request: PresentationRequest,
    opts: { readonly units?: bigint; readonly evenIfLinkable?: boolean } = {},
  ): Promise<TxRef> {
    const req = normalised(request);
    if (req.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That request is for another royalties contract. Nothing was sent.');
    const offer = unhex(req.offer);
    const validAt = BigInt(req.validAt);
    if (validAt <= nowSeconds()) throw new Error('That request has expired: ask the verifier for a new one.');
    const live = (await this.liveLicences(offer)).filter((x) => BigInt(x.expires) > validAt);
    if (live.length === 0)
      throw new Error('This client holds no licence from that offer that is live at the time the verifier asks about.');
    const period = unhex(req.period);
    let lic = live[live.length - 1];
    let units: bigint | undefined;
    if (!isZero(period)) {
      // A licence with a settlement on chain for this period covering what is asked
      // (the most units, unless told which), newest licence first.
      const held = (await this.settlements(offer)).filter((r) => hex(periodBytes(r.period)) === req.period);
      const pick = [...live].reverse().flatMap((l) => {
        const view = R.viewKey(unhex(l.secret), offer);
        const leafOf = (u: bigint): string => hex(R.receiptLeaf(R.receiptCommit(view, period), offer, u));
        const us = held
          .filter((r) => leafOf(BigInt(r.units)) === r.leaf)
          .map((r) => BigInt(r.units))
          .filter((u) => (opts.units === undefined ? true : u === opts.units))
          .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
        return us.length > 0 ? [{ l, u: us[0] }] : [];
      });
      if (pick.length === 0)
        throw new Error(
          opts.units === undefined
            ? 'No settlement on chain for that period under a licence held here.'
            : `No settlement of exactly ${opts.units} unit(s) for that period under a licence held here.`,
        );
      const best = pick.reduce((a, b) => (b.u > a.u ? b : a));
      if (best.u < BigInt(req.minUnits))
        throw new Error('Your settlement for that period covers fewer units than asked.');
      lic = best.l;
      units = best.u;
    }
    await this.assertNotLatest(isZero(period) ? ['sale'] : ['sale', 'receipt'], opts);
    return this.call(
      'proveLicense',
      {
        licenseSecret: unhex(lic.secret),
        offer,
        expires: BigInt(lic.expires),
        challenge: unhex(req.challenge),
        ...(units !== undefined ? { period, units } : {}),
      },
      (c) => c.callTx.proveLicense(period, BigInt(req.minUnits), validAt, unhex(req.scope)),
    );
  }

  /**
   * The verifier checks the licensee's transaction against the request it made. Only
   * revocations on the offer asked about matter (the contract tracks them per offer).
   */
  async verifyPresentation(
    request: PresentationRequest,
    txId: string,
    indexerUri: string,
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
    );
    const { gone, unsealed, revokedSince } = revocationVerdict(offer, cells, await this.currentLedger());
    if (gone)
      return {
        accepted: false,
        lines: ['FAILED That offer has ended and been removed, so this answer cannot be judged now.'],
      };
    const lines: string[] = [];
    const tagOk = hex(cells.lastPresentation) === hex(expected);
    lines.push(
      tagOk
        ? isZero(unhex(req.period))
          ? 'ok     A live licence from the offer you asked about, live at the time you asked.'
          : `ok     A live licence from that offer, and that period settled for at least ${req.minUnits} unit(s).`
        : 'FAILED This transaction does not answer your request (another offer, period, time, scope or challenge).',
    );
    if (unsealed)
      lines.push(
        'WAIT   A licence from this offer was revoked and not yet sealed when this was proved. Anyone can seal ' +
          `(menu 68) once ${SEAL_INTERVAL_SECONDS / 60} minutes have passed since the last seal; ask again after that.`,
      );
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
      'note   This shows that someone holding a live licence answered, not that the person in front of you holds it.',
    );
    return { accepted: tagOk && !unsealed && !revokedSince, lines, holder };
  }

  // ─────────────────────────────────────────── upkeep

  async seal(): Promise<SealResult> {
    const l = await this.currentLedger();
    if (!l.unsealedChanges && !l.rootsSinceSeal) return { sealed: false, waiting: false };
    const now = nowSeconds();
    const earliest = l.lastSealTime + BigInt(SEAL_INTERVAL_SECONDS + SEAL_SKEW_SECONDS);
    if (now < earliest) return { sealed: false, waiting: true, sealableAt: Number(earliest) };
    try {
      await this.call('sealRevocations', {}, (c) => c.callTx.sealRevocations(now + BigInt(SEAL_AHEAD_SECONDS)));
      return { sealed: true, waiting: false };
    } catch (e) {
      this.logger?.info(`seal not made now: ${e instanceof Error ? e.message : String(e)}`);
      const after = await this.currentLedger();
      return { sealed: false, waiting: after.unsealedChanges || after.rootsSinceSeal };
    }
  }

  /** Clear licences 30 days past their offer's end, then ended offers with none left. Anyone may. */
  async clearEnded(): Promise<{ readonly licences: number; readonly offers: number }> {
    const now = nowSeconds();
    const l = await this.currentLedger();
    const ended = new Set([...l.offers].filter(([, o]) => o.expires <= now).map(([id]) => hex(id)));
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
    let licences = 0;
    for (const [k, id] of [...l.licenseOffer])
      if (
        clearable.has(hex(id)) &&
        (await attempt('clearEnded', () => this.call('clearEnded', {}, (c) => c.callTx.clearEnded(k))))
      )
        licences++;
    let offers = 0;
    for (const id of ended)
      if (await attempt('removeEnded', () => this.call('removeEnded', {}, (c) => c.callTx.removeEnded(unhex(id)))))
        offers++;
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
   * receipts when it asks about a period).
   */
  private async assertNotLatest(
    trees: readonly Tree[],
    opts: { readonly afterOwnMerge?: boolean; readonly evenIfLinkable?: boolean } = {},
  ): Promise<void> {
    if (opts.evenIfLinkable === true) return;
    const l = await this.currentLedger();
    const mine = new Set((await this.held()).mine ?? []);
    const latest: Record<Tree, [Uint8Array, string, string]> = {
      sale: [l.lastSale, 'licence purchase', 'licence purchase on this contract'],
      note: [l.lastNote, 'credit note', 'top-up, settlement or merge'],
      receipt: [l.lastReceipt, 'settlement', 'settlement'],
    };
    for (const t of trees) {
      const [leaf, what, next] = latest[t];
      if (mine.has(hex(leaf)))
        throw new WouldLinkError(
          `${opts.afterOwnMerge === true ? 'Your credit was merged into one note. ' : ''}Your own ${what} is still ` +
            `the newest on chain, so anyone watching could guess this proof is yours. After someone else's next ` +
            `${next} it could be theirs as well; the more people use the contract, the better that hides it. ` +
            'Nothing was sent.',
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
      mine: [...(h.mine ?? []), hex(noteOf(secret, merged.nonce, op, merged.amount))].slice(-512),
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
    await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input: {}, held: f(await this.held()) });
  }

  private async call(
    circuit: string,
    input: RoyaltyInput,
    call: (c: DeployedRoyaltiesContract) => Promise<{ public: TxRef & { nextContractState: StateValue } }>,
  ): Promise<TxRef> {
    await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input, held: await this.held() });
    let txData;
    try {
      txData = await call(this.deployedContract);
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
