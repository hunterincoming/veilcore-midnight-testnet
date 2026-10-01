// Adversarial review of the per-identity state bounds (rotationsOf, recoveriesOf,
// pendingObligationsBy, pendingLicensesBy, obligation and parent caps, rootsSinceSeal).
// "BREAKS" tests demonstrate a finding; "HOLDS" tests pin a property that survived.
//
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { openObligations } from "../verify.js";
import { C, VeilcoreSimulator, as, hex, secret } from "./veilcore-simulator.js";

const A = secret("ab-A"),
  A_REC = C.commit(A);
const B = secret("ab-B"),
  B_REC = C.commit(B);
const T = secret("ab-thief-own"), // a record the thief anchors for himself
  T_REC = C.commit(T);
const anyone = as(secret("ab-anyone"));
const rcv = (s: Uint8Array): Uint8Array => secret(`ab-rcv-${hex(s)}`);

let sim: VeilcoreSimulator;
const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(rcv(s)));
};
const issueAs = (head: Uint8Array, l: Uint8Array): Uint8Array => {
  const lc = C.licenseCommit(l, C.commit(head));
  sim.call(as(head), "issueLicense", lc);
  return lc;
};
const countersign = (l: Uint8Array, rec: Uint8Array): void =>
  sim.withLicence({ secret: l, record: rec }, () =>
    sim.call(anyone, "countersignLicense", rec, sim.freeSlot()),
  );
/** The owner of A takes the identity back with the recovery secret. Returns the new head secret. */
const ownerRecovers = (): Uint8Array => {
  const back = secret("ab-owner-back");
  sim.call(
    as(secret("ab-whoever"), { incoming: back, recovery: rcv(A) }),
    "recoverRecordSecret",
    A_REC,
    C.commit(back),
    C.recoveryCommit(secret("ab-rcv-next")),
  );
  return back;
};
/** Whether `needle` appears anywhere in a transcript / effects object. */
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
const historyLen = (): number => {
  let n = 0;
  const it = sim.state.activeLicenses.history();
  while (!it.next().done) n++;
  return n;
};

beforeEach(() => {
  sim = new VeilcoreSimulator();
  [A, B, T].forEach(anchor);
});

// ───────────────────────────────────────────── findings

describe("FIXED: a thief with the head key can no longer use up the owner's caps for good", () => {
  it("F1 pending licences: issue publishes each commitment, so the recovered owner revokes the junk and issues again", () => {
    const junk = Array.from({ length: 32 }, (_, i) => secret(`ab-junk-l-${i}`));
    const lc0 = C.licenseCommit(junk[0], A_REC);
    const p = sim.prove(as(A), "issueLicense", lc0);
    expect(appears(p.transcript, lc0)).toBe(true); // now published
    const published: Uint8Array[] = [];
    for (const l of junk) {
      issueAs(A, l); // thief, holding A's head secret
      published.push(sim.state.lastIssuedLicense); // what the indexer shows per tx
    }
    const back = ownerRecovers();
    expect(() => issueAs(back, secret("ab-real-licence"))).toThrow(
      "Too many licences waiting",
    );
    published.forEach((lc) => sim.call(as(back), "revokeLicense", lc, A_REC));
    expect(sim.state.pendingLicensesBy.lookup(A_REC).read()).toBe(0n);
    issueAs(back, secret("ab-real-licence"));
  });

  it("F2 pending obligation proposals: each publishes what, against whom and by whom, so the recovered owner withdraws them", () => {
    const junk = Array.from({ length: 8 }, (_, i) => secret(`ab-junk-o-${i}`));
    const seen: Array<[Uint8Array, Uint8Array]> = [];
    for (const o of junk) {
      sim.call(as(A), "proposeObligation", T_REC, o);
      expect(sim.state.lastProposedBy).toEqual(A_REC);
      seen.push([
        sim.state.lastProposedAgainst,
        sim.state.lastProposedObligation,
      ]);
    }
    const back = ownerRecovers();
    expect(() =>
      sim.call(as(back), "proposeObligation", B_REC, secret("ab-real-claim")),
    ).toThrow("too many proposals waiting");
    seen.forEach(([r, o]) => sim.call(as(back), "withdrawObligation", r, o));
    expect(sim.state.pendingObligationsBy.lookup(A_REC).read()).toBe(0n);
    sim.call(as(back), "proposeObligation", B_REC, secret("ab-real-claim"));
  });

  it("F3 rotations: a thief spends all 16; recovery gives the owner a fresh 16", () => {
    let cur = A;
    for (let i = 0; i < 16; i++) {
      const next = secret(`ab-thief-rot-${i}`);
      sim.call(
        as(cur, { incoming: next }),
        "rotateRecordSecret",
        C.commit(next),
      );
      cur = next;
    }
    const back = ownerRecovers();
    expect(sim.state.rotationsOf.lookup(A_REC).read()).toBe(0n);
    const n = secret("ab-owner-rot");
    sim.call(as(back, { incoming: n }), "rotateRecordSecret", C.commit(n));
  });

  it("F4 (documented limit, not fixed) parents: a thief fills both parent slots with his own records; the true parent can never be recorded", () => {
    const J1 = secret("ab-junk-parent-1"),
      J2 = secret("ab-junk-parent-2");
    [J1, J2].forEach(anchor);
    for (const J of [J1, J2]) {
      sim.call(as(A), "proposeParent", C.commit(J));
      sim.call(as(J), "confirmParent", A_REC);
    }
    const back = ownerRecovers();
    expect(() => sim.call(as(back), "proposeParent", B_REC)).toThrow(
      "already has two parents",
    );
  });
});

describe("Per-identity growth: active licences capped; root history and Sybils are documented limits", () => {
  it("F5 ACTIVE licences are counted per issuer: countersign adds one, revoking an active one removes it, transfer keeps it", () => {
    const l1 = secret("ab-cnt-1"),
      l2 = secret("ab-cnt-2");
    const lc1 = issueAs(A, l1);
    countersign(l1, A_REC);
    issueAs(A, l2);
    countersign(l2, A_REC);
    expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(2n);
    const nlc = C.licenseCommit(secret("ab-cnt-new"), A_REC);
    sim.withLicence({ secret: l2, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(A), "approveTransfer", C.licenseCommit(l2, A_REC), A_REC, nlc);
    expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(2n);
    sim.call(as(A), "revokeLicense", lc1, A_REC);
    expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(1n);
  });

  // About 2,000 circuit calls; run with SLOW_TESTS=1.
  it.skipIf(process.env.SLOW_TESTS !== "1")(
    "F5 ACTIVE licences: at most 1024 per issuer; revoking one frees a place",
    () => {
      const N = 1024;
      const lcs: Uint8Array[] = [];
      for (let i = 0; i < N; i++) {
        const l = secret(`ab-act-${i}`);
        lcs.push(issueAs(A, l));
        countersign(l, A_REC);
      }
      expect(sim.state.activeLicensesBy.lookup(A_REC).read()).toBe(BigInt(N));
      const extra = secret("ab-act-extra");
      issueAs(A, extra);
      expect(() => countersign(extra, A_REC)).toThrow("most active licences");
      sim.call(as(A), "revokeLicense", lcs[0], A_REC);
      countersign(extra, A_REC);
    },
    600_000,
  );

  it("F6 (documented limit) root history grows with every tree change until someone pays to seal, and a seal can push the next one to 900 s", () => {
    const h0 = historyLen();
    for (let i = 0; i < 20; i++)
      countersign(
        secret(`ab-h-${i}`),
        (issueAs(A, secret(`ab-h-${i}`)), A_REC),
      );
    expect(historyLen()).toBe(h0 + 20); // nothing in the contract seals on its own
    // A seal with the furthest bound allowed (now + 300) sets the next earliest seal 900 s out.
    sim.call(anyone, "sealRevocations", sim.now + 300n);
    expect(historyLen()).toBe(1);
    countersign(secret("ab-h-x"), (issueAs(A, secret("ab-h-x")), A_REC));
    sim.advance(600n);
    expect(() => sim.call(anyone, "sealRevocations", sim.now + 1n)).toThrow(
      "Too soon",
    );
    sim.advance(300n);
    sim.call(anyone, "sealRevocations", sim.now + 1n);
  }, 60_000);

  it("F7 (documented limit) Sybil: every anchor brings fresh caps, so pending proposals against one victim grow 8 per anchor and the victim must reject each one (the published lastProposed* cells give it what it needs)", () => {
    const sybils = Array.from({ length: 3 }, (_, i) => secret(`ab-sybil-${i}`));
    sybils.forEach(anchor);
    sybils.forEach((s, j) =>
      Array.from({ length: 8 }, (_, i) => secret(`ab-syb-o-${j}-${i}`)).forEach(
        (o) => sim.call(as(s), "proposeObligation", B_REC, o),
      ),
    );
    expect(sim.state.pendingObligations.size()).toBe(24n);
    // B cannot clear them without the commitments.
    expect(() =>
      sim.call(
        as(B),
        "rejectObligation",
        secret("ab-guess"),
        C.commit(sybils[0]),
      ),
    ).toThrow("No such obligation proposed");
  });
});

// ───────────────────────────────────────────── what held

describe("HOLDS: what a thief leaves behind that the owner CAN clean", () => {
  it("self-encumbrances: each one publishes its commitment (lastObligation), so the recovered owner discharges all 16", () => {
    const os = Array.from({ length: 16 }, (_, i) => secret(`ab-enc-${i}`));
    const published: Uint8Array[] = [];
    for (const o of os) {
      sim.call(as(A), "encumberOwnRecord", o);
      published.push(sim.state.lastObligation); // what the indexer shows per tx
    }
    const back = ownerRecovers();
    published.forEach((o) => sim.call(as(back), "discharge", A_REC, o));
    expect(openObligations(sim.state, A_REC)).toBe(0n);
    sim.call(as(back), "encumberOwnRecord", secret("ab-real-enc"));
  });

  it("thief-activated licences: lastActivatedLicense publishes the commitment, so the owner revokes them", () => {
    const l = secret("ab-thief-act");
    issueAs(A, l);
    countersign(l, A_REC);
    const lc = sim.state.lastActivatedLicense;
    const back = ownerRecovers();
    sim.call(as(back), "revokeLicense", lc, A_REC);
    expect(sim.state.licenseStatusOf.size()).toBe(0n);
  });

  it("a thief cannot spend recoveries, so recovery always works after a theft", () => {
    let cur = A;
    for (let i = 0; i < 16; i++) {
      const next = secret(`ab-r-${i}`);
      sim.call(
        as(cur, { incoming: next }),
        "rotateRecordSecret",
        C.commit(next),
      );
      cur = next;
    }
    ownerRecovers();
    expect(sim.state.recoveriesOf.lookup(A_REC).read()).toBe(1n);
  });
});

describe("HOLDS: counters stay in step", () => {
  it("issue under the origin, rotate, revoke-pending and countersign under the successor: count returns to 0", () => {
    const l1 = secret("ab-c1"),
      l2 = secret("ab-c2");
    const lc1 = issueAs(A, l1);
    issueAs(A, l2);
    const A2 = secret("ab-A2");
    sim.call(as(A, { incoming: A2 }), "rotateRecordSecret", C.commit(A2));
    sim.call(as(A2), "revokeLicense", lc1, A_REC);
    countersign(l2, A_REC);
    expect(sim.state.pendingLicensesBy.lookup(A_REC).read()).toBe(0n);
    expect(sim.state.pendingLicensesBy.member(C.commit(A2))).toBe(false);
  });

  it("proposal under a successor, rejected naming the successor and accepted naming the origin: count returns to 0", () => {
    const B2 = secret("ab-B2");
    sim.call(as(B, { incoming: B2 }), "rotateRecordSecret", C.commit(B2));
    const o1 = secret("ab-o1"),
      o2 = secret("ab-o2");
    sim.call(as(B2), "proposeObligation", A_REC, o1);
    sim.call(as(B2), "proposeObligation", A_REC, o2);
    sim.call(as(A), "rejectObligation", o1, C.commit(B2));
    sim.call(as(A), "acceptObligation", o2, B_REC);
    expect(sim.state.pendingObligationsBy.lookup(B_REC).read()).toBe(0n);
  });

  it("countersign and revoke of the same pending licence race: the second is rejected, no double decrement", () => {
    const l = secret("ab-race");
    const lc = issueAs(A, l);
    const rev = sim.prove(as(A), "revokeLicense", lc, A_REC);
    countersign(l, A_REC);
    expect(() => sim.land(rev)).toThrow();
    expect(sim.state.pendingLicensesBy.lookup(A_REC).read()).toBe(0n);
  });
});

describe("HOLDS: lessThan pins only the comparison result, not the count", () => {
  it("an accept proved at 14 in force lands after a concurrent discharge (still commutes)", () => {
    const os = Array.from({ length: 14 }, (_, i) => secret(`ab-cc-${i}`));
    os.forEach((o) => sim.call(as(A), "encumberOwnRecord", o));
    const o = secret("ab-cc-B");
    sim.call(as(B), "proposeObligation", A_REC, o);
    const acc = sim.prove(as(A), "acceptObligation", o, B_REC);
    sim.call(as(A), "discharge", A_REC, os[0]);
    sim.land(acc);
    expect(openObligations(sim.state, A_REC)).toBe(14n);
  });

  it("only a crossing of the threshold conflicts: two proposals proved at 7 waiting, the second fails to land", () => {
    Array.from({ length: 7 }, (_, i) => secret(`ab-th-${i}`)).forEach((o) =>
      sim.call(as(B), "proposeObligation", A_REC, o),
    );
    const p1 = sim.prove(as(B), "proposeObligation", A_REC, secret("ab-th-x"));
    const p2 = sim.prove(as(B), "proposeObligation", A_REC, secret("ab-th-y"));
    sim.land(p1);
    expect(() => sim.land(p2)).toThrow();
    expect(sim.state.pendingObligationsBy.lookup(B_REC).read()).toBe(8n);
  });
});
