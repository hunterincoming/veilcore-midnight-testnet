// Attack round A on the claims contract, kept as a regression suite.
//
// Each finding from round A (3 Oct 2026) is a test that the defence now holds
// (FIXED-...). Accepted limits are tests that document the behaviour (INFO-... /
// ACCEPTED-...), so a change to them is noticed. DEFENCE-... tests cover attacks that
// never worked. Report: review-out/attack-claims-A.md.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createCircuitContext,
  createConstructorContext,
  ecMulGenerator,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  ClaimKind,
  Contract,
  RangeOp,
} from "../managed/veilcore-claims/contract/index.js";
import { CC, ClaimsSimulator, type Private } from "./claims-simulator.js";
import {
  ABSENT,
  SLOTS,
  type FieldSet,
  type SchemaTerms,
  commitmentOf,
  digestValue,
  leafOf,
  maskValue,
  nodeOf,
  numberValue,
  openSlot,
  recordOf,
  schemaIdOf,
  sealFields,
  setRootOf,
  treeOf,
} from "../fields.js";

// Record every randomBytes request so the nonce width (A7) can be checked.
const rng = vi.hoisted(() => ({ sizes: [] as number[] }));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    randomBytes: (n: number) => {
      rng.sizes.push(n);
      return real.randomBytes(n);
    },
  };
});

const { JUBJUB_ORDER, newAttesterKey, signRecord } =
  await import("../attest.js");
type AttestationSignature = import("../attest.js").AttestationSignature;

const sha = (s: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(s).digest());
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** BLS12-381 scalar field modulus (Compact's Field). */
const P = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const TWO_248 = 1n << 248n;

const comparable = Array.from({ length: SLOTS }, (_, i) => i < 12);
const numeric = Array.from(
  { length: SLOTS },
  (_, i) => i === 12 || i === 13 || i === 15,
);
const TERMS: SchemaTerms = {
  documentDigest: sha("plant-variety-markers/v1 schema document"),
  comparable,
  k: 3n,
  numeric,
};
const SCHEMA = schemaIdOf(TERMS);
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
const make = (
  calls: string[],
  germ: bigint,
  label: string,
  schema = SCHEMA,
): { fs: FieldSet; c: Uint8Array } => {
  const values = [
    ...calls.map((c) => (c === "" ? ABSENT : digestValue(c))),
    numberValue(germ),
    numberValue(6400n),
    digestValue(`name:${label}`),
    ABSENT,
  ];
  const fs = sealFields(values, sha(`fs ${label}`), sha(`json ${label}`));
  return { fs, c: commitmentOf(schema, fs) };
};
const A = make(BASE, 9650n, "A");
const B = make(
  BASE.map((v, i) =>
    i === 0 ? "231/233" : i === 4 ? "310/318" : i === 9 ? "177/177" : v,
  ),
  9100n,
  "B",
);

const lab = newAttesterKey();
const sim = (): ClaimsSimulator => new ClaimsSimulator({ terms: TERMS });

/** proveAttestedRange on slot 12 of `rec` (default A), returning the landed state. */
const attestedRange = (
  sig: AttestationSignature,
  opts: {
    key?: { x: bigint; y: bigint };
    fs?: FieldSet;
    rec?: Uint8Array;
  } = {},
) => {
  const s = sim();
  s.call(
    {
      opening: openSlot(opts.fs ?? A.fs, 12),
      number: 9650n,
      attester: opts.key ?? lab.key,
      signature: sig,
    },
    "proveAttestedRange",
    opts.rec ?? A.c,
    SCHEMA,
    12n,
    RangeOp.AT_LEAST,
    9500n,
  );
  return s.state;
};

/** A contract run whose Schnorr reduction witness the attacker controls. */
const runWithReduction = (
  p: Private,
  reduce: (h: bigint) => [bigint, bigint],
  ...args: unknown[]
): void => {
  const w = <T>(v: T | undefined): T => {
    if (v === undefined) throw new Error("missing witness");
    return v;
  };
  const c = new Contract<Record<string, never>>({
    firstFieldSet: ({ privateState }) => [privateState, w(p.first)],
    secondFieldSet: ({ privateState }) => [privateState, w(p.second)],
    slotOpening: ({ privateState }) => [privateState, w(p.opening)],
    slotNumber: ({ privateState }) => [privateState, w(p.number)],
    schemaTerms: ({ privateState }) => [privateState, w(p.terms)],
    attesterKey: ({ privateState }) => [privateState, w(p.attester)],
    attesterSignature: ({ privateState }) => [privateState, w(p.signature)],
    secondAttesterSignature: ({ privateState }) => [
      privateState,
      w(p.secondSignature),
    ],
    schnorrReduction: ({ privateState }, h: bigint) => [
      privateState,
      reduce(h),
    ],
  });
  const init = c.initialState(createConstructorContext({}, "0".repeat(64)));
  const ctx = createCircuitContext(
    sampleContractAddress(),
    "0".repeat(64),
    init.currentContractState,
    {},
  );
  const fn = c.impureCircuits.proveAttestedRange.bind(
    c.impureCircuits,
  ) as unknown as (c: unknown, ...a: unknown[]) => unknown;
  fn(ctx, ...args);
};

const zkir = (circuit: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../managed/veilcore-claims/zkir/${circuit}.zkir`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { instructions: { op: string; imm?: string; inputs?: number[] }[] };

/** A Field as the ZKIR writes immediates: little-endian bytes, upper-case hex, trailing zero bytes dropped. */
const immHex = (n: bigint): string => {
  let out = "";
  for (let v = n; v > 0n; v >>= 8n)
    out += (v & 0xffn).toString(16).padStart(2, "0");
  return out.toUpperCase();
};

// ───────────────────────────────────────────────────────── laboratory signatures

describe("laboratory attestation binding", () => {
  it("FIXED-A1: a lab signature cannot be moved to another record built around the same field set", () => {
    const sig = signRecord(lab.secret, A.c);
    expect(attestedRange(sig).lastClaimAttesterX).toBe(lab.key.x); // genuine use works
    const otherSubject = {
      ...A.fs,
      jsonDigest: sha("json: lot Y, variety Z, owner Mallory"),
    };
    const moved = commitmentOf(SCHEMA, otherSubject);
    expect(hex(moved)).not.toBe(hex(A.c));
    expect(() => attestedRange(sig, { fs: otherSubject, rec: moved })).toThrow(
      /signature does not verify/,
    );
    // ... nor into a distinctness claim about a re-wrapped pair.
    const otherB = {
      ...B.fs,
      jsonDigest: sha("json: someone else's reference"),
    };
    const s = sim();
    expect(() =>
      s.call(
        {
          first: otherSubject,
          second: otherB,
          attester: lab.key,
          signature: sig,
          secondSignature: signRecord(lab.secret, B.c),
        },
        "proveAttestedDistinct",
        moved,
        commitmentOf(SCHEMA, otherB),
      ),
    ).toThrow(/signature does not verify/);
    // A signature on the field-set root (the old message) is no longer accepted either.
    const rootSig = signRecord(lab.secret, setRootOf(SCHEMA, treeOf(A.fs)));
    expect(() => attestedRange(rootSig)).toThrow(/signature does not verify/);
  });

  it("FIXED-A1: one lab's signatures on A and B do not serve B and A swapped", () => {
    const s = sim();
    expect(() =>
      s.call(
        {
          first: A.fs,
          second: B.fs,
          attester: lab.key,
          signature: signRecord(lab.secret, B.c),
          secondSignature: signRecord(lab.secret, A.c),
        },
        "proveAttestedDistinct",
        A.c,
        B.c,
      ),
    ).toThrow(/signature does not verify/);
  });

  it("FIXED-A2: the signed message covers all 32 bytes of the record (byte 31 included)", () => {
    const flipped = new Uint8Array(A.c);
    flipped[31] ^= 0xff;
    const m0 = CC.attestationMessage(A.c);
    const m1 = CC.attestationMessage(flipped);
    expect(m0).toHaveLength(3);
    expect(m1[1]).toBe(m0[1]); // the plain limb still drops byte 31 ...
    expect(m1[2]).not.toBe(m0[2]); // ... the tagged hash catches it
    expect(() => attestedRange(signRecord(lab.secret, flipped))).toThrow(
      /signature does not verify/,
    );
    // In the circuit: the transient hash now takes 7 inputs (annX annY pkX pkY tag rec h(rec)).
    const th = zkir("proveAttestedValue").instructions.filter(
      (i) => i.op === "transient_hash",
    );
    expect(th).toHaveLength(1);
    expect(th[0].inputs).toHaveLength(7);
  });

  it("DEFENCE: a signature does not replay across schemas (the schema id is inside the record)", () => {
    const S2 = schemaIdOf({ ...TERMS, k: 4n });
    const a2 = commitmentOf(S2, A.fs);
    const s = new ClaimsSimulator({ terms: { ...TERMS, k: 4n } });
    expect(() =>
      s.call(
        {
          opening: openSlot(A.fs, 12),
          number: 9650n,
          attester: lab.key,
          signature: signRecord(lab.secret, A.c),
        },
        "proveAttestedRange",
        a2,
        S2,
        12n,
        RangeOp.AT_LEAST,
        9500n,
      ),
    ).toThrow(/signature does not verify/);
  });

  it("ACCEPTED-A3: a signature is not bound to a deployment; it verifies on any claims contract", () => {
    const sig = signRecord(lab.secret, A.c);
    for (let i = 0; i < 2; i++)
      expect(attestedRange(sig).lastClaimAttesterX).toBe(lab.key.x);
  });
});

describe("Schnorr port", () => {
  it("FIXED-A5: the second split of the challenge (q = 115, c' = cFull + p - 115*2^248) is refused", () => {
    const slack = 116n * TWO_248 - P;
    let found:
      | { k: bigint; R: { x: bigint; y: bigint }; h: bigint }
      | undefined;
    for (let k = 1n; k < 60000n && !found; k++) {
      const R = ecMulGenerator(k) as { x: bigint; y: bigint };
      const h = CC.attestationChallenge(R.x, R.y, lab.key.x, lab.key.y, A.c);
      if (h < slack) found = { k, R, h };
    }
    expect(found).toBeDefined();
    const { k, R, h } = found!;
    const cAlt = h + P - 115n * TWO_248;
    expect(cAlt < TWO_248).toBe(true);
    const sigAlt = {
      announcement: R,
      response: (k + cAlt * lab.secret) % JUBJUB_ORDER,
    };
    const args = [A.c, SCHEMA, 12n, RangeOp.AT_LEAST, 9500n];
    const p = {
      opening: openSlot(A.fs, 12),
      number: 9650n,
      terms: TERMS,
      attester: lab.key,
      signature: sigAlt,
    };
    expect(() => runWithReduction(p, () => [115n, cAlt], ...args)).toThrow(
      /quotient out of range/,
    );
    // and the canonical split of that hash does not verify the alternative response
    expect(() => attestedRange(sigAlt)).toThrow(/does not verify/);
  }, 120_000);

  it("FIXED-A5 boundary: an honest signature whose challenge has q = 115 still verifies", () => {
    // About 0.8% of challenges have q = 115; find one and sign with it.
    let found:
      | { k: bigint; R: { x: bigint; y: bigint }; h: bigint }
      | undefined;
    for (let k = 1n; k < 20000n && !found; k++) {
      const R = ecMulGenerator(k) as { x: bigint; y: bigint };
      const h = CC.attestationChallenge(R.x, R.y, lab.key.x, lab.key.y, A.c);
      if (h / TWO_248 === 115n) found = { k, R, h };
    }
    expect(found).toBeDefined();
    const { k, R, h } = found!;
    const sig = {
      announcement: R,
      response: (k + (h % TWO_248) * lab.secret) % JUBJUB_ORDER,
    };
    expect(attestedRange(sig).lastClaimAttesterX).toBe(lab.key.x);
    // q = 116 with any remainder is refused.
    const p = {
      opening: openSlot(A.fs, 12),
      number: 9650n,
      terms: TERMS,
      attester: lab.key,
      signature: sig,
    };
    expect(() =>
      runWithReduction(
        p,
        (x) => [116n, x - 116n * TWO_248 + P],
        A.c,
        SCHEMA,
        12n,
        RangeOp.AT_LEAST,
        9500n,
      ),
    ).toThrow(/quotient out of range|Invalid challenge reduction|Uint/);
  }, 120_000);

  describe("FIXED-A6: keys outside the prime-order subgroup are refused", () => {
    const modpow = (b: bigint, e: bigint, m: bigint): bigint => {
      let r = 1n;
      b %= m;
      while (e > 0n) {
        if (e & 1n) r = (r * b) % m;
        b = (b * b) % m;
        e >>= 1n;
      }
      return r;
    };
    let z = 2n;
    while (modpow(z, (P - 1n) / 2n, P) !== P - 1n) z++;
    let t = P - 1n;
    let e2 = 0n;
    while (t % 2n === 0n) {
      t /= 2n;
      e2++;
    }
    const i4 = modpow(z, t * 2n ** (e2 - 2n), P); // sqrt(-1)
    const refusal = (key: { x: bigint; y: bigint }): string => {
      try {
        attestedRange(
          {
            announcement: ecMulGenerator(1n),
            response: 1n,
          },
          { key },
        );
      } catch (e) {
        return (e as Error).message;
      }
      return "ACCEPTED";
    };

    it("order-4 point (sqrt(-1), 0): refused (layer: JS runtime EC code; contract check is behind it)", () => {
      expect((i4 * i4) % P).toBe(P - 1n);
      const m = refusal({ x: i4, y: 0n });
      expect(m).not.toBe("ACCEPTED");
      // Which layer refused: the WASM runtime panics ("unreachable") before the contract's
      // own assert can run. The contract check is asserted present in the ZKIR below.
      expect(m).toMatch(/unreachable|not a signing key/);
    });

    it("lab key + order-4 point: refused", () => {
      // Edwards addition (a = -1): (x1,y1)+(x2,y2) with T = (i4, 0)
      const d =
        19257038036680949359750312669786877991949435402254120286184196891950884077233n;
      const inv = (a: bigint) => modpow(((a % P) + P) % P, P - 2n, P);
      const { x: x1, y: y1 } = lab.key;
      const x2 = i4,
        y2 = 0n;
      const dx = (d * x1 * x2 * y1 * y2) % P;
      const x3 = ((x1 * y2 + y1 * x2) * inv(1n + dx)) % P;
      const y3 = (((y1 * y2 + x1 * x2) % P) * inv(1n - dx)) % P;
      // on the curve: -x^2 + y^2 = 1 + d x^2 y^2
      expect(
        (((-x3 * x3 + y3 * y3 - 1n - ((((d * x3 * x3) % P) * y3) % P) * y3) %
          P) +
          P) %
          P,
      ).toBe(0n);
      const m = refusal({ x: x3, y: y3 });
      expect(m).not.toBe("ACCEPTED");
      expect(m).toMatch(/unreachable|not a signing key/);
    });

    it("off-curve point: refused", () => {
      expect(refusal({ x: 5n, y: 7n })).not.toBe("ACCEPTED");
    });

    it("identity and (0, -1): refused by the contract's own check", () => {
      expect(refusal({ x: 0n, y: 1n })).toMatch(/not a signing key/);
      expect(refusal({ x: 0n, y: P - 1n })).toMatch(
        /not a signing key|unreachable/,
      );
    });

    it("the circuit itself checks r * pk = identity (independent of the JS runtime)", () => {
      const ins = zkir("proveAttestedValue").instructions;
      const rMinus1 = immHex(JUBJUB_ORDER - 1n);
      expect(
        ins.some(
          (i) =>
            i.op === "load_imm" && i.imm?.replace(/(00)+$/, "") === rMinus1,
        ),
      ).toBe(true);
      expect(ins.filter((i) => i.op === "ec_mul")).toHaveLength(2); // c*pk and (r-1)*pk
      expect(ins.filter((i) => i.op === "ec_add")).toHaveLength(2);
    });
  });

  it("ACCEPTED-A4: the response is an unchecked Field; s + order is refused by the JS runtime (EmbeddedFr), not by the contract", () => {
    const sig = signRecord(lab.secret, A.c);
    const mauled = { ...sig, response: sig.response + JUBJUB_ORDER };
    expect(mauled.response).toBeLessThan(P);
    expect(() => attestedRange(mauled)).toThrow(/EmbeddedFr/);
  });

  it("FIXED-A7: signing draws 512 bits per nonce (no 256-bit modular bias)", () => {
    rng.sizes.length = 0;
    signRecord(lab.secret, A.c);
    newAttesterKey();
    expect(rng.sizes.length).toBeGreaterThanOrEqual(2);
    expect(rng.sizes.every((n) => n === 64)).toBe(true);
    // 2^512 mod r / 2^512 < 2^-260: the bias is negligible.
    expect((1n << 512n) / JUBJUB_ORDER > 1n << 259n).toBe(true);
  });
});

// ───────────────────────────────────────────────────────── range claims and schema terms

describe("range claims and schema terms", () => {
  it("FIXED (new): a range claim on a non-numeric slot is refused even when its value was forced to number form", () => {
    // Bypass the SDK: put a number in slot 14 (a text slot in this schema).
    const values = A.fs.values.map((v, i) => (i === 14 ? numberValue(42n) : v));
    const fs = sealFields(values, sha("fs forced"), sha("json forced"));
    const c = commitmentOf(SCHEMA, fs);
    const s = sim();
    expect(() =>
      s.call(
        { opening: openSlot(fs, 14), number: 42n },
        "proveRange",
        c,
        SCHEMA,
        14n,
        RangeOp.AT_MOST,
        100n,
      ),
    ).toThrow(/not a number slot/);
    // The same for the laboratory-signed version, even with a genuine signature.
    expect(() =>
      s.call(
        {
          opening: openSlot(fs, 14),
          number: 42n,
          attester: lab.key,
          signature: signRecord(lab.secret, c),
        },
        "proveAttestedRange",
        c,
        SCHEMA,
        14n,
        RangeOp.AT_MOST,
        100n,
      ),
    ).toThrow(/not a number slot/);
  });

  it("FIXED (new): terms that are not the schema's (e.g. a numeric mask widened to slot 14) are refused", () => {
    const widened = {
      ...TERMS,
      numeric: TERMS.numeric.map((b, i) => b || i === 14),
    };
    const s = new ClaimsSimulator({ terms: widened });
    expect(() =>
      s.call(
        { opening: openSlot(A.fs, 12), number: 9650n },
        "proveRange",
        A.c,
        SCHEMA,
        12n,
        RangeOp.AT_LEAST,
        1n,
      ),
    ).toThrow(/not the terms of that schema/);
  });

  it("ACCEPTED-A13: a holder can mint its own schema id (same document digest, other masks); only verifier step 3 catches it", () => {
    // The masks and k are not derived from the document in-circuit. A holder seals under
    // a home-made id whose numeric mask includes slot 14, then range-proves it.
    const homemade = {
      ...TERMS,
      numeric: TERMS.numeric.map((b, i) => b || i === 14),
    };
    const S = schemaIdOf(homemade);
    const values = A.fs.values.map((v, i) => (i === 14 ? numberValue(42n) : v));
    const fs = sealFields(values, sha("fs home"), sha("json home"));
    const c = commitmentOf(S, fs);
    const s = new ClaimsSimulator({ terms: homemade });
    s.call(
      { opening: openSlot(fs, 14), number: 42n },
      "proveRange",
      c,
      S,
      14n,
      RangeOp.AT_MOST,
      100n,
    );
    expect(hex(s.state.lastClaimSchema)).toBe(hex(S));
    expect(hex(s.state.lastClaimSchema)).not.toBe(hex(SCHEMA)); // a verifier comparing ids refuses it
  });

  it("DEFENCE: number values with stray high bytes are refused", () => {
    const v = numberValue(9650n);
    v[9] = 1;
    const fs = {
      ...A.fs,
      values: A.fs.values.map((x, i) => (i === 12 ? v : x)),
    };
    const c = commitmentOf(SCHEMA, fs);
    expect(() =>
      sim().call(
        { opening: openSlot(fs, 12), number: 9650n },
        "proveRange",
        c,
        SCHEMA,
        12n,
        RangeOp.AT_LEAST,
        1n,
      ),
    ).toThrow(/does not hold that number/);
  });
});

// ───────────────────────────────────────────────────────── verifier reading

describe("event cells, bundling, replay", () => {
  it("DEFENCE: consecutive claims in one transaction never mix cells (every circuit writes every cell)", () => {
    const s = sim();
    s.call(
      {
        opening: openSlot(A.fs, 12),
        number: 9650n,
        attester: lab.key,
        signature: signRecord(lab.secret, A.c),
      },
      "proveAttestedRange",
      A.c,
      SCHEMA,
      12n,
      RangeOp.AT_MOST,
      9700n,
    );
    s.call({ first: A.fs, second: B.fs }, "proveDistinct", A.c, B.c);
    const st = s.state;
    expect(st.lastClaimKind).toBe(ClaimKind.DISTINCT);
    expect(st.lastClaimOp).toBe(RangeOp.AT_LEAST);
    expect(hex(st.lastClaimParam)).toBe(hex(new Uint8Array(32)));
    expect(st.lastClaimSlot).toBe(0n);
    expect(st.lastClaimAttesterX).toBe(0n);
    expect(st.lastClaimAttesterY).toBe(0n);
  });

  it("ACCEPTED-A8: an earlier claim in a bundle is invisible in post-transaction state; a proof can be landed twice", () => {
    const s = sim();
    const p = s.prove(
      { opening: openSlot(A.fs, 3) },
      "proveValue",
      A.c,
      SCHEMA,
      3n,
      digestValue("155/159"),
    );
    s.land(p);
    s.land(p);
    expect(s.state.claimSeq).toBe(2n);
  });

  it("OPEN-A9: an UNCHANGED claim is symmetric and says nothing about the JSON part", () => {
    const R = sealFields(
      A.fs.values,
      sha("fs A-r"),
      sha("json: a totally different subject"),
    );
    const rc = commitmentOf(SCHEMA, R);
    const none = Array.from({ length: SLOTS }, () => false);
    const s = sim();
    s.call({ first: R, second: A.fs }, "proveUnchanged", rc, A.c, SCHEMA, none);
    expect(s.state.lastClaimKind).toBe(ClaimKind.UNCHANGED);
    expect(hex(s.state.lastClaimParam)).toBe(hex(maskValue(none)));
  });

  it("ACCEPTED-A10: anyone given a single opening can publish a VALUE claim for that slot", () => {
    const o = openSlot(A.fs, 12);
    const s = sim();
    s.call({ opening: o }, "proveValue", A.c, SCHEMA, 12n, o.value);
    expect(hex(s.state.lastClaimParam)).toBe(hex(numberValue(9650n)));
  });
});

// ───────────────────────────────────────────────────────── binding and encodings

describe("binding between field set and commitment", () => {
  it("DEFENCE: an interior node cannot be opened as a leaf (tags differ, depth fixed)", () => {
    const l0 = leafOf(A.fs.values[0], A.fs.salts[0]);
    const l1 = leafOf(A.fs.values[1], A.fs.salts[1]);
    const o = openSlot(A.fs, 0);
    const forged = {
      ...o,
      value: l0,
      salt: l1,
      siblings: [o.siblings[1], o.siblings[2], o.siblings[3], o.siblings[3]],
    };
    expect(hex(nodeOf(l0, l1))).not.toBe(hex(leafOf(l0, l1)));
    expect(() =>
      sim().call({ opening: forged }, "proveValue", A.c, SCHEMA, 0n, l0),
    ).toThrow(/does not belong/);
  });

  it("DEFENCE: setRoot and record cannot be swapped (fieldRecord vs fieldSetRoot tags)", () => {
    const root = setRootOf(SCHEMA, treeOf(A.fs));
    expect(hex(recordOf(root, A.fs.jsonDigest))).toBe(hex(A.c));
    expect(hex(setRootOf(root, A.fs.jsonDigest))).not.toBe(hex(A.c));
  });

  it("DEFENCE: the Uint<8> difference counter cannot overflow (max 16); k = 16 works, k = 17 does not", () => {
    const all = Array.from({ length: SLOTS }, () => true);
    const none = Array.from({ length: SLOTS }, () => false);
    const T16: SchemaTerms = {
      documentDigest: sha("all"),
      comparable: all,
      k: 16n,
      numeric: none,
    };
    const S = schemaIdOf(T16);
    const vals = (p: string) =>
      Array.from({ length: SLOTS }, (_, i) => digestValue(`${p}${i}`));
    const X = sealFields(vals("x"), sha("x"), sha("jx"));
    const Y = sealFields(vals("y"), sha("y"), sha("jy"));
    const s = new ClaimsSimulator();
    s.call(
      { first: X, second: Y, terms: T16 },
      "proveDistinct",
      commitmentOf(S, X),
      commitmentOf(S, Y),
    );
    expect(s.state.lastClaimKind).toBe(ClaimKind.DISTINCT);
    const T17 = { ...T16, k: 17n };
    const S17 = schemaIdOf(T17);
    expect(() =>
      s.call(
        { first: X, second: Y, terms: T17 },
        "proveDistinct",
        commitmentOf(S17, X),
        commitmentOf(S17, Y),
      ),
    ).toThrow(/enough comparable/);
  });

  it("OPEN-A11: fields.ts still mints schema ids no circuit can satisfy (k >= 256)", () => {
    const bad = { ...TERMS, k: 300n };
    expect(() => schemaIdOf(bad)).not.toThrow();
    const S = schemaIdOf(bad);
    expect(() =>
      new ClaimsSimulator({ terms: bad }).call(
        { first: A.fs, second: B.fs },
        "proveDistinct",
        commitmentOf(S, A.fs),
        commitmentOf(S, B.fs),
      ),
    ).toThrow();
  });

  it("OPEN-A12: distinctness counts byte inequality, so one genotype written two ways counts as a difference", () => {
    const flip = (g: string) => g.split("/").reverse().join("/");
    const X = make(BASE, 9650n, "X");
    const Y = make(
      BASE.map((g, i) => (i === 1 || i === 3 || i === 4 ? flip(g) : g)),
      9650n,
      "Y",
    );
    const s = sim();
    s.call(
      {
        first: X.fs,
        second: Y.fs,
        attester: lab.key,
        signature: signRecord(lab.secret, X.c),
        secondSignature: signRecord(lab.secret, Y.c),
      },
      "proveAttestedDistinct",
      X.c,
      Y.c,
    );
    expect(s.state.lastClaimKind).toBe(ClaimKind.DISTINCT);
  });

  it("DEFENCE: numberBytes/maskBytes/countBytes are injective over their domains", () => {
    const seen = new Set<string>();
    for (const n of [0n, 1n, 255n, 256n, 65535n, (1n << 64n) - 1n]) {
      const h = hex(CC.numberBytes(n));
      expect(seen.has(h)).toBe(false);
      seen.add(h);
      expect(CC.numberBytes(n)[8]).toBe(1);
      expect(hex(CC.countBytes(n))).not.toBe(h);
    }
    const m1 = Array.from({ length: SLOTS }, (_, i) => i === 15);
    const m2 = Array.from({ length: SLOTS }, (_, i) => i === 14);
    expect(hex(CC.maskBytes(m1))).not.toBe(hex(CC.maskBytes(m2)));
  });
});
