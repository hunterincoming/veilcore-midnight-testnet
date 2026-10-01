// Attacker pass: records, identity, rotation, recovery. SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import {
  C,
  VeilcoreSimulator,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";
import { isLive, identityOf, commitmentsOf } from "../verify.js";

const A = secret("atk-A"),
  B = secret("atk-B"),
  RCV = secret("atk-recovery"),
  RCV_B = secret("atk-recovery-B"),
  THIEF = secret("atk-thief"),
  THIEF2 = secret("atk-thief-2"),
  OWNER_NEW = secret("atk-owner-new"),
  THIEF_RCV = secret("atk-thief-rcv");
const A_REC = C.commit(A),
  B_REC = C.commit(B);

let sim: VeilcoreSimulator;
beforeEach(() => {
  sim = new VeilcoreSimulator();
  sim.call(as(A), "anchor", C.recoveryCommit(RCV));
});

describe("recovery secret is multi-use and stays valid after a recovery", () => {
  it.fails(
    "anyone who saw the recovery secret during a recovery can take the identity back and lock the owner out",
    () => {
      // Thief steals A's record secret and rotates.
      sim.call(
        as(A, { incoming: THIEF }),
        "rotateRecordSecret",
        C.commit(THIEF),
      );
      // Owner recovers. The recovery secret is typed into an online client to do it.
      sim.call(
        as(secret("x"), { recovery: RCV, incoming: OWNER_NEW }),
        "recoverRecordSecret",
        A_REC,
        C.commit(OWNER_NEW),
        freshRecovery(),
      );
      expect(isLive(sim.state, C.commit(OWNER_NEW))).toBe(true);
      // The same recovery secret still works: recovery did not consume or replace it.
      sim.call(
        as(secret("y"), { recovery: RCV, incoming: THIEF2 }),
        "recoverRecordSecret",
        A_REC,
        C.commit(THIEF2),
        freshRecovery(),
      );
      sim.call(
        as(secret("y"), { recovery: RCV }),
        "replaceRecoveryCommitment",
        A_REC,
        C.recoveryCommit(THIEF_RCV),
      );
      expect(isLive(sim.state, C.commit(THIEF2))).toBe(true);
      // Owner is now locked out permanently.
      expect(() =>
        sim.call(
          as(secret("z"), { recovery: RCV, incoming: secret("owner-3") }),
          "recoverRecordSecret",
          A_REC,
          C.commit(secret("owner-3")),
          freshRecovery(),
        ),
      ).toThrow("not the recovery secret");
    },
  );
});

describe("forking an identity", () => {
  it("a thief's rotation proved before a recovery cannot land after it", () => {
    sim.call(as(A, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    const pending = sim.prove(
      as(THIEF, { incoming: THIEF2 }),
      "rotateRecordSecret",
      C.commit(THIEF2),
    );
    sim.call(
      as(secret("x"), { recovery: RCV, incoming: OWNER_NEW }),
      "recoverRecordSecret",
      A_REC,
      C.commit(OWNER_NEW),
      freshRecovery(),
    );
    expect(() => sim.land(pending)).toThrow();
    expect(hex(sim.state.headOf.lookup(A_REC))).toBe(hex(C.commit(OWNER_NEW)));
  });

  it("a recovery proved before a thief's rotation still lands, with one head", () => {
    const rec = sim.prove(
      as(secret("x"), { recovery: RCV, incoming: OWNER_NEW }),
      "recoverRecordSecret",
      A_REC,
      C.commit(OWNER_NEW),
      freshRecovery(),
    );
    sim.call(as(A, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    sim.land(rec);
    expect(isLive(sim.state, C.commit(OWNER_NEW))).toBe(true);
    expect(isLive(sim.state, C.commit(THIEF))).toBe(false);
    expect(isLive(sim.state, A_REC)).toBe(false);
  });

  it("two rotations from one head: the second cannot land", () => {
    const p1 = sim.prove(
      as(A, { incoming: THIEF }),
      "rotateRecordSecret",
      C.commit(THIEF),
    );
    const p2 = sim.prove(
      as(A, { incoming: THIEF2 }),
      "rotateRecordSecret",
      C.commit(THIEF2),
    );
    sim.land(p1);
    expect(() => sim.land(p2)).toThrow();
  });
});

describe("merging and squatting", () => {
  beforeEach(() => {
    sim.call(as(B), "anchor", C.recoveryCommit(RCV_B));
  });
  it("cannot recover or rotate into another identity's origin or successor", () => {
    expect(() =>
      sim.call(
        as(secret("x"), { recovery: RCV, incoming: B }),
        "recoverRecordSecret",
        A_REC,
        B_REC,
        freshRecovery(),
      ),
    ).toThrow();
    sim.call(as(B, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    expect(() =>
      sim.call(
        as(secret("x"), { recovery: RCV, incoming: THIEF }),
        "recoverRecordSecret",
        A_REC,
        C.commit(THIEF),
        freshRecovery(),
      ),
    ).toThrow("already a successor");
    expect(() =>
      sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC),
    ).toThrow();
  });
  it("cannot recover back into a retired commitment of the same identity", () => {
    sim.call(as(A, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    expect(() =>
      sim.call(
        as(secret("x"), { recovery: RCV, incoming: A }),
        "recoverRecordSecret",
        A_REC,
        A_REC,
        freshRecovery(),
      ),
    ).toThrow();
  });
  it("recovery only takes an origin, not a successor", () => {
    sim.call(as(A, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    expect(() =>
      sim.call(
        as(secret("x"), { recovery: RCV, incoming: OWNER_NEW }),
        "recoverRecordSecret",
        C.commit(THIEF),
        C.commit(OWNER_NEW),
        freshRecovery(),
      ),
    ).toThrow("only for an anchored origin");
  });
});

describe("retired commitments", () => {
  it("a retired origin or successor can do nothing, including re-anchoring", () => {
    sim.call(as(A, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    sim.call(
      as(THIEF, { incoming: THIEF2 }),
      "rotateRecordSecret",
      C.commit(THIEF2),
    );
    for (const old of [A, THIEF]) {
      expect(() =>
        sim.call(as(old), "anchor", C.recoveryCommit(secret("r"))),
      ).toThrow();
      expect(() => sim.call(as(old), "proveOwnership")).toThrow();
      expect(() => sim.call(as(old), "pairDna", secret("d"))).toThrow();
      expect(() =>
        sim.call(
          as(old, { incoming: secret("n") }),
          "rotateRecordSecret",
          C.commit(secret("n")),
        ),
      ).toThrow();
      expect(() => sim.call(as(old), "issueLicense", secret("lc"))).toThrow();
      expect(() =>
        sim.call(as(old), "encumberOwnRecord", secret("o")),
      ).toThrow();
    }
    expect(hex(identityOf(sim.state, C.commit(THIEF2)))).toBe(hex(A_REC));
    expect(commitmentsOf(sim.state, A_REC).length).toBe(3);
  });

  it("an unanchored commitment cannot rotate", () => {
    expect(() =>
      sim.call(
        as(B, { incoming: THIEF }),
        "rotateRecordSecret",
        C.commit(THIEF),
      ),
    ).toThrow("Anchor this record");
  });
});

describe("recovery commitment copying", () => {
  it("anyone can anchor with another identity's public recovery commitment (harmless to the copied party)", () => {
    sim.call(as(B), "anchor", sim.state.recoveryOf.lookup(A_REC));
    // A's recovery secret now also controls B's identity: only B is exposed.
    sim.call(
      as(secret("x"), { recovery: RCV, incoming: OWNER_NEW }),
      "recoverRecordSecret",
      B_REC,
      C.commit(OWNER_NEW),
      freshRecovery(),
    );
    expect(isLive(sim.state, B_REC)).toBe(false);
  });
});
