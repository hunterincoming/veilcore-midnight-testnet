// Tests for verifier checks that mutation testing (StrykerJS on verify.ts, 3 October
// 2026) showed nothing exercised. Each one kills a mutant that survived the suite:
// a check whose removal no test noticed is a check the tests did not make.
// docs/self-audit-3oct.md has the run.
//
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  ChallengeBook,
  DEFAULT_CHALLENGE_MAX_AGE_MS,
  acceptOwnership,
  acceptPresentation,
  acceptPresentationOnce,
  commitmentsOf,
} from "../verify.js";
import { C, VeilcoreSimulator, as, hex, secret } from "./veilcore-simulator.js";

const A = secret("mv-A"),
  A_REC = C.commit(A);
const B = secret("mv-B"),
  B_REC = C.commit(B);

let sim: VeilcoreSimulator;
beforeEach(() => {
  sim = new VeilcoreSimulator();
  sim.call(as(A), "anchor", C.recoveryCommit(secret("mv-rA")));
  sim.call(as(B), "anchor", C.recoveryCommit(secret("mv-rB")));
});

describe("an issuer's commitments are its own, not every identity's", () => {
  it("commitmentsOf(A) leaves out B's successors", () => {
    const A2 = secret("mv-A2");
    const B2 = secret("mv-B2");
    sim.call(as(A, { incoming: A2 }), "rotateRecordSecret", C.commit(A2));
    sim.call(as(B, { incoming: B2 }), "rotateRecordSecret", C.commit(B2));
    const mine = commitmentsOf(sim.state, A_REC).map(hex);
    expect(mine).toEqual([hex(A_REC), hex(C.commit(A2))]);
    expect(mine).not.toContain(hex(C.commit(B2)));
  });

  it("a presentation of B's licence, made under B's successor, is not accepted as A's", () => {
    const B2 = secret("mv-B2p");
    sim.call(as(B, { incoming: B2 }), "rotateRecordSecret", C.commit(B2));
    const B2_REC = C.commit(B2);
    const l = secret("mv-lic");
    sim.call(as(B2), "issueLicense", C.licenseCommit(l, B2_REC));
    sim.withLicence({ secret: l, record: B2_REC }, () =>
      sim.call(
        as(secret("mv-x")),
        "countersignLicense",
        B2_REC,
        sim.freeSlot(),
      ),
    );
    const challenge = secret("mv-ch");
    sim.withLicence({ secret: l, record: B2_REC, challenge }, () =>
      sim.call(as(secret("mv-x")), "proveLicense"),
    );
    expect(acceptPresentation(sim.state, B_REC, challenge).accepted).toBe(true);
    expect(acceptPresentation(sim.state, A_REC, challenge).accepted).toBe(
      false,
    );
  });
});

describe("unusable challenges are refused before anything else", () => {
  for (const [name, ch] of [
    ["all zero", new Uint8Array(32)],
    ["31 bytes", new Uint8Array(31).fill(7)],
    ["33 bytes", new Uint8Array(33).fill(7)],
  ] as const) {
    it(`a ${name} challenge`, () => {
      expect(acceptPresentation(sim.state, A_REC, ch)).toEqual({
        accepted: false,
        reason: "not a usable challenge",
      });
      expect(acceptOwnership(sim.state, A_REC, ch)).toEqual({
        accepted: false,
        reason: "not a usable challenge",
      });
    });
  }
});

describe("the challenge book remembers across runs", () => {
  let t = 1_000_000;
  const now = () => t;

  it("a used challenge stays used after its entries are saved and loaded", () => {
    const book = new ChallengeBook({ now });
    const { challenge } = book.issue("licence");
    expect(book.consume(challenge, "licence").ok).toBe(true);
    const reopened = new ChallengeBook({ now, entries: book.entries() });
    expect(reopened.check(challenge, "licence").ok).toBe(false);
    expect(reopened.consume(challenge, "licence").ok).toBe(false);
  });

  it("an issued, unused challenge is still usable after reload; one past its age is dropped", () => {
    const book = new ChallengeBook({ now, maxAgeMs: 1000 });
    const { challenge: fresh } = book.issue("ownership");
    t += 2000;
    const { challenge: later } = book.issue("ownership");
    const saved = book.entries();
    expect(saved.map((e) => e.challenge)).toEqual([hex(later)]);
    const reopened = new ChallengeBook({ now, maxAgeMs: 1000, entries: saved });
    expect(reopened.check(later, "ownership").ok).toBe(true);
    expect(reopened.check(fresh, "ownership").ok).toBe(false);
  });

  it("absorb: a challenge used by either run stays used", () => {
    const first = new ChallengeBook({ now });
    const { challenge } = first.issue("licence");
    const second = new ChallengeBook({ now, entries: first.entries() });
    expect(second.consume(challenge, "licence").ok).toBe(true);
    // The first run never saw that use. Taking in the second run's entries brings it.
    expect(first.check(challenge, "licence").ok).toBe(true);
    first.absorb(second.entries());
    expect(first.check(challenge, "licence").ok).toBe(false);
    // And absorbing an older, unused copy does not un-use it.
    first.absorb([{ ...second.entries()[0], usedAt: undefined }]);
    expect(first.check(challenge, "licence").ok).toBe(false);
  });

  it("a refusal does not use up the challenge", () => {
    const book = new ChallengeBook({ now });
    const { challenge } = book.issue("licence");
    // No presentation has been made on this contract, so the check refuses.
    expect(
      acceptPresentationOnce(book, sim.state, A_REC, challenge).accepted,
    ).toBe(false);
    expect(book.check(challenge, "licence").ok).toBe(true);
  });

  it("absorb takes in challenges this run never issued, used or not", () => {
    const other = new ChallengeBook({ now });
    const { challenge: used } = other.issue("ownership");
    const { challenge: unused } = other.issue("ownership");
    other.consume(used, "ownership");
    const mine = new ChallengeBook({ now });
    mine.absorb(other.entries());
    expect(mine.check(used, "ownership").ok).toBe(false);
    expect(mine.check(unused, "ownership").ok).toBe(true);
  });

  it("issue never hands out a challenge already in the book", () => {
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    const draws = [a, a, b];
    const book = new ChallengeBook({ now, random: () => draws.shift()! });
    expect(hex(book.issue("licence").challenge)).toBe(hex(a));
    expect(hex(book.issue("licence").challenge)).toBe(hex(b));
  });

  it("a challenge is good for seven days by default", () => {
    expect(DEFAULT_CHALLENGE_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const book = new ChallengeBook({ now });
    const { challenge } = book.issue("licence");
    t += DEFAULT_CHALLENGE_MAX_AGE_MS;
    expect(book.check(challenge, "licence").ok).toBe(true);
    t += 1;
    expect(book.check(challenge, "licence").ok).toBe(false);
  });
});
