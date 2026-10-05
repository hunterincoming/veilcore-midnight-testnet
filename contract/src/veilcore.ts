// Veilcore compiled-contract module. Mirrors ./index.ts (bboard) but for the
// veilcore contract, in its own file to avoid `export *` name collisions.
// SPDX-License-Identifier: Apache-2.0

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import {
  ContractState,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";

import * as CompiledVeilcoreContract from "./managed/veilcore/contract/index.js";
import {
  createVeilcorePrivateState,
  veilcoreWitnesses,
  type VeilcorePrivateState,
} from "./witnesses";

export const CompiledVeilcore = CompiledContract.make<
  CompiledVeilcoreContract.Contract<VeilcorePrivateState>
>("Veilcore", CompiledVeilcoreContract.Contract<VeilcorePrivateState>).pipe(
  CompiledContract.withWitnesses(veilcoreWitnesses),
  CompiledContract.withCompiledFileAssets("./managed/veilcore"),
);

/** Every circuit that needs a verifier key on chain, sorted by code unit. */
export const PROVABLE_CIRCUITS: readonly string[] = Object.keys(
  new CompiledVeilcoreContract.Contract<VeilcorePrivateState>(veilcoreWitnesses)
    .provableCircuits,
).sort();

/**
 * The same contract, deploying with verifier keys for `keep` only.
 *
 * Midnight caps what one transaction may write, and the deploy transaction carries a
 * verifier key per circuit: with all of them the deploy is refused ("exceeded block
 * limit"). So the contract is deployed with some keys and the rest are added one
 * maintenance transaction each (VeilcoreAPI.deploy). The ledger state and every circuit
 * are identical; only which keys ride the first transaction differs. Calls are always
 * made through CompiledVeilcore.
 */
export const veilcoreDeployingContract = (keep: readonly string[]) => {
  const keepSet = new Set(keep);
  for (const k of keep) {
    if (!PROVABLE_CIRCUITS.includes(k))
      throw new Error(`No circuit named ${k}`);
  }
  class VeilcoreDeploying<PS> extends CompiledVeilcoreContract.Contract<PS> {
    constructor(witnesses: CompiledVeilcoreContract.Witnesses<PS>) {
      super(witnesses);
      (this as { provableCircuits: Record<string, unknown> }).provableCircuits =
        Object.fromEntries(
          Object.entries(this.provableCircuits).filter(([name]) =>
            keepSet.has(name),
          ),
        );
    }

    override initialState(
      ...args: Parameters<CompiledVeilcoreContract.Contract<PS>["initialState"]>
    ): ReturnType<CompiledVeilcoreContract.Contract<PS>["initialState"]> {
      const result = super.initialState(...args);
      const full = result.currentContractState;
      // ContractState has no way to remove an operation, so build it again with the same
      // data and only the kept operations.
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
  return VeilcoreDeploying;
};

/** CompiledVeilcore, deploying with verifier keys for `keep` only. */
export const compiledVeilcoreDeploying = (keep: readonly string[]) => {
  const VeilcoreDeploying = veilcoreDeployingContract(keep);
  return CompiledContract.make<
    InstanceType<typeof VeilcoreDeploying<VeilcorePrivateState>>
  >("Veilcore", VeilcoreDeploying<VeilcorePrivateState>).pipe(
    CompiledContract.withWitnesses(veilcoreWitnesses),
    CompiledContract.withCompiledFileAssets("./managed/veilcore"),
  );
};

/* **********************************************************************
 * What a genuine deploy starts from (round D, D-1).
 *
 * Midnight does not run the constructor on chain: a deploy carries whatever contract
 * state its deployer built. A copy of this build with every verifier key identical can
 * therefore start from a forged ledger (anchored identities, confirmed parents, a
 * licence tree). Joining compares the ledger DATA of the deploy transaction's state
 * with what this build's constructor produces. Not compared: the operations (their
 * verifier keys are checked separately, against this build, when joining), the
 * maintenance authority (a verifier has no expected value for it) and the balance.
 */

const hexOf = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** A contract state's ledger data alone, serialized (operations, authority and balance left out). */
export const ledgerDataHex = (state: ContractState): string => {
  const dataOnly = new ContractState();
  dataOnly.data = state.data;
  return hexOf(dataOnly.serialize());
};

/** The ledger data this build's constructor produces; it takes no arguments and reads no witness. */
export const constructorLedgerDataHex = (): string =>
  ledgerDataHex(
    new CompiledVeilcoreContract.Contract<VeilcorePrivateState>(
      veilcoreWitnesses,
    ).initialState(
      createConstructorContext(
        createVeilcorePrivateState(new Uint8Array(32)),
        "0".repeat(64),
      ),
    ).currentContractState,
  );

/** Whether a deploy state starts from exactly the constructor's ledger data. */
export const startsFromConstructor = (deployState: ContractState): boolean =>
  ledgerDataHex(deployState) === constructorLedgerDataHex();
