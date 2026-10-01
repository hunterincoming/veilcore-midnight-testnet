// A simulated VeilCore contract for tests: the compiled circuits run against an
// in-memory ledger, one party at a time, at a block time the test controls.
//
// Beyond Midnight's usual simulator it can PROVE a call against one state and LAND it
// against a later one (`prove` / `land`). That is what happens on chain when other
// transactions arrive first, and it is how the contention attacks are tested: a call
// that lands after an adversary's transaction is one the adversary could not stop.
//
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
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
} from "../managed/veilcore/contract/index.js";

export const C = pureCircuits;
export const ZERO = new Uint8Array(32);
export const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
/** A deterministic 32-byte secret from a label. */
export const secret = (label: string): Uint8Array =>
  createHash("sha256").update(label).digest();

const COIN = "0".repeat(64);
export const T0 = 1_800_000_000n;

let recoveries = 0;
/** A recovery commitment nobody has used: every recovery must install one. */
export const freshRecovery = (): Uint8Array =>
  pureCircuits.recoveryCommit(secret(`fresh-recovery-${recoveries++}`));

/** Who is calling: their record secret, and the other secrets a call may need. */
export type Party = {
  readonly own: Uint8Array;
  readonly incoming?: Uint8Array;
  readonly recovery?: Uint8Array;
};

/** The licence a call acts on. `path` defaults to the one found in the current tree. */
export type LicenceWitness = {
  readonly secret: Uint8Array;
  readonly record: Uint8Array;
  readonly challenge?: Uint8Array;
  readonly path?: MerkleTreePath<Uint8Array>;
};

type Ctx = CircuitContext<Record<string, never>>;
type Impure = Contract<Record<string, never>>["impureCircuits"];
export type CircuitName = keyof Impure;

/** A call proved against one state, waiting to land on a later one. */
export type Proved = {
  readonly transcript: unknown;
  readonly effects: unknown;
};

const GAS = {
  readTime: 10n ** 15n,
  computeTime: 10n ** 15n,
  bytesWritten: 10n ** 12n,
  bytesDeleted: 10n ** 12n,
};

export class VeilcoreSimulator {
  private ctx: Ctx;
  /** Block time in seconds. Tests move it with `advance`. */
  now = T0;
  private licence: LicenceWitness | null = null;

  constructor() {
    const deployer = this.contract({ own: secret("deployer") });
    const initial = deployer.initialState(createConstructorContext({}, COIN));
    this.ctx = createCircuitContext(
      sampleContractAddress(),
      COIN,
      initial.currentContractState,
      {},
    );
  }

  /** The public ledger, as anyone reading the chain sees it. */
  get state(): Ledger {
    return ledger(this.ctx.currentQueryContext.state);
  }

  advance(seconds: bigint): void {
    this.now += seconds;
  }

  /** Run a call and commit its effects. Throws the contract's refusal. */
  call<N extends CircuitName>(
    who: Party,
    circuit: N,
    ...args: Parameters<Impure[N]> extends [unknown, ...infer A] ? A : never
  ): void {
    this.setTime(this.ctx);
    const fn = this.contract(who).impureCircuits[circuit] as (
      c: Ctx,
      ...a: unknown[]
    ) => { context: Ctx };
    this.ctx = fn(this.ctx, ...args).context;
  }

  /** Run a call with a licence named (countersign, transfer, presentation). */
  withLicence<T>(licence: LicenceWitness, f: () => T): T {
    this.licence = licence;
    try {
      return f();
    } finally {
      this.licence = null;
    }
  }

  /** Prove a call against the CURRENT state without committing it. */
  prove<N extends CircuitName>(
    who: Party,
    circuit: N,
    ...args: Parameters<Impure[N]> extends [unknown, ...infer A] ? A : never
  ): Proved {
    this.setTime(this.ctx);
    const fn = this.contract(who).impureCircuits[circuit] as (
      c: Ctx,
      ...a: unknown[]
    ) => {
      context: Ctx;
      proofData: { publicTranscript: unknown };
    };
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
    this.ctx = {
      ...this.ctx,
      currentQueryContext: landed,
    };
  }

  /** The licensee's path, as the SDK finds it: from the current tree. */
  pathFor(
    licenceSecret: Uint8Array,
    record: Uint8Array,
  ): MerkleTreePath<Uint8Array> | undefined {
    return this.state.activeLicenses.findPathForLeaf(
      C.licenseKey(C.licenseCommit(licenceSecret, record), record),
    );
  }

  /** A free leaf index, lowest first (the SDK picks at random). */
  freeSlot(): bigint {
    let s = 0n;
    while (this.state.licenseAtSlot.member(s)) s++;
    return s;
  }

  private setTime(ctx: Ctx): void {
    ctx.currentQueryContext.block = {
      ...ctx.currentQueryContext.block,
      secondsSinceEpoch: this.now,
    };
  }

  private contract(who: Party): Contract<Record<string, never>> {
    const lic = (): LicenceWitness => {
      if (this.licence === null)
        throw new Error(
          "test error: a circuit read the licence witnesses with no licence named",
        );
      return this.licence;
    };
    return new Contract<Record<string, never>>({
      localGeneticSecret: (c) => [c.privateState, who.own],
      incomingGeneticSecret: (c) => [c.privateState, who.incoming ?? who.own],
      recoverySecret: (c) => [c.privateState, who.recovery ?? ZERO],
      licenseSecret: (c) => [c.privateState, lic().secret],
      licenseRecord: (c) => [c.privateState, lic().record],
      presentationChallenge: (c) => [c.privateState, lic().challenge ?? ZERO],
      licensePath: (c) => {
        const l = lic();
        const path =
          l.path ??
          this.pathFor(l.secret, l.record) ??
          stubPath(C.licenseKey(C.licenseCommit(l.secret, l.record), l.record));
        return [c.privateState, path];
      },
    });
  }
}

/** A well-formed path for a leaf that is not in the tree: passes the leaf check, must fail the root check. */
const stubPath = (leaf: Uint8Array): MerkleTreePath<Uint8Array> => ({
  leaf,
  path: Array.from({ length: 24 }, () => ({
    sibling: { field: 0n },
    goes_left: true,
  })),
});

/** A party holding one secret. */
export const as = (own: Uint8Array, extra: Omit<Party, "own"> = {}): Party => ({
  own,
  ...extra,
});
