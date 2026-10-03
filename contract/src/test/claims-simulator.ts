// A simulated claims contract: compiled circuits against an in-memory ledger, with the
// prover's private values passed per call. Can prove against one state and land on a
// later one, as on chain.
// SPDX-License-Identifier: Apache-2.0

import {
  type CircuitContext,
  QueryContext,
  CostModel,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  type AttestationSignature as SchnorrSignature,
  type JubjubPoint,
  schnorrReduction,
} from "../attest.js";
import {
  Contract,
  type Ledger,
  type FieldSet,
  type SlotOpening,
  type SchemaTerms,
  ledger,
  pureCircuits,
} from "../managed/veilcore-claims/contract/index.js";

export const CC = pureCircuits;
const COIN = "0".repeat(64);

/** What the prover holds for one call. Anything not given makes the witness throw. */
export type Private = {
  first?: FieldSet;
  second?: FieldSet;
  opening?: SlotOpening;
  number?: bigint;
  terms?: SchemaTerms;
  attester?: JubjubPoint;
  signature?: SchnorrSignature;
  secondSignature?: SchnorrSignature;
};

type Ctx = CircuitContext<Record<string, never>>;
type Impure = Contract<Record<string, never>>["impureCircuits"];
export type ClaimCircuit = keyof Impure;
type Args<N extends ClaimCircuit> =
  Parameters<Impure[N]> extends [unknown, ...infer A] ? A : never;

const GAS = {
  readTime: 10n ** 15n,
  computeTime: 10n ** 15n,
  bytesWritten: 10n ** 12n,
  bytesDeleted: 10n ** 12n,
};

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`the prover does not hold ${what}`);
  return v;
};

const contract = (p: Private): Contract<Record<string, never>> =>
  new Contract<Record<string, never>>({
    firstFieldSet: ({ privateState }) => [
      privateState,
      need(p.first, "a first field set"),
    ],
    secondFieldSet: ({ privateState }) => [
      privateState,
      need(p.second, "a second field set"),
    ],
    slotOpening: ({ privateState }) => [
      privateState,
      need(p.opening, "a slot opening"),
    ],
    slotNumber: ({ privateState }) => [
      privateState,
      need(p.number, "a slot number"),
    ],
    schemaTerms: ({ privateState }) => [
      privateState,
      need(p.terms, "schema terms"),
    ],
    attesterKey: ({ privateState }) => [
      privateState,
      need(p.attester, "a laboratory key"),
    ],
    attesterSignature: ({ privateState }) => [
      privateState,
      need(p.signature, "a laboratory signature"),
    ],
    secondAttesterSignature: ({ privateState }) => [
      privateState,
      need(p.secondSignature, "a second laboratory signature"),
    ],
    schnorrReduction: ({ privateState }, h: bigint) => [
      privateState,
      schnorrReduction(h),
    ],
  });

export class ClaimsSimulator {
  private ctx: Ctx;

  constructor() {
    const initial = contract({}).initialState(
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

  /** A printout of the whole public state, to check that nothing grows with use. */
  get stateText(): string {
    return String(
      (this.ctx.currentQueryContext.state as unknown as { state: unknown })
        .state,
    );
  }

  call<N extends ClaimCircuit>(p: Private, circuit: N, ...args: Args<N>): void {
    const fn = contract(p).impureCircuits[circuit] as (
      c: Ctx,
      ...a: unknown[]
    ) => { context: Ctx };
    this.ctx = fn(this.ctx, ...args).context;
  }

  prove<N extends ClaimCircuit>(
    p: Private,
    circuit: N,
    ...args: Args<N>
  ): { transcript: unknown; effects: unknown } {
    const fn = contract(p).impureCircuits[circuit] as (
      c: Ctx,
      ...a: unknown[]
    ) => { context: Ctx; proofData: { publicTranscript: unknown } };
    const r = fn(this.ctx, ...args);
    return {
      transcript: r.proofData.publicTranscript,
      effects: r.context.currentQueryContext.effects,
    };
  }

  land(p: { transcript: unknown; effects: unknown }): void {
    const q = new QueryContext(
      this.ctx.currentQueryContext.state,
      this.ctx.currentQueryContext.address,
    );
    const landed = q.runTranscript(
      { gas: GAS, effects: p.effects, program: p.transcript } as Parameters<
        QueryContext["runTranscript"]
      >[0],
      CostModel.initialCostModel(),
    );
    this.ctx = { ...this.ctx, currentQueryContext: landed };
  }
}
