// The claims verifier (verify-claims.ts): SPEC 4.5's nine checks, made on claims the
// compiled contract really published, with the published schema and record JSON.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from "@midnight-ntwrk/compact-runtime";
import {
  type ClaimInput,
  type ClaimsLedger,
  type ClaimsPrivateState,
  RangeOp,
  claimsLedger,
  claimsWitnesses,
  emptyClaimsPrivateState,
} from "../claims.js";
import { Contract } from "../managed/veilcore-claims/contract/index.js";
import {
  type FieldSchema,
  type TypedSlotValue,
  committedJsonDigest,
  fieldRecordCommitment,
  fieldSchemaId,
  sealFieldSetFile,
  typedSlotValues,
} from "../field-schema.js";
import {
  maskValue,
  numberValue,
  openSlot,
  sealFields,
  setRootOf,
  leavesOf,
} from "../fields.js";
import { newAttesterKey, signRecord } from "../attest.js";
import { type Claim, claimFromCells, verifyClaim } from "../verify-claims.js";

const COIN = "0".repeat(64);
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

type Vectors = {
  fieldSets: {
    input: {
      schema: FieldSchema;
      values: TypedSlotValue[];
      fieldSecret: string;
    };
  }[];
  commitments: {
    name: string;
    record: Record<string, unknown>;
    expectedCommitment: string;
  }[];
  commitmentRejections: { name: string; record: Record<string, unknown> }[];
};
const V = JSON.parse(
  readFileSync(
    new URL("../../vectors/fields-v1.json", import.meta.url),
    "utf8",
  ),
) as Vectors;
const SCHEMA = V.fieldSets[0].input.schema;
const VALUES = V.fieldSets[0].input.values;
const SCHEMA_ID = hex(fieldSchemaId(SCHEMA));

/** A sealed sha256/fields/v1 record: its JSON, and the field-set file the holder keeps. */
const sealRecord = (
  values: TypedSlotValue[],
  fieldSecret: string,
  extra: Record<string, unknown> = {},
) => {
  const schemaId = fieldSchemaId(SCHEMA);
  const setRoot = setRootOf(
    schemaId,
    leavesOf(
      sealFields(
        typedSlotValues(SCHEMA, values),
        Buffer.from(fieldSecret, "hex"),
        new Uint8Array(32),
      ),
    ),
  );
  const env: Record<string, unknown> = {
    formatVersion: "0.1",
    recordId: `vc_rec_${fieldSecret.slice(0, 8)}`,
    subjectType: "plant-genetic-material",
    profile: "veilcore/profile/cannabis/v0.1",
    commitmentAlgorithm: "sha256/fields/v1",
    sealedAt: "2026-10-03T00:00:00Z",
    holder: { id: "vc_hld_test" },
    profileData: { cultivarName: "Harbour Mist", nonce: fieldSecret },
    fieldSchema: hex(schemaId),
    fieldSetRoot: hex(setRoot),
    ...extra,
  };
  const sealed = sealFieldSetFile({
    schema: SCHEMA,
    values,
    fieldSecret,
    jsonDigest: hex(committedJsonDigest(env)),
  });
  return { env, sealed };
};

const A = sealRecord(VALUES, "11".repeat(32));
const altered = [...VALUES];
altered[0] = { text: "230/233" };
altered[1] = { text: "180/188" };
altered[2] = { text: "199/201" };
const B = sealRecord(altered, "22".repeat(32));

type Ctx = CircuitContext<ClaimsPrivateState>;
const impure = new Contract<ClaimsPrivateState>(claimsWitnesses).impureCircuits;
const ctx = (input: ClaimInput): Ctx => {
  const init = new Contract<ClaimsPrivateState>(claimsWitnesses).initialState(
    createConstructorContext(emptyClaimsPrivateState(), COIN),
  );
  return createCircuitContext(
    sampleContractAddress(),
    COIN,
    init.currentContractState,
    { input },
  );
};
const cells = (r: { context: Ctx }): ClaimsLedger =>
  claimsLedger(r.context.currentQueryContext.state);

const rangeCells = (bound: bigint, op = RangeOp.AT_LEAST) =>
  cells(
    impure.proveRange(
      ctx({
        opening: openSlot(A.sealed.fieldSet, 12),
        number: 9650n,
        terms: A.sealed.terms,
      }),
      A.sealed.commitment,
      A.sealed.schemaId,
      12n,
      op,
      bound,
    ),
  );

describe("record JSON against the SDK's commitment vectors", () => {
  for (const c of V.commitments)
    it(c.name, () =>
      expect(fieldRecordCommitment(c.record)).toBe(c.expectedCommitment),
    );
  for (const c of V.commitmentRejections)
    it(`refuses: ${c.name}`, () =>
      expect(() => fieldRecordCommitment(c.record)).toThrow());
});

describe("verifyClaim", () => {
  it("a range claim with its schema and record: every mechanical check passes", () => {
    const v = verifyClaim({
      claim: rangeCells(9500n),
      schema: SCHEMA,
      records: [A.env],
      earlierClaims: [],
    });
    expect(v.passed).toBe(true);
    expect(v.checks.map((c) => c.spec)).toEqual(expect.arrayContaining([3, 4]));
    expect(v.statement).toContain("is at least 95.00 percent");
    expect(v.statement).toContain("fields.germinationPercent");
    expect(v.statement).toContain("not published");
    // What cannot be checked here is said, every time.
    expect(v.toCheck.join("\n")).toMatch(/to check: the record is anchored/);
    expect(v.toCheck.join("\n")).toMatch(
      /to check: whether the record is current/,
    );
    expect(v.toCheck.join("\n")).toMatch(
      /no laboratory signature was considered/,
    );
    expect(v.toCheck.join("\n")).toMatch(/published claims contract/);
  });

  it("refuses a schema document that is not the one the claim names", () => {
    const v = verifyClaim({
      claim: rangeCells(9500n),
      schema: { ...SCHEMA, title: SCHEMA.title + " (edited)" },
    });
    expect(v.passed).toBe(false);
    expect(v.checks.find((c) => !c.ok)?.detail).toMatch(
      /not the schema the claim is about/,
    );
  });

  it("without a schema, says to obtain it rather than passing silently", () => {
    const v = verifyClaim({ claim: rangeCells(9500n) });
    expect(v.toCheck.join("\n")).toMatch(/to check: obtain schema/);
    expect(v.statement).toContain("is at least 9500");
  });

  it("refuses a range claim on a slot the schema does not call a number", () => {
    const c: Claim = { ...claimFromCells(rangeCells(9500n)), slot: 14 };
    const v = verifyClaim({ claim: c, schema: SCHEMA });
    expect(v.passed).toBe(false);
    expect(v.checks.find((x) => !x.ok)?.detail).toMatch(/not a number slot/);
  });

  it("refuses record JSON that does not recompute to the record the claim names", () => {
    const v = verifyClaim({
      claim: rangeCells(9500n),
      schema: SCHEMA,
      records: [{ ...A.env, holder: { id: "someone-else" } }],
    });
    expect(v.passed).toBe(false);
    expect(v.checks.find((x) => !x.ok)?.detail).toMatch(/does not name/);
  });

  it("refuses record JSON under another algorithm", () => {
    const v = verifyClaim({
      claim: rangeCells(9500n),
      records: [{ ...A.env, commitmentAlgorithm: "sha256/canonical-json/v1" }],
    });
    expect(v.checks.find((x) => !x.ok)?.detail).toMatch(
      /not sha256\/fields\/v1/,
    );
  });

  it("a value claim on text: matches the value shown, and refuses another", () => {
    const l = cells(
      impure.proveValue(
        ctx({ opening: openSlot(A.sealed.fieldSet, 14) }),
        A.sealed.commitment,
        A.sealed.schemaId,
        14n,
        A.sealed.fieldSet.values[14],
      ),
    );
    const good = verifyClaim({
      claim: l,
      schema: SCHEMA,
      shownValue: { text: "Harbour Mist" },
    });
    expect(good.passed).toBe(true);
    expect(good.statement).toContain("holds the text whose SHA-256 is");
    const bad = verifyClaim({
      claim: l,
      schema: SCHEMA,
      shownValue: { text: "Harbor Mist" },
    });
    expect(bad.passed).toBe(false);
    expect(bad.checks.find((x) => !x.ok)?.detail).toMatch(/NOT the sealed one/);
    expect(
      verifyClaim({ claim: l, schema: SCHEMA }).toCheck.join("\n"),
    ).toMatch(/compare it with the text you were shown/);
  });

  it("a laboratory-signed claim: an attested claim on the record, checked against the verifier's list", () => {
    const lab = newAttesterKey();
    const l = cells(
      impure.proveValue(
        ctx({ opening: openSlot(A.sealed.fieldSet, 13) }),
        A.sealed.commitment,
        A.sealed.schemaId,
        13n,
        numberValue(9980n),
      ),
    );
    const att = claimFromCells(
      cells(
        impure.proveAttested(
          ctx({
            attester: lab.key,
            signature: signRecord(lab.secret, A.sealed.commitment),
          }),
          A.sealed.commitment,
        ),
      ),
    );
    expect(att.kind).toBe("attested");
    expect(att.attester).toEqual(lab.key);
    // The attested claim on its own.
    const own = verifyClaim({ claim: att, trustedAttesters: [lab.key] });
    expect(own.passed).toBe(true);
    expect(own.statement).toContain("signed record");
    // The value claim, read with it.
    const trusted = verifyClaim({
      claim: l,
      schema: SCHEMA,
      attestations: [att],
      trustedAttesters: [lab.key],
    });
    expect(trusted.passed).toBe(true);
    expect(trusted.statement).toContain(
      "holds 99.80 percent, on values a laboratory signed",
    );
    expect(trusted.toCheck.join("\n")).toMatch(
      /valid at the time of its attested claim/,
    );
    // An untrusted key: refused, and the statement does not say "laboratory signed".
    const other = verifyClaim({
      claim: l,
      schema: SCHEMA,
      attestations: [att],
      trustedAttesters: [newAttesterKey().key],
    });
    expect(other.passed).toBe(false);
    expect(other.statement).not.toContain("laboratory signed");
    expect(
      verifyClaim({ claim: l, attestations: [att] }).toCheck.join("\n"),
    ).toMatch(/belongs to a laboratory you trust/);
    // An attestation on another record does not count, and is called out.
    const elsewhere = { ...att, record: B.sealed.commitment };
    const wrong = verifyClaim({
      claim: l,
      schema: SCHEMA,
      attestations: [elsewhere],
      trustedAttesters: [lab.key],
    });
    expect(wrong.passed).toBe(false);
    expect(
      wrong.checks
        .filter((c) => !c.ok)
        .map((c) => c.detail)
        .join("\n"),
    ).toMatch(/does not name|has no laboratory/);
    expect(wrong.statement).not.toContain("laboratory signed");
    // A non-attested claim passed as an attestation is refused.
    const notOne = verifyClaim({
      claim: l,
      schema: SCHEMA,
      attestations: [claimFromCells(l)],
    });
    expect(notOne.passed).toBe(false);
  });

  it("a distinctness claim is laboratory-signed only when both records are", () => {
    const lab = newAttesterKey();
    const d = cells(
      impure.proveDistinct(
        ctx({
          first: A.sealed.fieldSet,
          second: B.sealed.fieldSet,
          terms: A.sealed.terms,
        }),
        A.sealed.commitment,
        B.sealed.commitment,
      ),
    );
    const attest = (c: Uint8Array) =>
      claimFromCells(
        cells(
          impure.proveAttested(
            ctx({ attester: lab.key, signature: signRecord(lab.secret, c) }),
            c,
          ),
        ),
      );
    const one = verifyClaim({
      claim: d,
      schema: SCHEMA,
      attestations: [attest(A.sealed.commitment)],
      trustedAttesters: [lab.key],
    });
    expect(one.passed).toBe(false);
    expect(one.statement).not.toContain("laboratory signed");
    const both = verifyClaim({
      claim: d,
      schema: SCHEMA,
      attestations: [attest(A.sealed.commitment), attest(B.sealed.commitment)],
      trustedAttesters: [lab.key],
    });
    expect(both.passed).toBe(true);
    expect(both.statement).toContain("on values a laboratory signed");
  });

  it("distinct: states k as a count, never a verdict, and asks who chose the reference", () => {
    const l = cells(
      impure.proveDistinct(
        ctx({
          first: A.sealed.fieldSet,
          second: B.sealed.fieldSet,
          terms: A.sealed.terms,
        }),
        A.sealed.commitment,
        B.sealed.commitment,
      ),
    );
    const v = verifyClaim({
      claim: l,
      schema: SCHEMA,
      records: [A.env, B.env],
    });
    expect(v.passed).toBe(true);
    expect(v.statement).toContain("differ in at least 3 comparable values");
    expect(v.statement).toContain("not a determination of distinctness");
    expect(v.toCheck.join("\n")).toMatch(
      /identified by someone other than the prover/,
    );
    expect(v.toCheck.join("\n")).toMatch(/predates the purpose/);
  });

  it("unchanged: checks the mask and that the correction names the original", () => {
    const corrected = [...VALUES];
    corrected[15] = { uint: "4100" };
    const C = sealRecord(corrected, "33".repeat(32), {
      supersedes: {
        recordId: A.env.recordId,
        reason: "yield re-measured",
        descentSeverity: "cosmetic",
        termsSeverity: "cosmetic",
        effectiveAt: "2026-10-03T00:00:00Z",
        correctedBy: "holder",
      },
    });
    const mask = Array.from({ length: 16 }, (_, i) => i === 15);
    const l = cells(
      impure.proveUnchanged(
        ctx({ first: A.sealed.fieldSet, second: C.sealed.fieldSet }),
        A.sealed.commitment,
        C.sealed.commitment,
        A.sealed.schemaId,
        mask,
      ),
    );
    expect(hex(l.lastClaimParam)).toBe(hex(maskValue(mask)));
    const v = verifyClaim({
      claim: l,
      schema: SCHEMA,
      records: [A.env, C.env],
    });
    expect(v.passed).toBe(true);
    expect(
      v.checks.some((c) => /names the original in supersedes/.test(c.detail)),
    ).toBe(true);
    // Swapped: the "correction" does not name the other.
    const D = sealRecord(corrected, "44".repeat(32));
    const wrong = verifyClaim({
      claim: { ...claimFromCells(l), other: D.sealed.commitment },
      schema: SCHEMA,
      records: [A.env, D.env],
    });
    expect(wrong.passed).toBe(false);
    const all = verifyClaim({
      claim: {
        ...claimFromCells(l),
        mayChange: Array.from({ length: 16 }, () => true),
      },
    });
    expect(all.checks.find((c) => !c.ok)?.detail).toMatch(/says nothing/);
  });

  // 8 October 2026 review: a mask over every slot the schema describes (but not all 16)
  // passed check 8, and supersedes was matched by recordId alone.
  it("unchanged: a mask over every DESCRIBED slot says nothing, and is refused", () => {
    const SMALL = {
      ...SCHEMA,
      id: "test/small",
      slots: SCHEMA.slots.slice(0, 4),
    };
    const unchanged = (mayChange: boolean[]) => ({
      kind: "unchanged" as const,
      record: A.sealed.commitment,
      other: B.sealed.commitment,
      schema: fieldSchemaId(SMALL),
      mayChange,
    });
    const describedFree = Array.from({ length: 16 }, (_, i) => i < 4);
    const v = verifyClaim({ claim: unchanged(describedFree), schema: SMALL });
    const c8 = v.checks.filter((c) => c.spec === 8);
    expect(
      c8.some((c) => !c.ok && /every slot the schema describes/.test(c.detail)),
    ).toBe(true);
    expect(v.passed).toBe(false);
    // One described slot held: the claim says something.
    const oneHeld = describedFree.map((b, i) => (i === 3 ? false : b));
    const w = verifyClaim({ claim: unchanged(oneHeld), schema: SMALL });
    expect(w.checks.filter((c) => c.spec === 8).every((c) => c.ok)).toBe(true);
    // Without the schema it cannot be judged: it is left to the verifier, never passed silently.
    const x = verifyClaim({ claim: unchanged(describedFree) });
    expect(x.toCheck.join("\n")).toMatch(
      /leaves at least one slot the schema describes/,
    );
  });

  it("unchanged: supersedes must name the original by commitment, or by recordId with the same or a declared new holder", () => {
    const corrected = [...VALUES];
    corrected[15] = { uint: "4100" };
    const sup = {
      recordId: A.env.recordId,
      reason: "yield re-measured",
      descentSeverity: "cosmetic",
      termsSeverity: "cosmetic",
      effectiveAt: "2026-10-03T00:00:00Z",
      correctedBy: "holder",
    };
    const mask = Array.from({ length: 16 }, (_, i) => i === 15);
    const judge = (C: ReturnType<typeof sealRecord>) =>
      verifyClaim({
        claim: {
          kind: "unchanged",
          record: A.sealed.commitment,
          other: C.sealed.commitment,
          schema: A.sealed.schemaId,
          mayChange: mask,
        },
        schema: SCHEMA,
        records: [A.env, C.env],
      }).checks.filter((c) => c.spec === 8);
    // Another holder's record that happens to use the same recordId.
    const other = sealRecord(corrected, "55".repeat(32), {
      holder: { id: "someone-else" },
      supersedes: sup,
    });
    expect(judge(other).find((c) => !c.ok)?.detail).toMatch(
      /different holder, and its supersedes block does not list holder/,
    );
    // Verification review: the holder is a field a correction may change (the SDK's
    // corrections.ts classifies it). Declared in changedFields, as supersedesFor writes
    // it (flattened: holder.id), the holder change is accepted.
    for (const declared of [
      ["holder.id"],
      ["holder"],
      ["profileData.notes", "holder.id"],
    ]) {
      const reheld = sealRecord(corrected, "58".repeat(32), {
        holder: { id: "new-holder-after-sale" },
        supersedes: { ...sup, changedFields: declared },
      });
      expect(
        judge(reheld).every((c) => c.ok),
        declared.join(),
      ).toBe(true);
    }
    const undeclared = sealRecord(corrected, "59".repeat(32), {
      holder: { id: "new-holder-after-sale" },
      supersedes: {
        ...sup,
        changedFields: ["profileData.notes", "holderName"],
      },
    });
    expect(judge(undeclared).some((c) => !c.ok)).toBe(true);
    // Named by commitment: matched exactly, whatever the recordId.
    const byCommitment = sealRecord(corrected, "66".repeat(32), {
      supersedes: {
        ...sup,
        recordId: "anything",
        commitment: hex(A.sealed.commitment),
      },
    });
    expect(judge(byCommitment).every((c) => c.ok)).toBe(true);
    const wrongCommitment = sealRecord(corrected, "77".repeat(32), {
      supersedes: { ...sup, commitment: hex(B.sealed.commitment) },
    });
    expect(judge(wrongCommitment).find((c) => !c.ok)?.detail).toMatch(
      /its commitment is another record's/,
    );
  });

  it("disclosure accounting: two bounds narrow the number", () => {
    const first = claimFromCells(rangeCells(9000n));
    const v = verifyClaim({
      claim: rangeCells(9700n, RangeOp.AT_MOST),
      schema: SCHEMA,
      earlierClaims: [first],
    });
    expect(v.toCheck.join("\n")).toContain(
      "the number is between 90.00 percent and 97.00 percent",
    );
  });

  it("cells with no claim are refused, not read as a claim", () => {
    const init = new Contract<ClaimsPrivateState>(claimsWitnesses).initialState(
      createConstructorContext(emptyClaimsPrivateState(), COIN),
    );
    expect(() =>
      claimFromCells(claimsLedger(init.currentContractState.data)),
    ).toThrow(/no claim/);
  });

  it("the test records are the ones the schema id names", () => {
    expect(A.env.fieldSchema).toBe(SCHEMA_ID);
    expect(fieldRecordCommitment(A.env)).toBe(hex(A.sealed.commitment));
  });
});
