// Licences: issue, countersign, present, transfer, revoke, seal, and the attacks on each.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  C,
  VeilcoreSimulator,
  ZERO,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";
import { LicenseState } from "../managed/veilcore/contract/index.js";
import { acceptPresentation } from "../verify.js";

const A = secret("breeder-A"),
  B = secret("breeder-B"),
  Cs = secret("breeder-C"),
  D = secret("breeder-D");
const RECOVERY = secret("recovery"),
  THIEF = secret("thief");
const A_REC = C.commit(A),
  B_REC = C.commit(B),
  C_REC = C.commit(Cs);
const L1 = secret("licensee-1"),
  L2 = secret("licensee-2");
const anyone = as(secret("anyone"));
const INTERVAL = 600n;

let sim: VeilcoreSimulator;
const anchor = (
  s: Uint8Array,
  recovery = secret(`recovery-${hex(s)}`),
): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(recovery));
};
const anchorA = (): void => anchor(A, RECOVERY);
/** The issuer anchors if needed, then issues a licence to the holder of `licSecret`. */
const issue = (issuer: Uint8Array, licSecret: Uint8Array): Uint8Array => {
  anchor(issuer);
  const lc = C.licenseCommit(licSecret, C.commit(issuer));
  sim.call(as(issuer), "issueLicense", lc);
  return lc;
};
const countersign = (
  licSecret: Uint8Array,
  record: Uint8Array,
  slot = sim.freeSlot(),
): void =>
  sim.withLicence({ secret: licSecret, record }, () =>
    sim.call(anyone, "countersignLicense", record, slot),
  );
type Path = ReturnType<VeilcoreSimulator["pathFor"]>;
const present = (
  licSecret: Uint8Array,
  record: Uint8Array,
  challenge = secret("challenge"),
  path?: Path,
): void =>
  sim.withLicence({ secret: licSecret, record, challenge, path }, () =>
    sim.call(anyone, "proveLicense"),
  );
const propose = (
  licSecret: Uint8Array,
  record: Uint8Array,
  next: Uint8Array,
): void =>
  sim.withLicence({ secret: licSecret, record }, () =>
    sim.call(anyone, "proposeTransfer", record, next),
  );
/** A seal whose bound is 60 s ahead of the block time, as the client makes it. */
const seal = (): void => sim.call(anyone, "sealRevocations", sim.now + 60n);
/** Move to the first block time at which the next seal is allowed. */
const untilSealable = (): void => {
  const at = sim.state.lastSealTime + INTERVAL;
  if (sim.now < at) sim.advance(at - sim.now);
};

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

describe("the licence lifecycle", () => {
  it("issues, activates and presents", () => {
    const lc = issue(A, L1);
    expect(sim.state.licenseStatusOf.lookup(C.licenseKey(lc, A_REC))).toBe(
      LicenseState.PENDING,
    );
    countersign(L1, A_REC);
    expect(sim.state.licenseStatusOf.lookup(C.licenseKey(lc, A_REC))).toBe(
      LicenseState.ACTIVE,
    );
    expect(hex(sim.state.lastActivatedLicense)).toBe(hex(lc));
    const ch = secret("verifier-nonce");
    present(L1, A_REC, ch);
    expect(hex(sim.state.lastPresentation)).toBe(
      hex(C.presentationTag(A_REC, ch)),
    );
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
    expect(acceptPresentation(sim.state, B_REC, ch).accepted).toBe(false);
  });

  it("a presentation names neither the licence nor the record, and two do not link", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    present(L1, A_REC, secret("n1"));
    const t1 = sim.state.lastPresentation;
    present(L1, A_REC, secret("n2"));
    expect(hex(sim.state.lastPresentation)).not.toBe(hex(t1));
    expect([hex(A_REC), hex(lc)]).not.toContain(hex(t1));
  });

  it("refuses a presentation without a challenge, or for a licence not held", () => {
    issue(A, L1);
    countersign(L1, A_REC);
    expect(() => present(L1, A_REC, ZERO)).toThrow("verifier's challenge");
    expect(() => present(L1, B_REC)).toThrow("No live licence");
    expect(() => present(L2, A_REC)).toThrow("No live licence");
  });

  it("refuses the empty licence, a duplicate, and an unanchored issuer", () => {
    anchorA();
    expect(() => sim.call(as(A), "issueLicense", ZERO)).toThrow(
      "cannot be empty",
    );
    issue(A, L1);
    expect(() => issue(A, L1)).toThrow("already exists");
    expect(() =>
      sim.call(as(D), "issueLicense", C.licenseCommit(L1, C.commit(D))),
    ).toThrow("only for anchored records");
  });
});

describe("who controls a licence", () => {
  it("a squatter cannot block an issue: entries are keyed by the issuer", () => {
    anchorA();
    const lc = C.licenseCommit(L1, A_REC);
    anchor(THIEF);
    sim.call(as(THIEF), "issueLicense", lc);
    sim.call(as(A), "issueLicense", lc);
    countersign(L1, A_REC);
    present(L1, A_REC);
  });

  it("an issue by D does not create a licence under A", () => {
    anchorA();
    anchor(D);
    sim.call(as(D), "issueLicense", C.licenseCommit(L1, A_REC));
    expect(() => countersign(L1, A_REC)).toThrow("No such license");
  });

  it("control follows the identity through two rotations; retired records lose it", () => {
    anchorA();
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC);
    const nlc = C.licenseCommit(L2, A_REC);
    propose(L1, A_REC, nlc);
    sim.call(as(B), "approveTransfer", lc, A_REC, nlc);
    sim.call(as(B, { incoming: Cs }), "rotateRecordSecret", C_REC);
    expect(() => sim.call(as(B), "revokeLicense", nlc, A_REC)).toThrow(
      "rotated or recovered",
    );
    sim.call(as(Cs), "revokeLicense", nlc, A_REC);
    expect(sim.state.licenseStatusOf.member(C.licenseKey(nlc, A_REC))).toBe(
      false,
    );
  });

  it("a licence issued after a rotation is found by the verifier through the identity", () => {
    anchorA();
    sim.call(as(A, { incoming: B }), "rotateRecordSecret", B_REC);
    const lc = C.licenseCommit(L1, B_REC);
    sim.call(as(B), "issueLicense", lc);
    countersign(L1, B_REC);
    const ch = secret("ask-about-A");
    present(L1, B_REC, ch);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });

  it("a stranger, or a stranger's successor, cannot revoke", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    anchor(D);
    expect(() => sim.call(as(D), "revokeLicense", lc, A_REC)).toThrow(
      "Only the issuing record",
    );
    sim.call(
      as(D, { incoming: secret("D2") }),
      "rotateRecordSecret",
      C.commit(secret("D2")),
    );
    expect(() =>
      sim.call(as(secret("D2")), "revokeLicense", lc, A_REC),
    ).toThrow("Only the issuing record");
  });

  it("after recovery from a thief, the owner controls the old licences and the thief controls nothing", () => {
    anchorA();
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    sim.call(as(A, { incoming: THIEF }), "rotateRecordSecret", C.commit(THIEF));
    sim.call(
      as(secret("x"), { incoming: Cs, recovery: RECOVERY }),
      "recoverRecordSecret",
      A_REC,
      C_REC,
      freshRecovery(),
    );
    expect(() => sim.call(as(THIEF), "revokeLicense", lc, A_REC)).toThrow(
      "rotated or recovered",
    );
    expect(() =>
      sim.call(as(THIEF), "issueLicense", C.licenseCommit(secret("t"), A_REC)),
    ).toThrow("rotated or recovered");
    sim.call(as(Cs), "revokeLicense", lc, A_REC);
  });
});

describe("transfers", () => {
  it("moves the licence; the outgoing holder's old path works only until the next seal", () => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    const outgoing = sim.pathFor(L1, A_REC);
    const nlc = C.licenseCommit(L2, A_REC);
    propose(L1, A_REC, nlc);
    expect(() =>
      sim.call(
        as(A),
        "approveTransfer",
        lc,
        A_REC,
        C.licenseCommit(secret("other"), A_REC),
      ),
    ).toThrow("not the one you approved");
    sim.call(as(A), "approveTransfer", lc, A_REC, nlc);
    present(L2, A_REC);
    expect(sim.pathFor(L1, A_REC)).toBeUndefined();
    present(L1, A_REC, secret("c"), outgoing); // the stated window
    seal();
    expect(() => present(L1, A_REC, secret("c2"), outgoing)).toThrow("stale");
  });

  it("cannot forge a licence from another issuer (independent review, critical)", () => {
    const Bf = secret("famous-breeder"),
      Bf_REC = C.commit(Bf);
    anchor(Bf);
    const M = secret("mallory"),
      M_REC = C.commit(M);
    const X1 = secret("x1"),
      X2 = secret("x2");
    const lcM = issue(M, X1);
    countersign(X1, M_REC);
    const forged = C.licenseCommit(X2, Bf_REC);
    propose(X1, M_REC, forged);
    sim.call(as(M), "approveTransfer", lcM, M_REC, forged);
    expect(() => present(X2, Bf_REC)).toThrow("No live licence");
    expect(sim.state.licenseStatusOf.member(C.licenseKey(forged, Bf_REC))).toBe(
      false,
    );
  });

  it("one commitment under two issuers: revoking one leaves no presentable copy under it", () => {
    const Aa = secret("A"),
      Aa_REC = C.commit(Aa),
      Bb = secret("B"),
      Bb_REC = C.commit(Bb);
    const G1 = secret("g1"),
      G2 = secret("g2");
    const lcB = issue(Bb, G2);
    countersign(G2, Bb_REC);
    const lcA = issue(Aa, G1);
    countersign(G1, Aa_REC);
    propose(G1, Aa_REC, lcB);
    sim.call(as(Aa), "approveTransfer", lcA, Aa_REC, lcB);
    const oldB = sim.pathFor(G2, Bb_REC);
    sim.call(as(Bb), "revokeLicense", lcB, Bb_REC);
    seal();
    expect(() => present(G2, Bb_REC, secret("v"), oldB)).toThrow("stale");
    expect(sim.state.licenseStatusOf.member(C.licenseKey(lcB, Aa_REC))).toBe(
      true,
    );
  });

  it("refuses a transfer to the empty leaf, and the holder can withdraw a proposal", () => {
    issue(A, L1);
    countersign(L1, A_REC);
    expect(() => propose(L1, A_REC, ZERO)).toThrow("cannot be empty");
    propose(L1, A_REC, C.licenseCommit(L2, A_REC));
    expect(() => propose(L1, A_REC, C.licenseCommit(L2, A_REC))).toThrow(
      "already proposed",
    );
    sim.withLicence({ secret: L1, record: A_REC }, () =>
      sim.call(anyone, "withdrawTransfer", A_REC),
    );
  });
});

describe("revocation and sealing", () => {
  const activeA = (): Uint8Array => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    return lc;
  };

  it("revocation clears the licence at once; the old path works until the seal and fails after it", () => {
    const lc = activeA();
    const oldPath = sim.pathFor(L1, A_REC);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(sim.state.licenseStatusOf.member(C.licenseKey(lc, A_REC))).toBe(
      false,
    );
    expect(sim.pathFor(L1, A_REC)).toBeUndefined();
    const ch = secret("c");
    present(L1, A_REC, ch, oldPath);
    // The verifier's rule 5 rejects it: a revocation was waiting for a seal.
    expect(acceptPresentation(sim.state, A_REC, ch)).toMatchObject({
      accepted: false,
    });
    seal();
    expect(() => present(L1, A_REC, secret("c2"), oldPath)).toThrow("stale");
  });

  it("cannot be starved: a revoke proved before the licensee proposes still lands", () => {
    const lc = activeA();
    const revoke = sim.prove(as(A), "revokeLicense", lc, A_REC);
    propose(L1, A_REC, C.licenseCommit(secret("friend"), A_REC));
    sim.land(revoke);
    expect(sim.state.licenseStatusOf.member(C.licenseKey(lc, A_REC))).toBe(
      false,
    );
    expect(sim.state.pendingTransferOf.member(C.licenseKey(lc, A_REC))).toBe(
      false,
    );
  });

  it("control: the replay rejects what the chain would (a revoke of an already revoked licence)", () => {
    const lc = activeA();
    const revoke = sim.prove(as(A), "revokeLicense", lc, A_REC);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(() => sim.land(revoke)).toThrow();
  });

  it("a presentation in flight survives activations elsewhere and is accepted", () => {
    activeA();
    const M = secret("spam"),
      M_REC = C.commit(M);
    issue(M, secret("spam-lic"));
    const ch = secret("c");
    const presentation = sim.withLicence(
      { secret: L1, record: A_REC, challenge: ch },
      () => sim.prove(anyone, "proveLicense"),
    );
    countersign(secret("spam-lic"), M_REC); // the root moves on
    sim.land(presentation);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });

  it("a revocation anywhere sends presentations in flight back to be re-proved", () => {
    // The presentation records whether a revocation was waiting when it was proved, so
    // a revocation landing first changes what it read. A verifier would refuse it anyway
    // (older root, revocation waiting), so this costs a re-proof, not a wrong answer.
    activeA();
    const M = secret("spam"),
      M_REC = C.commit(M);
    const spam = issue(M, secret("spam-lic"));
    countersign(secret("spam-lic"), M_REC);
    const presentation = sim.withLicence(
      { secret: L1, record: A_REC, challenge: secret("c") },
      () => sim.prove(anyone, "proveLicense"),
    );
    sim.call(as(M), "revokeLicense", spam, M_REC);
    expect(() => sim.land(presentation)).toThrow();
    const ch = secret("c2");
    sim.withLicence({ secret: L1, record: A_REC, challenge: ch }, () =>
      sim.call(anyone, "proveLicense"),
    );
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true); // current root
  });

  it("a revoked licensee gains nothing by landing a seal after a stale presentation", () => {
    // Attack round, 1 Oct: proveLicense against the pre-revocation root, then a seal in
    // the same transaction, used to leave unsealedChanges false for the verifier to read.
    const lc = activeA();
    const oldPath = sim.pathFor(L1, A_REC); // fetched while the licence was live
    sim.call(as(A), "revokeLicense", lc, A_REC);
    untilSealable();
    const ch = secret("bundle");
    // The old root is still in history until the seal, so the stale path still proves.
    sim.withLicence(
      { secret: L1, record: A_REC, challenge: ch, path: oldPath },
      () => sim.call(anyone, "proveLicense"),
    );
    sim.call(anyone, "sealRevocations", sim.now + 1n); // same transaction, or right after
    expect(sim.state.unsealedChanges).toBe(false);
    expect(acceptPresentation(sim.state, A_REC, ch)).toMatchObject({
      accepted: false,
    });
  });

  it("anyone may seal, only when something is waiting, and never twice within the interval of block time", () => {
    const lc = activeA();
    expect(() => seal()).toThrow("No revocation or transfer is waiting");
    sim.call(as(A), "revokeLicense", lc, A_REC);
    sim.call(anyone, "sealRevocations", sim.now + 1n); // the tightest bound
    const lc2 = issue(A, L2);
    countersign(L2, A_REC);
    sim.call(as(A), "revokeLicense", lc2, A_REC);
    sim.advance(INTERVAL);
    expect(() => sim.call(anyone, "sealRevocations", sim.now + 1n)).toThrow(
      "Too soon",
    );
    expect(() => sim.call(anyone, "sealRevocations", sim.now + 300n)).toThrow(
      "Too soon",
    );
    sim.advance(1n);
    sim.call(anyone, "sealRevocations", sim.now + 1n);
    expect(sim.state.sealSeq).toBe(2n);
  });

  it("the seal's bound must be ahead of the block time, by at most 300 s", () => {
    const lc = activeA();
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(() => sim.call(anyone, "sealRevocations", sim.now)).toThrow(
      "not ahead of the block time",
    );
    expect(() => sim.call(anyone, "sealRevocations", sim.now - 100n)).toThrow(
      "not ahead of the block time",
    );
    expect(() => sim.call(anyone, "sealRevocations", sim.now + 301n)).toThrow(
      "too far ahead",
    );
    sim.call(anyone, "sealRevocations", sim.now + 300n);
  });

  it("griefing costs honest licensees re-proofs, never a wrong answer (known limit)", () => {
    activeA();
    const M = secret("griefer"),
      M_REC = C.commit(M);
    const grief = (): void => {
      const x = secret(`g-${sim.now}-${Math.random()}`);
      const lc = issue(M, x);
      countersign(x, M_REC);
      sim.call(as(M), "revokeLicense", lc, M_REC);
    };
    const inFlight = (ch: Uint8Array): ReturnType<VeilcoreSimulator["prove"]> =>
      sim.withLicence({ secret: L1, record: A_REC, challenge: ch }, () =>
        sim.prove(anyone, "proveLicense"),
      );

    const p = inFlight(secret("p"));
    grief(); // nothing was waiting: the revocation changes what p read
    expect(() => sim.land(p)).toThrow();

    const ch = secret("q");
    const q = inFlight(ch);
    const y = secret("g-activation");
    issue(M, y);
    countersign(y, M_REC); // a revocation is already waiting: q lands, on a root that is no longer current
    sim.land(q);
    expect(acceptPresentation(sim.state, A_REC, ch)).toMatchObject({
      accepted: false,
    });

    untilSealable();
    seal();
    const ch2 = secret("r");
    sim.land(inFlight(ch2)); // nothing changed in between
    expect(acceptPresentation(sim.state, A_REC, ch2).accepted).toBe(true);
  });
});

describe("slots", () => {
  it("two activations on the same state both land if they picked different slots", () => {
    issue(A, L1);
    issue(A, L2);
    const second = sim.withLicence({ secret: L2, record: A_REC }, () =>
      sim.prove(anyone, "countersignLicense", A_REC, 6n),
    );
    countersign(L1, A_REC, 5n);
    sim.land(second);
    expect(hex(sim.state.licenseAtSlot.lookup(6n))).toBe(
      hex(C.licenseKey(C.licenseCommit(L2, A_REC), A_REC)),
    );
  });

  it("the same slot is refused, as is one outside the tree", () => {
    issue(A, L1);
    issue(A, L2);
    countersign(L1, A_REC, 5n);
    expect(() => countersign(L2, A_REC, 5n)).toThrow("slot is taken");
    expect(() => countersign(L2, A_REC, 16777216n)).toThrow(
      "outside the licence tree",
    );
  });

  it("a freed slot is reused, and the revoked licence does not come back with it", () => {
    const lc1 = issue(A, L1);
    issue(A, L2);
    countersign(L1, A_REC, 5n);
    const oldPath = sim.pathFor(L1, A_REC);
    sim.call(as(A), "revokeLicense", lc1, A_REC);
    seal();
    countersign(L2, A_REC, 5n);
    present(L2, A_REC);
    expect(() => present(L1, A_REC, secret("c"), oldPath)).toThrow("stale");
    expect(() => present(L1, A_REC)).toThrow("No live licence");
  });
});

describe("the verifier's presentation check (rule 5)", () => {
  const activeA = (): Uint8Array => {
    const lc = issue(A, L1);
    countersign(L1, A_REC);
    return lc;
  };

  it("reads the tag from chain state, so a licensee cannot hand over one of their own making", () => {
    anchorA();
    const ch = secret("verifier-challenge");
    expect(acceptPresentation(sim.state, A_REC, ch)).toMatchObject({
      accepted: false,
    }); // nothing presented yet
    activeA();
    present(L1, A_REC, secret("some-other-challenge"));
    expect(acceptPresentation(sim.state, A_REC, ch)).toMatchObject({
      accepted: false,
    });
    present(L1, A_REC, ch);
    expect(acceptPresentation(sim.state, A_REC, ch)).toMatchObject({
      accepted: true,
    });
  });

  it("a revoked licence presented before the seal is rejected on the state right after it, even if a seal follows", () => {
    const lc = activeA();
    const oldPath = sim.pathFor(L1, A_REC);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    const ch = secret("c");
    present(L1, A_REC, ch, oldPath);
    const afterTx = sim.state;
    seal(); // the licensee, or anyone, seals straight after
    expect(acceptPresentation(afterTx, A_REC, ch)).toMatchObject({
      accepted: false,
    });
  });

  it("a live licence is accepted even while someone keeps a revocation waiting", () => {
    activeA();
    const M = secret("griefer"),
      M_REC = C.commit(M);
    const x = secret("throwaway");
    const lc = issue(M, x);
    countersign(x, M_REC);
    sim.call(as(M), "revokeLicense", lc, M_REC);
    expect(sim.state.unsealedChanges).toBe(true);
    const ch = secret("c");
    present(L1, A_REC, ch); // a fresh path, against the current root
    expect(acceptPresentation(sim.state, A_REC, ch)).toMatchObject({
      accepted: true,
    });
  });
});
