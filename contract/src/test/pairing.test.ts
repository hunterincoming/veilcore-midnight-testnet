// Bound DNA pairings (src/pairing.ts, verifier rule 9): the binding uses the contract's
// own hash layout, a copied binding fails for any other identity, a wrong salt or report
// fails, a raw pairing is refused, and verification holds across rotation and recovery.
// The contract is unchanged: these run the live pairDna circuit.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from "@midnight-ntwrk/compact-runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptPairing } from "../verify.js";
import {
  DNA_PAIR_TAG,
  dnaPairBinding,
  pairingEvidence,
  readPairingEvidence,
  reportHashOf,
  tag32,
  taggedHash,
} from "../pairing.js";
import {
  C,
  T0,
  VeilcoreSimulator,
  as,
  freshRecovery,
  hex,
  secret,
} from "./veilcore-simulator.js";

const A = secret("pair-A"),
  B = secret("pair-B");
const A_REC = C.commit(A),
  B_REC = C.commit(B);
const REPORT = new TextEncoder().encode(
  "Certificate of analysis, lot 7 (test data)",
);
const REPORT_HASH = reportHashOf(REPORT);
const SALT = secret("pair-salt");

let sim: VeilcoreSimulator;
beforeEach(() => {
  sim = new VeilcoreSimulator();
  sim.call(as(A), "anchor", freshRecovery());
  sim.call(as(B), "anchor", freshRecovery());
});

/** The block time the simulator gives a call, in ms, as an indexer reports it. */
const landed = (): number => Number(sim.now) * 1000;

describe("the binding uses the contract's hash convention", () => {
  it("is Compact's persistentHash<Vector<4, Bytes<32>>> over pad(32, tag) and the three inputs", () => {
    const x = secret("x"),
      y = secret("y"),
      z = secret("z");
    const compact = persistentHash(
      new CompactTypeVector(4, new CompactTypeBytes(32)),
      [tag32(DNA_PAIR_TAG), x, y, z],
    );
    expect(hex(dnaPairBinding(x, y, z))).toBe(hex(compact));
  });

  it("taggedHash is the layout the compiled contract uses for its own four-element hash (obligationKey)", () => {
    const x = secret("x"),
      y = secret("y"),
      z = secret("z");
    expect(hex(taggedHash("veilcore:v1:obligation", x, y, z))).toBe(
      hex(C.obligationKey(x, y, z)),
    );
    expect(hex(taggedHash("veilcore:v1:commit", x))).toBe(hex(C.commit(x)));
  });

  it("is plain SHA-256 over the 128 bytes, and its tag is its own domain", () => {
    const t = Buffer.alloc(32);
    t.write("veilcore:v1:dnapair", "utf8");
    const plain = createHash("sha256")
      .update(Buffer.concat([t, REPORT_HASH, A_REC, SALT]))
      .digest("hex");
    expect(hex(dnaPairBinding(REPORT_HASH, A_REC, SALT))).toBe(plain);
    // Same inputs, the contract's other four-element hash: a different value.
    expect(hex(dnaPairBinding(REPORT_HASH, A_REC, SALT))).not.toBe(
      hex(C.obligationKey(REPORT_HASH, A_REC, SALT)),
    );
    for (const other of [
      "veilcore:v1:commit",
      "veilcore:v1:recover",
      "veilcore:v1:license",
      "veilcore:v1:lickey",
      "veilcore:v1:present",
      "veilcore:v1:obligation",
    ])
      expect(DNA_PAIR_TAG).not.toBe(other);
    expect(Buffer.byteLength(DNA_PAIR_TAG)).toBeLessThan(32);
  });

  it("refuses inputs that are not 32 bytes", () => {
    expect(() =>
      dnaPairBinding(REPORT_HASH, A_REC, new Uint8Array(31)),
    ).toThrow(/32 bytes/);
  });
});

describe("rule 9: a bound pairing", () => {
  const pairA = () => {
    const binding = dnaPairBinding(REPORT_HASH, A_REC, SALT);
    sim.call(as(A), "pairDna", binding);
    return { after: sim.state, at: landed(), binding };
  };

  it("is accepted for the holder's record, report and salt, dated by its block", () => {
    sim.advance(100n);
    const { after, at } = pairA();
    const v = acceptPairing(
      after,
      { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
      { landedAt: at, blockHeight: 7 },
    );
    expect(v.accepted).toBe(true);
    expect(v.pairedAt).toBe(Number(T0 + 100n) * 1000);
    expect(v.reason).toMatch(/had this report by block 7, /);
    expect(v.reason).toMatch(/does not show who controls the record now/);
  });

  it("nothing about the report is on chain: only the binding", () => {
    const { after, binding } = pairA();
    expect(hex(after.lastPairedDna)).toBe(hex(binding));
    expect(hex(after.lastPairedDna)).not.toBe(hex(REPORT_HASH));
  });

  it("a copied binding fails for any other identity, even when the copy landed FIRST", () => {
    const binding = dnaPairBinding(REPORT_HASH, A_REC, SALT);
    // B watches A's pending transaction and pairs the same 32 bytes first.
    sim.call(as(B), "pairDna", binding);
    const copied = sim.state;
    sim.advance(30n);
    sim.call(as(A), "pairDna", binding);
    const real = sim.state;
    // B cannot show it for B: the binding holds only for the identity inside it.
    const forB = acceptPairing(
      copied,
      { record: B_REC, reportHash: REPORT_HASH, salt: SALT },
      { landedAt: 1 },
    );
    expect(forB).toMatchObject({ accepted: false });
    expect(forB.reason).toMatch(/did not pair this report/);
    // Nor can B's earlier transaction be passed off as A's.
    expect(
      acceptPairing(
        copied,
        { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
        { landedAt: 1 },
      ),
    ).toMatchObject({
      accepted: false,
      reason: "that transaction paired a different record",
    });
    // A's own pairing still verifies.
    expect(
      acceptPairing(
        real,
        { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
        { landedAt: 2 },
      ).accepted,
    ).toBe(true);
  });

  it("a copier who learns the report only when it is shown can bind it to their own identity, dated later", () => {
    sim.advance(10n);
    const { after: first, at: aAt } = pairA();
    sim.advance(3600n);
    const theirs = secret("copier-salt");
    sim.call(as(B), "pairDna", dnaPairBinding(REPORT_HASH, B_REC, theirs));
    const v = acceptPairing(
      sim.state,
      { record: B_REC, reportHash: REPORT_HASH, salt: theirs },
      { landedAt: landed() },
    );
    expect(v.accepted).toBe(true);
    expect(v.pairedAt! - aAt).toBe(3600_000);
    expect(
      acceptPairing(
        first,
        { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
        { landedAt: aAt },
      ).pairedAt,
    ).toBeLessThan(v.pairedAt!);
  });

  it("a wrong salt or a different report fails", () => {
    const { after, at } = pairA();
    for (const claim of [
      { record: A_REC, reportHash: REPORT_HASH, salt: secret("other salt") },
      {
        record: A_REC,
        reportHash: reportHashOf(new TextEncoder().encode("another report")),
        salt: SALT,
      },
    ]) {
      const v = acceptPairing(after, claim, { landedAt: at });
      expect(v.accepted).toBe(false);
      expect(v.reason).toMatch(/did not pair this report, with this salt/);
    }
  });

  it("a raw report hash paired directly is refused, and says why", () => {
    sim.call(as(A), "pairDna", REPORT_HASH);
    const v = acceptPairing(
      sim.state,
      { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
      { landedAt: landed() },
    );
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(
      /raw report hash, which anyone who saw it could pair/,
    );
  });

  it("no pairing, no block time, or bad lengths: refused", () => {
    expect(
      acceptPairing(
        sim.state,
        { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
        { landedAt: 1 },
      ).reason,
    ).toBe("no pairing has been made on this contract");
    const { after } = pairA();
    expect(
      acceptPairing(
        after,
        { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
        { landedAt: undefined },
      ).reason,
    ).toMatch(/did not say when/);
    expect(
      acceptPairing(
        after,
        { record: A_REC, reportHash: REPORT_HASH, salt: new Uint8Array(16) },
        { landedAt: 1 },
      ).accepted,
    ).toBe(false);
  });
});

describe("rule 9 across rotation and recovery: the binding names the identity, not the key", () => {
  it("paired, then rotated: checked with the new record (given the state now) or the origin", () => {
    const binding = dnaPairBinding(REPORT_HASH, A_REC, SALT);
    sim.call(as(A), "pairDna", binding);
    const after = sim.state;
    const at = landed();
    const A2 = secret("pair-A2");
    sim.call(as(A, { incoming: A2 }), "rotateRecordSecret", C.commit(A2));
    const now = sim.state;
    const claim = { record: C.commit(A2), reportHash: REPORT_HASH, salt: SALT };
    expect(acceptPairing(after, claim, { landedAt: at, now }).accepted).toBe(
      true,
    );
    // Without the state now, a record made after the pairing is unknown at the pairing.
    expect(acceptPairing(after, claim, { landedAt: at }).reason).toBe(
      "that transaction paired a different record",
    );
    expect(
      acceptPairing(after, { ...claim, record: A_REC }, { landedAt: at, now })
        .accepted,
    ).toBe(true);
  });

  it("rotated, then paired from the new key: bound to the same identity (the origin)", () => {
    const A2 = secret("pair-A2b");
    sim.call(as(A, { incoming: A2 }), "rotateRecordSecret", C.commit(A2));
    sim.call(as(A2), "pairDna", dnaPairBinding(REPORT_HASH, A_REC, SALT));
    const after = sim.state;
    expect(hex(after.lastPairedRecord)).toBe(hex(C.commit(A2)));
    for (const record of [A_REC, C.commit(A2)])
      expect(
        acceptPairing(
          after,
          { record, reportHash: REPORT_HASH, salt: SALT },
          { landedAt: 1 },
        ).accepted,
      ).toBe(true);
    // A binding made for the head commitment instead of the identity does not verify.
    sim.call(
      as(A2),
      "pairDna",
      dnaPairBinding(REPORT_HASH, C.commit(A2), SALT),
    );
    expect(
      acceptPairing(
        sim.state,
        { record: A_REC, reportHash: REPORT_HASH, salt: SALT },
        { landedAt: 1 },
      ).accepted,
    ).toBe(false);
  });

  it("recovered after the pairing: still verifies, with any record of the identity", () => {
    const rcv = secret("pair-rcv");
    const C1 = secret("pair-C1");
    const C_REC = C.commit(C1);
    sim.call(as(C1), "anchor", C.recoveryCommit(rcv));
    sim.call(as(C1), "pairDna", dnaPairBinding(REPORT_HASH, C_REC, SALT));
    const after = sim.state;
    const NEW = secret("pair-C-new");
    sim.call(
      as(secret("anyone"), { recovery: rcv, incoming: NEW }),
      "recoverRecordSecret",
      C_REC,
      C.commit(NEW),
      freshRecovery(),
    );
    expect(
      acceptPairing(
        after,
        { record: C.commit(NEW), reportHash: REPORT_HASH, salt: SALT },
        { landedAt: 1, now: sim.state },
      ).accepted,
    ).toBe(true);
  });
});

describe("the evidence file", () => {
  const ev = () =>
    pairingEvidence({
      network: "preprod",
      contractAddress: "AB".repeat(32),
      txId: "0x" + "cd".repeat(32),
      identity: A_REC,
      reportHash: REPORT_HASH,
      salt: SALT,
      reportFile: "coa-lot7.pdf",
    });

  it("round-trips, with the binding stated and every value lowercase hex", () => {
    const e = ev();
    expect(e).toMatchObject({
      format: "veilcore/dna-pairing/v1",
      contractAddress: "ab".repeat(32),
      txId: "cd".repeat(32),
      record: hex(A_REC),
      binding: hex(dnaPairBinding(REPORT_HASH, A_REC, SALT)),
    });
    const r = readPairingEvidence(JSON.stringify(e));
    expect(hex(r.record)).toBe(hex(A_REC));
    expect(hex(r.reportHash)).toBe(hex(REPORT_HASH));
    expect(hex(r.salt)).toBe(hex(SALT));
    expect(r.reportFile).toBe("coa-lot7.pdf");
  });

  it("refuses an edited or malformed file", () => {
    expect(() =>
      readPairingEvidence({ ...ev(), salt: hex(secret("edited")) }),
    ).toThrow(/damaged or was edited/);
    expect(() => readPairingEvidence({ ...ev(), format: "x" })).toThrow(
      /not a pairing evidence file/,
    );
    expect(() => readPairingEvidence({ ...ev(), record: "AB" })).toThrow(
      /64 lowercase hex/,
    );
    expect(() => readPairingEvidence("{")).toThrow(/not JSON/);
  });
});
