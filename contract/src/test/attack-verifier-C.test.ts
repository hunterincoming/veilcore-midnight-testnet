// Attack round C on the off-chain claims verifier (verify-claims.ts), with a laboratory's
// signature as a SEPARATE attested claim. Each break found is now a FIXED test: it states
// the behaviour a verifier should have, and fails on the code before round C's fixes.
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
  fieldSchemaId,
  sealFieldSetFile,
} from "../field-schema.js";
import { openSlot } from "../fields.js";
import {
  JUBJUB_ORDER,
  type JubjubPoint,
  newAttesterKey,
  signRecord,
  verifyRecordSignature,
} from "../attest.js";
import {
  type Claim,
  claimFromCells,
  disclosedText,
  measured,
  verifyClaim,
} from "../verify-claims.js";
import { ClaimsSimulator } from "./claims-simulator.js";

const COIN = "0".repeat(64);
const V = JSON.parse(
  readFileSync(
    new URL("../../vectors/fields-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  fieldSets: {
    input: { schema: FieldSchema; values: TypedSlotValue[] };
  }[];
};
const SCHEMA = V.fieldSets[0].input.schema;
const VALUES = V.fieldSets[0].input.values;

const seal = (
  values: TypedSlotValue[],
  secret: string,
  schema: FieldSchema = SCHEMA,
) =>
  sealFieldSetFile({
    schema,
    values,
    fieldSecret: secret,
    jsonDigest: "0a".repeat(32),
  });

const A = seal(VALUES, "11".repeat(32));
const altered = [...VALUES];
altered[0] = { text: "230/233" };
altered[1] = { text: "180/188" };
altered[2] = { text: "199/201" };
const B = seal(altered, "22".repeat(32));

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

const valueCells = (s: ReturnType<typeof seal>, slot: number) =>
  cells(
    impure.proveValue(
      ctx({ opening: openSlot(s.fieldSet, slot) }),
      s.commitment,
      s.schemaId,
      BigInt(slot),
      s.fieldSet.values[slot],
    ),
  );

/** An attested claim really published by the compiled contract, by whoever holds `secret`. */
const attested = (
  secret: bigint,
  key: JubjubPoint,
  record: Uint8Array,
): Claim =>
  claimFromCells(
    cells(
      impure.proveAttested(
        ctx({ attester: key, signature: signRecord(secret, record) }),
        record,
      ),
    ),
  );

describe("attack round C: the verifier's laboratory statement", () => {
  // C1 (HIGH). The holder makes its own "laboratory" key, signs its own record and
  // publishes the attested claim. Without a trusted-key list the verifier used to say
  // "on values a laboratory signed" and pass. Now it names the key and says it is not
  // checked; "a laboratory signed" needs trustedAttesters with every signer in it.
  it("FIXED C1: a holder's self-made key, no trusted keys: the key is named, never 'a laboratory'", () => {
    const self = newAttesterKey(); // the HOLDER's key, no laboratory involved
    const v = verifyClaim({
      claim: valueCells(A, 13),
      schema: SCHEMA,
      attestations: [attested(self.secret, self.key, A.commitment)],
    });
    expect(v.passed).toBe(true); // every check made here holds: the key did sign
    expect(v.statement).not.toContain("laboratory signed");
    expect(v.statement).toContain(
      `holds 99.80 percent, on values signed by key (${self.key.x.toString(16).slice(0, 12)}…`,
    );
    expect(v.statement).toContain(
      "not checked against a laboratory's published key",
    );
    expect(v.toCheck.join("\n")).toMatch(/belongs to a laboratory you trust/);
    // With the key listed as trusted, and only then, it is a laboratory's.
    const t = verifyClaim({
      claim: valueCells(A, 13),
      schema: SCHEMA,
      attestations: [attested(self.secret, self.key, A.commitment)],
      trustedAttesters: [self.key],
    });
    expect(t.passed).toBe(true);
    expect(t.statement).toContain("on values a laboratory signed (key (");
    expect(t.statement).toContain(", one you trust)");
  });

  it("FIXED C1b: an attested claim on its own names a key, not 'the laboratory', unless trusted", () => {
    const self = newAttesterKey();
    const att = attested(self.secret, self.key, A.commitment);
    const v = verifyClaim({ claim: att });
    expect(v.passed).toBe(true);
    expect(v.statement).toMatch(/^key \(/);
    expect(v.statement).toContain(
      "not checked against a laboratory's published key",
    );
    expect(v.statement).toContain("binds every value it seals");
    expect(
      verifyClaim({ claim: att, trustedAttesters: [self.key] }).statement,
    ).toMatch(/^the laboratory with key .*, one you trust, signed record/);
    const other = verifyClaim({
      claim: att,
      trustedAttesters: [newAttesterKey().key],
    });
    expect(other.passed).toBe(false);
    expect(other.statement).not.toMatch(/laboratory with key/);
  });

  // C2 (LOW). Hand-built attestations with the key (0,0), the identity (0,1) — which
  // verifies ANY Schnorr signature — the order-2 point, or a point off the curve, used to
  // count. The verifier now applies the contract's own key rule.
  it("FIXED C2: attestations with keys the contract would refuse do not count", () => {
    const P =
      52435875175126190479447740508185965837690552500527637822603658699938581184513n;
    for (const attester of [
      { x: 0n, y: 0n },
      { x: 0n, y: 1n },
      { x: 0n, y: P - 1n },
      { x: 5n, y: 7n },
      { x: P + 5n, y: 7n },
    ]) {
      const forged: Claim = {
        kind: "attested",
        record: A.commitment,
        schema: new Uint8Array(32),
        attester,
      };
      for (const trustedAttesters of [undefined, [attester]]) {
        const v = verifyClaim({
          claim: valueCells(A, 13),
          schema: SCHEMA,
          attestations: [forged],
          ...(trustedAttesters ? { trustedAttesters } : {}),
        });
        expect(v.passed).toBe(false);
        expect(v.statement).not.toMatch(/signed/);
        expect(v.checks.find((c) => !c.ok)?.detail).toMatch(
          /NOT a signing key/,
        );
      }
    }
  });

  it("FIXED C2b: an attested claim with the identity key is refused on its own too", () => {
    const v = verifyClaim({
      claim: {
        kind: "attested",
        record: A.commitment,
        schema: new Uint8Array(32),
        attester: { x: 0n, y: 1n },
      },
    });
    expect(v.passed).toBe(false);
    expect(v.statement).toMatch(/a check on the key failed/);
  });

  // C6 (LOW). Two records signed by two different keys: each record's key is named.
  it("FIXED C6: a distinct claim over records signed by two different keys names each record's key", () => {
    const x = newAttesterKey();
    const y = newAttesterKey();
    const d = cells(
      impure.proveDistinct(
        ctx({ first: A.fieldSet, second: B.fieldSet, terms: A.terms }),
        A.commitment,
        B.commitment,
      ),
    );
    const atts = [
      attested(x.secret, x.key, A.commitment),
      attested(y.secret, y.key, B.commitment),
    ];
    const v = verifyClaim({
      claim: d,
      schema: SCHEMA,
      attestations: atts,
      trustedAttesters: [x.key, y.key],
    });
    expect(v.passed).toBe(true);
    const xa = x.key.x.toString(16).slice(0, 12);
    const ya = y.key.x.toString(16).slice(0, 12);
    expect(v.statement).toContain(
      `record ${Buffer.from(A.commitment).toString("hex").slice(0, 16)}… by key (${xa}`,
    );
    expect(v.statement).toContain(
      `record ${Buffer.from(B.commitment).toString("hex").slice(0, 16)}… by key (${ya}`,
    );
    expect(v.statement).toContain("on values laboratories signed");
    expect(v.statement).not.toContain("a laboratory signed");
    // Trusting only one of them: refused, and no laboratory wording.
    const half = verifyClaim({
      claim: d,
      schema: SCHEMA,
      attestations: atts,
      trustedAttesters: [x.key],
    });
    expect(half.passed).toBe(false);
    expect(half.statement).not.toMatch(/laborator(y|ies) signed/);
    // No list: both keys named, neither called a laboratory.
    const none = verifyClaim({ claim: d, schema: SCHEMA, attestations: atts });
    expect(none.statement).toContain(
      "not checked against a laboratory's published key",
    );
    expect(none.statement).toContain(xa);
    expect(none.statement).toContain(ya);
  });

  // C7 (MEDIUM/LOW). Check 1's reminder now covers the attested claims as well.
  it("FIXED C7: the to-check list requires the attested claims to be on the same published contract", () => {
    const lab = newAttesterKey();
    const v = verifyClaim({
      claim: valueCells(A, 13),
      schema: SCHEMA,
      attestations: [attested(lab.secret, lab.key, A.commitment)],
      trustedAttesters: [lab.key],
    });
    expect(v.toCheck.join("\n")).toMatch(
      /every attested claim read with it is on that same contract/,
    );
  });

  it("INFO: an extra attested claim by an untrusted key on the right record fails the whole verdict", () => {
    // Anyone can publish an attested claim on any record with their own key. A verifier
    // that gathers every attested claim on a record (rather than the ones the holder
    // names) can be made to refuse a good claim. Conservative, but a griefing lever.
    const lab = newAttesterKey();
    const griefer = newAttesterKey();
    const v = verifyClaim({
      claim: valueCells(A, 13),
      schema: SCHEMA,
      attestations: [
        attested(lab.secret, lab.key, A.commitment),
        attested(griefer.secret, griefer.key, A.commitment),
      ],
      trustedAttesters: [lab.key],
    });
    expect(v.passed).toBe(false);
    expect(v.statement).not.toContain("laboratory signed");
  });

  it("holds: hand-built attestations with no key, another kind, or another record are refused", () => {
    const lab = newAttesterKey();
    const good = attested(lab.secret, lab.key, A.commitment);
    for (const bad of [
      { ...good, attester: undefined },
      { ...good, kind: "value" as const },
      { ...good, record: new Uint8Array([...A.commitment, 0]) },
      { ...good, record: A.commitment.slice(0, 31) },
    ]) {
      const v = verifyClaim({
        claim: valueCells(A, 13),
        schema: SCHEMA,
        attestations: [bad],
        trustedAttesters: [lab.key],
      });
      expect(v.passed).toBe(false);
      expect(v.statement).not.toMatch(/signed/);
    }
    const none = verifyClaim({
      claim: valueCells(A, 13),
      schema: SCHEMA,
      attestations: [],
    });
    expect(none.passed).toBe(false);
    expect(none.statement).not.toMatch(/signed/);
  });

  it("holds: claimFromCells refuses ATTESTED cells whose key is (0, 0)", () => {
    const lab = newAttesterKey();
    const l = cells(
      impure.proveAttested(
        ctx({
          attester: lab.key,
          signature: signRecord(lab.secret, A.commitment),
        }),
        A.commitment,
      ),
    );
    expect(() =>
      claimFromCells({ ...l, lastClaimAttesterX: 0n, lastClaimAttesterY: 0n }),
    ).toThrow(/no laboratory key/);
  });
});

describe("attack round C: what the statement says a value is", () => {
  // C3 (MEDIUM). A value claim on an EMPTY slot (32 zero bytes) is provable. It used to be
  // stated as "holds the text whose SHA-256 is 0000…" and, on a number slot, refused.
  const emptyVals = [...VALUES];
  emptyVals[13] = null;
  emptyVals[14] = null;
  const E = seal(emptyVals, "33".repeat(32));

  it("FIXED C3: an empty text slot is stated as empty", () => {
    const v = verifyClaim({ claim: valueCells(E, 14), schema: SCHEMA });
    expect(v.passed).toBe(true);
    expect(v.statement).toContain("as sealed, is empty (no value sealed).");
    expect(v.statement).not.toContain("SHA-256");
    expect(v.toCheck.join("\n")).not.toMatch(/SHA-256 digest of text/);
    // Shown "nothing": matches. Shown any text, even "": does not.
    expect(
      verifyClaim({ claim: valueCells(E, 14), shownValue: null }).passed,
    ).toBe(true);
    expect(
      verifyClaim({ claim: valueCells(E, 14), shownValue: { text: "" } })
        .passed,
    ).toBe(false);
  });

  it("FIXED C3b: an empty number slot is a true claim, stated as empty, and accounted as such", () => {
    const v = verifyClaim({
      claim: valueCells(E, 13),
      schema: SCHEMA,
      earlierClaims: [],
    });
    expect(v.passed).toBe(true);
    expect(
      v.checks.some((c) => /is empty \(no value sealed\)/.test(c.detail)),
    ).toBe(true);
    expect(v.statement).toContain("is empty (no value sealed)");
    expect(v.toCheck.join("\n")).toContain(
      "disclosed so far on this record and slot: the value itself (empty (no value sealed))",
    );
    // No schema: still empty, never a number or a text digest.
    expect(verifyClaim({ claim: valueCells(E, 13) }).statement).toContain(
      "is empty",
    );
  });

  // C4 (MEDIUM). A scale that is not a power of ten used to misstate the number.
  const S20: FieldSchema = {
    ...SCHEMA,
    slots: SCHEMA.slots.map((s) => (s.slot === 12 ? { ...s, scale: 20 } : s)),
  };
  const vals20 = [...VALUES];
  vals20[12] = { uint: "9651" };
  const R20 = seal(vals20, "44".repeat(32), S20);

  it("FIXED C4: a scale that is not a power of ten is written exactly (9651/20 = 482.55)", () => {
    const v = verifyClaim({ claim: valueCells(R20, 12), schema: S20 });
    expect(v.passed).toBe(true);
    expect(v.statement).toContain("holds 482.55 percent");
    expect(Buffer.from(fieldSchemaId(S20)).toString("hex")).toBe(
      Buffer.from(R20.schemaId).toString("hex"),
    );
  });

  it("FIXED C4b: no exact decimal: the fraction, and an approximation rounded against the claim", () => {
    const d3 = { scale: 3, unit: "percent" };
    expect(measured(10n, d3, "down")).toBe(
      "10/3 percent (≈ 3.3333, rounded down)",
    );
    expect(measured(10n, d3, "up")).toBe("10/3 percent (≈ 3.3334, rounded up)");
    expect(measured(11n, d3)).toBe("11/3 percent (≈ 3.6667, rounded)");
    expect(measured(9n, d3)).toBe("3 percent");
    expect(measured(0n, d3)).toBe("0 percent");
    // Exact decimals for scales made of 2s and 5s; powers of ten as before.
    expect(measured(3n, { scale: 4 })).toBe("0.75");
    expect(measured(6n, { scale: 20 })).toBe("0.3");
    expect(measured(1n, { scale: 8 })).toBe("0.125");
    expect(measured(9550n, { scale: 100, unit: "percent" })).toBe(
      "95.50 percent",
    );
    expect(measured(5n, { scale: 1000 })).toBe("0.005");
    expect(measured(7n)).toBe("7");
    // Disclosure accounting rounds a lower bound down and an upper bound up.
    const lo: Claim = {
      kind: "range",
      record: A.commitment,
      schema: A.schemaId,
      slot: 12,
      bound: 10n,
      op: "at least",
    };
    const hi: Claim = { ...lo, bound: 11n, op: "at most" };
    expect(disclosedText([lo, hi], d3)).toBe(
      "the number is between 10/3 percent (≈ 3.3333, rounded down) and 11/3 percent (≈ 3.6667, rounded up)",
    );
    // A brute check: for every n and non-power-of-ten scale up to 60, a lower bound's
    // approximation is never above n/scale and an upper bound's never below it.
    for (let scale = 2; scale <= 60; scale++)
      for (let n = 0n; n < 200n; n++) {
        const read = (s: string): number => {
          const m = /≈ ([0-9.]+)/.exec(s) ?? /^([0-9.]+)/.exec(s);
          return Number(m![1]);
        };
        const exact = Number(n) / scale;
        expect(read(measured(n, { scale }, "down"))).toBeLessThanOrEqual(
          exact + 1e-12,
        );
        expect(read(measured(n, { scale }, "up"))).toBeGreaterThanOrEqual(
          exact - 1e-12,
        );
      }
  });

  it("FIXED C4c: a range claim at scale 3 is stated rounded against the holder", () => {
    const S3: FieldSchema = {
      ...SCHEMA,
      slots: SCHEMA.slots.map((s) => (s.slot === 12 ? { ...s, scale: 3 } : s)),
    };
    const R3 = seal(VALUES, "45".repeat(32), S3);
    const range = (op: RangeOp, bound: bigint) =>
      cells(
        impure.proveRange(
          ctx({
            opening: openSlot(R3.fieldSet, 12),
            number: 9650n,
            terms: R3.terms,
          }),
          R3.commitment,
          R3.schemaId,
          12n,
          op,
          bound,
        ),
      );
    expect(
      verifyClaim({ claim: range(RangeOp.AT_LEAST, 9649n), schema: S3 })
        .statement,
    ).toContain("is at least 9649/3 percent (≈ 3216.3333, rounded down)");
    expect(
      verifyClaim({ claim: range(RangeOp.AT_MOST, 9650n), schema: S3 })
        .statement,
    ).toContain("is at most 9650/3 percent (≈ 3216.6667, rounded up)");
  });

  // C5 (LOW). A schema document that fails check 3 no longer words the statement.
  it("FIXED C5: a rejected schema does not set the scale, unit or path in the statement", () => {
    const fake: FieldSchema = {
      ...SCHEMA,
      slots: SCHEMA.slots.map((s) =>
        s.slot === 12
          ? { ...s, scale: 1, unit: "kg/ha", path: "fields.yield" }
          : s,
      ),
    };
    const l = cells(
      impure.proveRange(
        ctx({
          opening: openSlot(A.fieldSet, 12),
          number: 9650n,
          terms: A.terms,
        }),
        A.commitment,
        A.schemaId,
        12n,
        RangeOp.AT_LEAST,
        9500n,
      ),
    );
    const v = verifyClaim({ claim: l, schema: fake, earlierClaims: [] });
    expect(v.passed).toBe(false);
    expect(v.statement).not.toContain("kg/ha");
    expect(v.statement).not.toContain("fields.yield");
    expect(v.statement).toContain("the number in slot 12 of record");
    expect(v.statement).toContain("is at least 9500.");
    expect(v.toCheck.join("\n")).not.toContain("kg/ha");
    // A distinct claim with a rejected schema does not quote its k.
    const d = cells(
      impure.proveDistinct(
        ctx({ first: A.fieldSet, second: B.fieldSet, terms: A.terms }),
        A.commitment,
        B.commitment,
      ),
    );
    expect(
      verifyClaim({ claim: d, schema: { ...SCHEMA, k: 1 } }).statement,
    ).toContain("differ in at least the schema's k comparable values");
    // The right schema still words it.
    expect(verifyClaim({ claim: l, schema: SCHEMA }).statement).toContain(
      "is at least 95.00 percent",
    );
  });
});

describe("attack round C: verifyRecordSignature agrees with the circuit", () => {
  const P =
    52435875175126190479447740508185965837690552500527637822603658699938581184513n;
  /** What the compiled proveAttested says about (key, record, signature). */
  const circuit = (
    key: JubjubPoint,
    record: Uint8Array,
    sig: ReturnType<typeof signRecord>,
  ): boolean => {
    try {
      new ClaimsSimulator().call(
        { attester: key, signature: sig },
        "proveAttested",
        record,
      );
      return true;
    } catch {
      return false;
    }
  };
  const rec = (i: number): Uint8Array => {
    const b = new Uint8Array(32);
    b[0] = i & 0xff;
    b[1] = (i >> 8) & 0xff;
    b[31] = 0xa5;
    return b;
  };

  it("accepts exactly what the circuit accepts: 40 good signatures and 7 kinds of bad one for each", () => {
    let good = 0;
    let bad = 0;
    for (let i = 0; i < 40; i++) {
      const lab = newAttesterKey();
      const r = rec(i);
      const sig = signRecord(lab.secret, r);
      const cases: [JubjubPoint, Uint8Array, typeof sig][] = [
        [lab.key, r, sig],
        [lab.key, rec(i + 1000), sig], // another record
        [newAttesterKey().key, r, sig], // another key
        [lab.key, r, { ...sig, response: (sig.response + 1n) % JUBJUB_ORDER }],
        [lab.key, r, { ...sig, announcement: newAttesterKey().key }],
        [lab.key, r, signRecord(newAttesterKey().secret, r)], // someone else's signature
        // The same point from another scalar: the runtime refuses a response >= r, so it never lands.
        [lab.key, r, { ...sig, response: sig.response + JUBJUB_ORDER }],
        [{ x: 0n, y: 1n }, r, { announcement: sig.announcement, response: 0n }],
      ];
      for (const [k, m, s] of cases) {
        const off = verifyRecordSignature(k, m, s);
        expect(off).toBe(circuit(k, m, s));
        if (off) good++;
        else bad++;
      }
    }
    expect(good).toBe(40);
    expect(bad).toBe(280);
  }, 120_000);

  it("refuses keys outside the subgroup, off the curve, or with x = 0, and malformed input, without throwing", () => {
    const lab = newAttesterKey();
    const r = rec(7);
    const sig = signRecord(lab.secret, r);
    for (const k of [
      { x: 0n, y: 1n },
      { x: 0n, y: P - 1n },
      { x: 5n, y: 7n },
      { x: lab.key.x + P, y: lab.key.y },
      { x: -1n, y: 1n },
    ])
      expect(verifyRecordSignature(k, r, sig)).toBe(false);
    expect(verifyRecordSignature(lab.key, r.slice(0, 31), sig)).toBe(false);
    expect(verifyRecordSignature(lab.key, r, { ...sig, response: P })).toBe(
      false,
    );
    expect(verifyRecordSignature(lab.key, r, { ...sig, response: -1n })).toBe(
      false,
    );
    expect(
      verifyRecordSignature(lab.key, r, {
        announcement: { x: 5n, y: 7n },
        response: 1n,
      }),
    ).toBe(false);
    expect(verifyRecordSignature(lab.key, r, undefined as never)).toBe(false);
    // And still accepts the real one afterwards (a runtime panic does not poison later calls).
    expect(verifyRecordSignature(lab.key, r, sig)).toBe(true);
  });
});
