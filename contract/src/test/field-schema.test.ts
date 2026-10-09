// The operator tool's copy of the SDK's schema and typed-value rules (field-schema.ts),
// against the SDK's own conformance vectors: every field set, every rejection, and every
// canonicalisation case. If one byte differs, a field-set file sealed by the tool would
// name a schema id or commitment the SDK does not recognise.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type FieldSchema,
  type TypedSlotValue,
  canonicalise,
  committedJsonDigest,
  fieldSchemaId,
  fieldSetSummary,
  sealFieldSetFile,
  schemaTermsOf,
  slotValueOf,
} from "../field-schema.js";
import { commitmentOf, numberFrom, openSlot, recordOf } from "../fields.js";
import { CC } from "./claims-simulator.js";

type Input = {
  schema: FieldSchema;
  values: TypedSlotValue[];
  fieldSecret: string;
};
type Vectors = {
  fieldSets: {
    name: string;
    input: Input;
    expected: Record<string, unknown>;
  }[];
  fieldRejections: { name: string; input: Input; reason: string }[];
  canonicalisation: {
    name: string;
    input?: unknown;
    inputText?: string;
    expected: string;
  }[];
};

const raw = readFileSync(
  new URL("../../vectors/fields-v1.json", import.meta.url),
  "utf8",
);
const V = JSON.parse(raw) as Vectors;
const hex = (u: Uint8Array): string => Buffer.from(u).toString("hex");

describe("field-schema.ts against the SDK vectors", () => {
  it("has every kind of vector", () => {
    expect(V.fieldSets.length).toBeGreaterThanOrEqual(4);
    expect(V.fieldRejections.length).toBeGreaterThanOrEqual(21);
    expect(V.canonicalisation.length).toBeGreaterThanOrEqual(19);
  });

  for (const v of V.fieldSets) {
    it(`seals: ${v.name}`, () => {
      const got = fieldSetSummary(v.input);
      for (const k of [
        "schemaDocumentDigest",
        "schemaId",
        "slotValues",
        "salts",
        "setRoot",
      ])
        expect(got[k as keyof typeof got], k).toEqual(v.expected[k]);
    });
  }

  for (const v of V.fieldRejections) {
    it(`refuses: ${v.name}`, () => {
      expect(() =>
        sealFieldSetFile({ ...v.input, jsonDigest: "00".repeat(32) }),
      ).toThrow();
    });
  }

  for (const c of V.canonicalisation) {
    it(`canonicalises: ${c.name}`, () => {
      const value: unknown =
        c.inputText !== undefined ? JSON.parse(c.inputText) : c.input;
      expect(canonicalise(value)).toBe(c.expected);
    });
  }
});

describe("a sealed field-set file is what the claims contract recomputes", () => {
  const input = V.fieldSets[0].input;
  const sealed = sealFieldSetFile({ ...input, jsonDigest: "ab".repeat(32) });

  it("the schema id is the contract's", () => {
    const t = schemaTermsOf(input.schema);
    expect(hex(fieldSchemaId(input.schema))).toBe(
      hex(CC.schemaId(t.documentDigest, CC.termsBytes(t))),
    );
  });

  it("the commitment is H(frecord, setRoot, jsonDigest)", () => {
    expect(hex(sealed.commitment)).toBe(
      hex(commitmentOf(sealed.schemaId, sealed.fieldSet)),
    );
    expect(hex(sealed.commitment)).toBe(
      hex(CC.fieldRecord(sealed.setRoot, sealed.fieldSet.jsonDigest)),
    );
    expect(hex(recordOf(sealed.setRoot, sealed.fieldSet.jsonDigest))).toBe(
      hex(sealed.commitment),
    );
  });

  it("a uint slot opens to its number, as the contract encodes it", () => {
    const o = openSlot(sealed.fieldSet, 12);
    expect(numberFrom(o.value)).toBe(9650n);
    expect(hex(o.value)).toBe(hex(CC.numberBytes(9650n)));
  });

  it("refuses a jsonDigest or fieldSecret that is not 64 lowercase hex", () => {
    expect(() =>
      sealFieldSetFile({ ...input, jsonDigest: "AB".repeat(32) }),
    ).toThrow(/jsonDigest/);
    expect(() =>
      sealFieldSetFile({
        ...input,
        jsonDigest: "ab",
        fieldSecret: input.fieldSecret,
      }),
    ).toThrow(/jsonDigest/);
  });

  it("refuses a malformed uint wherever it sits (the vectors stop at the slot type)", () => {
    for (const bad of ["18446744073709551616", "07", "-1", "1.0", " 1", ""])
      expect(() => slotValueOf({ uint: bad }), bad).toThrow();
    expect(() => slotValueOf({ uint: "1", text: "x" })).toThrow(/exactly one/);
    expect(numberFrom(slotValueOf({ uint: "18446744073709551615" }))).toBe(
      2n ** 64n - 1n,
    );
  });

  // 8 October 2026 review (pocs/client/kit-vs-sdk-canonical.mjs): this copy hashed a
  // sparse array and a Uint8Array that veilcore-records 0.15 refuses.
  it("refuses what the SDK refuses: an array hole, binary data, a value that contains itself", () => {
    const sparse: number[] = [1];
    sparse[2] = 3;
    expect(() => canonicalise({ x: sparse })).toThrow(/missing element/);
    expect(() => canonicalise([, 1])).toThrow(/missing element/); // eslint-disable-line no-sparse-arrays
    expect(() => canonicalise({ x: new Uint8Array([1, 2]) })).toThrow(
      /binary data/,
    );
    expect(() => canonicalise(new Uint8Array(0).buffer)).toThrow(/binary data/);
    expect(() => canonicalise({ x: new DataView(new ArrayBuffer(2)) })).toThrow(
      /binary data/,
    );
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(() => canonicalise(loop)).toThrow(/contains itself/);
    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => canonicalise(arr)).toThrow(/contains itself/);
    // Plain values, and the same object twice side by side, are unchanged.
    expect(canonicalise({ x: [1, 2, 3] })).toBe('{"x":[1,2,3]}');
    expect(canonicalise({ x: { 0: 1, 1: 2 } })).toBe('{"x":{"0":1,"1":2}}');
    const shared = { k: 1 };
    expect(canonicalise([shared, shared])).toBe('[{"k":1},{"k":1}]');
  });

  it("committedJsonDigest refuses the same inputs as the SDK's computeCommitment", () => {
    const base = {
      formatVersion: "1.0",
      recordId: "r",
      subjectType: "plant",
      profile: "p",
      sealedAt: "2026-10-08T00:00:00Z",
      holder: "h",
      commitmentAlgorithm: "sha256/fields/v1",
      fieldSetRoot: "a".repeat(64),
      fieldSchema: "b".repeat(64),
    };
    const sparse: number[] = [1];
    sparse[2] = 3;
    expect(() =>
      committedJsonDigest({ ...base, profileData: { x: sparse } }),
    ).toThrow(/missing element/);
    expect(() =>
      committedJsonDigest({
        ...base,
        profileData: { x: new Uint8Array([1, 2]) },
      }),
    ).toThrow(/binary data/);
    expect(
      committedJsonDigest({ ...base, profileData: { x: [1, 2, 3] } }),
    ).toHaveLength(32);
  });

  it("refuses null in a schema document (it cannot be canonicalised)", () => {
    expect(() => fieldSchemaId({ ...input.schema, note: null })).toThrow(
      /null/,
    );
  });
});
