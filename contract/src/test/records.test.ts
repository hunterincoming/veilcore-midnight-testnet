// Records: anchoring, ownership, rotation and recovery, including the attacks from the
// 30 Sep security pass (docs/security-pass-30sep.md). SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  C,
  VeilcoreSimulator,
  ZERO,
  as,
  hex,
  secret,
} from "./veilcore-simulator.js";

const A = secret("breeder-A"),
  B = secret("breeder-B"),
  Cs = secret("breeder-C"),
  D = secret("breeder-D");
const RECOVERY = secret("recovery"),
  THIEF = secret("thief");
const A_REC = C.commit(A),
  B_REC = C.commit(B),
  C_REC = C.commit(Cs),
  D_REC = C.commit(D);

let sim: VeilcoreSimulator;
const anchorA = (): void =>
  sim.call(as(A), "anchor", C.recoveryCommit(RECOVERY));

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

describe("anchoring and ownership", () => {
  it("anchors the caller's own record and proves ownership of it", () => {
    anchorA();
    expect(hex(sim.state.lastAnchor)).toBe(hex(A_REC));
    sim.call(as(A), "proveOwnership");
    expect(hex(sim.state.lastOwnershipProof)).toBe(hex(A_REC));
  });

  it("cannot anchor twice", () => {
    anchorA();
    expect(() => anchorA()).toThrow("already anchored");
  });

  it("pairs a DNA fingerprint to the caller's record, not anyone else's", () => {
    anchorA();
    sim.call(as(D), "anchor", C.recoveryCommit(secret("rd")));
    sim.call(as(D), "pairDna", secret("dna"));
    expect(hex(sim.state.lastPairedRecord)).toBe(hex(D_REC));
    expect(hex(sim.state.lastAnchor)).toBe(hex(D_REC)); // pairDna did not write the anchor cell
  });

  it("refuses empty inputs everywhere", () => {
    expect(() => sim.call(as(A), "anchor", ZERO)).toThrow("cannot be empty");
    expect(() => sim.call(as(A), "anchor", C.recoveryCommit(ZERO))).toThrow(
      "all-zero secret",
    );
    anchorA();
    expect(() => sim.call(as(A), "anchorBatch", ZERO)).toThrow(
      "cannot be empty",
    );
    expect(() => sim.call(as(A), "pairDna", ZERO)).toThrow("cannot be empty");
    expect(() =>
      sim.call(
        as(secret("n"), { recovery: RECOVERY }),
        "replaceRecoveryCommitment",
        A_REC,
        ZERO,
      ),
    ).toThrow("cannot be empty");
    expect(() =>
      sim.call(
        as(secret("n"), { recovery: RECOVERY }),
        "replaceRecoveryCommitment",
        A_REC,
        C.recoveryCommit(ZERO),
      ),
    ).toThrow("all-zero secret");
  });

  it("keeps recovery and record commitments in different domains", () => {
    expect(hex(C.recoveryCommit(RECOVERY))).not.toBe(hex(C.commit(RECOVERY)));
  });
});

describe("rotation", () => {
  it("retires the old secret and keeps the identity", () => {
    anchorA();
    sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC);
    expect(() => sim.call(as(A), "proveOwnership")).toThrow(
      "rotated or recovered",
    );
    sim.call(as(B), "proveOwnership");
    expect(hex(sim.state.headOf.lookup(A_REC))).toBe(hex(B_REC));
  });

  it("requires holding the new secret", () => {
    anchorA();
    expect(() =>
      sim.call(
        as(A, { incoming: secret("other") }),
        "rotateRecordSecret",
        B_REC,
      ),
    ).toThrow("hold the secret");
  });

  it("an unanchored record can do nothing but anchor, so it carries no history into an identity", () => {
    expect(() => sim.call(as(D), "proveOwnership")).toThrow(
      "only for anchored records",
    );
    expect(() => sim.call(as(D), "pairDna", secret("dna"))).toThrow(
      "only for anchored records",
    );
    expect(() =>
      sim.call(as(D), "issueLicense", C.licenseCommit(secret("l"), D_REC)),
    ).toThrow("only for anchored records");
    expect(() => sim.call(as(D), "encumberOwnRecord", secret("o"))).toThrow(
      "only for anchored records",
    );
    expect(() =>
      sim.call(as(D, { incoming: B }), "rotateRecordSecret", B_REC),
    ).toThrow("Anchor this record before rotating it");
    sim.call(as(D), "anchor", C.recoveryCommit(secret("r")));
    sim.call(as(D, { incoming: B }), "rotateRecordSecret", B_REC);
  });

  it("cannot move into a commitment with history, so identities never merge", () => {
    anchorA();
    sim.call(as(D), "anchor", C.recoveryCommit(secret("rd")));
    sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC);
    expect(() =>
      sim.call(as(D, { incoming: B }), "rotateRecordSecret", B_REC),
    ).toThrow("already a successor");
    expect(() =>
      sim.call(as(B, { incoming: D }), "rotateRecordSecret", D_REC),
    ).toThrow("already an anchored record");
    expect(() =>
      sim.call(as(B, { incoming: A }), "rotateRecordSecret", A_REC),
    ).toThrow();
  });

  it("does not let a successor re-anchor", () => {
    anchorA();
    sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC);
    expect(() =>
      sim.call(as(B), "anchor", C.recoveryCommit(secret("r"))),
    ).toThrow("successor");
  });
});

describe("recovery", () => {
  it("beats a thief who rotated first", () => {
    anchorA();
    sim.call(as(A, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    sim.call(
      as(secret("nothing"), { incoming: Cs, recovery: RECOVERY }),
      "recoverRecordSecret",
      A_REC,
      C_REC,
    );
    expect(hex(sim.state.headOf.lookup(A_REC))).toBe(hex(C_REC));
    expect(() => sim.call(as(THIEF), "proveOwnership")).toThrow(
      "rotated or recovered",
    );
    sim.call(as(Cs), "proveOwnership");
  });

  it("survives rotation (the original recovery secret still works)", () => {
    anchorA();
    sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC);
    sim.call(
      as(secret("lost"), { incoming: Cs, recovery: RECOVERY }),
      "recoverRecordSecret",
      A_REC,
      C_REC,
    );
    expect(() => sim.call(as(B), "proveOwnership")).toThrow(
      "rotated or recovered",
    );
  });

  it("refuses a wrong recovery secret, the zero secret, and a successor named as the origin", () => {
    anchorA();
    expect(() =>
      sim.call(
        as(secret("n"), { incoming: Cs, recovery: secret("guess") }),
        "recoverRecordSecret",
        A_REC,
        C_REC,
      ),
    ).toThrow("not the recovery secret");
    expect(() =>
      sim.call(
        as(secret("n"), { incoming: Cs, recovery: ZERO }),
        "recoverRecordSecret",
        A_REC,
        C_REC,
      ),
    ).toThrow("not the recovery secret");
    sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC);
    expect(() =>
      sim.call(
        as(secret("n"), { incoming: Cs, recovery: RECOVERY }),
        "recoverRecordSecret",
        B_REC,
        C_REC,
      ),
    ).toThrow("only for an anchored origin");
  });

  it("lets the recovery holder replace a leaked recovery secret, and nobody else", () => {
    anchorA();
    const R2 = secret("recovery-2");
    expect(() =>
      sim.call(
        as(A, { recovery: A }),
        "replaceRecoveryCommitment",
        A_REC,
        C.recoveryCommit(secret("evil")),
      ),
    ).toThrow("not the recovery secret");
    sim.call(
      as(secret("n"), { recovery: RECOVERY }),
      "replaceRecoveryCommitment",
      A_REC,
      C.recoveryCommit(R2),
    );
    expect(() =>
      sim.call(
        as(secret("n"), { incoming: Cs, recovery: RECOVERY }),
        "recoverRecordSecret",
        A_REC,
        C_REC,
      ),
    ).toThrow();
    sim.call(
      as(secret("n"), { incoming: Cs, recovery: R2 }),
      "recoverRecordSecret",
      A_REC,
      C_REC,
    );
  });

  it("cannot be starved: a recovery proved before the thief rotates again still lands", () => {
    anchorA();
    const T1 = secret("t1"),
      T2 = secret("t2"),
      NEW = secret("owner-new");
    sim.call(as(A, { incoming: T1 }), "rotateRecordSecret", C.commit(T1));
    const recovery = sim.prove(
      as(secret("lost"), { incoming: NEW, recovery: RECOVERY }),
      "recoverRecordSecret",
      A_REC,
      C.commit(NEW),
    );
    sim.call(as(T1, { incoming: T2 }), "rotateRecordSecret", C.commit(T2));
    sim.land(recovery);
    expect(hex(sim.state.headOf.lookup(A_REC))).toBe(hex(C.commit(NEW)));
    expect(() => sim.call(as(T2), "proveOwnership")).toThrow(
      "rotated or recovered",
    );
  });
});
