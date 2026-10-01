// Attack round 11 (1 Oct): cross-circuit state, licence lifecycle after revocation,
// recovery against pending state, verifier verdicts after recovery.
// FINDING = demonstrated problem (the bad outcome is asserted to succeed); HELD = refused.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptOwnership,
  acceptPresentation,
  checkLineage,
  isLive,
  openObligations,
} from "../verify.js";
import {
  C,
  VeilcoreSimulator,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";

const A = secret("r11-issuer-A"),
  A_REC = C.commit(A);
const anyone = as(secret("r11-anyone"));
const rcvOf = (s: Uint8Array): Uint8Array => secret(`r11-rcv-${hex(s)}`);
let sim: VeilcoreSimulator;

const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(rcvOf(s)));
};
const activate = (issuer: Uint8Array, l: Uint8Array): Uint8Array => {
  anchor(issuer);
  const rec = C.commit(issuer);
  const lc = C.licenseCommit(l, rec);
  sim.call(as(issuer), "issueLicense", lc);
  sim.withLicence({ secret: l, record: rec }, () =>
    sim.call(anyone, "countersignLicense", rec, sim.freeSlot()),
  );
  return lc;
};
const present = (l: Uint8Array, rec: Uint8Array, ch: Uint8Array) =>
  sim.withLicence({ secret: l, record: rec, challenge: ch }, () =>
    sim.call(anyone, "proveLicense"),
  );
const seal = (): void => {
  sim.advance(700n);
  sim.call(anyone, "sealRevocations", sim.now + 100n);
};

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

// ───────────────────────────────────────────── 1. revocation is forgotten by the transfer path

describe("LICENCES: nothing on chain remembers a revocation", () => {
  // The contract (frozen) still allows both of these. Since 1 Oct the CLIENT refuses them:
  // VeilcoreAPI remembers what its issuer revoked and refuses issueLicense /
  // approveTransfer to it (bboard-cli/src/attack-round11-deploy.test.ts, R11-L). These
  // two pin the contract-level behaviour the client guard exists for.
  it("LIMIT (contract; refused by the client since 1 Oct): a revoked licensee is revived by another licensee's transfer to the revoked commitment; verifier accepts", () => {
    const L = secret("r11-L-revoked");
    const M = secret("r11-M-colluder");
    const lcL = activate(A, L);
    const lcM = activate(A, M);

    // A revokes L, and it is sealed: L is out for good, as far as A knows.
    sim.call(as(A), "revokeLicense", lcL, A_REC);
    seal();
    expect(sim.state.licenseStatusOf.member(C.licenseKey(lcL, A_REC))).toBe(
      false,
    );

    // M "sells" its licence to L: proposes a transfer to L's OLD commitment (public since
    // L's countersign wrote it to lastActivatedLicense). Nothing refuses it: the
    // "already in use" checks read licenseStatusOf, which revocation cleared.
    sim.withLicence({ secret: M, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, lcL),
    );
    // A approves the commitment it is shown. The client does not compare it with
    // A's own revocation history, and the contract kept none.
    sim.call(as(A), "approveTransfer", lcM, A_REC, lcL);

    // L presents with the secret A revoked, and a verifier asking about A accepts.
    const ch = secret("r11-ch-1");
    present(L, A_REC, ch);
    const v = acceptPresentation(sim.state, A_REC, ch);
    expect(v.accepted).toBe(true);
  });

  it("LIMIT (contract; refused by the client since 1 Oct): the issuer can also re-issue a revoked commitment by mistake; the old licensee countersigns it", () => {
    const L = secret("r11-L-reissue");
    const lcL = activate(A, L);
    sim.call(as(A), "revokeLicense", lcL, A_REC);
    seal();
    sim.call(as(A), "issueLicense", lcL); // no "was revoked" refusal
    sim.withLicence({ secret: L, record: A_REC }, () =>
      sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
    );
    const ch = secret("r11-ch-2");
    present(L, A_REC, ch);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });
});

// ───────────────────────────────────────────── 2. what a thief leaves pending, or releases

describe("RECOVERY vs state the thief touched", () => {
  const OWNER = secret("r11-owner"),
    OWNER_REC = C.commit(OWNER);
  const OBLIGOR = secret("r11-obligor"),
    OBLIGOR_REC = C.commit(OBLIGOR);
  const TERMS = secret("r11-royalty-terms");

  it("FINDING (low, docs): a thief holding a BENEFICIARY's head discharges royalties owed to it; recovery cannot restore them", () => {
    anchor(OWNER);
    anchor(OBLIGOR);
    sim.call(as(OWNER), "proposeObligation", OBLIGOR_REC, TERMS);
    sim.call(as(OBLIGOR), "acceptObligation", TERMS, OWNER_REC);
    expect(openObligations(sim.state, OBLIGOR_REC)).toBe(1n);

    // The thief (who may be the obligor's agent) uses the stolen current secret.
    sim.call(as(OWNER), "discharge", OBLIGOR_REC, TERMS);
    expect(openObligations(sim.state, OBLIGOR_REC)).toBe(0n);

    // The owner recovers ...
    const NEW = secret("r11-owner-new");
    sim.call(
      as(secret("r11-x"), { recovery: rcvOf(OWNER), incoming: NEW }),
      "recoverRecordSecret",
      OWNER_REC,
      C.commit(NEW),
      freshRecovery(),
    );
    // ... and can only re-propose; the obligor now has to agree again, and will not.
    sim.call(as(NEW), "proposeObligation", OBLIGOR_REC, TERMS);
    expect(openObligations(sim.state, OBLIGOR_REC)).toBe(0n);
    expect(checkLineage(sim.state, OBLIGOR_REC).clean).toBe(true);
  });

  it("FINDING (info): a thief's parent proposal survives recovery; the named parent completes it afterwards and the record can never be accepted", () => {
    const ROOT = secret("r11-root"),
      ROOT_REC = C.commit(ROOT);
    const P = secret("r11-attacker-parent"),
      P_REC = C.commit(P);
    anchor(ROOT);
    anchor(OWNER);
    anchor(P);
    // The owner's record descends from a recognised root.
    sim.call(as(OWNER), "proposeParent", ROOT_REC);
    sim.call(as(ROOT), "confirmParent", OWNER_REC);
    expect(checkLineage(sim.state, OWNER_REC, [ROOT_REC]).accepted).toBe(true);

    // A thief holding the owner's current secret names an attacker-held parent.
    // (The owner's own proposal was consumed by the confirm, so the slot is free.)
    sim.call(as(OWNER), "proposeParent", P_REC);

    // Owner recovers. The pending proposal is keyed by identity, so it is still there.
    const NEW = secret("r11-owner-new-2");
    sim.call(
      as(secret("r11-y"), { recovery: rcvOf(OWNER), incoming: NEW }),
      "recoverRecordSecret",
      OWNER_REC,
      C.commit(NEW),
      freshRecovery(),
    );
    expect(sim.state.pendingParentOf.member(OWNER_REC)).toBe(true);

    // The attacker's parent confirms AFTER the recovery: no stolen secret is used now.
    sim.call(as(P), "confirmParent", OWNER_REC);
    const r = checkLineage(sim.state, OWNER_REC, [ROOT_REC]);
    expect(r.roots.map(hex)).toContain(hex(P_REC));
    expect(r.accepted).toBe(false); // permanently: edges cannot be removed
  });

  it("HELD (control): the owner can withdraw the thief's proposal if it lands first", () => {
    const P = secret("r11-attacker-parent-2"),
      P_REC = C.commit(P);
    anchor(OWNER);
    anchor(P);
    sim.call(as(OWNER), "proposeParent", P_REC); // thief
    const NEW = secret("r11-owner-new-3");
    sim.call(
      as(secret("r11-z"), { recovery: rcvOf(OWNER), incoming: NEW }),
      "recoverRecordSecret",
      OWNER_REC,
      C.commit(NEW),
      freshRecovery(),
    );
    sim.call(as(NEW), "withdrawParent");
    expect(() => sim.call(as(P), "confirmParent", OWNER_REC)).toThrow();
  });
});

// ───────────────────────────────────────────── 3. verifier verdict after the identity was recovered

describe("VERIFIER: verdicts never look at what happened after the proof", () => {
  it("FIXED (low): a thief's ownership proof is refused once the owner recovered away from the thief, when the verifier passes the current state", () => {
    const OWNER = secret("r11-own-proof"),
      OWNER_REC = C.commit(OWNER);
    anchor(OWNER);
    const ch = secret("r11-own-ch");
    // Thief, holding the stolen head secret, answers a buyer's challenge.
    sim.call(as(OWNER), "proveOwnership", ch);
    const afterProof = sim.state;
    // Owner recovers an hour later: strong evidence the prover was a thief.
    sim.advance(3600n);
    const NEW = secret("r11-own-new");
    sim.call(
      as(secret("r11-w"), { recovery: rcvOf(OWNER), incoming: NEW }),
      "recoverRecordSecret",
      OWNER_REC,
      C.commit(NEW),
      freshRecovery(),
    );
    expect(isLive(sim.state, OWNER_REC)).toBe(false);
    // The buyer checks the txid the next day. The state after the proof alone still says
    // yes (that is all rule 8 can see) ...
    expect(acceptOwnership(afterProof, OWNER_REC, ch).accepted).toBe(true);
    expect(sim.state.lastRecoveredOrigin).toEqual(OWNER_REC);
    // ... but with the current state (VeilcoreAPI.checkOwnership always passes it) it is refused.
    const v = acceptOwnership(afterProof, OWNER_REC, ch, sim.state);
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/ask for a fresh proof/);
  });

  it("HELD (control): with the current state, a proof by the live head is still accepted", () => {
    const OWNER = secret("r11-own-proof-ok"),
      OWNER_REC = C.commit(OWNER);
    anchor(OWNER);
    const ch = secret("r11-own-ch-ok");
    sim.call(as(OWNER), "proveOwnership", ch);
    const afterProof = sim.state;
    sim.advance(3600n);
    expect(acceptOwnership(afterProof, OWNER_REC, ch, sim.state).accepted).toBe(
      true,
    );
  });
});

// ───────────────────────────────────────────── 4. held

describe("HELD", () => {
  it("a revoked licensee cannot revive itself by proposing a transfer of a licence it no longer has", () => {
    const L = secret("r11-L-h1");
    const lcL = activate(A, L);
    sim.call(as(A), "revokeLicense", lcL, A_REC);
    expect(() =>
      sim.withLicence({ secret: L, record: A_REC }, () =>
        sim.call(
          anyone,
          "proposeTransfer",
          A_REC,
          C.licenseCommit(secret("n"), A_REC),
        ),
      ),
    ).toThrow();
  });

  it("transfer A->B->A (ABA) at one slot brings back the old root only with the holder's own consent", () => {
    const L = secret("r11-L-aba"),
      L2 = secret("r11-L2-aba");
    const lc = activate(A, L);
    const root0 = sim.state.activeLicenses.root().field;
    const nlc = C.licenseCommit(L2, A_REC);
    sim.withLicence({ secret: L, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(A), "approveTransfer", lc, A_REC, nlc);
    seal();
    expect(sim.state.activeLicenses.root().field).not.toBe(root0);
    // Only the new holder can propose the move back, and only the issuer approve it.
    expect(() =>
      sim.withLicence({ secret: L, record: A_REC }, () =>
        sim.call(anyone, "proposeTransfer", A_REC, lc),
      ),
    ).toThrow();
  });

  it("a pending transfer proposal does not survive the issuer's revocation, so a revived key cannot be approved from it", () => {
    const L = secret("r11-L-pt");
    const lc = activate(A, L);
    const nlc = C.licenseCommit(secret("r11-n-pt"), A_REC);
    sim.withLicence({ secret: L, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.call(as(A), "revokeLicense", lc, A_REC);
    sim.call(as(A), "issueLicense", lc);
    expect(() => sim.call(as(A), "approveTransfer", lc, A_REC, nlc)).toThrow();
  });

  it("no cycle via a pending proposal confirmed after the child gained offspring", () => {
    const X = secret("r11-cx"),
      Y = secret("r11-cy");
    anchor(X);
    anchor(Y);
    sim.call(as(X), "proposeParent", C.commit(Y)); // X names Y as parent
    sim.call(as(Y), "proposeParent", C.commit(X)); // Y names X as parent
    sim.call(as(X), "confirmParent", C.commit(Y)); // X is Y's parent; X has offspring
    expect(() => sim.call(as(Y), "confirmParent", C.commit(X))).toThrow();
    expect(checkLineage(sim.state, C.commit(Y)).cyclic).toBe(false);
  });
});
