// The SDK's field-set vectors (veilcore-sdk conformance, copied to vectors/fields-v1.json)
// recomputed with the compiled claims contract's own circuits. If the SDK and the contract
// ever disagree about one byte, a record sealed by the SDK cannot be proved on chain.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CC } from "./claims-simulator.js";
import { saltOf } from "../fields.js";

type Summary = {
  schemaDocumentDigest: string;
  schemaId: string;
  slotValues: string[];
  salts: string[];
  leaves: string[];
  setRoot: string;
};
type Vector = {
  name: string;
  input: {
    schema: {
      slots: { slot: number; type: string; comparable?: boolean }[];
      k: number;
    };
    values: ({ uint: string } | { text: string } | null)[];
    fieldSecret: string;
  };
  expected: Summary;
};

const vectors = (
  JSON.parse(
    readFileSync(
      new URL("../../vectors/fields-v1.json", import.meta.url),
      "utf8",
    ),
  ) as { fieldSets: Vector[] }
).fieldSets;
const b = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
const hex = (u: Uint8Array): string => Buffer.from(u).toString("hex");

describe("SDK field-set vectors, recomputed by the claims contract", () => {
  it("there are vectors to check", () =>
    expect(vectors.length).toBeGreaterThanOrEqual(4));

  for (const v of vectors) {
    it(v.name, () => {
      const e = v.expected;
      const numeric = Array.from({ length: 16 }, (_, i) =>
        v.input.schema.slots.some((s) => s.slot === i && s.type === "uint"),
      );
      const comparable = Array.from({ length: 16 }, (_, i) =>
        v.input.schema.slots.some((s) => s.slot === i && s.comparable === true),
      );
      const terms = {
        documentDigest: b(e.schemaDocumentDigest),
        comparable,
        k: BigInt(v.input.schema.k),
        numeric,
      };
      expect(hex(CC.schemaId(terms.documentDigest, CC.termsBytes(terms)))).toBe(
        e.schemaId,
      );

      v.input.values.forEach((val, i) => {
        if (val !== null && "uint" in val)
          expect(hex(CC.numberBytes(BigInt(val.uint)))).toBe(e.slotValues[i]);
        if (val === null) expect(e.slotValues[i]).toBe("00".repeat(32));
        expect(hex(saltOf(b(v.input.fieldSecret), i))).toBe(e.salts[i]);
        expect(hex(CC.fieldLeaf(b(e.slotValues[i]), b(e.salts[i])))).toBe(
          e.leaves[i],
        );
      });

      expect(hex(CC.fieldSetRoot(b(e.schemaId), e.leaves.map(b)))).toBe(
        e.setRoot,
      );
    });
  }
});
