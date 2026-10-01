// Second adversarial pass on the per-identity state bounds, after the F1-F7 patches
// (lastIssuedLicense, lastProposed*, rotation reset on recovery, activeLicensesBy).
// "BREAKS" tests demonstrate a finding; "HOLDS" tests pin a property that survived.
// The owner is assumed to learn values only from the per-transaction event cells
// (every exported ledger field named last*), as the brief for this pass states.
//
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { openObligations } from "../verify.js";
import { C, VeilcoreSimulator, as, hex, secret } from "./veilcore-simulator.js";

const A = secret("rb-A"),
  A_REC = C.commit(A);
const B = secret("rb-B"),
  B_REC = C.commit(B);
const T = secret("rb-thief-own"), // a record the thief anchors for himself
  T_REC = C.commit(T);
const anyone = as(secret("rb-anyone"));
const rcv = (s: Uint8Array): Uint8Array => secret(`rb-rcv-${hex(s)}`);

let sim: VeilcoreSimulator;
const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(rcv(s)));
};
let recN = 0;
/** The owner of A takes the identity back with the current recovery secret. */
let curRecovery: Uint8Array;
const ownerRecovers = (): Uint8Array => {
  const back = secret(`rb-owner-back-${recN}`);
  const next = secret(`rb-rcv-next-${recN++}`);
  sim.call(
    as(secret("rb-whoever"), { incoming: back, recovery: curRecovery }),
    "recoverRecordSecret",
    A_REC,
    C.commit(back),
    C.recoveryCommit(next),
  );
  curRecovery = next;
  return back;
};
/** Every event cell (ledger field named last*) as hex, for "did the indexer show X". */
const eventCells = (): string[] => {
  const st = sim.state as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(Object.getPrototypeOf(st) ?? {}).concat(
    Object.keys(st),
  )) {
    if (!k.startsWith("last")) continue;
    const v = st[k];
    if (v instanceof Uint8Array) out.push(hex(v));
  }
  return out;
};
const appears = (
  hay: unknown,
  needle: Uint8Array,
  seen = new Set<unknown>(),
): boolean => {
  if (hay === null || typeof hay !== "object" || seen.has(hay)) return false;
  seen.add(hay);
  if (hay instanceof Uint8Array) return hex(hay).includes(hex(needle));
  return Object.values(hay as Record<string, unknown>).some((v) =>
    appears(v, needle, seen),
  );
};

beforeEach(() => {
  sim = new VeilcoreSimulator();
  [A, B, T].forEach(anchor);
  curRecovery = rcv(A);
});

// ───────────────────────────────────────────── findings

describe("FIXED: what a thief fills, the recovered owner can work around or clean", () => {
  it("R1 obligations in force: after a thief fills 16 owed to himself, each recovery gives the record 16 more", () => {
    for (let round = 0; round < 2; round++) {
      const os = Array.from({ length: 8 }, (_, i) =>
        secret(`rb-r1-${round}-${i}`),
      );
      os.forEach((o) => sim.call(as(T), "proposeObligation", A_REC, o));
      os.forEach((o) => sim.call(as(A), "acceptObligation", o, T_REC)); // thief, as A
    }
    expect(openObligations(sim.state, A_REC)).toBe(16n);
    expect(() =>
      sim.call(as(A), "encumberOwnRecord", secret("rb-r1-more")),
    ).toThrow("most obligations");
    const back = ownerRecovers();
    // The thief's 16 stand (only their beneficiary can release them: a documented limit),
    // but the record can take genuine obligations again.
    sim.call(as(back), "encumberOwnRecord", secret("rb-r1-real"));
    const real = secret("rb-r1-real-claim");
    sim.call(as(B), "proposeObligation", A_REC, real);
    sim.call(as(back), "acceptObligation", real, B_REC);
    expect(openObligations(sim.state, A_REC)).toBe(18n);
  });

  it("R2 active licences: an approved transfer publishes the new commitment, so the recovered owner revokes it", () => {
    const l = secret("rb-r2-thief-l");
    const lc = C.licenseCommit(l, A_REC);
    sim.call(as(A), "issueLicense", lc); // thief, as A
    sim.withLicence({ secret: l, record: A_REC }, () =>
      sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
    );
    const l2 = secret("rb-r2-hidden");
    const nlc = C.licenseCommit(l2, A_REC);
    sim.withLicence({ secret: l, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(A), "approveTransfer", lc, A_REC, nlc); // thief approves as issuer
    expect(eventCells().some((c) => c.includes(hex(nlc)))).toBe(true);
    const published = sim.state.lastTransferredLicense;
    const back = ownerRecovers();
    sim.call(as(back), "revokeLicense", published, A_REC);
    expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(0n);
  });
});

describe("DOCUMENTED LIMIT: parents a thief confirms stay", () => {
  it("R3 (= F4) two thief-confirmed parents fill MAX_PARENTS for good; withdrawParent cannot touch confirmed edges", () => {
    const J1 = secret("rb-jp-1"),
      J2 = secret("rb-jp-2");
    [J1, J2].forEach(anchor);
    for (const J of [J1, J2]) {
      sim.call(as(A), "proposeParent", C.commit(J));
      sim.call(as(J), "confirmParent", A_REC);
    }
    const back = ownerRecovers();
    expect(() => sim.call(as(back), "withdrawParent")).toThrow(
      "No parentage proposed",
    );
    expect(() => sim.call(as(back), "proposeParent", B_REC)).toThrow(
      "already has two parents",
    );
  });
});

describe("Privacy of the new event cells", () => {
  it("P1 lastIssuedLicense adds nothing linkable that the issue transcript did not already carry: the key and the issuing record were public", () => {
    const l = secret("rb-p1");
    const lc = C.licenseCommit(l, A_REC);
    const p = sim.prove(as(A), "issueLicense", lc);
    expect(appears(p.transcript, C.licenseKey(lc, A_REC))).toBe(true); // key, as before
    expect(appears(p.transcript, A_REC)).toBe(true); // issuing record, as before
    sim.land(p);
    // The presentation still names neither lc, the key, nor the record.
    sim.withLicence({ secret: l, record: A_REC }, () =>
      sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
    );
    const pr = sim.withLicence(
      { secret: l, record: A_REC, challenge: secret("rb-p1-ch") },
      () => sim.prove(anyone, "proveLicense"),
    );
    for (const v of [lc, C.licenseKey(lc, A_REC), A_REC])
      expect(appears(pr.transcript, v)).toBe(false);
  });

  it("P2 lastProposedObligation is NEW disclosure for proposals that are rejected: before, o never left the circuit", () => {
    const o = secret("rb-p2-o");
    const p = sim.prove(as(B), "proposeObligation", A_REC, o);
    expect(appears(p.transcript, o)).toBe(true); // via lastProposedObligation only
    sim.land(p);
    const r = sim.prove(as(A), "rejectObligation", o, B_REC);
    expect(appears(r.transcript, o)).toBe(false); // reject does not publish it
    expect(hex(sim.state.lastProposedObligation)).toBe(hex(o)); // but the proposal already did
  });
});

// ───────────────────────────────────────────── what held

describe("HOLDS", () => {
  it("pending licences issued after a thief's rotation: lastIssuedLicense omits the issuing record, but lastRotatedTo gives the candidates and the owner revokes", () => {
    const A2 = secret("rb-thief-rot");
    sim.call(as(A, { incoming: A2 }), "rotateRecordSecret", C.commit(A2));
    const heads = [A_REC, sim.state.lastRotatedTo]; // all the owner's identity heads, from events
    const lc = C.licenseCommit(secret("rb-h1"), C.commit(A2));
    sim.call(as(A2), "issueLicense", lc);
    const seenLc = sim.state.lastIssuedLicense;
    const back = ownerRecovers();
    expect(() => sim.call(as(back), "revokeLicense", seenLc, A_REC)).toThrow(
      "No such license",
    );
    const rc = heads.find((h) =>
      sim.state.licenseStatusOf.member(C.licenseKey(seenLc, h)),
    )!;
    sim.call(as(back), "revokeLicense", seenLc, rc);
    expect(sim.state.pendingLicensesBy.lookup(A_REC).read()).toBe(0n);
  });

  it("activeLicensesBy: countersign after issuer rotation and recovery, revoke by the recovered head, transfer: stays in step, never underflows", () => {
    const l1 = secret("rb-a1"),
      l2 = secret("rb-a2");
    const lc1 = C.licenseCommit(l1, A_REC),
      lc2 = C.licenseCommit(l2, A_REC);
    sim.call(as(A), "issueLicense", lc1);
    sim.call(as(A), "issueLicense", lc2);
    const A2 = secret("rb-a-rot");
    sim.call(as(A, { incoming: A2 }), "rotateRecordSecret", C.commit(A2));
    sim.withLicence({ secret: l1, record: A_REC }, () =>
      sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
    );
    const back = ownerRecovers();
    sim.withLicence({ secret: l2, record: A_REC }, () =>
      sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
    );
    expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(2n);
    expect(sim.state.activeLicensesBy.member(C.commit(A2))).toBe(false);
    const nlc = C.licenseCommit(secret("rb-a3"), A_REC);
    sim.withLicence({ secret: l2, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(back), "approveTransfer", lc2, A_REC, nlc);
    sim.call(as(back), "revokeLicense", lc1, A_REC);
    sim.call(as(back), "revokeLicense", nlc, A_REC);
    expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(0n);
    expect(sim.state.pendingLicensesBy.lookup(A_REC).read()).toBe(0n);
    expect(() => sim.call(as(back), "revokeLicense", nlc, A_REC)).toThrow(
      "No such license",
    );
  });

  it("a licensee cannot raise the issuer's active count: one pending licence activates once, a transfer adds nothing", () => {
    const l = secret("rb-lic");
    sim.call(as(A), "issueLicense", C.licenseCommit(l, A_REC));
    sim.withLicence({ secret: l, record: A_REC }, () =>
      sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
    );
    expect(() =>
      sim.withLicence({ secret: l, record: A_REC }, () =>
        sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
      ),
    ).toThrow("not pending");
    expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(1n);
  });

  it("rotation reset cannot grow originOf past 16*17+16 = 288 entries per identity", () => {
    const before = sim.state.originOf.size();
    let head = A;
    const rotateAll = (): void => {
      for (let i = 0; i < 16; i++) {
        const n = secret(`rb-cyc-${recN}-${i}`);
        sim.call(as(head, { incoming: n }), "rotateRecordSecret", C.commit(n));
        head = n;
      }
      const n = secret(`rb-cyc-x-${recN}`);
      expect(() =>
        sim.call(as(head, { incoming: n }), "rotateRecordSecret", C.commit(n)),
      ).toThrow("used all its rotations");
    };
    rotateAll();
    for (let r = 0; r < 16; r++) {
      head = ownerRecovers();
      rotateAll();
    }
    expect(() => ownerRecovers()).toThrow("used all its recoveries");
    expect(sim.state.originOf.size() - before).toBe(288n);
  }, 120_000);
});
