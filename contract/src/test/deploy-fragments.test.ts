// Deploying in fragments: the first transaction carries some verifier keys, the rest are
// added by maintenance transactions (VeilcoreAPI.deploy). A full deploy is refused by
// the network as over the block limit.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  createConstructorContext,
  ContractState,
} from "@midnight-ntwrk/compact-runtime";
import { Contract } from "../managed/veilcore/contract/index.js";
import { PROVABLE_CIRCUITS, veilcoreDeployingContract } from "../veilcore.js";
import { veilcoreWitnesses, type VeilcorePrivateState } from "../witnesses.js";

const COIN = "0".repeat(64);
const names = (s: ContractState): string[] =>
  s
    .operations()
    .map((o) => (typeof o === "string" ? o : Buffer.from(o).toString("utf8")))
    .sort();

describe("deploying in fragments", () => {
  const full = new Contract<VeilcorePrivateState>(
    veilcoreWitnesses,
  ).initialState(
    createConstructorContext(
      { geneticSecret: new Uint8Array(32) } as VeilcorePrivateState,
      COIN,
    ),
  ).currentContractState;

  it("knows every circuit that needs a key", () => {
    expect(PROVABLE_CIRCUITS.length).toBe(24);
    expect(names(full)).toEqual([...PROVABLE_CIRCUITS]);
  });

  it("deploys exactly the kept circuits, with the same state", () => {
    const keep = PROVABLE_CIRCUITS.slice(0, 5);
    const Deploying = veilcoreDeployingContract(keep);
    const c = new Deploying<VeilcorePrivateState>(veilcoreWitnesses);
    expect(Object.keys(c.provableCircuits).sort()).toEqual([...keep]);
    const pruned = c.initialState(
      createConstructorContext(
        { geneticSecret: new Uint8Array(32) } as VeilcorePrivateState,
        COIN,
      ),
    ).currentContractState;
    expect(names(pruned)).toEqual([...keep]);
    // Adding the other operations back gives the full deploy state, byte for byte.
    const rebuilt = ContractState.deserialize(pruned.serialize());
    for (const n of PROVABLE_CIRCUITS.slice(5))
      rebuilt.setOperation(n, full.operation(n)!);
    expect(Buffer.from(rebuilt.serialize()).toString("hex")).toBe(
      Buffer.from(full.serialize()).toString("hex"),
    );
  });

  it("refuses a circuit that does not exist", () => {
    expect(() => veilcoreDeployingContract(["noSuchCircuit"])).toThrow(
      "No circuit named",
    );
  });
});
