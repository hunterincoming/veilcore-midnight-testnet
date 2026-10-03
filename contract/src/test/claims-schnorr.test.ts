// The laboratory-signature check, attacked directly: a forged challenge split, an
// alternative split above the quotient bound, and a signature whose two sides agree in
// one coordinate only. Each of these survived mutation testing (3 Oct): removing the
// check it targets broke no earlier test.
// SPDX-License-Identifier: Apache-2.0

import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ecAdd, ecMul, ecMulGenerator } from "@midnight-ntwrk/compact-runtime";
import {
  RangeOp,
  ClaimKind,
} from "../managed/veilcore-claims/contract/index.js";
import { CC, ClaimsSimulator } from "./claims-simulator.js";
import {
  ABSENT,
  SLOTS,
  commitmentOf,
  digestValue,
  numberValue,
  openSlot,
  schemaIdOf,
  sealFields,
} from "../fields.js";
import {
  JUBJUB_ORDER as R,
  type AttestationSignature,
  type JubjubPoint,
  newAttesterKey,
} from "../attest.js";

const sha = (s: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(s).digest());
const P = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const TWO_248 = 1n << 248n;
const rnd = (): bigint => BigInt("0x" + randomBytes(64).toString("hex")) % R;
const neg = (pt: JubjubPoint): JubjubPoint => ecMul(pt, R - 1n);

const comparable = Array.from({ length: SLOTS }, (_, i) => i < 2);
const numeric = Array.from({ length: SLOTS }, (_, i) => i === 12);
const TERMS = {
  documentDigest: sha("schnorr test schema"),
  comparable,
  k: 1n,
  numeric,
};
const SCHEMA = schemaIdOf(TERMS);

const recordWith = (allele: string, germ: bigint, label: string) => {
  const values: Uint8Array[] = Array.from({ length: SLOTS }, () => ABSENT);
  values[0] = digestValue(allele);
  values[1] = digestValue("200/204");
  values[12] = numberValue(germ);
  const fs = sealFields(values, sha(`secret ${label}`), sha(`json ${label}`));
  return { fs, c: commitmentOf(SCHEMA, fs) };
};
const A = recordWith("180/184", 9650n, "A");
const lab = newAttesterKey();

const challenge = (Rp: JubjubPoint, record: Uint8Array): bigint =>
  CC.attestationChallenge(Rp.x, Rp.y, lab.key.x, lab.key.y, record);

const rangeClaim = (
  sim: ClaimsSimulator,
  signature: AttestationSignature,
  reduction?: (h: bigint) => [bigint, bigint],
): void =>
  sim.call(
    {
      opening: openSlot(A.fs, 12),
      number: 9650n,
      attester: lab.key,
      signature,
      reduction,
    },
    "proveAttestedRange",
    A.c,
    SCHEMA,
    12n,
    RangeOp.AT_LEAST,
    9500n,
  );

describe("laboratory signature check", () => {
  it("an honest signature verifies (the harness itself works)", () => {
    const k = rnd();
    const Rp = ecMulGenerator(k);
    const c = challenge(Rp, A.c) % TWO_248;
    const sim = new ClaimsSimulator({ terms: TERMS });
    rangeClaim(sim, { announcement: Rp, response: (k + c * lab.secret) % R });
    expect(sim.state.lastClaimAttesterX).toBe(lab.key.x);
  });

  it("refuses a challenge split that does not add up to the challenge (forgery without the key)", () => {
    // Without the key: choose s and c freely and solve for the announcement. Only the
    // reduction check stops c from being anything but the hash.
    const s = rnd();
    const c = rnd() % TWO_248;
    const Rp = ecAdd(ecMulGenerator(s), neg(ecMul(lab.key, c)));
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      rangeClaim(sim, { announcement: Rp, response: s }, () => [0n, c]),
    ).toThrow(/Invalid challenge reduction|quotient out of range/);
  });

  it("refuses an alternative split with a quotient of 116 or more", () => {
    // q' * 2^248 + c' equals the challenge modulo p when q' = q + 116 and c' = c - d,
    // d = 116 * 2^248 - p. The quotient bound is the only thing that refuses it.
    const d = 116n * TWO_248 - P;
    for (let tries = 0; tries < 2000; tries++) {
      const k = rnd();
      const Rp = ecMulGenerator(k);
      const h = challenge(Rp, A.c);
      const q = h / TWO_248;
      const c = h % TWO_248;
      if (q > 11n || c < d) continue; // q' must fit in 7 bits and c' must stay non-negative
      const q2 = q + 116n;
      const c2 = c - d;
      expect((q2 * TWO_248 + c2) % P).toBe(h % P);
      const sig = { announcement: Rp, response: (k + c2 * lab.secret) % R };
      const sim = new ClaimsSimulator({ terms: TERMS });
      expect(() => rangeClaim(sim, sig, () => [q2, c2])).toThrow(
        /quotient out of range/,
      );
      return;
    }
    throw new Error("no suitable challenge found in 2000 tries");
  });

  it("refuses a signature whose two sides agree in y but not x", () => {
    // s = -(k + c * sk): s*G is the negation of R + c*pk, which on this curve has the
    // same y and the opposite x. Checking only one coordinate would accept it.
    const k = rnd();
    const Rp = ecMulGenerator(k);
    const c = challenge(Rp, A.c) % TWO_248;
    const s = (R - ((k + c * lab.secret) % R)) % R;
    const lhs = ecMulGenerator(s);
    const rhs = ecAdd(Rp, ecMul(lab.key, c));
    expect(lhs.y).toBe(rhs.y);
    expect(lhs.x).not.toBe(rhs.x);
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() => rangeClaim(sim, { announcement: Rp, response: s })).toThrow(
      /signature does not verify/,
    );
  });
});

describe("a distinctness threshold of exactly 1", () => {
  it("is allowed, and one differing comparable slot meets it", () => {
    const B = recordWith("182/184", 9650n, "B");
    const sim = new ClaimsSimulator({ terms: TERMS });
    sim.call({ first: A.fs, second: B.fs }, "proveDistinct", A.c, B.c);
    expect(sim.state.lastClaimKind).toBe(ClaimKind.DISTINCT);
  });
});
