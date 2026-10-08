// The client API for the VeilCore royalties contract (contract/src/veilcore-royalties.compact).
// SPDX-License-Identifier: Apache-2.0
//
// A breeder posts an offer against one of their records and runs it with an admin key
// made here. A grower buys a licence from it; the price passes to the breeder's wallet in
// the same transaction. Royalties are paid per unit, by the licensee or by anyone holding
// the licensee's receipt commitment for a period. A licensee proves a licence, and if
// asked a paid-up period, to one verifier, who checks the result here.
//
// Two rules the contract cannot enforce, enforced here:
//   1. Buy only from an offer whose record is the LIVE HEAD of an ANCHORED identity in the
//      main VeilCore contract now (Midnight mainnet has no calls between contracts yet).
//   2. Never prove against the root your own purchase or payment created: that root names
//      it. Wait until someone else's transaction has changed the tree.
//
// Secrets a party keeps (admin secrets, licence secrets) are stored in this client's own
// private-state store, which is encrypted; each call's input is cleared when it ends.
// The contract is deployed without a maintenance authority anyone can use, as the claims
// contract is. Design and limits: docs/royalties-design.md.

import { type ContractAddress, sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type StateValue } from '@midnight-ntwrk/midnight-js-protocol/onchain-runtime';
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
  type RoyaltiesHeld,
  type RoyaltiesLedger,
  type RoyaltiesPrivateState,
  type RoyaltyInput,
  type RoyaltyOffer,
  compiledRoyaltiesDeploying,
  emptyRoyaltiesHeld,
  emptyRoyaltiesPrivateState,
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
const unhex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const ZERO32 = (): Uint8Array => new Uint8Array(32);
const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0);

/** NIGHT's token colour, as an offer names it. */
export const NIGHT_COLOR = ZERO32();
/** Slots in the licence tree (LICENSE_SLOTS in the contract). */
export const LICENSE_SLOTS = 16777216n;
const SEAL_AHEAD_SECONDS = 200;
const SEAL_SKEW_SECONDS = 30;
const RECEIPT_SEAL_SECONDS = 86400;

/** Whether a record can stand behind an offer, read from the main VeilCore contract now. */
export type RecordStanding =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: 'not-anchored' | 'moved' | 'no-contract' };

/** The rule tools apply before a sale: the record is the live head of an anchored identity. */
export const recordStanding = (main: ReturnType<typeof veilcoreLedger>, record: Uint8Array): RecordStanding => {
  const origin = main.originOf.member(record) ? main.originOf.lookup(record) : record;
  if (!main.recoveryOf.member(origin)) return { ok: false, why: 'not-anchored' };
  const live = main.headOf.member(origin)
    ? hex(main.headOf.lookup(origin)) === hex(record)
    : hex(origin) === hex(record);
  return live ? { ok: true } : { ok: false, why: 'moved' };
};

/** An offer as the chain shows it, with its id. */
export type OfferView = RoyaltyOffer & { readonly id: Uint8Array };

/** What a breeder sets on a new offer. */
export type OfferTerms = {
  /** SHA-256 (or any 32-byte fingerprint) of the licence terms the parties hold. */
  readonly terms: Uint8Array;
  readonly color: Uint8Array;
  readonly price: bigint;
  readonly perUnit: bigint;
  readonly payTo: Uint8Array;
  readonly count: bigint;
  /** Unix seconds. */
  readonly expires: bigint;
  readonly revocable: boolean;
};

/**
 * What a verifier asks for. The verifier makes it (newPresentationRequest), hands it to the
 * licensee, and checks the licensee's transaction against it (verifyPresentation).
 */
export type PresentationRequest = {
  readonly contract: string;
  /** The offer the verifier wants a licence from (hex). */
  readonly offer: string;
  /** The period a royalty must be paid for (hex, 32 bytes), or all zeros for none. */
  readonly period: string;
  readonly minUnits: string;
  /** Unix seconds: the licence must still be live then. In the future when asked. */
  readonly validAt: string;
  /** The verifier's own scope (hex): the holder tag repeats only within it. */
  readonly scope: string;
  /** 32 fresh random bytes (hex), used once. */
  readonly challenge: string;
};

/** A period label as 32 bytes: the text, UTF-8, zero-padded (at most 32 bytes). */
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
  contract: args.contract,
  offer: hex(args.offer),
  period: hex(args.period === undefined || args.period === '' ? ZERO32() : periodBytes(args.period)),
  minUnits: String(args.minUnits ?? 0n),
  validAt: String(Math.floor(Date.now() / 1000) + (args.validForSeconds ?? 3600)),
  scope: hex(args.scope ?? utils.randomBytes(32)),
  challenge: hex(utils.randomBytes(32)),
});

/** A verifier's verdict on one presentation. */
export type PresentationVerdict = {
  readonly accepted: boolean;
  readonly lines: readonly string[];
  /** The holder tag: the same licence shown again in this scope shows the same tag. */
  readonly holder?: string;
};

/** A request with every hex field lower-case and without 0x, as this client compares them. */
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

  // ─────────────────────────────────────────────────────────── reading

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

  /** The record's standing in the main VeilCore contract at `mainAddress`, now. */
  async recordStandingIn(mainAddress: ContractAddress, record: Uint8Array): Promise<RecordStanding> {
    const state = await this.providers.publicDataProvider.queryContractState(mainAddress);
    if (state === null || state === undefined) return { ok: false, why: 'no-contract' };
    return recordStanding(veilcoreLedger(state.data), record);
  }

  async held(): Promise<RoyaltiesHeld> {
    const ps = await this.providers.privateStateProvider.get(royaltiesPrivateStateKey);
    return ps?.held ?? emptyRoyaltiesHeld();
  }

  // ─────────────────────────────────────────────────────────── offers

  /**
   * Post an offer from the record `recordSecret` stands for. Makes the offer's admin
   * secret, keeps it in this client's store, and returns it: the caller must have it
   * written down (on paper) too. Losing it means the offer can never be closed or revoked.
   */
  async postOffer(
    recordSecret: Uint8Array,
    t: OfferTerms,
    mainAddress?: ContractAddress,
  ): Promise<TxRef & { readonly offer: Uint8Array; readonly adminSecret: Uint8Array }> {
    if (mainAddress !== undefined) {
      const standing = await this.recordStandingIn(mainAddress, R.recordCommit(recordSecret));
      if (!standing.ok)
        throw new Error(
          'Your record is not the current record of an anchored identity in the VeilCore contract, so buyers ' +
            'would refuse this offer. Anchor it (or act as your current record) first. Nothing was sent.',
        );
    }
    if (isZero(t.terms) || t.terms.length !== 32) throw new Error('The terms fingerprint is 32 bytes, not all zero.');
    if (t.payTo.length !== 32) throw new Error('The payout wallet is a 32-byte unshielded address.');
    if (t.price <= 0n || t.count <= 0n) throw new Error('The price and the number for sale must be more than zero.');
    if (t.expires <= BigInt(Math.floor(Date.now() / 1000))) throw new Error('The end date must be in the future.');
    const adminSecret = utils.randomBytes(32);
    const nonce = utils.randomBytes(32);
    const record = R.recordCommit(recordSecret);
    const offer = R.offerId(record, nonce);
    // Kept before the call, so an interrupted post still leaves the admin secret here.
    await this.updateHeld((h) => ({ ...h, admins: { ...h.admins, [hex(offer)]: hex(adminSecret) } }));
    const tx = await this.call('postOffer', { recordSecret }, (c) =>
      c.callTx.postOffer(
        nonce,
        R.adminCommit(adminSecret),
        t.terms,
        t.color,
        t.price,
        t.perUnit,
        { bytes: t.payTo },
        t.count,
        t.expires,
        t.revocable,
      ),
    );
    return { ...tx, offer, adminSecret };
  }

  async closeOffer(offer: Uint8Array, adminSecret?: Uint8Array): Promise<TxRef> {
    const admin = adminSecret ?? (await this.adminFor(offer));
    return this.call('closeOffer', { adminSecret: admin }, (c) => c.callTx.closeOffer(offer));
  }

  /** Hand the offer to a new admin secret, made here and returned (write it down). */
  async changeOfferAdmin(
    offer: Uint8Array,
    adminSecret?: Uint8Array,
  ): Promise<TxRef & { readonly adminSecret: Uint8Array }> {
    const admin = adminSecret ?? (await this.adminFor(offer));
    if (hex(R.adminCommit(admin)) !== hex((await this.offer(offer)).admin))
      throw new Error('That admin secret does not run this offer. Nothing was sent.');
    // Whatever runs the offer now becomes the main entry, so a new pending one never
    // overwrites the only copy of the secret on chain (an earlier change that landed).
    await this.updateHeld((h) => ({ ...h, admins: { ...h.admins, [hex(offer)]: hex(admin) } }));
    const next = utils.randomBytes(32);
    // Kept before sending, beside the current one: if the change lands and this client
    // stops, the new secret is still here (adminFor tries it when the chain shows it).
    await this.updateHeld((h) => ({ ...h, admins: { ...h.admins, [`${hex(offer)}:next`]: hex(next) } }));
    const tx = await this.call('changeOfferAdmin', { adminSecret: admin }, (c) =>
      c.callTx.changeOfferAdmin(offer, R.adminCommit(next)),
    );
    await this.updateHeld((h) => {
      const admins: Record<string, string> = { ...h.admins, [hex(offer)]: hex(next) };
      delete admins[`${hex(offer)}:next`];
      return { ...h, admins };
    });
    return { ...tx, adminSecret: next };
  }

  /** Revoke a licence sold from one of this party's offers (its key, as the sale published it). */
  async revokeLicense(license: Uint8Array, adminSecret?: Uint8Array): Promise<TxRef & SealResult> {
    const l = await this.currentLedger();
    if (!l.licenseOffer.member(license)) throw new Error('No such live licence. Nothing was sent.');
    const admin = adminSecret ?? (await this.adminFor(l.licenseOffer.lookup(license)));
    const tx = await this.call('revokeLicense', { adminSecret: admin }, (c) => c.callTx.revokeLicense(license));
    return { ...tx, ...(await this.seal()) };
  }

  // ─────────────────────────────────────────────────────────── sales

  /**
   * Buy one licence. Refused before anything is sent unless the offer is open, not ended,
   * not sold out, and its record is the live head of an anchored identity in the main
   * VeilCore contract at `mainAddress`. Makes the licence secret and keeps it here.
   */
  async buyLicense(offer: Uint8Array, mainAddress: ContractAddress): Promise<TxRef & { readonly license: Uint8Array }> {
    const o = await this.offer(offer);
    if (!o.open) throw new Error('That offer is closed. Nothing was sent.');
    if (o.expires <= BigInt(Math.floor(Date.now() / 1000))) throw new Error('That offer has ended. Nothing was sent.');
    if (o.remaining === 0n) throw new Error('That offer is sold out. Nothing was sent.');
    const standing = await this.recordStandingIn(mainAddress, o.record);
    if (!standing.ok)
      throw new Error(
        standing.why === 'moved'
          ? "That offer's record is no longer its identity's current record in the VeilCore contract (rotated or " +
              'recovered). The breeder must post the offer again from the current record. Nothing was sent.'
          : standing.why === 'not-anchored'
            ? "That offer's record is not an anchored record in the VeilCore contract. Nothing was sent."
            : `No VeilCore contract at ${mainAddress} to check the record against. Nothing was sent.`,
      );
    const secret = utils.randomBytes(32);
    const license = R.licenseKey(R.licenseCommit(secret, offer), offer, o.expires);
    const slot = await this.freeSlot();
    const pending: HeldLicence = {
      offer: hex(offer),
      secret: hex(secret),
      expires: String(o.expires),
      rootAfterPurchase: '',
    };
    // Kept before the call: if it lands and this client stops, the licence is still held.
    await this.updateHeld((h) => ({ ...h, licences: [...h.licences, pending] }));
    // The pending licence stays held even if this throws: a timeout can come after the buy
    // landed. licenceFor only ever uses a licence the chain shows live, so a buy that never
    // landed leaves nothing anyone can pay against.
    const landed = await this.callWithData('buyLicense', { licenseSecret: secret }, (c) =>
      c.callTx.buyLicense(offer, slot),
    );
    const { txData, ref } = landed;
    const root = royaltiesLedger(txData.public.nextContractState).licenses.root().field.toString();
    await this.updateHeld((h) => ({
      ...h,
      licences: h.licences.map((x) => (x.secret === pending.secret ? { ...x, rootAfterPurchase: root } : x)),
    }));
    return { ...ref, license };
  }

  // ─────────────────────────────────────────────────────────── royalties

  /** The receipt commitment a licensee hands whoever pays for a period on their behalf. */
  async receiptCommitment(offer: Uint8Array, period: string): Promise<Uint8Array> {
    return R.receiptCommit(unhex((await this.licenceFor(offer)).secret), periodBytes(period));
  }

  /** Pay a royalty on behalf of a licensee, for the receipt commitment they gave you. */
  async payRoyaltyFor(
    offer: Uint8Array,
    commitment: Uint8Array,
    units: bigint,
  ): Promise<TxRef & { readonly amount: bigint }> {
    const o = await this.offer(offer);
    this.checkPayable(o, units);
    if (commitment.length !== 32 || isZero(commitment)) throw new Error('That is not a receipt commitment.');
    await this.notePaid(R.receiptLeaf(commitment, offer, units));
    const ref = await this.call('payRoyalty', {}, (c) => c.callTx.payRoyalty(offer, commitment, units));
    return { ...ref, amount: units * o.perUnit };
  }

  /** Pay a royalty for this party's own licence from `offer`, for `period`. */
  async payRoyalty(offer: Uint8Array, period: string, units: bigint): Promise<TxRef & { readonly amount: bigint }> {
    const o = await this.offer(offer);
    this.checkPayable(o, units);
    const lic = await this.licenceFor(offer);
    const commitment = R.receiptCommit(unhex(lic.secret), periodBytes(period));
    await this.notePaid(R.receiptLeaf(commitment, offer, units));
    const { txData, ref } = await this.callWithData('payRoyalty', {}, (c) =>
      c.callTx.payRoyalty(offer, commitment, units),
    );
    const root = royaltiesLedger(txData.public.nextContractState).receipts.root().field.toString();
    await this.updateHeld((h) => ({
      ...h,
      receipts: [...h.receipts, { offer: hex(offer), period, units: String(units), rootAfterPayment: root }],
    }));
    return { ...ref, amount: units * o.perUnit };
  }

  // ─────────────────────────────────────────────────────────── presentations

  /**
   * Answer a verifier's request with this party's licence from the requested offer. For a
   * paid-up request, the receipt must be one this client paid or was told about
   * (`units` given). Refused while the tree still has the root this party's own purchase
   * or payment made, since proving against it would name that transaction.
   */
  async prove(
    request: PresentationRequest,
    opts: { readonly units?: bigint; readonly periodLabel?: string } = {},
  ): Promise<TxRef> {
    const req = normalised(request);
    if (req.contract !== this.deployedContractAddress.toLowerCase())
      throw new Error('That request is for another royalties contract. Nothing was sent.');
    const offer = unhex(req.offer);
    const lic = await this.licenceFor(offer);
    const validAt = BigInt(req.validAt);
    if (validAt <= BigInt(Math.floor(Date.now() / 1000)))
      throw new Error('That request has expired: ask the verifier for a new one.');
    if (BigInt(lic.expires) <= validAt) throw new Error('Your licence ends before the time the verifier asks about.');
    const l = await this.currentLedger();
    const heldNow = await this.held();
    const myKeys = new Set(heldNow.licences.map((x) => hex(RoyaltiesAPI.keyOf(x))));
    if (
      myKeys.has(hex(l.lastSale)) ||
      (lic.rootAfterPurchase !== '' && l.licenses.root().field.toString() === lic.rootAfterPurchase)
    )
      throw new Error(
        'Nobody else has bought a licence since your purchase, so a proof now would point at it. ' +
          'Try again after the next sale. Nothing was sent.',
      );
    const period = unhex(req.period);
    let units: bigint | undefined;
    if (!isZero(period)) {
      const label = opts.periodLabel;
      const mine = (await this.held()).receipts.filter(
        (r) => r.offer === req.offer && hex(periodBytes(r.period)) === req.period,
      );
      units =
        opts.units ??
        (mine.length > 0 ? mine.map((r) => BigInt(r.units)).reduce((a, b) => (a > b ? a : b)) : undefined);
      if (units === undefined)
        throw new Error(
          `No royalty this client knows of for that period${label ? ` (${label})` : ''}. Give the units paid.`,
        );
      if (units < BigInt(req.minUnits))
        throw new Error('The royalty paid for that period covers fewer units than asked.');
      const own = mine.find((r) => BigInt(r.units) === units);
      const ownLeaf = R.receiptLeaf(R.receiptCommit(unhex(lic.secret), period), offer, units);
      const myLeaves = new Set([...(heldNow.paidLeaves ?? []), hex(ownLeaf)]);
      if (
        myLeaves.has(hex(l.lastReceipt)) ||
        (own !== undefined && l.receipts.root().field.toString() === own.rootAfterPayment)
      )
        throw new Error(
          'Nobody else has paid a royalty since your payment, so a proof now would point at it. ' +
            'Try again after the next payment. Nothing was sent.',
        );
    }
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

  /** The verifier checks the licensee's transaction against the request it made. */
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
    const cells = royaltiesLedger(found.state.data);
    const expected = R.presentationTag(
      unhex(req.offer),
      unhex(req.period),
      BigInt(req.minUnits),
      BigInt(req.validAt),
      unhex(req.scope),
      unhex(req.challenge),
    );
    const lines: string[] = [];
    const tagOk = hex(cells.lastPresentation) === hex(expected);
    lines.push(
      tagOk
        ? isZero(unhex(req.period))
          ? 'ok     A live licence from the offer you asked about, live at the time you asked.'
          : `ok     A live licence from that offer, and a royalty paid for that period covering at least ${req.minUnits} unit(s).`
        : 'FAILED This transaction does not answer your request (another offer, period, time, scope or challenge).',
    );
    if (cells.lastPresentationUnsealed)
      lines.push(
        'WAIT   A revocation was waiting for a seal when this was proved. Ask again after the next seal ' +
          `(at most ${SEAL_INTERVAL_SECONDS / 60} minutes after the last one) before relying on it.`,
      );
    const revokedSince = (await this.currentLedger()).revocationSeq > cells.revocationSeq;
    if (revokedSince)
      lines.push(
        'WAIT   A licence on this contract has been revoked since this was proved. Ask for a new answer before ' +
          'relying on it.',
      );
    lines.push(
      `holder ${hex(cells.lastPresentationHolder)} (repeats if the same licence is shown to you again in this scope)`,
    );
    return {
      accepted: tagOk && !cells.lastPresentationUnsealed && !revokedSince,
      lines,
      holder: hex(cells.lastPresentationHolder),
    };
  }

  // ─────────────────────────────────────────────────────────── upkeep

  /** Seal waiting revocations if the contract allows it now (anyone may). */
  async seal(): Promise<SealResult> {
    const l = await this.currentLedger();
    if (!l.unsealedChanges && !l.rootsSinceSeal) return { sealed: false, waiting: false };
    const now = BigInt(Math.floor(Date.now() / 1000));
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

  /** Clear every ended licence, then every ended offer with none left. Anyone may. */
  async clearEnded(): Promise<{ readonly licences: number; readonly offers: number }> {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const l = await this.currentLedger();
    const endedOffers = new Set([...l.offers].filter(([, o]) => o.expires <= now).map(([id]) => hex(id)));
    let licences = 0;
    const attempt = async (what: string, f: () => Promise<unknown>): Promise<boolean> => {
      try {
        await f();
        return true;
      } catch (e) {
        this.logger?.info(`${what} not done now: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    };
    for (const [k, id] of [...l.licenseOffer]) {
      if (!endedOffers.has(hex(id))) continue;
      if (await attempt('clearEnded', () => this.call('clearEnded', {}, (c) => c.callTx.clearEnded(k)))) licences++;
    }
    let offers = 0;
    for (const id of endedOffers) {
      if (await attempt('removeEnded', () => this.call('removeEnded', {}, (c) => c.callTx.removeEnded(unhex(id)))))
        offers++;
    }
    return { licences, offers };
  }

  /** How long a receipt path stays usable at least (receipt roots are retired at most daily). */
  static readonly receiptRootSeconds = RECEIPT_SEAL_SECONDS;

  // ─────────────────────────────────────────────────────────── plumbing

  private checkPayable(o: OfferView, units: bigint): void {
    if (o.perUnit === 0n) throw new Error('That offer takes no royalties through this contract. Nothing was sent.');
    if (o.expires <= BigInt(Math.floor(Date.now() / 1000))) throw new Error('That offer has ended. Nothing was sent.');
    if (units <= 0n) throw new Error('A royalty covers at least one unit. Nothing was sent.');
  }

  /** The held admin secret the chain currently accepts for `offer` (the current one, or a pending new one). */
  private async adminFor(offer: Uint8Array): Promise<Uint8Array> {
    const h = (await this.held()).admins;
    const onChain = hex((await this.offer(offer)).admin);
    for (const s of [h[hex(offer)], h[`${hex(offer)}:next`]])
      if (s !== undefined && hex(R.adminCommit(unhex(s))) === onChain) return unhex(s);
    throw new Error('This client holds no admin secret that runs that offer now: type it in. Nothing was sent.');
  }

  /** The key a held licence has on chain. */
  private static keyOf(lic: HeldLicence): Uint8Array {
    const offer = unhex(lic.offer);
    return R.licenseKey(R.licenseCommit(unhex(lic.secret), offer), offer, BigInt(lic.expires));
  }

  /** The newest licence this client holds from `offer` that is live on chain now. */
  private async licenceFor(offer: Uint8Array): Promise<HeldLicence> {
    const l = await this.currentLedger();
    const live = (await this.held()).licences.filter(
      (x) => x.offer === hex(offer) && l.licenseOffer.member(RoyaltiesAPI.keyOf(x)),
    );
    if (live.length === 0)
      throw new Error(
        'This client holds no live licence from that offer (none bought here, or it was revoked, ended or never ' +
          'landed). Nothing was sent.',
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

  /** Remember a receipt leaf this client paid, so it never proves while that payment is the latest. */
  private async notePaid(leaf: Uint8Array): Promise<void> {
    await this.updateHeld((h) => ({ ...h, paidLeaves: [...(h.paidLeaves ?? []), hex(leaf)].slice(-256) }));
  }

  private async updateHeld(f: (h: RoyaltiesHeld) => RoyaltiesHeld): Promise<void> {
    const ps =
      (await this.providers.privateStateProvider.get(royaltiesPrivateStateKey)) ?? emptyRoyaltiesPrivateState();
    await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input: {}, held: f(ps.held) });
  }

  private async callWithData(
    circuit: string,
    input: RoyaltyInput,
    call: (c: DeployedRoyaltiesContract) => Promise<{ public: TxRef & { nextContractState: StateValue } }>,
  ): Promise<{ txData: { public: TxRef & { nextContractState: StateValue } }; ref: TxRef }> {
    const held = await this.held();
    await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input, held });
    let txData;
    try {
      txData = await call(this.deployedContract);
    } finally {
      await this.providers.privateStateProvider.set(royaltiesPrivateStateKey, { input: {}, held: await this.held() });
    }
    const { txId, txHash, blockHeight } = txData.public;
    this.logger?.info({ transactionAdded: { circuit, txHash, blockHeight } });
    return { txData, ref: { txId, txHash, blockHeight } };
  }

  private async call(
    circuit: string,
    input: RoyaltyInput,
    call: (c: DeployedRoyaltiesContract) => Promise<{ public: TxRef & { nextContractState: StateValue } }>,
  ): Promise<TxRef> {
    return (await this.callWithData(circuit, input, call)).ref;
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

  // ─────────────────────────────────────────────────────────── deploy and join

  /**
   * Deploy a royalties contract, add every circuit key, then retire the maintenance
   * authority provably (an empty committee). Test networks only for now
   * (assertRoyaltiesDeployAllowed).
   */
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

  /** Add missing circuit keys, check every key, retire the authority provably. Safe to run again. */
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

  /**
   * Join a royalties contract. On mainnet, refused unless it is the pinned address (none
   * yet). Refused unless every circuit key on chain matches this build and the contract
   * carries no circuit this build lacks. Warns if its authority is not retired.
   */
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
