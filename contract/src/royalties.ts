// The royalties contract (veilcore-royalties.compact), compiled for midnight-js: the same
// shape as ./claims.ts. Kept in its own file so the contracts' generated names never collide.
//
// Every witness reads one call's private input, which the client puts in private state
// just before the call and clears straight after (api/src/royalties-api.ts). The secrets a
// party keeps between calls (offer admin keys, licence secrets) live in `held`, as hex.
// Merkle paths are never stored: the path witnesses read them from the ledger at proving
// time, from the CURRENT tree.
// SPDX-License-Identifier: Apache-2.0

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ContractState } from "@midnight-ntwrk/compact-runtime";

import * as Royalties from "./managed/veilcore-royalties/contract/index.js";

export type {
  Offer as RoyaltyOffer,
  Link as DescentLink,
  OfferOpening,
  NoteOpening,
  RateOpening,
  Owed,
  Ledger as RoyaltiesLedger,
} from "./managed/veilcore-royalties/contract/index.js";
export const royaltiesLedger = Royalties.ledger;
export const royaltiesPureCircuits = Royalties.pureCircuits;

/** What the prover holds for ONE call. A witness asked for something not given throws. */
export type RoyaltyInput = {
  readonly recordSecret?: Uint8Array;
  readonly adminSecret?: Uint8Array;
  /** The offer's credit issuer secret, to issue credit. */
  readonly issuerSecret?: Uint8Array;
  /** The amount of credit a private issuance makes (it stays inside the note). */
  readonly amount?: bigint;
  readonly licenseSecret?: Uint8Array;
  /** The offer a licence is from, and the licence's end date. */
  readonly offer?: Uint8Array;
  readonly expires?: bigint;
  readonly challenge?: Uint8Array;
  /** A settlement's (or a paid-up presentation's) period and units. */
  readonly period?: Uint8Array;
  readonly units?: bigint;
  /** An issuance's, top-up's or settlement's offer, opened privately. */
  readonly opening?: Royalties.OfferOpening;
  /** An issuance's or top-up's code. */
  readonly code?: Uint8Array;
  /** The note(s) a settlement or merge spends. */
  readonly note?: Royalties.NoteOpening;
  readonly note2?: Royalties.NoteOpening;
  /** The rate and salt, for postOffer and settle (a top-up never needs them). */
  readonly rate?: Royalties.RateOpening;
  /**
   * A presentation can be made with the presentation key and the public spending key
   * instead of the licence secret (a delegate who answers buyers but cannot spend).
   */
  readonly present?: Uint8Array;
  readonly spend?: Uint8Array;
  /** The change note of the settlement a presentation shows. */
  readonly change?: Uint8Array;
  /** Which settlement of this licence a settle is (0, 1, 2 ...). */
  readonly index?: bigint;
  /**
   * A split payment (licence purchase or topUpSplit) or a record of what is owed (a licence
   * or split credit issued off chain): the record whose ancestors are owed, the token, the
   * amount, and the time to judge links' end dates by. The witness works out each
   * ancestor's amount from the ledger (splitAmountsFor).
   */
  readonly split?: {
    readonly record: Uint8Array;
    readonly color: Uint8Array;
    readonly total: bigint;
    readonly now: bigint;
  };
};

/** A licence this party bought: its secret (one per licence) and end date. */
export type HeldLicence = {
  readonly offer: string;
  readonly secret: string;
  readonly expires: string;
};

/** A credit note this licensee holds. */
export type HeldNote = {
  readonly offer: string;
  /** The licence key it belongs to (its secret spends it). Older stores lack it. */
  readonly licence?: string;
  readonly nonce: string;
  readonly amount: string;
  readonly spent: boolean;
};

/** A settlement this licensee made (kept before it is sent: only ones in the receipt tree count). */
export type HeldReceipt = {
  readonly offer: string;
  readonly period: string;
  readonly units: string;
  readonly leaf: string;
  /** Its change note (part of the receipt leaf), needed to present it. */
  readonly change?: string;
};

/** The parts of an offer card a party keeps (api/src/royalties-api.ts OfferCard). */
export type HeldOfferCard = {
  readonly kind: "veilcore-offer-card";
  readonly contract: string;
  readonly offer: string;
  readonly payTo: string;
  readonly color: string;
  readonly rateCommit: string;
  readonly expires: string;
  readonly rate: string;
  readonly rateSalt: string;
  readonly split?: boolean;
  /** Whether the offer takes payment through the contract. Missing means no. */
  readonly onChainPayment?: boolean;
};

/** The terms of a descent link, as hex and decimal strings (api/src/royalties-api.ts LinkTermsCard). */
export type HeldLinkTerms = {
  readonly kind: "veilcore-link-terms";
  readonly contract: string;
  readonly parent: string;
  readonly color: string;
  readonly fee: string;
  readonly share: string;
  readonly generations: string;
  readonly until: string;
  readonly payTo: string;
  readonly payee: string;
  /** The child record these terms are for, if the parent named one: any other child is refused. */
  readonly child?: string;
};

/** What a party keeps between calls. All hex or decimal strings, so the store needs no custom types. */
export type RoyaltiesHeld = {
  /** Offer id -> the admin secret this party runs it with. */
  readonly admins: Readonly<Record<string, string>>;
  /** Offer id -> the credit issuer secret this party issues its credit with. */
  readonly issuers?: Readonly<Record<string, string>>;
  /**
   * Credit this party issued, kept for its own books (what it acknowledged, to set against
   * what its licensees settle): the offer, the note on chain, the amount, the code's
   * fingerprint, and when (Unix seconds).
   */
  readonly issued?: readonly {
    readonly offer: string;
    readonly note: string;
    readonly amount: string;
    readonly fingerprint: string;
    readonly at: string;
  }[];
  readonly licences: readonly HeldLicence[];
  readonly receipts: readonly HeldReceipt[];
  /** Offer id -> the offer card (rate and salt) this party was given or made. */
  readonly offerCards?: Readonly<Record<string, HeldOfferCard>>;
  /** Top-up codes this licensee handed out and has not seen paid. */
  readonly codes?: readonly {
    readonly offer: string;
    readonly licence?: string;
    readonly nonce: string;
  }[];
  readonly notes?: readonly HeldNote[];
  /**
   * Descent terms this party offered as a parent, by payee commitment (hex): the terms it
   * will confirm, and the payee key that may move where they are paid.
   */
  readonly linkTerms?: Readonly<
    Record<
      string,
      { readonly terms: HeldLinkTerms; readonly payeeSecret: string }
    >
  >;
  /** A verifier's seed for its scopes: the same offer always gets the same scope from this verifier. */
  readonly verifierSeed?: string;
  /** Holder tags that answered this verifier, per offer, with when: a repeat is flagged. */
  readonly seenHolders?: Readonly<
    Record<string, readonly { readonly holder: string; readonly at: string }[]>
  >;
  /** Licence keys, notes and receipts this party put on chain: never prove while one is the latest. */
  readonly mine?: readonly string[];
};

export type RoyaltiesPrivateState = {
  readonly input: RoyaltyInput;
  readonly held: RoyaltiesHeld;
};

export const emptyRoyaltiesHeld = (): RoyaltiesHeld => ({
  admins: {},
  licences: [],
  receipts: [],
});

export const emptyRoyaltiesPrivateState = (
  held: RoyaltiesHeld = emptyRoyaltiesHeld(),
): RoyaltiesPrivateState => ({
  input: {},
  held,
});

type W = Royalties.Witnesses<RoyaltiesPrivateState>;
type Ctx = Parameters<W["recordSecret"]>[0];

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined)
    throw new Error(`This call needs ${what}, and none was given.`);
  return v;
};

const C = Royalties.pureCircuits;

/** A well-formed path for a leaf the tree does not hold: it passes the leaf check and fails the root check. */
const absentPath = (leaf: Uint8Array, depth: number) => ({
  leaf,
  path: Array.from({ length: depth }, () => ({
    sibling: { field: 0n },
    goes_left: true,
  })),
});

export const offerLeafOf = (o: Royalties.OfferOpening): Uint8Array =>
  C.offerLeaf(
    o.offer,
    o.payTo,
    o.color,
    o.rateCommit,
    o.expires,
    o.split,
    o.onChainPayment,
  );

/** An offer's issuer leaf for the credit issuer secret `issuer`. */
export const issuerLeafOf = (
  o: Royalties.OfferOpening,
  issuer: Uint8Array,
): Uint8Array => C.issuerLeaf(offerLeafOf(o), C.adminCommit(issuer));

/** Places in a pedigree chart, and the share denominator at each (basis points, halved per generation). */
export const CHART_PLACES = 14;
export const placeDenominator = (i: number): bigint =>
  i < 2 ? 10000n : i < 6 ? 20000n : 40000n;
const isEmpty = (b: Uint8Array): boolean => b.every((x) => x === 0);

/**
 * What each place in `record`'s chart is owed from a payment of `total` in `color` at
 * time `now`: the share rounded down, or 0 (an empty place, no share, another token, or
 * a link past its end). Exactly what the contract checks in paySplit.
 */
export const splitAmountsFor = (
  ledger: Royalties.Ledger,
  record: Uint8Array,
  color: Uint8Array,
  total: bigint,
  now: bigint,
): bigint[] => {
  const chart = ledger.stacks.member(record)
    ? ledger.stacks.lookup(record)
    : Array.from({ length: CHART_PLACES }, () => new Uint8Array(32));
  const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
  return chart.map((id, i) => {
    if (isEmpty(id) || !ledger.links.member(id)) return 0n;
    const l = ledger.links.lookup(id);
    if (l.share === 0n || hex(l.color) !== hex(color) || l.until <= now)
      return 0n;
    return (total * l.share) / placeDenominator(i);
  });
};

/** The note a licence secret, nonce, offer and amount make. */
export const noteOf = (
  secret: Uint8Array,
  nonce: Uint8Array,
  o: Royalties.OfferOpening,
  amount: bigint,
): Uint8Array =>
  C.noteCommit(
    C.topUpCode(C.spendKey(secret, o.offer), nonce),
    offerLeafOf(o),
    amount,
  );

/** The nonce of the change note that spending (nonce, amount) makes. */
export const changeNonceOf = (
  secret: Uint8Array,
  nonce: Uint8Array,
  o: Royalties.OfferOpening,
  amount: bigint,
): Uint8Array =>
  C.changeNonceFor(
    secret,
    C.nullifier(C.nullifierKey(secret), noteOf(secret, nonce, o, amount)),
  );

/** The licence key a secret holds from an offer. */
export const licenceKeyOf = (
  secret: Uint8Array,
  offer: Uint8Array,
  expires: bigint,
): Uint8Array =>
  C.licenseKey(
    C.licenseCommit(C.viewKey(secret, offer), C.spendKey(secret, offer), offer),
    offer,
    expires,
  );

/** Every witness the royalties contract declares. The compiled constructor refuses one missing. */
export const royaltiesWitnesses: W = {
  recordSecret: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.recordSecret, "the record secret"),
  ],
  adminSecret: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.adminSecret, "the offer's admin secret"),
  ],
  issuerSecret: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.issuerSecret, "the offer's credit issuer secret"),
  ],
  issuerPath: ({ privateState, ledger }: Ctx) => {
    const i = privateState.input;
    const leaf = issuerLeafOf(
      need(i.opening, "the offer opening"),
      need(i.issuerSecret, "the offer's credit issuer secret"),
    );
    return [
      privateState,
      ledger.issuerLeaves.findPathForLeaf(leaf) ?? absentPath(leaf, 32),
    ];
  },
  creditAmount: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.amount, "the amount of credit"),
  ],
  licenseSecret: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.licenseSecret, "the licence secret"),
  ],
  presentationOffer: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.offer, "the offer"),
  ],
  licenceExpires: ({ privateState }: Ctx) => [
    privateState,
    need(
      privateState.input.expires ?? privateState.input.opening?.expires,
      "the licence's end date",
    ),
  ],
  presentationChallenge: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.challenge, "the verifier's challenge"),
  ],
  receiptUnits: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.units, "the receipt's units"),
  ],
  licensePath: ({ privateState, ledger }: Ctx) => {
    const i = privateState.input;
    const offer = need(i.offer ?? i.opening?.offer, "the offer");
    const expires = need(
      i.expires ?? i.opening?.expires,
      "the licence's end date",
    );
    const leaf =
      i.present !== undefined && i.spend !== undefined
        ? C.licenseKey(
            C.licenseCommit(C.viewOf(i.present), i.spend, offer),
            offer,
            expires,
          )
        : licenceKeyOf(
            need(i.licenseSecret, "the licence secret"),
            offer,
            expires,
          );
    return [
      privateState,
      ledger.licenses.findPathForLeaf(leaf) ?? absentPath(leaf, 24),
    ];
  },
  receiptPath: ({ privateState, ledger }: Ctx) => {
    const i = privateState.input;
    const offer = need(i.offer, "the offer");
    const present =
      i.present ??
      C.presentKey(need(i.licenseSecret, "the licence secret"), offer);
    const leaf = C.receiptLeaf(
      C.receiptCommit(C.viewOf(present), need(i.period, "the period")),
      offer,
      need(i.units, "the receipt's units"),
      need(i.change, "the settlement's change note"),
    );
    return [
      privateState,
      ledger.receipts.findPathForLeaf(leaf) ?? absentPath(leaf, 32),
    ];
  },
  offerOpening: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.opening, "the offer opening"),
  ],
  offerPath: ({ privateState, ledger }: Ctx) => {
    const leaf = offerLeafOf(
      need(privateState.input.opening, "the offer opening"),
    );
    return [
      privateState,
      ledger.offerLeaves.findPathForLeaf(leaf) ?? absentPath(leaf, 32),
    ];
  },
  topUpCodeWitness: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.code, "the top-up code"),
  ],
  noteOpening: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.note, "the credit note"),
  ],
  notePath: ({ privateState, ledger }: Ctx) => {
    const i = privateState.input;
    const leaf = noteOf(
      need(i.licenseSecret, "the licence secret"),
      need(i.note, "the credit note").nonce,
      need(i.opening, "the offer opening"),
      need(i.note, "the credit note").amount,
    );
    return [
      privateState,
      ledger.notes.findPathForLeaf(leaf) ?? absentPath(leaf, 32),
    ];
  },
  secondNoteOpening: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.note2, "the second note"),
  ],
  secondNotePath: ({ privateState, ledger }: Ctx) => {
    const i = privateState.input;
    const leaf = noteOf(
      need(i.licenseSecret, "the licence secret"),
      need(i.note2, "the second note").nonce,
      need(i.opening, "the offer opening"),
      need(i.note2, "the second note").amount,
    );
    return [
      privateState,
      ledger.notes.findPathForLeaf(leaf) ?? absentPath(leaf, 32),
    ];
  },
  rateOpening: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.rate, "the rate opening"),
  ],
  settlePeriod: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.period, "the period"),
  ],
  settleUnits: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.units, "the units"),
  ],
  presentationKey: ({ privateState }: Ctx) => {
    const i = privateState.input;
    const offer = need(i.offer, "the offer");
    return [
      privateState,
      i.present ??
        C.presentKey(need(i.licenseSecret, "the licence secret"), offer),
    ];
  },
  licenceSpendKey: ({ privateState }: Ctx) => {
    const i = privateState.input;
    const offer = need(i.offer, "the offer");
    return [
      privateState,
      i.spend ?? C.spendKey(need(i.licenseSecret, "the licence secret"), offer),
    ];
  },
  receiptChange: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.change, "the settlement's change note"),
  ],
  settleIndex: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.index, "the settlement number"),
  ],
  splitAmounts: ({ privateState, ledger }: Ctx) => {
    const s = need(privateState.input.split, "the split payment");
    return [
      privateState,
      splitAmountsFor(ledger, s.record, s.color, s.total, s.now),
    ];
  },
};

export const CompiledVeilcoreRoyalties = CompiledContract.make<
  Royalties.Contract<RoyaltiesPrivateState>
>("VeilcoreRoyalties", Royalties.Contract<RoyaltiesPrivateState>).pipe(
  CompiledContract.withWitnesses(royaltiesWitnesses),
  CompiledContract.withCompiledFileAssets("./managed/veilcore-royalties"),
);

/** Every royalties circuit that needs a verifier key on chain, sorted by code unit. */
export const ROYALTIES_PROVABLE_CIRCUITS: readonly string[] = Object.keys(
  new Royalties.Contract<RoyaltiesPrivateState>(royaltiesWitnesses)
    .provableCircuits,
).sort();

/**
 * The royalties contract, deploying with verifier keys for `keep` only (as
 * claimsDeployingContract in ./claims.ts: the network caps what a deploy may carry, so the
 * rest are added one maintenance transaction each). Calls go through CompiledVeilcoreRoyalties.
 */
export const royaltiesDeployingContract = (keep: readonly string[]) => {
  const keepSet = new Set(keep);
  for (const k of keep) {
    if (!ROYALTIES_PROVABLE_CIRCUITS.includes(k))
      throw new Error(`No royalties circuit named ${k}`);
  }
  class RoyaltiesDeploying<PS> extends Royalties.Contract<PS> {
    constructor(witnesses: Royalties.Witnesses<PS>) {
      super(witnesses);
      (this as { provableCircuits: Record<string, unknown> }).provableCircuits =
        Object.fromEntries(
          Object.entries(this.provableCircuits).filter(([name]) =>
            keepSet.has(name),
          ),
        );
    }

    override initialState(
      ...args: Parameters<Royalties.Contract<PS>["initialState"]>
    ): ReturnType<Royalties.Contract<PS>["initialState"]> {
      const result = super.initialState(...args);
      const full = result.currentContractState;
      const pruned = new ContractState();
      pruned.data = full.data;
      for (const name of keep) {
        const op = full.operation(name);
        if (op === undefined)
          throw new Error(`The constructor produced no operation ${name}`);
        pruned.setOperation(name, op);
      }
      return { ...result, currentContractState: pruned };
    }
  }
  return RoyaltiesDeploying;
};

/** CompiledVeilcoreRoyalties, deploying with verifier keys for `keep` only. */
export const compiledRoyaltiesDeploying = (keep: readonly string[]) => {
  const RoyaltiesDeploying = royaltiesDeployingContract(keep);
  return CompiledContract.make<
    InstanceType<typeof RoyaltiesDeploying<RoyaltiesPrivateState>>
  >("VeilcoreRoyalties", RoyaltiesDeploying<RoyaltiesPrivateState>).pipe(
    CompiledContract.withWitnesses(royaltiesWitnesses),
    CompiledContract.withCompiledFileAssets("./managed/veilcore-royalties"),
  );
};
