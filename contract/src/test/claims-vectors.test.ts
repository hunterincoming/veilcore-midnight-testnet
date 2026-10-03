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
  setRoot: string;
  openings: { slot: number; siblings: string[]; bits: boolean[] }[];
};
type Vector = {
  name: string;
  input: {
    schema: { slots: { slot: number; comparable?: boolean }[]; k: number };
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
      const mask = Array.from({ length: 16 }, (_, i) =>
        v.input.schema.slots.some((s) => s.slot === i && s.comparable === true),
      );
      expect(
        hex(
          CC.schemaId(
            b(e.schemaDocumentDigest),
            CC.maskBytes(mask),
            CC.countBytes(BigInt(v.input.schema.k)),
          ),
        ),
      ).toBe(e.schemaId);

      v.input.values.forEach((val, i) => {
        if (val !== null && "uint" in val)
          expect(hex(CC.numberBytes(BigInt(val.uint)))).toBe(e.slotValues[i]);
        if (val === null) expect(e.slotValues[i]).toBe("00".repeat(32));
        expect(hex(saltOf(b(v.input.fieldSecret), i))).toBe(e.salts[i]);
      });

      let level = e.slotValues.map((s, i) => CC.fieldLeaf(b(s), b(e.salts[i])));
      const layers = [level];
      while (level.length > 1) {
        const next: Uint8Array[] = [];
        for (let i = 0; i < level.length; i += 2)
          next.push(CC.fieldNode(level[i], level[i + 1]));
        level = next;
        layers.push(next);
      }
      expect(hex(CC.fieldSetRoot(b(e.schemaId), level[0]))).toBe(e.setRoot);

      for (const o of e.openings) {
        let idx = o.slot;
        for (let l = 0; l < 4; l++) {
          expect(o.bits[l]).toBe((idx & 1) === 1);
          expect(o.siblings[l]).toBe(hex(layers[l][idx ^ 1]));
          idx >>= 1;
        }
      }
    });
  }
});
