// A simulated royalties contract: compiled circuits against an in-memory ledger, at a
// block time the test controls, with the caller's secrets passed per call. Each call
// returns the token movements it asks the chain for, so tests can check that every
// payment passes straight through. Can prove against one state and land on a later one.
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
  ledger,
  pureCircuits,
} from "../managed/veilcore-royalties/contract/index.js";

export const R = pureCircuits;
const COIN = "0".repeat(64);
const ZERO = new Uint8Array(32);
export const T0 = 1_800_000_000n;

/** What the caller holds for one call. Anything not given makes the witness throw. */
export type Caller = {
  record?: Uint8Array;
  admin?: Uint8Array;
  license?: Uint8Array;
  /** For a presentation: the offer, the licence's end date, the verifier's challenge. */
  offer?: Uint8Array;
  expires?: bigint;
  challenge?: Uint8Array;
  /** Override the path the SDK would find in the current tree. */
  path?: MerkleTreePath<Uint8Array>;
  /** For a paid-up presentation: the receipt's period and units, and optionally its path. */
  period?: Uint8Array;
  units?: bigint;
  receiptPath?: MerkleTreePath<Uint8Array>;
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

export class RoyaltiesSimulator {
  private ctx: Ctx;
  private seen: Movements = {
    inputs: new Map(),
    outputs: new Map(),
    spends: [],
  };
  private nextSlot = 0n;
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

  /** A free leaf index (the SDK picks at random). */
  freeSlot(): bigint {
    let s = this.nextSlot;
    while (this.state.licenseAtSlot.member(s)) s++;
    this.nextSlot = s + 1n;
    return s;
  }

  /** The licensee's path, as the SDK finds it: from the current tree. */
  pathFor(
    license: Uint8Array,
    offer: Uint8Array,
    expires: bigint,
  ): MerkleTreePath<Uint8Array> | undefined {
    return this.state.licenses.findPathForLeaf(
      R.licenseKey(R.licenseCommit(license, offer), offer, expires),
    );
  }

  receiptPathFor(receipt: Uint8Array): MerkleTreePath<Uint8Array> | undefined {
    return this.state.receipts.findPathForLeaf(receipt);
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

  /** Land a proved call on the CURRENT state, as the chain would. Throws if the chain would reject it. */
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

  /** The simulated context accumulates effects across calls; report this call's alone. */
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
    return new Contract<Record<string, never>>({
      recordSecret: (c) => [
        c.privateState,
        need(who.record, "a record secret"),
      ],
      adminSecret: (c) => [
        c.privateState,
        need(who.admin, "an offer admin secret"),
      ],
      licenseSecret: (c) => [
        c.privateState,
        need(who.license, "a licence secret"),
      ],
      presentationOffer: (c) => [
        c.privateState,
        need(who.offer, "an offer to present"),
      ],
      presentationExpires: (c) => [
        c.privateState,
        need(who.expires, "the licence's end date"),
      ],
      presentationChallenge: (c) => [c.privateState, who.challenge ?? ZERO],
      receiptUnits: (c) => [
        c.privateState,
        need(who.units, "the receipt's units"),
      ],
      licensePath: (c) => {
        const lic = need(who.license, "a licence secret");
        const offer = need(who.offer, "the offer the licence is from");
        const expires = need(who.expires, "the licence's end date");
        const path =
          who.path ??
          this.pathFor(lic, offer, expires) ??
          stubPath(
            R.licenseKey(R.licenseCommit(lic, offer), offer, expires),
            24,
          );
        return [c.privateState, path];
      },
      receiptPath: (c) => {
        const r = R.receiptLeaf(
          R.receiptCommit(
            need(who.license, "a licence secret"),
            need(who.period, "the period"),
          ),
          need(who.offer, "the offer"),
          need(who.units, "the receipt's units"),
        );
        return [
          c.privateState,
          who.receiptPath ?? this.receiptPathFor(r) ?? stubPath(r, 32),
        ];
      },
    });
  }
}
