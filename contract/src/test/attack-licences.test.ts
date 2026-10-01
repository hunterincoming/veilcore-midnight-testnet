// Attacker pass on licences. SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import {
  C,
  VeilcoreSimulator,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";
import { acceptPresentation } from "../verify.js";

const A = secret("breeder-A");
const A_REC = C.commit(A);
const L1 = secret("licensee-1"),
  L2 = secret("licensee-2");
const M = secret("griefer"),
  M_REC = C.commit(M);
const anyone = as(secret("anyone"));
let sim: VeilcoreSimulator;
const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(secret(`rec-${hex(s)}`)));
};
const issue = (issuer: Uint8Array, l: Uint8Array): Uint8Array => {
  anchor(issuer);
  const lc = C.licenseCommit(l, C.commit(issuer));
  sim.call(as(issuer), "issueLicense", lc);
  return lc;
};
const countersign = (l: Uint8Array, rec: Uint8Array, slot = sim.freeSlot()) =>
  sim.withLicence({ secret: l, record: rec }, () =>
    sim.call(anyone, "countersignLicense", rec, slot),
  );
const proveCountersign = (l: Uint8Array, rec: Uint8Array, slot: bigint) =>
  sim.withLicence({ secret: l, record: rec }, () =>
    sim.prove(anyone, "countersignLicense", rec, slot),
  );
const seal = () => sim.call(anyone, "sealRevocations", sim.now + 60n);

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

describe("ATTACK 1: verifier-side denial of presentations (rule 5)", () => {
  it("one throwaway revoke + any root change before landing => an honest live licence is rejected", () => {
    issue(A, L1);
    countersign(L1, A_REC);
    // griefer: one revoke keeps unsealedChanges true
    const t = secret("t0");
    const lt = issue(M, t);
    countersign(t, M_REC);
    sim.call(as(M), "revokeLicense", lt, M_REC);
    // honest presentation proved against the current root
    const ch = secret("ch");
    const p = sim.withLicence(
      { secret: L1, record: A_REC, challenge: ch },
      () => sim.prove(anyone, "proveLicense"),
    );
    // griefer (or any honest user) activates something before it lands
    const t2 = secret("t1");
    issue(M, t2);
    countersign(t2, M_REC);
    sim.land(p); // the chain accepts it
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(false); // the verifier rejects it
  });

  it("the griefer can keep it up across seals: no 600 s cap applies", () => {
    issue(A, L1);
    countersign(L1, A_REC);
    const pool: Uint8Array[] = [];
    for (let i = 0; i < 4; i++) {
      const s = secret(`p${i}`);
      pool.push(issue(M, s));
      countersign(s, M_REC);
    }
    let rejected = 0;
    for (let round = 0; round < 4; round++) {
      sim.call(as(M), "revokeLicense", pool[round], M_REC); // keep a revocation waiting
      for (let k = 0; k < 3; k++) {
        const ch = secret(`c-${round}-${k}`);
        const p = sim.withLicence(
          { secret: L1, record: A_REC, challenge: ch },
          () => sim.prove(anyone, "proveLicense"),
        );
        const s = secret(`spam-${round}-${k}`);
        issue(M, s);
        countersign(s, M_REC);
        sim.land(p);
        if (!acceptPresentation(sim.state, A_REC, ch).accepted) rejected++;
        sim.advance(20n);
      }
      sim.advance(600n);
      seal(); // honest seals do not help: griefer revokes again
    }
    expect(rejected).toBe(12);
  });
});

describe("ATTACK 2: races proved on old state, landed later", () => {
  it("double countersign of one licence at two slots", () => {
    issue(A, L1);
    const p1 = proveCountersign(L1, A_REC, 5n);
    const p2 = proveCountersign(L1, A_REC, 9n);
    sim.land(p1);
    expect(() => sim.land(p2)).toThrow();
  });

  it("revoke of a PENDING licence lands after the licensee countersigns", () => {
    const lc = issue(A, L1);
    const r = sim.prove(as(A), "revokeLicense", lc, A_REC);
    countersign(L1, A_REC, 5n);
    let landed = true;
    try {
      sim.land(r);
    } catch {
      landed = false;
    }
    if (landed) {
      // if it landed, the leaf must not survive
      expect(sim.state.licenseAtSlot.member(5n)).toBe(false);
    }
    expect(landed).toBe(false);
  });

  it("countersign proved while pending lands after the pending licence was revoked", () => {
    const lc = issue(A, L1);
    const p = proveCountersign(L1, A_REC, 5n);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(() => sim.land(p)).toThrow();
  });

  it("proposeTransfer proved while ACTIVE lands after revoke + re-issue (PENDING)", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    const nlc = C.licenseCommit(L2, A_REC);
    const p = sim.withLicence({ secret: L1, record: A_REC }, () =>
      sim.prove(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(A), "revokeLicense", lc, A_REC);
    sim.call(as(A), "issueLicense", lc);
    expect(() => sim.land(p)).toThrow();
  });

  it("approveTransfer proved, then revoke, then approve lands", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    const nlc = C.licenseCommit(L2, A_REC);
    sim.withLicence({ secret: L1, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    const ap = sim.prove(as(A), "approveTransfer", lc, A_REC, nlc);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(() => sim.land(ap)).toThrow();
  });

  it("two seals proved on the same state cannot both land", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    const s1 = sim.prove(anyone, "sealRevocations", sim.now + 60n);
    const s2 = sim.prove(anyone, "sealRevocations", sim.now + 60n);
    sim.land(s1);
    expect(() => sim.land(s2)).toThrow();
  });

  it("a seal proved early cannot land after a second revocation to wipe history without the rate limit", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    const lc2 = issue(A, L2);
    countersign(L2, A_REC);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    const s1 = sim.prove(anyone, "sealRevocations", sim.now + 300n);
    sim.advance(299n);
    sim.call(as(A), "revokeLicense", lc2, A_REC);
    sim.land(s1); // fine: it is the first seal; it resets history to the current root
    const old = sim.state;
    expect(old.unsealedChanges).toBe(false);
  });

  it("a seal proved long ago cannot land late (bound must be ahead of block time)", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    const s1 = sim.prove(anyone, "sealRevocations", sim.now + 300n);
    sim.advance(400n);
    expect(() => sim.land(s1)).toThrow();
  });
});

describe("ATTACK 3: presentation semantics", () => {
  it("any licence against a record satisfies a verifier asking about that record (terms not bound)", () => {
    issue(A, L1);
    issue(A, L2);
    countersign(L1, A_REC);
    countersign(L2, A_REC);
    const ch = secret("v");
    sim.withLicence({ secret: L2, record: A_REC, challenge: ch }, () =>
      sim.call(anyone, "proveLicense"),
    );
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });

  it("the issuer itself (no licence issued to anyone else) can self-license and present", () => {
    const own = secret("self");
    issue(A, own);
    countersign(own, A_REC);
    const ch = secret("v2");
    sim.withLicence({ secret: own, record: A_REC, challenge: ch }, () =>
      sim.call(anyone, "proveLicense"),
    );
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });

  it("a revoked licensee re-presenting an old root after a seal and a later countersign is refused on chain", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    const old = sim.pathFor(L1, A_REC);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    seal();
    issue(A, L2);
    countersign(L2, A_REC);
    expect(() =>
      sim.withLicence(
        { secret: L1, record: A_REC, challenge: secret("z"), path: old },
        () => sim.call(anyone, "proveLicense"),
      ),
    ).toThrow("stale");
  });
});

describe("ATTACK 4: thief-issued licences after recovery", () => {
  it("a thief's dormant pending licence activates after recovery and is accepted as A's licensee", () => {
    anchor(A);
    const T = secret("thief"),
      T_REC = C.commit(T);
    sim.call(as(A, { incoming: T }), "rotateRecordSecret", T_REC);
    const x = secret("thief-licence");
    const lcT = C.licenseCommit(x, T_REC);
    const issueTx = sim.prove(as(T), "issueLicense", lcT);
    sim.land(issueTx);
    const owner = secret("owner-new");
    sim.call(
      as(secret("z"), { incoming: owner, recovery: secret(`rec-${hex(A)}`) }),
      "recoverRecordSecret",
      A_REC,
      C.commit(owner),
      freshRecovery(),
    );
    // is lcT recoverable from the public transcript of issueLicense?
    const s = JSON.stringify(issueTx.transcript, (_k, v) =>
      typeof v === "bigint"
        ? v.toString()
        : v instanceof Uint8Array
          ? hex(v)
          : v,
    );
    console.log(
      "lc in issue transcript:",
      s.includes(hex(lcT)),
      "key in transcript:",
      s.includes(hex(C.licenseKey(lcT, T_REC))),
    );
    // much later: thief countersigns and presents
    sim.advance(10n ** 7n);
    countersign(x, T_REC);
    const ch = secret("verifier");
    sim.withLicence({ secret: x, record: T_REC, challenge: ch }, () =>
      sim.call(anyone, "proveLicense"),
    );
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });
});
