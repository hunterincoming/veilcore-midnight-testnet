// A simulated royalties contract: compiled circuits against an in-memory ledger, with the
// caller's secrets passed per call. Each call returns the token movements it asks the
// chain for, so tests can check that every payment passes straight through.
// SPDX-License-Identifier: Apache-2.0

import {
  type CircuitContext,
  type MerkleTreePath,
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

/** What the caller holds for one call. Anything not given makes the witness throw. */
export type Caller = {
  record?: Uint8Array;
  license?: Uint8Array;
  /** For a presentation, or to override the path the SDK would find. */
  offer?: Uint8Array;
  challenge?: Uint8Array;
  path?: MerkleTreePath<Uint8Array>;
};

/** The token movements one call asks for, by raw colour (hex). */
export type Movements = {
  inputs: Map<string, bigint>;
  outputs: Map<string, bigint>;
  /** [colour, recipient hex] → amount. */
  spends: Array<[string, string, bigint]>;
};

type Ctx = CircuitContext<Record<string, never>>;
type Impure = Contract<Record<string, never>>["impureCircuits"];
export type RoyaltyCircuit = keyof Impure;
type Args<N extends RoyaltyCircuit> =
  Parameters<Impure[N]> extends [unknown, ...infer A] ? A : never;

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`the caller does not hold ${what}`);
  return v;
};

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** A well-formed path for a leaf that is not in the tree: passes the leaf check, must fail the root check. */
export const stubPath = (leaf: Uint8Array): MerkleTreePath<Uint8Array> => ({
  leaf,
  path: Array.from({ length: 20 }, () => ({
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

  /** The licensee's path, as the SDK finds it: from the current tree. */
  pathFor(
    license: Uint8Array,
    offer: Uint8Array,
  ): MerkleTreePath<Uint8Array> | undefined {
    return this.state.licenses.findPathForLeaf(
      R.licenseKey(R.licenseCommit(license, offer), offer),
    );
  }

  /** Run a call and commit it. Throws the contract's refusal. */
  call<N extends RoyaltyCircuit>(
    who: Caller,
    circuit: N,
    ...args: Args<N>
  ): { result: unknown; moved: Movements } {
    const fn = this.contract(who).impureCircuits[circuit] as (
      c: Ctx,
      ...a: unknown[]
    ) => { context: Ctx; result: unknown };
    const r = fn(this.ctx, ...args);
    const e = r.context.currentQueryContext.effects as unknown as {
      unshieldedInputs: Map<{ tag: string; raw: string }, bigint>;
      unshieldedOutputs: Map<{ tag: string; raw: string }, bigint>;
      claimedUnshieldedSpends: Map<
        [{ tag: string; raw: string }, { tag: string; address: string }],
        bigint
      >;
    };
    // The simulated context accumulates effects across calls; report this call's alone.
    const flat = (
      m: Map<{ raw: string }, bigint>,
      before: Map<string, bigint>,
    ): Map<string, bigint> => {
      const out = new Map<string, bigint>();
      for (const [k, v] of m) {
        const d = v - (before.get(k.raw) ?? 0n);
        if (d !== 0n) out.set(k.raw, (out.get(k.raw) ?? 0n) + d);
      }
      return out;
    };
    const spends = [...e.claimedUnshieldedSpends].map(
      ([[t, to], v]) =>
        [t.raw, JSON.stringify(to), v] as [string, string, bigint],
    );
    const moved: Movements = {
      inputs: flat(e.unshieldedInputs, this.seen.inputs),
      outputs: flat(e.unshieldedOutputs, this.seen.outputs),
      spends: spends
        .map(([t, to, v]) => {
          const prior = this.seen.spends.find(
            ([pt, pto]) => pt === t && pto === to,
          );
          return [t, to, v - (prior?.[2] ?? 0n)] as [string, string, bigint];
        })
        .filter(([, , v]) => v !== 0n),
    };
    this.seen = {
      inputs: new Map([...e.unshieldedInputs].map(([k, v]) => [k.raw, v])),
      outputs: new Map([...e.unshieldedOutputs].map(([k, v]) => [k.raw, v])),
      spends,
    };
    this.ctx = r.context;
    return { result: r.result, moved };
  }

  private contract(who: Caller): Contract<Record<string, never>> {
    return new Contract<Record<string, never>>({
      recordSecret: (c) => [
        c.privateState,
        need(who.record, "a record secret"),
      ],
      licenseSecret: (c) => [
        c.privateState,
        need(who.license, "a licence secret"),
      ],
      presentationOffer: (c) => [
        c.privateState,
        need(who.offer, "an offer to present"),
      ],
      presentationChallenge: (c) => [c.privateState, who.challenge ?? ZERO],
      licensePath: (c) => {
        const lic = need(who.license, "a licence secret");
        const offer = need(who.offer, "the offer the licence is from");
        const path =
          who.path ??
          this.pathFor(lic, offer) ??
          stubPath(R.licenseKey(R.licenseCommit(lic, offer), offer));
        return [c.privateState, path];
      },
    });
  }
}

export { hex };
