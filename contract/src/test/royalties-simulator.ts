// A simulated royalties contract: compiled circuits against an in-memory ledger, at a
// block time the test controls, with the caller's secrets passed per call. Each call
// returns the token movements it asks the chain for, so tests can check that none moves.
// Can prove against one state and land on a later one.
// SPDX-License-Identifier: Apache-2.0

import {
  type CircuitContext,
  type MerkleTreePath,
  QueryContext,
  CostModel,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  type NoteOpening,
  type OfferOpening,
  type RateOpening,
  ledger,
  pureCircuits,
} from "../managed/veilcore-royalties/contract/index.js";

export const R = pureCircuits;
const COIN = "0".repeat(64);
const ZERO = new Uint8Array(32);
export const T0 = 1_800_000_000n;
/** The credit issuer secret tests post offers with unless they say otherwise. */
export const ISSUER = (() => {
  const out = new Uint8Array(32);
  out[0] = 0x15;
  out[31] = 0x50;
  return out;
})();

/** What the caller holds for one call. Anything not given makes the witness throw. */
export type Caller = {
  record?: Uint8Array;
  admin?: Uint8Array;
  /** An offer's credit issuer secret, and for a private issuance the amount and optionally the path. */
  issuer?: Uint8Array;
  amount?: bigint;
  issuerPath?: MerkleTreePath<Uint8Array>;
  license?: Uint8Array;
  /** For a presentation: the offer, the licence's end date, the verifier's challenge. */
  offer?: Uint8Array;
  expires?: bigint;
  challenge?: Uint8Array;
  path?: MerkleTreePath<Uint8Array>;
  /** For a paid-up presentation: the receipt's period and units, and optionally its path. */
  period?: Uint8Array;
  units?: bigint;
  receiptPath?: MerkleTreePath<Uint8Array>;
  /** For a top-up or settlement: the offer opened privately, and optionally its path. */
  opening?: OfferOpening;
  offerPath?: MerkleTreePath<Uint8Array>;
  /** For a top-up: the licensee's top-up code. */
  code?: Uint8Array;
  /** For a settlement or merge: the note(s) spent, the change nonce, the rate. */
  note?: NoteOpening;
  notePath?: MerkleTreePath<Uint8Array>;
  note2?: NoteOpening;
  notePath2?: MerkleTreePath<Uint8Array>;
  rate?: RateOpening;
  /** For a presentation by a delegate: the presentation key and spending key instead of the licence secret. */
  present?: Uint8Array;
  spend?: Uint8Array;
  /** For a paid-up presentation: the settlement's change note (found automatically if left out). */
  change?: Uint8Array;
  /** For a settle: which settlement of the licence this is (the next free one if left out). */
  index?: bigint;
};

/** The token movements one call asks for, by raw colour (hex). */
export type Movements = {
  inputs: Map<string, bigint>;
  outputs: Map<string, bigint>;
  /** [colour, recipient as JSON, amount]. */
  spends: Array<[string, string, bigint]>;
};

export type Proved = { transcript: unknown; effects: unknown };

type Ctx = CircuitContext<Record<string, never>>;
type Impure = Contract<Record<string, never>>["impureCircuits"];
export type RoyaltyCircuit = keyof Impure;
type Args<N extends RoyaltyCircuit> =
  Parameters<Impure[N]> extends [unknown, ...infer A] ? A : never;
type Effects = {
  unshieldedInputs: Map<{ raw: string }, bigint>;
  unshieldedOutputs: Map<{ raw: string }, bigint>;
  claimedUnshieldedSpends: Map<[{ raw: string }, unknown], bigint>;
};

const GAS = {
  readTime: 10n ** 15n,
  computeTime: 10n ** 15n,
  bytesWritten: 10n ** 12n,
  bytesDeleted: 10n ** 12n,
};

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`the caller does not hold ${what}`);
  return v;
};

export const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** A well-formed path for a leaf that is not in the tree: passes the leaf check, must fail the root check. */
export const stubPath = (
  leaf: Uint8Array,
  depth: number,
): MerkleTreePath<Uint8Array> => ({
  leaf,
  path: Array.from({ length: depth }, () => ({
    sibling: { field: 0n },
    goes_left: true,
  })),
});

export const offerLeafOf = (o: OfferOpening): Uint8Array =>
  R.offerLeaf(o.offer, o.unit, o.rateCommit, o.expires, o.split);

/** The note a licensee's secret, nonce, offer and amount make. */
export const noteOf = (
  secret: Uint8Array,
  nonce: Uint8Array,
  o: OfferOpening,
  amount: bigint,
): Uint8Array =>
  R.noteCommit(
    R.topUpCode(R.spendKey(secret, o.offer), nonce),
    offerLeafOf(o),
    amount,
  );

/** The nonce of the change note that spending (nonce, amount) makes. */
export const changeNonceOf = (
  secret: Uint8Array,
  nonce: Uint8Array,
  o: OfferOpening,
  amount: bigint,
): Uint8Array =>
  R.changeNonceFor(
    secret,
    R.nullifier(R.nullifierKey(secret), noteOf(secret, nonce, o, amount)),
  );

/** The licence key a secret holds from an offer. */
export const licenceKeyOf = (
  secret: Uint8Array,
  offer: Uint8Array,
  expires: bigint,
): Uint8Array =>
  R.licenseKey(
    R.licenseCommit(R.viewKey(secret, offer), R.spendKey(secret, offer), offer),
    offer,
    expires,
  );

export class RoyaltiesSimulator {
  private ctx: Ctx;
  private seen: Movements = {
    inputs: new Map(),
    outputs: new Map(),
    spends: [],
  };
  private nextSlot = 0n;
  private nextIssuerSlot = 0n;
  /** Block time in seconds. Tests move it with `advance`. */
  now = T0;

  constructor() {
    const initial = this.contract({}).initialState(
      createConstructorContext({}, COIN),
    );
    this.ctx = createCircuitContext(
      sampleContractAddress(),
      COIN,
      initial.currentContractState,
      {},
    );
  }

  get state(): Ledger {
    return ledger(this.ctx.currentQueryContext.state);
  }

  advance(seconds: bigint): void {
    this.now += seconds;
  }

  freeSlot(): bigint {
    let s = this.nextSlot;
    while (this.state.licenseAtSlot.member(s)) s++;
    this.nextSlot = s + 1n;
    return s;
  }

  /** A place in the issuer tree no offer has taken. */
  freeIssuerSlot(): bigint {
    let s = this.nextIssuerSlot;
    while (this.state.issuerSlotTaken.member(s)) s++;
    this.nextIssuerSlot = s + 1n;
    return s;
  }

  pathFor(
    license: Uint8Array,
    offer: Uint8Array,
    expires: bigint,
  ): MerkleTreePath<Uint8Array> | undefined {
    return this.state.licenses.findPathForLeaf(
      licenceKeyOf(license, offer, expires),
    );
  }

  receiptPathFor(leaf: Uint8Array): MerkleTreePath<Uint8Array> | undefined {
    return this.state.receipts.findPathForLeaf(leaf);
  }

  notePathFor(note: Uint8Array): MerkleTreePath<Uint8Array> | undefined {
    return this.state.notes.findPathForLeaf(note);
  }

  /** Run a call and commit it. Throws the contract's refusal. */
  call<N extends RoyaltyCircuit>(
    who: Caller,
    circuit: N,
    ...args: Args<N>
  ): { result: unknown; moved: Movements } {
    this.setTime(this.ctx);
    const fn = this.contract(who).impureCircuits[circuit] as (
      c: Ctx,
      ...a: unknown[]
    ) => { context: Ctx; result: unknown };
    const r = fn(this.ctx, ...args);
    const moved = this.diff(
      r.context.currentQueryContext.effects as unknown as Effects,
    );
    this.ctx = r.context;
    return { result: r.result, moved };
  }

  /** Prove a call against the CURRENT state without committing it. */
  prove<N extends RoyaltyCircuit>(
    who: Caller,
    circuit: N,
    ...args: Args<N>
  ): Proved {
    this.setTime(this.ctx);
    const fn = this.contract(who).impureCircuits[circuit] as (
      c: Ctx,
      ...a: unknown[]
    ) => { context: Ctx; proofData: { publicTranscript: unknown } };
    const r = fn(this.ctx, ...args);
    return {
      transcript: r.proofData.publicTranscript,
      effects: r.context.currentQueryContext.effects,
    };
  }

  land(p: Proved): void {
    const q = new QueryContext(
      this.ctx.currentQueryContext.state,
      this.ctx.currentQueryContext.address,
    );
    q.block = { ...q.block, secondsSinceEpoch: this.now };
    const landed = q.runTranscript(
      { gas: GAS, effects: p.effects, program: p.transcript } as Parameters<
        QueryContext["runTranscript"]
      >[0],
      CostModel.initialCostModel(),
    );
    this.ctx = { ...this.ctx, currentQueryContext: landed };
  }

  private diff(e: Effects): Movements {
    const totals = (m: Map<{ raw: string }, bigint>): Map<string, bigint> => {
      const out = new Map<string, bigint>();
      for (const [k, v] of m) out.set(k.raw, (out.get(k.raw) ?? 0n) + v);
      return out;
    };
    const minus = (
      now: Map<string, bigint>,
      before: Map<string, bigint>,
    ): Map<string, bigint> => {
      const out = new Map<string, bigint>();
      for (const [k, v] of now) {
        const d = v - (before.get(k) ?? 0n);
        if (d !== 0n) out.set(k, d);
      }
      return out;
    };
    const inputs = totals(e.unshieldedInputs);
    const outputs = totals(e.unshieldedOutputs);
    const spends = [...e.claimedUnshieldedSpends].map(
      ([[t, to], v]) =>
        [t.raw, JSON.stringify(to), v] as [string, string, bigint],
    );
    const moved: Movements = {
      inputs: minus(inputs, this.seen.inputs),
      outputs: minus(outputs, this.seen.outputs),
      spends: spends
        .map(([t, to, v]) => {
          const prior = this.seen.spends.find(
            ([pt, pto]) => pt === t && pto === to,
          );
          return [t, to, v - (prior?.[2] ?? 0n)] as [string, string, bigint];
        })
        .filter(([, , v]) => v !== 0n),
    };
    this.seen = { inputs, outputs, spends };
    return moved;
  }

  private setTime(ctx: Ctx): void {
    ctx.currentQueryContext.block = {
      ...ctx.currentQueryContext.block,
      secondsSinceEpoch: this.now,
    };
  }

  private contract(who: Caller): Contract<Record<string, never>> {
    const offerOf = (): OfferOpening => need(who.opening, "an offer opening");
    const lic = (): Uint8Array => need(who.license, "a licence secret");
    const noteLeaf = (n: NoteOpening): Uint8Array =>
      noteOf(lic(), n.nonce, offerOf(), n.amount);
    const licOffer = (): Uint8Array => who.offer ?? offerOf().offer;
    const licExpires = (): bigint => who.expires ?? offerOf().expires;
    const presentOf = (offer: Uint8Array): Uint8Array =>
      who.present ?? R.presentKey(lic(), offer);
    /** The change note of the settlement whose receipt matches (period, units) under this licence. */
    const changeOf = (offer: Uint8Array): Uint8Array => {
      if (who.change !== undefined) return who.change;
      const commit = R.receiptCommit(
        R.viewOf(presentOf(offer)),
        need(who.period, "the period"),
      );
      const units = need(who.units, "the receipt's units");
      for (const [change, st] of this.state.settlements)
        if (
          Buffer.from(R.receiptLeaf(commit, offer, units, change)).equals(
            Buffer.from(st.receipt),
          )
        )
          return change;
      return ZERO;
    };
    return new Contract<Record<string, never>>({
      recordSecret: (c) => [
        c.privateState,
        need(who.record, "a record secret"),
      ],
      adminSecret: (c) => [
        c.privateState,
        need(who.admin, "an offer admin secret"),
      ],
      issuerSecret: (c) => [
        c.privateState,
        need(who.issuer, "a credit issuer secret"),
      ],
      issuerPath: (c) => {
        const leaf = R.issuerLeaf(
          offerLeafOf(offerOf()),
          R.adminCommit(need(who.issuer, "a credit issuer secret")),
        );
        return [
          c.privateState,
          who.issuerPath ??
            this.state.issuerLeaves.findPathForLeaf(leaf) ??
            stubPath(leaf, 32),
        ];
      },
      creditAmount: (c) => [
        c.privateState,
        need(who.amount, "an amount of credit"),
      ],
      licenseSecret: (c) => [c.privateState, lic()],
      presentationOffer: (c) => [
        c.privateState,
        need(who.offer, "an offer to present"),
      ],
      licenceExpires: (c) => [c.privateState, licExpires()],
      presentationChallenge: (c) => [c.privateState, who.challenge ?? ZERO],
      receiptUnits: (c) => [
        c.privateState,
        need(who.units, "the receipt's units"),
      ],
      licensePath: (c) => {
        const leaf =
          who.present !== undefined && who.spend !== undefined
            ? R.licenseKey(
                R.licenseCommit(R.viewOf(who.present), who.spend, licOffer()),
                licOffer(),
                licExpires(),
              )
            : licenceKeyOf(lic(), licOffer(), licExpires());
        return [
          c.privateState,
          who.path ??
            this.state.licenses.findPathForLeaf(leaf) ??
            stubPath(leaf, 24),
        ];
      },
      receiptPath: (c) => {
        const offer = need(who.offer, "the offer");
        const leaf = R.receiptLeaf(
          R.receiptCommit(
            R.viewOf(presentOf(offer)),
            need(who.period, "the period"),
          ),
          offer,
          need(who.units, "the receipt's units"),
          changeOf(offer),
        );
        return [
          c.privateState,
          who.receiptPath ?? this.receiptPathFor(leaf) ?? stubPath(leaf, 32),
        ];
      },
      offerOpening: (c) => [c.privateState, offerOf()],
      offerPath: (c) => {
        const leaf = offerLeafOf(offerOf());
        return [
          c.privateState,
          who.offerPath ??
            this.state.offerLeaves.findPathForLeaf(leaf) ??
            stubPath(leaf, 32),
        ];
      },
      topUpCodeWitness: (c) => [
        c.privateState,
        need(who.code, "a top-up code"),
      ],
      noteOpening: (c) => [c.privateState, need(who.note, "a credit note")],
      notePath: (c) => {
        const leaf = noteLeaf(need(who.note, "a credit note"));
        return [
          c.privateState,
          who.notePath ?? this.notePathFor(leaf) ?? stubPath(leaf, 32),
        ];
      },
      secondNoteOpening: (c) => [
        c.privateState,
        need(who.note2, "a second credit note"),
      ],
      secondNotePath: (c) => {
        const leaf = noteLeaf(need(who.note2, "a second credit note"));
        return [
          c.privateState,
          who.notePath2 ?? this.notePathFor(leaf) ?? stubPath(leaf, 32),
        ];
      },
      rateOpening: (c) => [c.privateState, need(who.rate, "the rate opening")],
      settlePeriod: (c) => [c.privateState, need(who.period, "the period")],
      settleUnits: (c) => [c.privateState, need(who.units, "the units")],
      presentationKey: (c) => [
        c.privateState,
        presentOf(need(who.offer, "the offer")),
      ],
      licenceSpendKey: (c) => [
        c.privateState,
        who.spend ?? R.spendKey(lic(), need(who.offer, "the offer")),
      ],
      receiptChange: (c) => [
        c.privateState,
        changeOf(need(who.offer, "the offer")),
      ],
      settleIndex: (c) => {
        if (who.index !== undefined) return [c.privateState, who.index];
        const view = R.viewKey(lic(), offerOf().offer);
        let n = 0n;
        while (this.state.settlementByTag.member(R.settleTag(view, n))) n++;
        return [c.privateState, n];
      },
    });
  }
}
