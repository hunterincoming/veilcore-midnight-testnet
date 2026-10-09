// ledgerIdentity is a committed field (SPEC 4.2, 3.6). The reference verifier's record
// commitment must equal the SDK's computeCommitment for records with and without it, and
// refuse a malformed one with the SDK's own message. Checked against vectors the SDK
// produced (vectors/ledger-identity-sdk.json) and, where a built SDK is next to this
// checkout (../sdk-fix/dist), against the SDK itself.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldRecordCommitment } from "../field-schema.js";

type Vec = {
  name: string;
  record: Record<string, unknown>;
  commitment?: string;
  refused?: string;
};
const V = JSON.parse(
  readFileSync(
    new URL("../../vectors/ledger-identity-sdk.json", import.meta.url),
    "utf8",
  ),
) as { records: Vec[] };

const ours = (r: Record<string, unknown>): { c?: string; err?: string } => {
  try {
    return { c: fieldRecordCommitment(r) };
  } catch (e) {
    return { err: (e as Error).message };
  }
};

describe("ledgerIdentity: the SDK's vectors", () => {
  it("cover records with and without it, and every refusal", () => {
    expect(V.records.filter((v) => v.commitment).length).toBeGreaterThanOrEqual(
      4,
    );
    expect(V.records.filter((v) => v.refused).length).toBeGreaterThanOrEqual(
      10,
    );
  });
  for (const v of V.records)
    it(v.name, () => {
      const r = ours(v.record);
      if (v.commitment !== undefined) expect(r).toEqual({ c: v.commitment });
      else expect(r).toEqual({ err: v.refused });
    });
  it("a ledger identity changes the commitment", () => {
    const cs = V.records.flatMap((v) => (v.commitment ? [v.commitment] : []));
    expect(new Set(cs).size).toBe(cs.length);
  });
});

const SDK = new URL("../../../../sdk-fix/dist/commit.js", import.meta.url);

describe.skipIf(!existsSync(SDK))(
  "ledgerIdentity: the SDK itself (when built next to this checkout)",
  () => {
    it("computeCommitment agrees on every vector record, and on random identities", async () => {
      const { computeCommitment } = (await import(SDK.href)) as {
        computeCommitment: (env: Record<string, unknown>) => Promise<string>;
      };
      const sdk = async (r: Record<string, unknown>) => {
        try {
          return { c: await computeCommitment(r) };
        } catch (e) {
          return { err: (e as Error).message };
        }
      };
      for (const v of V.records)
        expect(ours(v.record)).toEqual(await sdk(v.record));
      const base = V.records[0].record;
      const hex = () =>
        Array.from({ length: 32 }, () =>
          Math.floor(Math.random() * 256)
            .toString(16)
            .padStart(2, "0"),
        ).join("");
      for (let i = 0; i < 50; i++) {
        const li: Record<string, unknown> = {
          chain: `midnight:${i}`,
          identity: hex(),
        };
        if (i % 2) li.contractAddress = hex();
        if (i % 7 === 0) li.identity = (li.identity as string).toUpperCase();
        if (i % 11 === 0) li.extra = 1;
        const r = { ...base, ledgerIdentity: li };
        expect(ours(r)).toEqual(await sdk(r));
      }
    });
  },
);
