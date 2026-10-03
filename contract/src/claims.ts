// The claims contract (veilcore-claims.compact), compiled for midnight-js: the same shape
// as ./veilcore.ts for the main contract. Kept in its own file so the two contracts'
// generated names never collide.
//
// Every witness reads one call's private input, which the client puts in private state
// just before the call and clears straight after (api/src/claims-api.ts). Nothing a
// holder proves from stays in private state between calls.
// SPDX-License-Identifier: Apache-2.0

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ContractState } from "@midnight-ntwrk/compact-runtime";

import * as Claims from "./managed/veilcore-claims/contract/index.js";
import {
  type AttestationSignature,
  type JubjubPoint,
  schnorrReduction,
} from "./attest.js";

export {
  ClaimKind,
  RangeOp,
} from "./managed/veilcore-claims/contract/index.js";
export type {
  FieldSet as ClaimFieldSet,
  SlotOpening as ClaimSlotOpening,
  SchemaTerms as ClaimSchemaTerms,
  Ledger as ClaimsLedger,
} from "./managed/veilcore-claims/contract/index.js";
export const claimsLedger = Claims.ledger;
export const claimsPureCircuits = Claims.pureCircuits;

/**
 * What the prover holds for ONE claim. Which parts a circuit reads:
 *   value, range           opening (+ number and terms for a range)
 *   distinct               first, second, terms
 *   unchanged              first, second
 *   attested versions      the same, plus attester and signature (and secondSignature for distinct)
 * A witness asked for something not given throws, so the call is never built.
 */
export type ClaimInput = {
  readonly first?: Claims.FieldSet;
  readonly second?: Claims.FieldSet;
  readonly opening?: Claims.SlotOpening;
  readonly number?: bigint;
  readonly terms?: Claims.SchemaTerms;
  readonly attester?: JubjubPoint;
  readonly signature?: AttestationSignature;
  readonly secondSignature?: AttestationSignature;
};

/** Private state of a claims client: the input of the call being made, or nothing. */
export type ClaimsPrivateState = { readonly input: ClaimInput };

export const emptyClaimsPrivateState = (): ClaimsPrivateState => ({
  input: {},
});

type W = Claims.Witnesses<ClaimsPrivateState>;
type Ctx = Parameters<W["firstFieldSet"]>[0];

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined)
    throw new Error(`This claim needs ${what}, and none was given.`);
  return v;
};

/** Every witness the claims contract declares. The compiled constructor refuses one missing. */
export const claimsWitnesses: W = {
  firstFieldSet: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.first, "the first record's field set"),
  ],
  secondFieldSet: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.second, "the second record's field set"),
  ],
  slotOpening: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.opening, "an opening of the slot"),
  ],
  slotNumber: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.number, "the number in the slot"),
  ],
  schemaTerms: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.terms, "the schema's terms"),
  ],
  attesterKey: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.attester, "a laboratory key"),
  ],
  attesterSignature: ({ privateState }: Ctx) => [
    privateState,
    need(privateState.input.signature, "a laboratory signature"),
  ],
  secondAttesterSignature: ({ privateState }: Ctx) => [
    privateState,
    need(
      privateState.input.secondSignature,
      "a laboratory signature on the second record",
    ),
  ],
  schnorrReduction: ({ privateState }: Ctx, h: bigint) => [
    privateState,
    schnorrReduction(h),
  ],
};

export const CompiledVeilcoreClaims = CompiledContract.make<
  Claims.Contract<ClaimsPrivateState>
>("VeilcoreClaims", Claims.Contract<ClaimsPrivateState>).pipe(
  CompiledContract.withWitnesses(claimsWitnesses),
  CompiledContract.withCompiledFileAssets("./managed/veilcore-claims"),
);

/** Every claims circuit that needs a verifier key on chain, sorted by code unit. */
export const CLAIMS_PROVABLE_CIRCUITS: readonly string[] = Object.keys(
  new Claims.Contract<ClaimsPrivateState>(claimsWitnesses).provableCircuits,
).sort();

/**
 * The claims contract, deploying with verifier keys for `keep` only (see
 * veilcoreDeployingContract in ./veilcore.ts, which this mirrors: the network caps what a
 * deploy may carry, so the rest are added one maintenance transaction each). The ledger
 * state and every circuit are identical; calls are always made through
 * CompiledVeilcoreClaims.
 */
export const claimsDeployingContract = (keep: readonly string[]) => {
  const keepSet = new Set(keep);
  for (const k of keep) {
    if (!CLAIMS_PROVABLE_CIRCUITS.includes(k))
      throw new Error(`No claims circuit named ${k}`);
  }
  class ClaimsDeploying<PS> extends Claims.Contract<PS> {
    constructor(witnesses: Claims.Witnesses<PS>) {
      super(witnesses);
      (this as { provableCircuits: Record<string, unknown> }).provableCircuits =
        Object.fromEntries(
          Object.entries(this.provableCircuits).filter(([name]) =>
            keepSet.has(name),
          ),
        );
    }

    override initialState(
      ...args: Parameters<Claims.Contract<PS>["initialState"]>
    ): ReturnType<Claims.Contract<PS>["initialState"]> {
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
  return ClaimsDeploying;
};

/** CompiledVeilcoreClaims, deploying with verifier keys for `keep` only. */
export const compiledClaimsDeploying = (keep: readonly string[]) => {
  const ClaimsDeploying = claimsDeployingContract(keep);
  return CompiledContract.make<
    InstanceType<typeof ClaimsDeploying<ClaimsPrivateState>>
  >("VeilcoreClaims", ClaimsDeploying<ClaimsPrivateState>).pipe(
    CompiledContract.withWitnesses(claimsWitnesses),
    CompiledContract.withCompiledFileAssets("./managed/veilcore-claims"),
  );
};
