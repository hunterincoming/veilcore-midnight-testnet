// Lineage: consent-based descent and obligations, keyed by identity so they survive
// rotation and recovery, and the verifier walk over chain state.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  C,
  VeilcoreSimulator,
  ZERO,
  as,
  hex,
  secret,
} from "./veilcore-simulator.js";
import {
  checkLineage,
  identityOf,
  isLive,
  openObligations,
} from "../verify.js";

const GROWER = secret("grower"),
  BREEDER = secret("breeder"),
  COMPETITOR = secret("competitor"),
  SECOND = secret("second");
const G = C.commit(GROWER),
  Br = C.commit(BREEDER),
  Co = C.commit(COMPETITOR),
  S2 = C.commit(SECOND);
const ROYALTY = secret("royalty-terms"),
  FAKE = secret("fake-claim");

let sim: VeilcoreSimulator;
const anchor = (s: Uint8Array): void =>
  sim.call(as(s), "anchor", C.recoveryCommit(secret(`recovery-${hex(s)}`)));
const recoveryOf = (s: Uint8Array): Uint8Array => secret(`recovery-${hex(s)}`);
const owes = (record: Uint8Array): bigint => openObligations(sim.state, record);
const rotate = (from: Uint8Array, to: Uint8Array): void =>
  sim.call(as(from, { incoming: to }), "rotateRecordSecret", C.commit(to));

beforeEach(() => {
  sim = new VeilcoreSimulator();
  [GROWER, BREEDER, COMPETITOR, SECOND].forEach(anchor);
});

describe("obligations need the holder's consent", () => {
  it("a stranger's claim binds nobody, and the stranger cannot accept it for the holder", () => {
    sim.call(as(COMPETITOR), "proposeObligation", G, FAKE);
    expect(owes(G)).toBe(0n);
    expect(() =>
      sim.call(as(COMPETITOR), "acceptObligation", FAKE, Co),
    ).toThrow("No such obligation proposed");
  });

  it("the holder accepts the real claim despite a squatter's proposal", () => {
    sim.call(as(COMPETITOR), "proposeObligation", G, FAKE);
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, Br);
    expect(owes(G)).toBe(1n);
    expect(
      sim.state.openObligations.member(C.obligationKey(G, ROYALTY, Br)),
    ).toBe(true);
    expect(hex(sim.state.lastBeneficiary)).toBe(hex(Br));
  });

  it("only the beneficiary releases; releasing one leaves the other", () => {
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, Br);
    sim.call(as(SECOND), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, S2);
    expect(owes(G)).toBe(2n);
    expect(() => sim.call(as(GROWER), "discharge", G, ROYALTY)).toThrow(
      "in your favour",
    );
    expect(() => sim.call(as(COMPETITOR), "discharge", G, ROYALTY)).toThrow(
      "in your favour",
    );
    expect(() =>
      sim.call(as(GROWER), "withdrawObligation", G, ROYALTY),
    ).toThrow("No such proposal");
    sim.call(as(BREEDER), "discharge", G, ROYALTY);
    expect(owes(G)).toBe(1n);
    sim.call(as(SECOND), "discharge", G, ROYALTY);
    expect(owes(G)).toBe(0n);
    expect(() => sim.call(as(SECOND), "discharge", G, ROYALTY)).toThrow(
      "in your favour",
    );
  });

  it("proposals: no duplicates, only the proposer withdraws, a withdrawn one cannot be accepted", () => {
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    expect(() =>
      sim.call(as(BREEDER), "proposeObligation", G, ROYALTY),
    ).toThrow("already proposed");
    expect(() =>
      sim.call(as(COMPETITOR), "withdrawObligation", G, ROYALTY),
    ).toThrow("No such proposal");
    sim.call(as(BREEDER), "withdrawObligation", G, ROYALTY);
    expect(() => sim.call(as(GROWER), "acceptObligation", ROYALTY, Br)).toThrow(
      "No such obligation proposed",
    );
    expect(() => sim.call(as(GROWER), "proposeObligation", G, ROYALTY)).toThrow(
      "use encumberOwnRecord",
    );
  });

  it("a holder encumbers their own record in one step, and only for themselves", () => {
    sim.call(as(BREEDER), "encumberOwnRecord", ROYALTY);
    expect(owes(Br)).toBe(1n);
    expect(() => sim.call(as(BREEDER), "encumberOwnRecord", ROYALTY)).toThrow(
      "already in force",
    );
    expect(() => sim.call(as(COMPETITOR), "discharge", Br, ROYALTY)).toThrow(
      "in your favour",
    );
    sim.call(as(BREEDER), "discharge", Br, ROYALTY);
    expect(owes(Br)).toBe(0n);
  });

  it("refuses empty and unanchored records", () => {
    expect(() =>
      sim.call(as(BREEDER), "proposeObligation", ZERO, ROYALTY),
    ).toThrow("only for anchored records");
    expect(() => sim.call(as(BREEDER), "proposeObligation", G, ZERO)).toThrow(
      "cannot be empty",
    );
    expect(() => sim.call(as(BREEDER), "encumberOwnRecord", ZERO)).toThrow(
      "cannot be empty",
    );
    const loose = secret("unanchored");
    expect(() => sim.call(as(loose), "encumberOwnRecord", ROYALTY)).toThrow(
      "only for anchored records",
    );
    expect(() =>
      sim.call(as(BREEDER), "proposeObligation", C.commit(loose), ROYALTY),
    ).toThrow("only for anchored records");
  });
});

describe("obligations survive rotation and recovery (independent review, must-fix)", () => {
  it("a beneficiary who rotates can still release what they are owed; the retired secret cannot", () => {
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, Br);
    const B2 = secret("breeder-2");
    rotate(BREEDER, B2);
    expect(() => sim.call(as(BREEDER), "discharge", G, ROYALTY)).toThrow(
      "rotated or recovered",
    );
    sim.call(as(B2), "discharge", G, ROYALTY);
    expect(owes(G)).toBe(0n);
  });

  it("a beneficiary who lost their secret recovers and can still release", () => {
    sim.call(as(BREEDER), "encumberOwnRecord", ROYALTY);
    const NEW = secret("breeder-recovered");
    sim.call(
      as(secret("lost"), { incoming: NEW, recovery: recoveryOf(BREEDER) }),
      "recoverRecordSecret",
      Br,
      C.commit(NEW),
    );
    sim.call(as(NEW), "discharge", Br, ROYALTY);
    expect(owes(Br)).toBe(0n);
  });

  it("a holder who rotates does not shed the obligation", () => {
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, Br);
    const G2 = secret("grower-2");
    rotate(GROWER, G2);
    expect(owes(C.commit(G2))).toBe(1n);
    expect(hex(identityOf(sim.state, C.commit(G2)))).toBe(hex(G));
  });

  it("a thief who stole a beneficiary's secret loses the power to release at recovery", () => {
    sim.call(as(BREEDER), "encumberOwnRecord", ROYALTY);
    const T = secret("thief");
    rotate(BREEDER, T);
    sim.call(
      as(secret("x"), {
        incoming: secret("b3"),
        recovery: recoveryOf(BREEDER),
      }),
      "recoverRecordSecret",
      Br,
      C.commit(secret("b3")),
    );
    expect(() => sim.call(as(T), "discharge", Br, ROYALTY)).toThrow(
      "rotated or recovered",
    );
    expect(owes(Br)).toBe(1n);
  });

  it("an encumbered identity cannot be merged into another to shed it", () => {
    // Only anchored records take part in lineage, and an anchored record can never be a
    // rotation target, so an identity's obligations cannot be moved out from under it.
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, Br);
    expect(() => rotate(COMPETITOR, GROWER)).toThrow(
      "already an anchored record",
    );
    expect(owes(G)).toBe(1n);
  });
});

describe("descent", () => {
  it("takes both holders; strangers can neither confirm nor withdraw", () => {
    sim.call(as(GROWER), "proposeParent", Br);
    expect(() => sim.call(as(COMPETITOR), "confirmParent", G)).toThrow(
      "not the parent proposed",
    );
    expect(() => sim.call(as(GROWER), "proposeParent", Co)).toThrow(
      "already has a parentage proposal",
    );
    expect(() => sim.call(as(COMPETITOR), "withdrawParent")).toThrow(
      "No parentage proposed",
    );
    sim.call(as(BREEDER), "confirmParent", G);
    expect(sim.state.parentsOf.lookup(G).member(Br)).toBe(true);
    expect(hex(sim.state.lastDescentParent)).toBe(hex(Br));
    expect(() => sim.call(as(BREEDER), "confirmParent", G)).toThrow(
      "No parentage proposed",
    );
    expect(() => sim.call(as(GROWER), "proposeParent", Br)).toThrow(
      "already confirmed",
    );
  });

  it("a parent cannot confirm a proposal that now names someone else", () => {
    sim.call(as(GROWER), "proposeParent", Co);
    expect(() => sim.call(as(BREEDER), "confirmParent", G)).toThrow(
      "not the parent proposed",
    );
    sim.call(as(GROWER), "withdrawParent");
    expect(() => sim.call(as(GROWER), "proposeParent", G)).toThrow(
      "not its own parent",
    );
  });

  it("edges are between identities, so they survive either side rotating", () => {
    const G2 = secret("grower-2"),
      B2 = secret("breeder-2");
    rotate(GROWER, G2);
    sim.call(as(G2), "proposeParent", Br); // names the parent by an old commitment
    rotate(BREEDER, B2);
    sim.call(as(B2), "confirmParent", C.commit(G2));
    expect(sim.state.parentsOf.lookup(G).member(Br)).toBe(true);
    expect(isLive(sim.state, C.commit(G2))).toBe(true);
  });

  it("parents must be anchored", () => {
    expect(() => sim.call(as(GROWER), "proposeParent", ZERO)).toThrow(
      "only for anchored records",
    );
    expect(() =>
      sim.call(as(GROWER), "proposeParent", C.commit(secret("nobody"))),
    ).toThrow("only for anchored records");
  });
});

describe("the verifier's walk (verify.ts)", () => {
  const link = (child: Uint8Array, parent: Uint8Array): void => {
    sim.call(as(child), "proposeParent", C.commit(parent));
    sim.call(as(parent), "confirmParent", C.commit(child));
  };

  it("finds an encumbered grandparent the seller did not mention (omission)", () => {
    const GP = secret("grandparent");
    anchor(GP);
    link(GROWER, BREEDER);
    link(BREEDER, GP);
    sim.call(as(GP), "encumberOwnRecord", ROYALTY);
    const report = checkLineage(sim.state, G);
    expect(report.clean).toBe(false);
    expect(report.encumbered.map(hex)).toEqual([hex(C.commit(GP))]);
    expect(report.roots.map(hex)).toEqual([hex(C.commit(GP))]);
  });

  it("is clean when nothing upstream owes anything, and reports the roots", () => {
    link(GROWER, BREEDER);
    const report = checkLineage(sim.state, G);
    expect(report.clean).toBe(true);
    expect(report.ancestors.map(hex)).toEqual([hex(Br)]);
    expect(report.roots.map(hex)).toEqual([hex(Br)]);
  });

  it("walks from any commitment of the identity, and survives cycles", () => {
    link(GROWER, BREEDER);
    link(BREEDER, GROWER);
    const G2 = secret("grower-2");
    rotate(GROWER, G2);
    const report = checkLineage(sim.state, C.commit(G2));
    expect(hex(report.identity)).toBe(hex(G));
    expect(report.ancestors.map(hex)).toEqual([hex(Br)]);
  });

  it("clears when the beneficiary releases", () => {
    link(GROWER, BREEDER);
    sim.call(as(BREEDER), "encumberOwnRecord", ROYALTY);
    expect(checkLineage(sim.state, G).clean).toBe(false);
    sim.call(as(BREEDER), "discharge", Br, ROYALTY);
    expect(checkLineage(sim.state, G).clean).toBe(true);
  });
});

describe("contention and clean-up (second independent review)", () => {
  it("a discharge proved before the holder adds another obligation still lands (counts commute)", () => {
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, Br);
    const release = sim.prove(as(BREEDER), "discharge", G, ROYALTY);
    sim.call(as(GROWER), "encumberOwnRecord", secret("growers-own"));
    sim.land(release);
    expect(owes(G)).toBe(1n);
  });

  it("an accept proved before another beneficiary's discharge still lands", () => {
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, Br);
    sim.call(as(SECOND), "proposeObligation", G, ROYALTY);
    const accept = sim.prove(as(GROWER), "acceptObligation", ROYALTY, S2);
    sim.call(as(BREEDER), "discharge", G, ROYALTY);
    sim.land(accept);
    expect(owes(G)).toBe(1n);
  });

  it("the holder can reject proposals, so they cannot pile up; nobody else can", () => {
    sim.call(as(COMPETITOR), "proposeObligation", G, FAKE);
    expect(() => sim.call(as(BREEDER), "rejectObligation", FAKE, Co)).toThrow(
      "No such obligation proposed",
    );
    sim.call(as(GROWER), "rejectObligation", FAKE, Co);
    expect(
      sim.state.pendingObligations.member(C.obligationKey(G, FAKE, Co)),
    ).toBe(false);
    expect(() => sim.call(as(GROWER), "acceptObligation", FAKE, Co)).toThrow(
      "No such obligation proposed",
    );
  });
});

describe("known limit: what a thief does with a stolen secret before recovery stays", () => {
  // docs/design.md, "Known limits". Recovery stops a thief from acting again; it does
  // not undo what they did while they held the current secret. This test pins that
  // down so the documentation cannot drift from the behaviour.
  it("an obligation the thief accepted on the victim's record outlives recovery", () => {
    const T = secret("thief"),
      Tr = C.commit(T);
    anchor(T);
    sim.call(as(T), "proposeObligation", Br, FAKE);
    sim.call(as(BREEDER), "acceptObligation", FAKE, Tr); // the thief, holding BREEDER's secret
    const NEW = secret("breeder-new");
    sim.call(
      as(secret("x"), { incoming: NEW, recovery: recoveryOf(BREEDER) }),
      "recoverRecordSecret",
      Br,
      C.commit(NEW),
    );
    expect(owes(Br)).toBe(1n);
    expect(() => sim.call(as(NEW), "discharge", Br, FAKE)).toThrow(
      "in your favour",
    );
  });
});

describe("the verifier's walk: cycles, the record itself, and recognised roots", () => {
  const link = (child: Uint8Array, parent: Uint8Array): void => {
    sim.call(as(child), "proposeParent", C.commit(parent));
    sim.call(as(parent), "confirmParent", C.commit(child));
  };

  it("flags a pedigree that loops, which has no root to check", () => {
    link(GROWER, BREEDER);
    link(BREEDER, COMPETITOR);
    link(COMPETITOR, BREEDER);
    const r = checkLineage(sim.state, G, [Br, Co]);
    expect(r.cyclic).toBe(true);
    expect(r.roots).toEqual([]);
    expect(r.accepted).toBe(false);
  });

  it("counts an obligation on the record itself, not only on ancestors", () => {
    link(GROWER, BREEDER);
    sim.call(as(GROWER), "encumberOwnRecord", ROYALTY);
    const r = checkLineage(sim.state, G, [Br]);
    expect(r.encumbered.map(hex)).toEqual([hex(G)]);
    expect(r.clean).toBe(false);
  });

  it("accepts only when every root is one the verifier recognises", () => {
    link(GROWER, BREEDER);
    expect(checkLineage(sim.state, G).accepted).toBe(false);
    expect(checkLineage(sim.state, G, [Co]).accepted).toBe(false);
    expect(checkLineage(sim.state, G, [Br]).accepted).toBe(true);
    const B2 = secret("breeder-2");
    rotate(BREEDER, B2);
    expect(checkLineage(sim.state, G, [C.commit(B2)]).accepted).toBe(true); // any commitment of the identity
  });
});

describe("the verifier's walk: shared ancestors and founding records (third review)", () => {
  const link = (child: Uint8Array, parent: Uint8Array): void => {
    sim.call(as(child), "proposeParent", C.commit(parent));
    sim.call(as(parent), "confirmParent", C.commit(child));
  };

  it("a backcross (two lines sharing an ancestor) is not a cycle", () => {
    const R = secret("root-mother");
    anchor(R);
    link(GROWER, BREEDER);
    link(GROWER, COMPETITOR); // a cross: two parents
    link(BREEDER, R);
    link(COMPETITOR, R); // both descend from R
    const r = checkLineage(sim.state, G, [C.commit(R)]);
    expect(r.cyclic).toBe(false);
    expect(r.roots.map(hex)).toEqual([hex(C.commit(R))]);
    expect(r.accepted).toBe(true);
  });

  it("a founding record with no parents is its own root", () => {
    const r = checkLineage(sim.state, Br, [Br]);
    expect(r.roots.map(hex)).toEqual([hex(Br)]);
    expect(r.accepted).toBe(true);
    expect(checkLineage(sim.state, Br).accepted).toBe(false);
  });

  it("the first two obligations on a record, accepted concurrently, both land", () => {
    sim.call(as(BREEDER), "proposeObligation", G, ROYALTY);
    sim.call(as(SECOND), "proposeObligation", G, ROYALTY);
    const first = sim.prove(as(GROWER), "acceptObligation", ROYALTY, Br);
    sim.call(as(GROWER), "acceptObligation", ROYALTY, S2);
    sim.land(first);
    expect(owes(G)).toBe(2n);
  });
});
