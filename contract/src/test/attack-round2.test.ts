// Attack round 2 (1 Oct): the three fixes, attacked again. SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import {
  C,
  VeilcoreSimulator,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";
import { acceptPresentation, checkLineage, isLive } from "../verify.js";

const A = secret("r2-issuer"),
  A_REC = C.commit(A);
const L1 = secret("r2-lic-1"),
  L2 = secret("r2-lic-2");
const M = secret("r2-griefer"),
  M_REC = C.commit(M);
const anyone = as(secret("r2-anyone"));
let sim: VeilcoreSimulator;

const anchor = (s: Uint8Array, rcv = secret(`r2-rcv-${hex(s)}`)): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(rcv));
};
const issue = (issuer: Uint8Array, l: Uint8Array): Uint8Array => {
  anchor(issuer);
  const lc = C.licenseCommit(l, C.commit(issuer));
  sim.call(as(issuer), "issueLicense", lc);
  return lc;
};
const countersign = (l: Uint8Array, rec: Uint8Array): void =>
  sim.withLicence({ secret: l, record: rec }, () =>
    sim.call(anyone, "countersignLicense", rec, sim.freeSlot()),
  );
const active = (issuer: Uint8Array, l: Uint8Array): Uint8Array => {
  const lc = issue(issuer, l);
  countersign(l, C.commit(issuer));
  return lc;
};
const provePresentation = (l: Uint8Array, rec: Uint8Array, ch: Uint8Array) =>
  sim.withLicence({ secret: l, record: rec, challenge: ch }, () =>
    sim.prove(anyone, "proveLicense"),
  );
const untilSealable = (): void => {
  const at = sim.state.lastSealTime + 600n;
  if (sim.now < at) sim.advance(at - sim.now);
};
const seal = (): void => sim.call(anyone, "sealRevocations", sim.now + 60n);
/** Keep a revocation waiting, using the griefer's own throwaway licence. */
const waitingRevocation = (tag: string): void => {
  const t = secret(`r2-throwaway-${tag}`);
  const lt = active(M, t);
  sim.call(as(M), "revokeLicense", lt, M_REC);
};

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

describe("fix 1: revoked licensee presenting", () => {
  it("held: proved with nothing waiting, revoked before landing => refused on chain", () => {
    const lc = active(A, L1);
    expect(sim.state.unsealedChanges).toBe(false);
    const p = provePresentation(L1, A_REC, secret("ch1"));
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(() => sim.land(p)).toThrow();
  });

  it("held: same with approveTransfer (transfer away, then present the old licence)", () => {
    const lc = active(A, L1);
    const p = provePresentation(L1, A_REC, secret("ch2"));
    const nlc = C.licenseCommit(L2, A_REC);
    sim.withLicence({ secret: L1, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(A), "approveTransfer", lc, A_REC, nlc);
    expect(() => sim.land(p)).toThrow();
  });

  it("held: proved while a revocation was waiting, own revoke lands first => lands, verifier rejects", () => {
    const lc = active(A, L1);
    waitingRevocation("a");
    const ch = secret("ch3");
    const p = provePresentation(L1, A_REC, ch);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    sim.land(p);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(false);
  });

  it("held: same with approveTransfer => verifier rejects", () => {
    const lc = active(A, L1);
    waitingRevocation("b");
    const ch = secret("ch4");
    const p = provePresentation(L1, A_REC, ch);
    const nlc = C.licenseCommit(L2, A_REC);
    sim.withLicence({ secret: L1, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(A), "approveTransfer", lc, A_REC, nlc);
    sim.land(p);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(false);
  });

  it("held: proved with nothing waiting, revoke + seal both land first => refused on chain", () => {
    const lc = active(A, L1);
    const p = provePresentation(L1, A_REC, secret("ch5"));
    sim.call(as(A), "revokeLicense", lc, A_REC);
    untilSealable();
    seal();
    expect(sim.state.unsealedChanges).toBe(false); // flag matches what was read...
    expect(() => sim.land(p)).toThrow(); // ...but the root is gone
  });

  it("NEW (low): a seal now fails every in-flight current-root presentation on chain", () => {
    active(A, L1);
    waitingRevocation("c");
    const ch = secret("ch6");
    const p = provePresentation(L1, A_REC, ch); // current root, flag true
    untilSealable();
    seal(); // anyone; root unchanged, flag flips
    expect(() => sim.land(p)).toThrow(); // before the fix this landed and was accepted
  });

  it("NEW (low): the first revoke after a seal fails every in-flight presentation on chain", () => {
    active(A, L1);
    const p = provePresentation(L1, A_REC, secret("ch7")); // flag false
    waitingRevocation("d"); // griefer's own throwaway
    expect(() => sim.land(p)).toThrow();
  });
});

describe("fix 2: recovery installs a new recovery commitment", () => {
  const RCV = secret("r2-owner-rcv");
  const owner = (incoming: Uint8Array, rcv = RCV) =>
    as(secret("r2-x"), { recovery: rcv, incoming });

  it("held: two recoveries proved on one state, only the first lands", () => {
    anchor(A, RCV);
    const n1 = secret("r2-n1"),
      n2 = secret("r2-n2");
    const p1 = sim.prove(
      owner(n1),
      "recoverRecordSecret",
      A_REC,
      C.commit(n1),
      freshRecovery(),
    );
    const p2 = sim.prove(
      owner(n2),
      "recoverRecordSecret",
      A_REC,
      C.commit(n2),
      freshRecovery(),
    );
    sim.land(p1);
    expect(() => sim.land(p2)).toThrow();
    expect(isLive(sim.state, C.commit(n1))).toBe(true);
  });

  it("held: replaceRecoveryCommitment proved on the same state cannot land after a recovery", () => {
    anchor(A, RCV);
    const n1 = secret("r2-n3");
    const rep = sim.prove(
      owner(n1),
      "replaceRecoveryCommitment",
      A_REC,
      freshRecovery(),
    );
    sim.call(
      owner(n1),
      "recoverRecordSecret",
      A_REC,
      C.commit(n1),
      freshRecovery(),
    );
    expect(() => sim.land(rep)).toThrow();
  });

  it("held: a thief with only the record secret cannot make the recovery fail", () => {
    anchor(A, RCV);
    const n1 = secret("r2-n4"),
      T = secret("r2-thief");
    const rec = sim.prove(
      owner(n1),
      "recoverRecordSecret",
      A_REC,
      C.commit(n1),
      freshRecovery(),
    );
    sim.call(as(A, { incoming: T }), "rotateRecordSecret", C.commit(T));
    sim.land(rec);
    expect(isLive(sim.state, C.commit(n1))).toBe(true);
  });

  it("client risk: a recovery that landed but 'failed' cannot be retried; only the first secrets work", () => {
    anchor(A, RCV);
    const n1 = secret("r2-n5"),
      n2 = secret("r2-n6");
    const NEXT_RCV = secret("r2-next-rcv");
    sim.call(
      owner(n1),
      "recoverRecordSecret",
      A_REC,
      C.commit(n1),
      C.recoveryCommit(NEXT_RCV),
    );
    // The client saw a timeout and the user retries with freshly shown secrets.
    expect(() =>
      sim.call(
        owner(n2),
        "recoverRecordSecret",
        A_REC,
        C.commit(n2),
        freshRecovery(),
      ),
    ).toThrow("not the recovery secret");
    // If the user kept only the retry's secrets, nothing they hold works any more.
    expect(isLive(sim.state, C.commit(n1))).toBe(true);
  });

  it("note: a recovery may re-install an earlier, replaced recovery commitment", () => {
    const OLD = secret("r2-old-leaked");
    anchor(A, OLD);
    sim.call(
      as(A, { recovery: OLD }),
      "replaceRecoveryCommitment",
      A_REC,
      C.recoveryCommit(RCV),
    );
    const n1 = secret("r2-n7");
    sim.call(
      owner(n1),
      "recoverRecordSecret",
      A_REC,
      C.commit(n1),
      C.recoveryCommit(OLD),
    );
    expect(hex(sim.state.recoveryOf.lookup(A_REC))).toBe(
      hex(C.recoveryCommit(OLD)),
    );
  });
});

describe("fix 3: hasOffspring", () => {
  const X = secret("r2-X"),
    Y = secret("r2-Y"),
    Z = secret("r2-Z");
  const Xr = C.commit(X),
    Yr = C.commit(Y),
    Zr = C.commit(Z);
  beforeEach(() => [X, Y, Z].forEach((s) => anchor(s)));

  it("held: a two-cycle cannot form from two confirms proved on one state", () => {
    sim.call(as(X), "proposeParent", Yr);
    sim.call(as(Y), "proposeParent", Xr);
    const c1 = sim.prove(as(Y), "confirmParent", Xr);
    const c2 = sim.prove(as(X), "confirmParent", Yr);
    sim.land(c1);
    expect(() => sim.land(c2)).toThrow();
    expect(checkLineage(sim.state, Xr).cyclic).toBe(false);
  });

  it("held: a three-cycle cannot form, in any landing order", () => {
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of orders) {
      sim = new VeilcoreSimulator();
      [X, Y, Z].forEach((s) => anchor(s));
      // X child of Y, Y child of Z, Z child of X
      sim.call(as(X), "proposeParent", Yr);
      sim.call(as(Y), "proposeParent", Zr);
      sim.call(as(Z), "proposeParent", Xr);
      const confirms = [
        sim.prove(as(Y), "confirmParent", Xr),
        sim.prove(as(Z), "confirmParent", Yr),
        sim.prove(as(X), "confirmParent", Zr),
      ];
      let landed = 0;
      for (const i of order) {
        try {
          sim.land(confirms[i]);
          landed++;
        } catch {
          /* refused */
        }
      }
      expect(landed).toBeLessThan(3);
      for (const r of [Xr, Yr, Zr])
        expect(checkLineage(sim.state, r).cyclic).toBe(false);
    }
  }, 30_000);

  it("held: a cycle through a rotated or recovered commitment is still refused", () => {
    sim.call(as(X), "proposeParent", Yr);
    sim.call(as(Y), "confirmParent", Xr);
    const Y2 = secret("r2-Y2");
    sim.call(as(Y, { incoming: Y2 }), "rotateRecordSecret", C.commit(Y2));
    expect(() => sim.call(as(Y2), "proposeParent", Xr)).toThrow(
      "confirmed offspring",
    );
  });

  it("held: nobody but the holder can give a record offspring", () => {
    const G = secret("r2-G");
    anchor(G);
    sim.call(as(G), "proposeParent", Xr); // G names X as its parent
    expect(sim.state.hasOffspring.member(Xr)).toBe(false);
    // X can still record its own parents
    sim.call(as(X), "proposeParent", Yr);
    sim.call(as(Y), "confirmParent", Xr);
    expect(sim.state.parentsOf.lookup(Xr).member(Yr)).toBe(true);
  });

  it("limit: a second parent is lost for good once the child confirms a clone first", () => {
    const CLONE = secret("r2-clone");
    anchor(CLONE);
    sim.call(as(X), "proposeParent", Yr);
    sim.call(as(Y), "confirmParent", Xr); // mother
    sim.call(as(X), "proposeParent", Zr); // father, slow to confirm
    sim.call(as(CLONE), "proposeParent", Xr);
    sim.call(as(X), "confirmParent", C.commit(CLONE));
    expect(() => sim.call(as(Z), "confirmParent", Xr)).toThrow(
      "confirmed offspring",
    );
    // the pending proposal is stuck until X withdraws it; no remedy for the edge
    expect(sim.state.pendingParentOf.member(Xr)).toBe(true);
  });
});
