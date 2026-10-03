// The claims contract: what each claim proves, what it refuses, what it publishes.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ClaimKind,
  RangeOp,
} from "../managed/veilcore-claims/contract/index.js";
import { CC, ClaimsSimulator } from "./claims-simulator.js";
import {
  ABSENT,
  SLOTS,
  type FieldSet,
  commitmentOf,
  countValue,
  digestValue,
  leafOf,
  maskValue,
  nodeOf,
  numberFrom,
  numberValue,
  openSlot,
  recordOf,
  schemaIdOf,
  sealFields,
  setRootOf,
  treeOf as treeOfSet,
} from "../fields.js";
import {
  JUBJUB_ORDER,
  attesterKeyOf,
  newAttesterKey,
  signRecord,
} from "../attest.js";

const sha = (s: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(s).digest());
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

// A marker schema: slots 0-11 are SSR loci (comparable), 12 germination % x100 and
// 13 yield kg/ha (numeric), 14 a variety name, 15 a numeric slot left empty.
// Distinct at 3 or more loci.
const comparable = Array.from({ length: SLOTS }, (_, i) => i < 12);
const numeric = Array.from(
  { length: SLOTS },
  (_, i) => i === 12 || i === 13 || i === 15,
);
const TERMS = {
  documentDigest: sha("plant-variety-markers/v1 schema document"),
  comparable,
  k: 3n,
  numeric,
};
const SCHEMA = schemaIdOf(TERMS);

const loci = (calls: string[]): Uint8Array[] =>
  calls.map((c) => (c === "" ? ABSENT : digestValue(c)));
const BASE = [
  "233/233",
  "180/184",
  "201/201",
  "155/159",
  "312/318",
  "140/140",
  "222/226",
  "199/199",
  "260/264",
  "175/175",
  "290/290",
  "133/137",
];

const record = (
  calls: string[],
  germ: bigint,
  label: string,
): { fs: FieldSet; c: Uint8Array } => {
  const values = [
    ...loci(calls),
    numberValue(germ),
    numberValue(6400n),
    digestValue(`name:${label}`),
    ABSENT,
  ];
  const fs = sealFields(
    values,
    sha(`field secret ${label}`),
    sha(`json ${label}`),
  );
  return { fs, c: commitmentOf(SCHEMA, fs) };
};

const A = record(BASE, 9650n, "A");
// B differs from A at loci 0, 4, 9 (three) and in germination.
const B = record(
  BASE.map((v, i) =>
    i === 0 ? "231/233" : i === 4 ? "310/318" : i === 9 ? "177/177" : v,
  ),
  9100n,
  "B",
);
// C differs from A at two loci only.
const C2 = record(
  BASE.map((v, i) => (i === 1 ? "182/184" : i === 2 ? "203/203" : v)),
  9650n,
  "C",
);

describe("off-chain field sets agree with the circuits", () => {
  it("every hash and encoding matches the compiled contract", () => {
    const v = digestValue("x");
    const s = sha("salt");
    expect(hex(CC.fieldLeaf(v, s))).toBe(hex(leafOf(v, s)));
    expect(hex(CC.fieldNode(v, s))).toBe(hex(nodeOf(v, s)));
    expect(hex(CC.fieldSetRoot(v, s))).toBe(hex(setRootOf(v, s)));
    expect(hex(CC.fieldRecord(v, s))).toBe(hex(recordOf(v, s)));
    for (const n of [0n, 1n, 258n, 9650n, (1n << 64n) - 1n])
      expect(hex(CC.numberBytes(n))).toBe(hex(numberValue(n)));
    expect(hex(CC.maskBytes(comparable))).toBe(hex(maskValue(comparable)));
    for (const n of [0n, 3n, 16n])
      expect(hex(CC.countBytes(n))).toBe(hex(countValue(n)));
    expect(
      hex(
        CC.schemaId(
          TERMS.documentDigest,
          maskValue(comparable),
          countValue(3n),
          maskValue(numeric),
        ),
      ),
    ).toBe(hex(SCHEMA));
  });

  it("numbers round-trip and non-numbers are refused", () => {
    expect(numberFrom(numberValue(9650n))).toBe(9650n);
    expect(() => numberFrom(digestValue("233/233"))).toThrow();
  });
});

describe("proveValue", () => {
  it("proves a slot holds a value and publishes exactly that", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    sim.call(
      { opening: openSlot(A.fs, 3) },
      "proveValue",
      A.c,
      SCHEMA,
      3n,
      digestValue("155/159"),
    );
    const s = sim.state;
    expect(s.lastClaimKind).toBe(ClaimKind.VALUE);
    expect(hex(s.lastClaimRecord)).toBe(hex(A.c));
    expect(hex(s.lastClaimSchema)).toBe(hex(SCHEMA));
    expect(s.lastClaimSlot).toBe(3n);
    expect(hex(s.lastClaimParam)).toBe(hex(digestValue("155/159")));
    expect(s.claimSeq).toBe(1n);
  });

  it("refuses a value the slot does not hold", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call(
        { opening: openSlot(A.fs, 3) },
        "proveValue",
        A.c,
        SCHEMA,
        3n,
        digestValue("155/161"),
      ),
    ).toThrow(/does not hold/);
  });

  it("refuses an opening of a different slot, even with the right value", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    // slot 5 holds 140/140; open slot 5 but claim it is slot 4
    expect(() =>
      sim.call(
        { opening: openSlot(A.fs, 5) },
        "proveValue",
        A.c,
        SCHEMA,
        4n,
        digestValue("140/140"),
      ),
    ).toThrow(/different slot/);
  });

  it("refuses an opening from another record", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call(
        { opening: openSlot(B.fs, 3) },
        "proveValue",
        A.c,
        SCHEMA,
        3n,
        digestValue("155/159"),
      ),
    ).toThrow(/does not belong/);
  });

  it("refuses the right record under another schema", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const other = schemaIdOf({ ...TERMS, k: 4n });
    expect(() =>
      sim.call(
        { opening: openSlot(A.fs, 3) },
        "proveValue",
        A.c,
        other,
        3n,
        digestValue("155/159"),
      ),
    ).toThrow(/does not belong/);
  });

  it("refuses slot 16 and above", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const o = { ...openSlot(A.fs, 0) };
    expect(() =>
      sim.call({ opening: o }, "proveValue", A.c, SCHEMA, 16n, o.value),
    ).toThrow(/16 slots/);
  });

  it("refuses a forged path that reorders siblings", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const o = openSlot(A.fs, 6);
    const forged = {
      ...o,
      siblings: [o.siblings[1], o.siblings[0], o.siblings[2], o.siblings[3]],
    };
    expect(() =>
      sim.call({ opening: forged }, "proveValue", A.c, SCHEMA, 6n, o.value),
    ).toThrow(/does not belong/);
  });
});

describe("proveRange", () => {
  it("proves at least and at most, including the boundary, without publishing the number", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const o = openSlot(A.fs, 12);
    sim.call(
      { opening: o, number: 9650n },
      "proveRange",
      A.c,
      SCHEMA,
      12n,
      RangeOp.AT_LEAST,
      9500n,
    );
    expect(sim.state.lastClaimKind).toBe(ClaimKind.RANGE);
    expect(sim.state.lastClaimOp).toBe(RangeOp.AT_LEAST);
    expect(numberFrom(sim.state.lastClaimParam)).toBe(9500n);
    sim.call(
      { opening: o, number: 9650n },
      "proveRange",
      A.c,
      SCHEMA,
      12n,
      RangeOp.AT_LEAST,
      9650n,
    );
    sim.call(
      { opening: o, number: 9650n },
      "proveRange",
      A.c,
      SCHEMA,
      12n,
      RangeOp.AT_MOST,
      9650n,
    );
    sim.call(
      { opening: o, number: 9650n },
      "proveRange",
      A.c,
      SCHEMA,
      12n,
      RangeOp.AT_MOST,
      10000n,
    );
    // Nothing public carries the sealed number.
    const s = sim.state;
    for (const v of [
      s.lastClaimParam,
      s.lastClaimRecord,
      s.lastClaimOther,
      s.lastClaimSchema,
    ])
      expect(hex(v)).not.toBe(hex(numberValue(9650n)));
  });

  it("refuses a bound the number does not meet", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const o = openSlot(B.fs, 12);
    expect(() =>
      sim.call(
        { opening: o, number: 9100n },
        "proveRange",
        B.c,
        SCHEMA,
        12n,
        RangeOp.AT_LEAST,
        9500n,
      ),
    ).toThrow(/does not meet/);
    expect(() =>
      sim.call(
        { opening: o, number: 9100n },
        "proveRange",
        B.c,
        SCHEMA,
        12n,
        RangeOp.AT_MOST,
        9099n,
      ),
    ).toThrow(/does not meet/);
  });

  it("refuses a number other than the sealed one", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const o = openSlot(B.fs, 12);
    expect(() =>
      sim.call(
        { opening: o, number: 9600n },
        "proveRange",
        B.c,
        SCHEMA,
        12n,
        RangeOp.AT_LEAST,
        9500n,
      ),
    ).toThrow(/does not hold that number/);
  });

  it("an absent slot never passes as the number 0 (a missing test result proves nothing)", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const o = openSlot(A.fs, 15); // slot 15 is absent
    for (const n of [0n, 1n])
      expect(() =>
        sim.call(
          { opening: o, number: n },
          "proveRange",
          A.c,
          SCHEMA,
          15n,
          RangeOp.AT_MOST,
          3000n,
        ),
      ).toThrow(/does not hold that number/);
    // A real 0 is a number and can be proved.
    const Z = record(BASE, 0n, "Z");
    sim.call(
      { opening: openSlot(Z.fs, 12), number: 0n },
      "proveRange",
      Z.c,
      SCHEMA,
      12n,
      RangeOp.AT_MOST,
      3000n,
    );
    expect(sim.state.lastClaimKind).toBe(ClaimKind.RANGE);
  });

  it("refuses a range claim on a text slot", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const o = openSlot(A.fs, 0);
    for (const n of [0n, 233n, 233233n])
      expect(() =>
        sim.call(
          { opening: o, number: n },
          "proveRange",
          A.c,
          SCHEMA,
          0n,
          RangeOp.AT_LEAST,
          0n,
        ),
      ).toThrow(/not a number slot/);
  });
});

describe("proveDistinct", () => {
  const terms = TERMS;

  it("proves two records differ in at least k comparable slots, and publishes neither which nor how many", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    sim.call({ first: A.fs, second: B.fs, terms }, "proveDistinct", A.c, B.c);
    const s = sim.state;
    expect(s.lastClaimKind).toBe(ClaimKind.DISTINCT);
    expect(hex(s.lastClaimRecord)).toBe(hex(A.c));
    expect(hex(s.lastClaimOther)).toBe(hex(B.c));
    expect(hex(s.lastClaimSchema)).toBe(hex(SCHEMA));
    expect(s.lastClaimSlot).toBe(0n);
    expect(hex(s.lastClaimParam)).toBe(hex(new Uint8Array(32)));
  });

  it("refuses records that differ in fewer than k", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call(
        { first: A.fs, second: C2.fs, terms },
        "proveDistinct",
        A.c,
        C2.c,
      ),
    ).toThrow(/enough comparable/);
  });

  it("does not count differences in non-comparable slots", () => {
    // D equals A at every locus but differs in germination, yield-unrelated name and more
    const D = record(BASE, 1n, "D");
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call({ first: A.fs, second: D.fs, terms }, "proveDistinct", A.c, D.c),
    ).toThrow(/enough comparable/);
  });

  it("does not count an absent value as a difference", () => {
    // E leaves loci 0, 4, 9 absent instead of differing there
    const E = record(
      BASE.map((v, i) => (i === 0 || i === 4 || i === 9 ? "" : v)),
      9650n,
      "E",
    );
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call({ first: A.fs, second: E.fs, terms }, "proveDistinct", A.c, E.c),
    ).toThrow(/enough comparable/);
    expect(() =>
      sim.call({ first: E.fs, second: A.fs, terms }, "proveDistinct", E.c, A.c),
    ).toThrow(/enough comparable/);
  });

  it("refuses a lower k or a wider comparable set than the records were sealed under", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call(
        { first: A.fs, second: C2.fs, terms: { ...terms, k: 2n } },
        "proveDistinct",
        A.c,
        C2.c,
      ),
    ).toThrow(/does not belong/);
    const allSlots = Array.from({ length: SLOTS }, () => true);
    const D = record(BASE, 1n, "D");
    expect(() =>
      sim.call(
        {
          first: A.fs,
          second: D.fs,
          terms: { ...terms, comparable: allSlots },
        },
        "proveDistinct",
        A.c,
        D.c,
      ),
    ).toThrow(/does not belong/);
  });

  it("refuses a schema with k = 0", () => {
    const zeroTerms = { ...terms, k: 0n };
    const z = schemaIdOf(zeroTerms);
    const fa = A.fs;
    const fz = C2.fs;
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call(
        { first: fa, second: fz, terms: zeroTerms },
        "proveDistinct",
        commitmentOf(z, fa),
        commitmentOf(z, fz),
      ),
    ).toThrow(/at least 1/);
  });

  it("refuses a record compared with itself, and swapped field sets", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call({ first: A.fs, second: A.fs, terms }, "proveDistinct", A.c, A.c),
    ).toThrow(/itself/);
    expect(() =>
      sim.call({ first: B.fs, second: A.fs, terms }, "proveDistinct", A.c, B.c),
    ).toThrow(/does not belong/);
  });

  it("refuses a field set whose salts were changed to fit another record", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const forged = { ...B.fs, salts: A.fs.salts };
    expect(() =>
      sim.call(
        { first: A.fs, second: forged, terms },
        "proveDistinct",
        A.c,
        B.c,
      ),
    ).toThrow(/does not belong/);
  });
});

describe("proveUnchanged", () => {
  const corrected = (
    fs: FieldSet,
    changes: Record<number, Uint8Array>,
    label: string,
  ): { fs: FieldSet; c: Uint8Array } => {
    const values = fs.values.map((v, i) => changes[i] ?? v);
    const n = sealFields(
      values,
      sha(`field secret ${label}`),
      sha(`json ${label}`),
    );
    return { fs: n, c: commitmentOf(SCHEMA, n) };
  };
  const none = Array.from({ length: SLOTS }, () => false);

  it("proves a correction changed nothing committed (fresh salts, new JSON)", () => {
    const R = corrected(A.fs, {}, "A-r1");
    const sim = new ClaimsSimulator({ terms: TERMS });
    sim.call(
      { first: A.fs, second: R.fs },
      "proveUnchanged",
      A.c,
      R.c,
      SCHEMA,
      none,
    );
    expect(sim.state.lastClaimKind).toBe(ClaimKind.UNCHANGED);
    expect(hex(sim.state.lastClaimParam)).toBe(hex(maskValue(none)));
  });

  it("proves a correction changed only the slots in the mask", () => {
    const R = corrected(A.fs, { 13: numberValue(6100n) }, "A-r2");
    const sim = new ClaimsSimulator({ terms: TERMS });
    const mask = none.map((_, i) => i === 13);
    sim.call(
      { first: A.fs, second: R.fs },
      "proveUnchanged",
      A.c,
      R.c,
      SCHEMA,
      mask,
    );
    expect(hex(sim.state.lastClaimParam)).toBe(hex(maskValue(mask)));
  });

  it("refuses when a slot outside the mask changed", () => {
    const R = corrected(
      A.fs,
      { 13: numberValue(6100n), 2: digestValue("203/203") },
      "A-r3",
    );
    const sim = new ClaimsSimulator({ terms: TERMS });
    const mask = none.map((_, i) => i === 13);
    expect(() =>
      sim.call(
        { first: A.fs, second: R.fs },
        "proveUnchanged",
        A.c,
        R.c,
        SCHEMA,
        mask,
      ),
    ).toThrow(/outside the mask/);
  });

  it("refuses the same record twice and mismatched field sets", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    expect(() =>
      sim.call(
        { first: A.fs, second: A.fs },
        "proveUnchanged",
        A.c,
        A.c,
        SCHEMA,
        none,
      ),
    ).toThrow(/different record/);
    const R = corrected(A.fs, {}, "A-r4");
    expect(() =>
      sim.call(
        { first: R.fs, second: A.fs },
        "proveUnchanged",
        A.c,
        R.c,
        SCHEMA,
        none,
      ),
    ).toThrow(/does not belong/);
  });
});

describe("contract behaviour", () => {
  it("no state grows with the number of claims", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    sim.call(
      { opening: openSlot(A.fs, 3) },
      "proveValue",
      A.c,
      SCHEMA,
      3n,
      digestValue("155/159"),
    );
    const size = sim.stateText.length;
    for (let i = 0; i < 25; i++) {
      sim.call(
        { opening: openSlot(A.fs, 12), number: 9650n },
        "proveRange",
        A.c,
        SCHEMA,
        12n,
        RangeOp.AT_LEAST,
        BigInt(9000 + i),
      );
      sim.call(
        { first: A.fs, second: B.fs, terms: TERMS },
        "proveDistinct",
        A.c,
        B.c,
      );
    }
    sim.call(
      { opening: openSlot(A.fs, 3) },
      "proveValue",
      A.c,
      SCHEMA,
      3n,
      digestValue("155/159"),
    );
    // Only the counter's digits may lengthen the printout (1 -> 52).
    expect(sim.stateText.length - size).toBeLessThanOrEqual(1);
    expect(sim.state.claimSeq).toBe(52n);
  });

  it("a claim proved against one state lands after other claims", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const p = sim.prove(
      { first: A.fs, second: B.fs, terms: TERMS },
      "proveDistinct",
      A.c,
      B.c,
    );
    sim.call(
      { opening: openSlot(A.fs, 3) },
      "proveValue",
      A.c,
      SCHEMA,
      3n,
      digestValue("155/159"),
    );
    sim.land(p);
    expect(sim.state.lastClaimKind).toBe(ClaimKind.DISTINCT);
    expect(sim.state.claimSeq).toBe(2n);
  });
});

describe("laboratory-signed claims", () => {
  const lab = newAttesterKey();
  const other = newAttesterKey();
  const commitOf = (fs: FieldSet): Uint8Array => commitmentOf(SCHEMA, fs);

  it("a range claim on a field set the laboratory signed publishes the laboratory's key", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const sig = signRecord(lab.secret, commitOf(A.fs));
    sim.call(
      {
        opening: openSlot(A.fs, 12),
        number: 9650n,
        attester: lab.key,
        signature: sig,
      },
      "proveAttestedRange",
      A.c,
      SCHEMA,
      12n,
      RangeOp.AT_LEAST,
      9500n,
    );
    expect(sim.state.lastClaimKind).toBe(ClaimKind.RANGE);
    expect(sim.state.lastClaimAttesterX).toBe(lab.key.x);
    expect(sim.state.lastClaimAttesterY).toBe(lab.key.y);
    // An unsigned claim afterwards clears the key: a verifier never sees a stale one.
    sim.call(
      { opening: openSlot(A.fs, 12), number: 9650n },
      "proveRange",
      A.c,
      SCHEMA,
      12n,
      RangeOp.AT_LEAST,
      9500n,
    );
    expect(sim.state.lastClaimAttesterX).toBe(0n);
  });

  it("refuses a signature on another field set, by another key, or tampered", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    const base = {
      opening: openSlot(A.fs, 12),
      number: 9650n,
      attester: lab.key,
    };
    const go = (signature: ReturnType<typeof signRecord>, attester = lab.key) =>
      sim.call(
        { ...base, attester, signature },
        "proveAttestedRange",
        A.c,
        SCHEMA,
        12n,
        RangeOp.AT_LEAST,
        9500n,
      );
    expect(() => go(signRecord(lab.secret, commitOf(B.fs)))).toThrow(
      /signature does not verify/,
    );
    expect(() => go(signRecord(other.secret, commitOf(A.fs)))).toThrow(
      /signature does not verify/,
    );
    const good = signRecord(lab.secret, commitOf(A.fs));
    expect(() =>
      go({ ...good, response: (good.response + 1n) % JUBJUB_ORDER }),
    ).toThrow(/signature does not verify/);
    expect(() =>
      go({ announcement: attesterKeyOf(5n), response: 5n }, { x: 0n, y: 1n }),
    ).toThrow(/not a signing key/);
  });

  it("a value claim and a distinctness claim with one laboratory signing both field sets", () => {
    const sim = new ClaimsSimulator({ terms: TERMS });
    sim.call(
      {
        opening: openSlot(A.fs, 3),
        attester: lab.key,
        signature: signRecord(lab.secret, commitOf(A.fs)),
      },
      "proveAttestedValue",
      A.c,
      SCHEMA,
      3n,
      digestValue("155/159"),
    );
    expect(sim.state.lastClaimAttesterX).toBe(lab.key.x);
    const p = {
      first: A.fs,
      second: B.fs,
      terms: TERMS,
      attester: lab.key,
      signature: signRecord(lab.secret, commitOf(A.fs)),
    };
    sim.call(
      { ...p, secondSignature: signRecord(lab.secret, commitOf(B.fs)) },
      "proveAttestedDistinct",
      A.c,
      B.c,
    );
    expect(sim.state.lastClaimKind).toBe(ClaimKind.DISTINCT);
    expect(sim.state.lastClaimAttesterX).toBe(lab.key.x);
    // The second field set signed by a different laboratory does not pass as one lab's work.
    expect(() =>
      sim.call(
        { ...p, secondSignature: signRecord(other.secret, commitOf(B.fs)) },
        "proveAttestedDistinct",
        A.c,
        B.c,
      ),
    ).toThrow(/signature does not verify/);
    // A signature over the wrong set in the second slot fails too.
    expect(() =>
      sim.call(
        { ...p, secondSignature: signRecord(lab.secret, commitOf(A.fs)) },
        "proveAttestedDistinct",
        A.c,
        B.c,
      ),
    ).toThrow(/signature does not verify/);
  });
});
