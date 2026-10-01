// Round 11 (1 Oct): rule coverage audit, Battleship-tutorial style. Every rule stated in
// README.md and docs/design.md that had no test proving it, and every illegal move no
// earlier suite tried, gets one here.
//
//   PROVEN   the rule holds; this test would fail if it stopped holding.
//   LIMIT    pins behaviour the docs do not describe (or describe differently).
//   VIOLATED the docs say the code does this; it does not. These tests FAIL on purpose.
//            (The two rule 5 / rule 8 "use it once" ones were fixed on 1 Oct with
//            ChallengeBook in verify.ts and are PROVEN now.)
//
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ChallengeBook,
  acceptOwnership,
  acceptOwnershipOnce,
  acceptPresentation,
  acceptPresentationOnce,
  checkLineage,
  isLive,
  openObligations,
} from "../verify.js";
import {
  C,
  VeilcoreSimulator,
  ZERO,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const A = secret("r11-A"),
  A_REC = C.commit(A);
const B = secret("r11-B"),
  B_REC = C.commit(B);
const G = secret("r11-G");
const X = secret("r11-stranger");
const LOOSE = secret("r11-never-anchored"),
  LOOSE_REC = C.commit(LOOSE);
const L1 = secret("r11-L1"),
  L2 = secret("r11-L2");
const TERMS = secret("r11-terms+salt");
const anyone = as(secret("r11-anyone"));
const rcv = (s: Uint8Array): Uint8Array => secret(`r11-rcv-${hex(s)}`);

let sim: VeilcoreSimulator;
const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(rcv(s)));
};
const rotate = (from: Uint8Array, to: Uint8Array): void =>
  sim.call(as(from, { incoming: to }), "rotateRecordSecret", C.commit(to));
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
const propose = (l: Uint8Array, rec: Uint8Array, next: Uint8Array): void =>
  sim.withLicence({ secret: l, record: rec }, () =>
    sim.call(anyone, "proposeTransfer", rec, next),
  );
const present = (l: Uint8Array, rec: Uint8Array, ch: Uint8Array): void =>
  sim.withLicence({ secret: l, record: rec, challenge: ch }, () =>
    sim.call(anyone, "proveLicense"),
  );

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

// ───────────────────────────────────────────────────── identity (design.md, Identity)

describe("PROVEN: only an anchored identity acts as a record holder, in every lineage circuit", () => {
  // design.md: "Only an anchored identity acts as a record holder: ... lineage all
  // require one." Earlier suites tried only encumberOwnRecord with an unanchored caller.
  beforeEach(() => {
    [A, B].forEach(anchor);
    sim.call(as(A), "proposeParent", B_REC);
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
  });
  const refused = (f: () => void): void =>
    expect(f).toThrow("only for anchored records");

  it("proposeParent, confirmParent, withdrawParent", () => {
    refused(() => sim.call(as(LOOSE), "proposeParent", B_REC));
    refused(() => sim.call(as(LOOSE), "confirmParent", A_REC));
    refused(() => sim.call(as(LOOSE), "withdrawParent"));
  });

  it("proposeObligation, withdrawObligation, acceptObligation, rejectObligation, discharge", () => {
    refused(() => sim.call(as(LOOSE), "proposeObligation", A_REC, TERMS));
    refused(() => sim.call(as(LOOSE), "withdrawObligation", A_REC, TERMS));
    refused(() => sim.call(as(LOOSE), "acceptObligation", TERMS, B_REC));
    refused(() => sim.call(as(LOOSE), "rejectObligation", TERMS, B_REC));
    refused(() => sim.call(as(LOOSE), "discharge", A_REC, TERMS));
  });

  it("naming an unanchored beneficiary is refused too", () => {
    refused(() => sim.call(as(A), "acceptObligation", TERMS, LOOSE_REC));
    refused(() => sim.call(as(A), "rejectObligation", TERMS, LOOSE_REC));
  });

  it("an unanchored commitment can neither revoke nor approve a transfer of anyone's licence", () => {
    const lc = active(A, L1);
    propose(L1, A_REC, C.licenseCommit(L2, A_REC));
    expect(() => sim.call(as(LOOSE), "revokeLicense", lc, A_REC)).toThrow(
      "Only the issuing record",
    );
    expect(() =>
      sim.call(
        as(LOOSE),
        "approveTransfer",
        lc,
        A_REC,
        C.licenseCommit(L2, A_REC),
      ),
    ).toThrow("Only the issuing record");
  });
});

describe("PROVEN: a retired commitment can do nothing (trust model), in the circuits not yet tried", () => {
  beforeEach(() => {
    [A, B].forEach(anchor);
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    rotate(A, secret("r11-A2"));
  });
  const retired = (f: () => void): void =>
    expect(f).toThrow("rotated or recovered");

  it("lineage circuits", () => {
    retired(() => sim.call(as(A), "proposeParent", B_REC));
    retired(() => sim.call(as(A), "withdrawParent"));
    retired(() => sim.call(as(A), "confirmParent", B_REC));
    retired(() => sim.call(as(A), "acceptObligation", TERMS, B_REC));
    retired(() => sim.call(as(A), "rejectObligation", TERMS, B_REC));
    retired(() => sim.call(as(A), "proposeObligation", B_REC, TERMS));
    retired(() => sim.call(as(A), "withdrawObligation", B_REC, TERMS));
  });

  it("approveTransfer of a licence the identity issued before it rotated", () => {
    sim = new VeilcoreSimulator();
    const lc = active(A, L1);
    const nlc = C.licenseCommit(L2, A_REC);
    propose(L1, A_REC, nlc);
    rotate(A, secret("r11-A2"));
    retired(() => sim.call(as(A), "approveTransfer", lc, A_REC, nlc));
    sim.call(as(secret("r11-A2")), "approveTransfer", lc, A_REC, nlc); // the head can
  });
});

describe("PROVEN: rotation and recovery inputs (illegal moves no suite tried)", () => {
  beforeEach(() => anchor(A));

  it("rotating into the same commitment is refused", () => {
    expect(() =>
      sim.call(as(A, { incoming: A }), "rotateRecordSecret", A_REC),
    ).toThrow("must differ from the old one");
  });

  it("a recovery cannot install the empty or the all-zero-secret recovery commitment", () => {
    const n = secret("r11-n");
    const recover = (next: Uint8Array): void =>
      sim.call(
        as(X, { incoming: n, recovery: rcv(A) }),
        "recoverRecordSecret",
        A_REC,
        C.commit(n),
        next,
      );
    expect(() => recover(ZERO)).toThrow("cannot be empty");
    expect(() => recover(C.recoveryCommit(ZERO))).toThrow("all-zero secret");
    expect(isLive(sim.state, A_REC)).toBe(true);
  });

  it("recovery of a commitment that was never anchored is refused", () => {
    expect(() =>
      sim.call(
        as(X, { incoming: secret("r11-n2"), recovery: ZERO }),
        "recoverRecordSecret",
        LOOSE_REC,
        C.commit(secret("r11-n2")),
        freshRecovery(),
      ),
    ).toThrow("only for an anchored origin");
  });

  it("replaceRecoveryCommitment refuses the current value, a successor, and a never-anchored record", () => {
    expect(() =>
      sim.call(
        as(X, { recovery: rcv(A) }),
        "replaceRecoveryCommitment",
        A_REC,
        C.recoveryCommit(rcv(A)),
      ),
    ).toThrow("must differ");
    const A2 = secret("r11-A2");
    rotate(A, A2);
    expect(() =>
      sim.call(
        as(X, { recovery: rcv(A) }),
        "replaceRecoveryCommitment",
        C.commit(A2),
        freshRecovery(),
      ),
    ).toThrow("only for an anchored origin");
    expect(() =>
      sim.call(
        as(X, { recovery: ZERO }),
        "replaceRecoveryCommitment",
        LOOSE_REC,
        freshRecovery(),
      ),
    ).toThrow("only for an anchored origin");
  });
});

// ───────────────────────────────────────────────────── licences (design.md, Licences)

describe("PROVEN: transfers — only the holder proposes, only the issuer's identity approves", () => {
  it("a stranger cannot approve a transfer, nor approve one that was never proposed or was withdrawn", () => {
    const lc = active(A, L1);
    const nlc = C.licenseCommit(L2, A_REC);
    anchor(X);
    expect(() => sim.call(as(A), "approveTransfer", lc, A_REC, nlc)).toThrow(
      "No transfer proposed",
    );
    propose(L1, A_REC, nlc);
    expect(() => sim.call(as(X), "approveTransfer", lc, A_REC, nlc)).toThrow(
      "Only the issuing record",
    );
    sim.withLicence({ secret: L1, record: A_REC }, () =>
      sim.call(anyone, "withdrawTransfer", A_REC),
    );
    expect(() => sim.call(as(A), "approveTransfer", lc, A_REC, nlc)).toThrow(
      "No transfer proposed",
    );
  });

  it("someone without the licence secret can neither propose nor withdraw a transfer of it", () => {
    active(A, L1);
    const nlc = C.licenseCommit(L2, A_REC);
    expect(() => propose(secret("r11-guess"), A_REC, nlc)).toThrow(
      "No such license",
    );
    propose(L1, A_REC, nlc);
    expect(() =>
      sim.withLicence({ secret: secret("r11-guess"), record: A_REC }, () =>
        sim.call(anyone, "withdrawTransfer", A_REC),
      ),
    ).toThrow("No transfer proposed");
    expect(
      sim.state.pendingTransferOf.member(
        C.licenseKey(C.licenseCommit(L1, A_REC), A_REC),
      ),
    ).toBe(true);
  });

  it("a PENDING (never countersigned) licence cannot be transferred", () => {
    issue(A, L1);
    expect(() => propose(L1, A_REC, C.licenseCommit(L2, A_REC))).toThrow(
      "Only an active license",
    );
  });

  it("approval is refused if the named recipient's commitment came into use after the proposal", () => {
    const lc = active(A, L1);
    const nlc = C.licenseCommit(L2, A_REC);
    propose(L1, A_REC, nlc);
    sim.call(as(A), "issueLicense", nlc); // the same commitment, now a separate licence
    expect(() => sim.call(as(A), "approveTransfer", lc, A_REC, nlc)).toThrow(
      "already in use",
    );
  });
});

describe("PROVEN: the licence state machine has no illegal edges", () => {
  it("an ACTIVE licence cannot be countersigned again (no second leaf)", () => {
    issue(A, L1);
    countersign(L1, A_REC);
    expect(() => countersign(L1, A_REC)).toThrow("not pending");
  });

  it("a PENDING licence cannot be presented", () => {
    issue(A, L1);
    expect(() => present(L1, A_REC, secret("r11-ch"))).toThrow(
      /No live licence/,
    );
  });

  it("revoking a licence that does not exist is refused", () => {
    anchor(A);
    expect(() =>
      sim.call(as(A), "revokeLicense", C.licenseCommit(L1, A_REC), A_REC),
    ).toThrow("No such license");
  });

  it("revoking a PENDING licence does not arm a seal; a transfer does; propose and withdraw do not", () => {
    const lc = issue(A, L1);
    sim.call(as(A), "revokeLicense", lc, A_REC);
    expect(sim.state.unsealedChanges).toBe(false);
    expect(() => sim.call(anyone, "sealRevocations", sim.now + 60n)).toThrow(
      "Nothing has changed the licence tree",
    );
    const lc2 = active(A, L2);
    const nlc = C.licenseCommit(secret("r11-L3"), A_REC);
    propose(L2, A_REC, nlc);
    expect(sim.state.unsealedChanges).toBe(false);
    sim.withLicence({ secret: L2, record: A_REC }, () =>
      sim.call(anyone, "withdrawTransfer", A_REC),
    );
    expect(sim.state.unsealedChanges).toBe(false);
    propose(L2, A_REC, nlc);
    sim.call(as(A), "approveTransfer", lc2, A_REC, nlc);
    expect(sim.state.unsealedChanges).toBe(true);
    sim.call(anyone, "sealRevocations", sim.now + 60n);
  });
});

// ───────────────────────────────────────────────────── lineage (design.md, Lineage)

describe("PROVEN: obligations — illegal moves no suite tried", () => {
  beforeEach(() => [A, B, G].forEach(anchor));

  it("a holder cannot shed an ACCEPTED obligation by rejecting it", () => {
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    sim.call(as(A), "acceptObligation", TERMS, B_REC);
    expect(() => sim.call(as(A), "rejectObligation", TERMS, B_REC)).toThrow(
      "No such obligation proposed",
    );
    expect(openObligations(sim.state, A_REC)).toBe(1n);
  });

  it("a beneficiary cannot discharge a proposal that was never accepted (the count cannot go negative)", () => {
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    expect(() => sim.call(as(B), "discharge", A_REC, TERMS)).toThrow(
      "No such obligation in your favour",
    );
    expect(openObligations(sim.state, A_REC)).toBe(0n);
  });

  it("an obligation already in force cannot be proposed again", () => {
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    sim.call(as(A), "acceptObligation", TERMS, B_REC);
    expect(() => sim.call(as(B), "proposeObligation", A_REC, TERMS)).toThrow(
      "already in force",
    );
  });

  it("a beneficiary cannot withdraw an obligation once accepted (only discharge releases it)", () => {
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    sim.call(as(A), "acceptObligation", TERMS, B_REC);
    expect(() => sim.call(as(B), "withdrawObligation", A_REC, TERMS)).toThrow(
      "No such proposal",
    );
    expect(openObligations(sim.state, A_REC)).toBe(1n);
  });

  it("a holder cannot 'propose' against its own record through another of its commitments", () => {
    const A2 = secret("r11-A2");
    rotate(A, A2);
    expect(() => sim.call(as(A2), "proposeObligation", A_REC, TERMS)).toThrow(
      "use encumberOwnRecord",
    );
  });

  it("a proposal survives the beneficiary rotating before acceptance; the holder may name any commitment of it", () => {
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    const B2 = secret("r11-B2");
    rotate(B, B2);
    sim.call(as(A), "acceptObligation", TERMS, C.commit(B2));
    expect(openObligations(sim.state, A_REC)).toBe(1n);
    sim.call(as(B2), "discharge", A_REC, TERMS);
    expect(openObligations(sim.state, A_REC)).toBe(0n);
  });

  it("a proposal survives the holder rotating before acceptance", () => {
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    const A2 = secret("r11-A2");
    rotate(A, A2);
    sim.call(as(A2), "acceptObligation", TERMS, B_REC);
    expect(openObligations(sim.state, C.commit(A2))).toBe(1n);
  });
});

describe("PROVEN: descent — illegal moves no suite tried", () => {
  beforeEach(() => [A, B, G].forEach(anchor));

  it("a record cannot name itself as a parent through another of its own commitments", () => {
    const A2 = secret("r11-A2");
    rotate(A, A2);
    expect(() => sim.call(as(A2), "proposeParent", A_REC)).toThrow(
      "not its own parent",
    );
  });

  it("a proposal that was withdrawn cannot be confirmed", () => {
    sim.call(as(A), "proposeParent", B_REC);
    sim.call(as(A), "withdrawParent");
    expect(() => sim.call(as(B), "confirmParent", A_REC)).toThrow(
      "No parentage proposed",
    );
  });
});

describe("PROVEN: a record has at most two parents (was a LIMIT before the state bounds)", () => {
  it("a third consenting parent is refused at proposal and at confirmation", () => {
    anchor(A);
    const ps = [0, 1, 2].map((i) => secret(`r11-fan-${i}`));
    ps.forEach(anchor);
    for (const p of ps.slice(0, 2)) {
      sim.call(as(A), "proposeParent", C.commit(p));
      sim.call(as(p), "confirmParent", A_REC);
    }
    expect(() => sim.call(as(A), "proposeParent", C.commit(ps[2]))).toThrow(
      "already has two parents",
    );
    expect([...sim.state.parentsOf.lookup(A_REC)].length).toBe(2);
  });
});

// ───────────────────────────────────────────────────── event cells (rule 6)

describe("PROVEN: rule 6 — which circuit writes which event cell", () => {
  beforeEach(() => [A, B].forEach(anchor));

  it("a recovery clears lastRotatedFrom; a rotation clears lastRecoveredOrigin", () => {
    rotate(B, secret("r11-B2")); // someone else's rotation leaves lastRotatedFrom set
    const n = secret("r11-A-new");
    sim.call(
      as(X, { incoming: n, recovery: rcv(A) }),
      "recoverRecordSecret",
      A_REC,
      C.commit(n),
      freshRecovery(),
    );
    expect(hex(sim.state.lastRotatedFrom)).toBe(hex(ZERO));
    expect(hex(sim.state.lastRecoveredOrigin)).toBe(hex(A_REC));
    expect(hex(sim.state.lastRotatedTo)).toBe(hex(C.commit(n)));
    rotate(n, secret("r11-A-newer"));
    expect(hex(sim.state.lastRecoveredOrigin)).toBe(hex(ZERO));
    expect(hex(sim.state.lastRotatedFrom)).toBe(hex(C.commit(n)));
  });

  it("rejecting or withdrawing a proposal writes no obligation event", () => {
    const seq = sim.state.obligationSeq;
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    sim.call(as(A), "rejectObligation", TERMS, B_REC);
    sim.call(as(B), "proposeObligation", A_REC, TERMS);
    sim.call(as(B), "withdrawObligation", A_REC, TERMS);
    expect(sim.state.obligationSeq).toBe(seq);
    expect(hex(sim.state.lastObligation)).toBe(hex(ZERO));
  });
});

// ───────────────────────────────────────────────────── verifier (verify.ts)

describe("PROVEN: rule 3 — a commitment the chain has never seen is not clean (direct)", () => {
  it("never anchored: not clean, not accepted, even if the verifier lists it as a root", () => {
    const r = checkLineage(sim.state, LOOSE_REC, [LOOSE_REC]);
    expect(r.anchored).toBe(false);
    expect(r.clean).toBe(false);
    expect(r.accepted).toBe(false);
  });
});

describe("PROVEN: rule 8 — acceptOwnership branches no suite reached", () => {
  it("refuses a zero or short challenge, and a contract with no proof yet", () => {
    anchor(A);
    expect(acceptOwnership(sim.state, A_REC, secret("c")).accepted).toBe(false); // proofSeq 0
    sim.call(as(A), "proveOwnership", secret("c"));
    expect(acceptOwnership(sim.state, A_REC, ZERO).accepted).toBe(false);
    expect(
      acceptOwnership(sim.state, A_REC, new Uint8Array(31).fill(1)).accepted,
    ).toBe(false);
  });

  it("a proof read from the wrong state (after the prover rotated) is refused: not the live head", () => {
    anchor(A);
    const ch = secret("r11-own");
    sim.call(as(A), "proveOwnership", ch);
    rotate(A, secret("r11-A2"));
    const v = acceptOwnership(sim.state, A_REC, ch);
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/live, anchored head/);
  });
});

describe("NOTE: rule 1 — isLive reports a never-seen commitment as live", () => {
  // Consistent with the contract (anchor relies on it), but rule 1 says "or it is an
  // un-moved ORIGIN". Callers must pair isLive with isAnchored; acceptOwnership does.
  it("isLive(random) is true", () => {
    expect(isLive(sim.state, LOOSE_REC)).toBe(true);
  });
});

describe("PROVEN (was VIOLATED): rule 5 / rule 8 'use it once' — ChallengeBook", () => {
  // design.md rule 5: "use it once: keep the challenges you issued, when, and whether each
  // was used". acceptPresentation / acceptOwnership judge one state and have no memory;
  // ChallengeBook (verify.ts) is the memory, and the *Once forms use it. The CLI keeps the
  // book in an encrypted file so options 26/27/28 enforce it across runs.
  it("a challenge already used to accept a presentation is refused a second time", () => {
    active(A, L1);
    const book = new ChallengeBook();
    const { challenge: ch } = book.issue("licence");
    present(L1, A_REC, ch);
    const tx = sim.state;
    expect(acceptPresentation(tx, A_REC, ch).accepted).toBe(true); // the verdict alone has no memory
    expect(acceptPresentationOnce(book, tx, A_REC, ch).accepted).toBe(true); // first use
    const again = acceptPresentationOnce(book, tx, A_REC, ch);
    expect(again.accepted).toBe(false); // must be refused
    expect(again.reason).toMatch(/already used/);
  });

  it("a challenge already used to accept an ownership proof is refused a second time", () => {
    anchor(A);
    const book = new ChallengeBook();
    const { challenge: ch } = book.issue("ownership");
    sim.call(as(A), "proveOwnership", ch);
    const tx = sim.state;
    expect(acceptOwnership(tx, A_REC, ch).accepted).toBe(true);
    expect(acceptOwnershipOnce(book, tx, A_REC, ch).accepted).toBe(true);
    expect(acceptOwnershipOnce(book, tx, A_REC, ch).accepted).toBe(false);
  });

  it("a challenge this verifier never issued, or issued for the other kind, is refused", () => {
    anchor(A);
    const book = new ChallengeBook();
    const stranger = secret("r11-not-issued");
    sim.call(as(A), "proveOwnership", stranger);
    expect(
      acceptOwnershipOnce(book, sim.state, A_REC, stranger).reason,
    ).toMatch(/not a challenge you issued/);
    const { challenge: forLicence } = book.issue("licence");
    sim.call(as(A), "proveOwnership", forLicence);
    const v = acceptOwnershipOnce(book, sim.state, A_REC, forLicence);
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/licence presentation/);
  });

  it("a refused check does not use the challenge up; an expired one is refused", () => {
    anchor(A);
    let t = 1_000;
    const book = new ChallengeBook({ now: () => t, maxAgeMs: 60_000 });
    const { challenge: ch } = book.issue("ownership");
    // The holder first points at the wrong state (before they answered): refused, still usable.
    expect(acceptOwnershipOnce(book, sim.state, A_REC, ch).accepted).toBe(
      false,
    );
    sim.call(as(A), "proveOwnership", ch);
    t += 61_000;
    const late = acceptOwnershipOnce(book, sim.state, A_REC, ch);
    expect(late.accepted).toBe(false);
    expect(late.reason).toMatch(/too old/);
  });

  it("the book survives a save and reload through entries()", () => {
    const book = new ChallengeBook();
    const { challenge: ch } = book.issue("licence");
    expect(book.consume(ch, "licence").ok).toBe(true);
    const reloaded = new ChallengeBook({
      entries: JSON.parse(JSON.stringify(book.entries())),
    });
    expect(reloaded.consume(ch, "licence").ok).toBe(false);
  });
});

// ───────────────────────────────────────────────────── docs claims checked against artefacts

describe("PROVEN: design.md Constraints — 'Browser-viable proving. 24 circuits, each under 700 ZKIR operations'", () => {
  it("24 ZKIR files, every one under 700 instructions", () => {
    const dir = here("../managed/veilcore/zkir");
    const files = readdirSync(dir).filter((f) => f.endsWith(".zkir"));
    expect(files.length).toBe(24);
    for (const f of files) {
      const z = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as {
        instructions: unknown[];
      };
      expect(z.instructions.length, f).toBeLessThan(700);
    }
  });
});

describe("LIMIT: 'Every hash the contract uses is plain SHA-256' (README) is not true of the licence tree", () => {
  // The six commitment hashes are plain SHA-256 (interface.test.ts). The licence tree's
  // inner nodes, which acceptPresentation compares (lastPresentationRoot vs root()), use
  // Midnight's transientHash, a field hash, so a verifier needs Midnight tooling for them.
  it("the compiled contract hashes Merkle nodes with transientHash", () => {
    const js = readFileSync(
      here("../managed/veilcore/contract/index.js"),
      "utf8",
    );
    expect(js).toMatch(/_transientHash_0\(\[left_0, right_0\]\)/);
    expect(typeof sim.state.activeLicenses.root().field).toBe("bigint");
  });
});

describe("LIMIT: README 'License ... active, expired or revoked' — the contract has no expiry", () => {
  it("a licence still presents and is accepted ten years later", () => {
    active(A, L1);
    sim.advance(10n * 365n * 24n * 3600n);
    const ch = secret("r11-decade");
    present(L1, A_REC, ch);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });
});

describe("PROVEN + doc fix: a thief's PENDING licence is invisible to the owner; issueLicense does NOT publish the licence commitment", () => {
  // design.md Known limits says the owner "cannot revoke what it does not know" (true,
  // proven here) and also that "Issue, countersign, transfer and revoke publish the
  // licence commitment and the issuer". For issue that is wrong: its transcript carries
  // licenseKey(lc, issuer) and the issuer, not lc, and revokeLicense needs lc.
  it("the issue transcript names the key, the issuer and (since the state bounds) the licence commitment", () => {
    anchor(A);
    const T = secret("r11-thief"),
      T_REC = C.commit(T);
    rotate(A, T);
    const lcT = C.licenseCommit(secret("r11-thief-lic"), T_REC);
    const tx = sim.prove(as(T), "issueLicense", lcT);
    const blob = JSON.stringify(tx.transcript, (_k, v: unknown) =>
      typeof v === "bigint"
        ? v.toString()
        : v instanceof Uint8Array
          ? hex(v)
          : v,
    );
    expect(blob.includes(hex(lcT))).toBe(true); // published so a recovered owner can revoke
    expect(blob.includes(hex(C.licenseKey(lcT, T_REC)))).toBe(true);
    expect(blob.includes(hex(T_REC))).toBe(true);
  });
});
