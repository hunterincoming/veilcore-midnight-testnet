// The claims contract as midnight-js runs it (src/claims.ts): the witnesses read one
// call's input from private state, and the deploy can carry a subset of the keys.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContractState,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from "@midnight-ntwrk/compact-runtime";
import {
  CLAIMS_PROVABLE_CIRCUITS,
  ClaimKind,
  RangeOp,
  type ClaimInput,
  type ClaimsPrivateState,
  claimsDeployingContract,
  claimsLedger,
  claimsWitnesses,
  emptyClaimsPrivateState,
} from "../claims.js";
import { Contract } from "../managed/veilcore-claims/contract/index.js";
import { type FieldSetFile, sealFieldSetFile } from "../field-schema.js";
import { numberFrom, numberValue, openSlot } from "../fields.js";
import { newAttesterKey, signRecord } from "../attest.js";

const COIN = "0".repeat(64);
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const names = (s: ContractState): string[] =>
  s
    .operations()
    .map((o) => (typeof o === "string" ? o : Buffer.from(o).toString("utf8")))
    .sort();

const V = JSON.parse(
  readFileSync(
    new URL("../../vectors/fields-v1.json", import.meta.url),
    "utf8",
  ),
) as { fieldSets: { input: Omit<FieldSetFile, "jsonDigest"> }[] };
const FILE: FieldSetFile = {
  ...V.fieldSets[0].input,
  jsonDigest: "cd".repeat(32),
};
const sealed = sealFieldSetFile(FILE);

type Ctx = CircuitContext<ClaimsPrivateState>;
const fresh = (): Ctx => {
  const c = new Contract<ClaimsPrivateState>(claimsWitnesses);
  const init = c.initialState(
    createConstructorContext(emptyClaimsPrivateState(), COIN),
  );
  return createCircuitContext(
    sampleContractAddress(),
    COIN,
    init.currentContractState,
    emptyClaimsPrivateState(),
  );
};
const withInput = (ctx: Ctx, input: ClaimInput): Ctx => ({
  ...ctx,
  currentPrivateState: { input },
});
const impure = new Contract<ClaimsPrivateState>(claimsWitnesses).impureCircuits;

describe("the claims contract wrapper", () => {
  it("knows all seven circuits that need a key", () => {
    expect([...CLAIMS_PROVABLE_CIRCUITS]).toEqual(
      [
        "proveAttestedDistinct",
        "proveAttestedRange",
        "proveAttestedValue",
        "proveDistinct",
        "proveRange",
        "proveUnchanged",
        "proveValue",
      ].sort(),
    );
  });

  it("a range claim reads its input from private state and publishes the bound", () => {
    const ctx = withInput(fresh(), {
      opening: openSlot(sealed.fieldSet, 12),
      number: 9650n,
      terms: sealed.terms,
    });
    const r = impure.proveRange(
      ctx,
      sealed.commitment,
      sealed.schemaId,
      12n,
      RangeOp.AT_LEAST,
      9500n,
    );
    const l = claimsLedger(r.context.currentQueryContext.state);
    expect(l.lastClaimKind).toBe(ClaimKind.RANGE);
    expect(hex(l.lastClaimRecord)).toBe(hex(sealed.commitment));
    expect(hex(l.lastClaimSchema)).toBe(hex(sealed.schemaId));
    expect(numberFrom(l.lastClaimParam)).toBe(9500n);
    // The witnesses hand the private state back untouched.
    expect(r.context.currentPrivateState.input.number).toBe(9650n);
  });

  it("a claim missing part of its input is never built, and says what is missing", () => {
    const ctx = withInput(fresh(), { opening: openSlot(sealed.fieldSet, 12) });
    expect(() =>
      impure.proveRange(
        ctx,
        sealed.commitment,
        sealed.schemaId,
        12n,
        RangeOp.AT_LEAST,
        1n,
      ),
    ).toThrow(/needs the schema's terms/);
  });

  it("an out-of-bound range is refused by the circuit", () => {
    const ctx = withInput(fresh(), {
      opening: openSlot(sealed.fieldSet, 12),
      number: 9650n,
      terms: sealed.terms,
    });
    expect(() =>
      impure.proveRange(
        ctx,
        sealed.commitment,
        sealed.schemaId,
        12n,
        RangeOp.AT_LEAST,
        9651n,
      ),
    ).toThrow(/does not meet the bound/);
  });

  it("a laboratory-signed value claim publishes the laboratory's key", () => {
    const lab = newAttesterKey();
    const ctx = withInput(fresh(), {
      opening: openSlot(sealed.fieldSet, 13),
      attester: lab.key,
      signature: signRecord(lab.secret, sealed.commitment),
    });
    const r = impure.proveAttestedValue(
      ctx,
      sealed.commitment,
      sealed.schemaId,
      13n,
      numberValue(9980n),
    );
    const l = claimsLedger(r.context.currentQueryContext.state);
    expect(l.lastClaimKind).toBe(ClaimKind.VALUE);
    expect(l.lastClaimAttesterX).toBe(lab.key.x);
    expect(l.lastClaimAttesterY).toBe(lab.key.y);
  });

  it("deploys exactly the kept circuits, with the same state", () => {
    const full = new Contract<ClaimsPrivateState>(claimsWitnesses).initialState(
      createConstructorContext(emptyClaimsPrivateState(), COIN),
    ).currentContractState;
    expect(names(full)).toEqual([...CLAIMS_PROVABLE_CIRCUITS]);
    const keep = CLAIMS_PROVABLE_CIRCUITS.slice(0, 3);
    const Deploying = claimsDeployingContract(keep);
    const c = new Deploying<ClaimsPrivateState>(claimsWitnesses);
    expect(Object.keys(c.provableCircuits).sort()).toEqual([...keep]);
    const pruned = c.initialState(
      createConstructorContext(emptyClaimsPrivateState(), COIN),
    ).currentContractState;
    expect(names(pruned)).toEqual([...keep]);
    const rebuilt = ContractState.deserialize(pruned.serialize());
    for (const n of CLAIMS_PROVABLE_CIRCUITS.slice(3))
      rebuilt.setOperation(n, full.operation(n)!);
    expect(hex(rebuilt.serialize())).toBe(hex(full.serialize()));
  });

  it("refuses a circuit that does not exist", () => {
    expect(() => claimsDeployingContract(["anchor"])).toThrow(
      "No claims circuit named anchor",
    );
  });
});
