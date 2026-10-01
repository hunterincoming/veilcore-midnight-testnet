// Attack round 4 (1 Oct): mempool front-running, what is disclosed, witness tampering,
// hash domains. FINDING = demonstrated problem; HELD = attack refused.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptOwnership, acceptPresentation } from "../verify.js";
import {
  C,
  VeilcoreSimulator,
  ZERO,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";

const sha = (...parts: Uint8Array[]): Uint8Array => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
const tag32 = (s: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(Buffer.from(s, "utf8"));
  return b;
};

const A = secret("r4-issuer-A"),
  A_REC = C.commit(A);
const B = secret("r4-issuer-B"),
  B_REC = C.commit(B);
const H = secret("r4-holder"),
  H_REC = C.commit(H);
const E = secret("r4-attacker");
const anyone = as(secret("r4-anyone"));
let sim: VeilcoreSimulator;

const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(secret(`r4-rcv-${hex(s)}`)));
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

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

// ───────────────────────────────────────────────────────── 1. mempool

describe("MEMPOOL: racing a pending transaction", () => {
  it("HELD: a pending anchor cannot be squatted (batch, same recovery, recover, rotate-into all fail to stop it)", () => {
    const rcv = C.recoveryCommit(secret("r4-H-rcv"));
    const pending = sim.prove(as(H), "anchor", rcv);
    // observer copies c and rcv from the pending transaction
    sim.call(anyone, "anchorBatch", H_REC);
    sim.call(as(E), "anchor", rcv); // same recovery commitment, own record: allowed, harmless
    expect(() =>
      sim.call(
        as(E, { recovery: secret("guess") }),
        "recoverRecordSecret",
        H_REC,
        C.commit(E),
        freshRecovery(),
      ),
    ).toThrow();
    expect(() =>
      sim.call(as(E, { incoming: secret("x") }), "rotateRecordSecret", H_REC),
    ).toThrow(); // needs H's secret
    sim.land(pending);
    expect(hex(sim.state.recoveryOf.lookup(H_REC))).toBe(hex(rcv));
  });

  it("HELD: a pending recovery cannot be front-run into failure by the thief holding the head", () => {
    const rs = secret("r4-H-recovery");
    sim.call(as(H), "anchor", C.recoveryCommit(rs));
    const F = secret("r4-H-fresh");
    const pending = sim.prove(
      as(secret("r4-offline"), { recovery: rs, incoming: F }),
      "recoverRecordSecret",
      H_REC,
      C.commit(F),
      freshRecovery(),
    );
    // thief sees fresh + new recovery commitment; rotates, tries to replace recovery
    sim.call(
      as(H, { incoming: secret("r4-thief-1") }),
      "rotateRecordSecret",
      C.commit(secret("r4-thief-1")),
    );
    expect(() =>
      sim.call(
        as(secret("r4-thief-1"), { recovery: secret("r4-guess") }),
        "replaceRecoveryCommitment",
        H_REC,
        freshRecovery(),
      ),
    ).toThrow();
    sim.land(pending);
    expect(hex(sim.state.headOf.lookup(H_REC))).toBe(hex(C.commit(F)));
  });

  it("HELD: copying a pending proveOwnership challenge and landing first does not steal or block the proof", () => {
    anchor(H);
    anchor(E);
    const ch = secret("r4-own-ch");
    const pending = sim.prove(as(H), "proveOwnership", ch);
    sim.call(as(E), "proveOwnership", ch); // copied challenge, own record
    const attackerState = sim.state;
    expect(acceptOwnership(attackerState, H_REC, ch).accepted).toBe(false);
    sim.land(pending);
    expect(acceptOwnership(sim.state, H_REC, ch).accepted).toBe(true);
  });

  it("HELD: copying a pending proposeTransfer's new commitment only gives the copier's licence away, never the holder's", () => {
    const L1 = secret("r4-L1"),
      L2 = secret("r4-L2"),
      N = secret("r4-incoming");
    const lc1 = activate(A, L1);
    const lc2 = activate(A, L2);
    const nlc = C.licenseCommit(N, A_REC);
    const pending = sim.withLicence({ secret: L1, record: A_REC }, () =>
      sim.prove(anyone, "proposeTransfer", A_REC, nlc),
    );
    sim.withLicence({ secret: L2, record: A_REC }, () =>
      sim.call(anyone, "proposeTransfer", A_REC, nlc),
    ); // copier lands first
    sim.land(pending); // both now pending to nlc
    // issuer approves the one it was shown (L1's), naming lc1
    sim.call(as(A), "approveTransfer", lc1, A_REC, nlc);
    expect(() => sim.call(as(A), "approveTransfer", lc2, A_REC, nlc)).toThrow();
    sim.withLicence({ secret: L2, record: A_REC }, () =>
      sim.call(anyone, "withdrawTransfer", A_REC),
    );
    expect(sim.state.licenseStatusOf.member(C.licenseKey(lc2, A_REC))).toBe(
      true,
    );
  });

  it("HELD: copying a pending proposeObligation's commitment creates an unrelated proposal; the real accept still lands", () => {
    anchor(H);
    anchor(A);
    anchor(E);
    const o = secret("r4-terms+salt");
    sim.call(as(A), "proposeObligation", H_REC, o);
    const accept = sim.prove(as(H), "acceptObligation", o, A_REC);
    sim.call(as(E), "proposeObligation", H_REC, o); // copy
    sim.land(accept);
    expect(sim.state.obligationCountOf.lookup(H_REC).read()).toBe(1n);
    expect(() => sim.call(as(E), "discharge", H_REC, o)).toThrow();
  });

  it("HELD: a third party cannot block a pending confirmParent", () => {
    anchor(H);
    anchor(A);
    anchor(E);
    sim.call(as(H), "proposeParent", A_REC);
    const confirm = sim.prove(as(A), "confirmParent", H_REC);
    sim.call(as(E), "proposeParent", A_REC);
    expect(() => sim.call(as(E), "confirmParent", H_REC)).toThrow();
    const X = secret("r4-other-child");
    anchor(X);
    sim.call(as(X), "proposeParent", H_REC); // naming H as a parent gives H no offspring...
    sim.land(confirm); // ...until H confirms, so this still lands
    expect(sim.state.parentsOf.lookup(H_REC).member(A_REC)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────── 2. disclosure

describe("DISCLOSURE: what the transcripts carry", () => {
  it("HELD: proveLicense's transcript carries the root, two booleans and the tag, nothing naming the licence, issuer or challenge", () => {
    const L = secret("r4-L");
    const lc = activate(A, L);
    const ch = secret("r4-ch");
    const p = sim.withLicence({ secret: L, record: A_REC, challenge: ch }, () =>
      sim.prove(anyone, "proveLicense"),
    );
    const blob = JSON.stringify(p.transcript, (_k, v) =>
      v instanceof Uint8Array
        ? hex(v)
        : typeof v === "bigint"
          ? v.toString()
          : v,
    );
    for (const secretish of [L, A_REC, lc, C.licenseKey(lc, A_REC), ch])
      expect(blob.includes(hex(secretish))).toBe(false);
  });

  it("FINDING: one challenge used for an ownership proof and a presentation names the issuer and links the licensee to the holder", () => {
    anchor(H);
    const LA = secret("r4-LA");
    activate(A, LA);
    activate(B, secret("r4-LB")); // two issuers live: the root alone does not say which
    // verifier makes ONE challenge (CLI option 26 offers one challenge "for a licensee or a holder")
    const ch = secret("r4-shared-ch");
    sim.call(as(H), "proveOwnership", ch);
    const ownershipState = sim.state;
    expect(acceptOwnership(ownershipState, H_REC, ch).accepted).toBe(true);
    sim.withLicence({ secret: LA, record: A_REC, challenge: ch }, () =>
      sim.call(anyone, "proveLicense"),
    );
    const presState = sim.state;
    // verifier accepts both; nothing warns that the challenge is already public
    expect(acceptPresentation(presState, A_REC, ch).accepted).toBe(true);
    // observer: the challenge is in the ownership event cell; test every issuer seen in countersigns
    const published = ownershipState.lastOwnershipChallenge;
    const named = [A_REC, B_REC].filter(
      (r) =>
        hex(C.presentationTag(r, published)) ===
        hex(presState.lastPresentation),
    );
    expect(named.map(hex)).toEqual([hex(A_REC)]);
    // and the same challenge ties the presentation to the record that proved ownership
    expect(hex(ownershipState.lastOwnershipProof)).toBe(hex(H_REC));
  });

  it("HELD (control): with distinct challenges the observer cannot name the issuer", () => {
    anchor(H);
    const LA = secret("r4-LA2");
    activate(A, LA);
    activate(B, secret("r4-LB2"));
    sim.call(as(H), "proveOwnership", secret("r4-own-only"));
    const published = sim.state.lastOwnershipChallenge;
    sim.withLicence(
      { secret: LA, record: A_REC, challenge: secret("r4-pres-only") },
      () => sim.call(anyone, "proveLicense"),
    );
    const named = [A_REC, B_REC].filter(
      (r) =>
        hex(C.presentationTag(r, published)) ===
        hex(sim.state.lastPresentation),
    );
    expect(named).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────── 3. witness tampering

describe("WITNESSES: crafted values from a malicious client", () => {
  it("HELD: wrong-length secrets are refused before any proof", () => {
    anchor(H);
    expect(() =>
      sim.call(as(new Uint8Array(31)), "proveOwnership", secret("c")),
    ).toThrow();
    expect(() =>
      sim.call(as(new Uint8Array(33)), "proveOwnership", secret("c")),
    ).toThrow();
    expect(() =>
      sim.call(
        as(H, { incoming: new Uint8Array(31) }),
        "rotateRecordSecret",
        C.commit(secret("z")),
      ),
    ).toThrow();
  });

  it("HELD: a path whose leaf is someone else's live key is refused", () => {
    const L1 = secret("r4-victim"),
      M = secret("r4-mallory");
    activate(A, L1);
    const victimPath = sim.pathFor(L1, A_REC)!;
    expect(() =>
      sim.withLicence(
        { secret: M, record: A_REC, challenge: secret("c"), path: victimPath },
        () => sim.call(anyone, "proveLicense"),
      ),
    ).toThrow(/No live licence/);
  });

  it("HELD: own leaf grafted onto a victim's siblings, a revoked slot, or a zero leaf is refused", () => {
    const L1 = secret("r4-victim2"),
      M = secret("r4-mallory2");
    const lc = activate(A, L1);
    const victimPath = sim.pathFor(L1, A_REC)!;
    const myLeaf = C.licenseKey(C.licenseCommit(M, A_REC), A_REC);
    expect(() =>
      sim.withLicence(
        {
          secret: M,
          record: A_REC,
          challenge: secret("c"),
          path: { ...victimPath, leaf: myLeaf },
        },
        () => sim.call(anyone, "proveLicense"),
      ),
    ).toThrow(/stale/);
    // revoke: slot holds the default leaf; a zero leaf on that path fails the leaf check,
    // and our leaf on it fails the root check
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(() =>
      sim.withLicence(
        {
          secret: M,
          record: A_REC,
          challenge: secret("c"),
          path: { ...victimPath, leaf: ZERO },
        },
        () => sim.call(anyone, "proveLicense"),
      ),
    ).toThrow(/No live licence/);
    expect(() =>
      sim.withLicence(
        {
          secret: M,
          record: A_REC,
          challenge: secret("c"),
          path: { ...victimPath, leaf: myLeaf },
        },
        () => sim.call(anyone, "proveLicense"),
      ),
    ).toThrow(/stale/);
  });

  it("HELD: naming a different record than the licence was issued against is refused", () => {
    const L = secret("r4-L3");
    activate(A, L);
    anchor(B);
    expect(() =>
      sim.withLicence(
        {
          secret: L,
          record: B_REC,
          challenge: secret("c"),
          path: sim.pathFor(L, A_REC),
        },
        () => sim.call(anyone, "proveLicense"),
      ),
    ).toThrow(/No live licence/);
  });

  it("FINDING (info): the all-zero record secret can be anchored, giving an identity anyone can act as and the first anchorer can recover", () => {
    const zeroOwner = as(ZERO);
    const rs = secret("r4-zero-rcv");
    sim.call(zeroOwner, "anchor", C.recoveryCommit(rs)); // first comer
    const ZREC = C.commit(ZERO);
    // anyone at all, knowing secret 0, issues licences and takes part in lineage as it
    sim.call(as(ZERO), "issueLicense", C.licenseCommit(secret("x"), ZREC));
    anchor(H);
    sim.call(as(ZERO), "proposeParent", H_REC);
    // and the first anchorer can take it over whenever they like
    const F = secret("r4-zero-taken");
    sim.call(
      as(E, { recovery: rs, incoming: F }),
      "recoverRecordSecret",
      ZREC,
      C.commit(F),
      freshRecovery(),
    );
    expect(hex(sim.state.headOf.lookup(ZREC))).toBe(hex(C.commit(F)));
  });
});

// ───────────────────────────────────────────────────────── 4. hash domains

describe("HASH DOMAINS", () => {
  const tags = {
    commit: "veilcore:v1:commit",
    recover: "veilcore:v1:recover",
    license: "veilcore:v1:license",
    lickey: "veilcore:v1:lickey",
    present: "veilcore:v1:present",
    obligation: "veilcore:v1:obligation",
  };

  it("HELD: tags are distinct, NUL-free, under 32 bytes; each domain has a fixed input length, so encodings are injective across domains", () => {
    const vals = Object.values(tags);
    expect(new Set(vals).size).toBe(vals.length);
    for (const t of vals) {
      expect(Buffer.byteLength(t)).toBeLessThan(32);
      expect(t.includes("\0")).toBe(false);
    }
    const x = secret("x"),
      y = secret("y"),
      z = secret("z");
    expect(hex(C.commit(x))).toBe(hex(sha(tag32(tags.commit), x)));
    expect(hex(C.recoveryCommit(x))).toBe(hex(sha(tag32(tags.recover), x)));
    expect(hex(C.licenseCommit(x, y))).toBe(
      hex(sha(tag32(tags.license), x, y)),
    );
    expect(hex(C.licenseKey(x, y))).toBe(hex(sha(tag32(tags.lickey), x, y)));
    expect(hex(C.presentationTag(x, y))).toBe(
      hex(sha(tag32(tags.present), x, y)),
    );
    expect(hex(C.obligationKey(x, y, z))).toBe(
      hex(sha(tag32(tags.obligation), x, y, z)),
    );
    // the Merkle leaf domain is "mdn:lh" || leaf (38 bytes): no 32-byte veilcore tag starts with it
    for (const t of vals) expect(t.startsWith("mdn:")).toBe(false);
    const v1 = JSON.parse(
      readFileSync(new URL("../../vectors/v1.json", import.meta.url), "utf8"),
    );
    expect(v1.protocolVersion).toBe(1);
  });

  it("HELD: feeding one domain's output where another is expected passes no check", () => {
    const L = secret("r4-Ld");
    const lc = activate(A, L);
    const k = C.licenseKey(lc, A_REC);
    // a licensee cannot use the leaf (or lc) as a 'secret' to reach the same leaf
    for (const s of [lc, k])
      expect(() =>
        sim.withLicence(
          {
            secret: s,
            record: A_REC,
            challenge: secret("c"),
            path: sim.pathFor(L, A_REC),
          },
          () => sim.call(anyone, "proveLicense"),
        ),
      ).toThrow();
    // a recovery secret is not a record secret for its own recovery commitment
    const rs = secret("r4-rs");
    sim.call(as(H), "anchor", C.recoveryCommit(rs));
    expect(() => sim.call(as(rs), "proveOwnership", secret("c"))).toThrow();
    // proposeTransfer to the outgoing licence's own commitment, or to the leaf, cannot
    // re-enter or duplicate it
    expect(() =>
      sim.withLicence({ secret: L, record: A_REC }, () =>
        sim.call(anyone, "proposeTransfer", A_REC, lc),
      ),
    ).toThrow(/already in use/);
  });
});
