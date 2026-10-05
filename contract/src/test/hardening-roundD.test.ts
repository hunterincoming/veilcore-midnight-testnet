// Round D hardening (4 Oct 2026): the main contract's round D tests, after the fixes.
// The two FINDINGs of attack-roundD.test.ts now assert their FIX (D-1: the starting-state
// comparison join uses; D-7: rule 5 with the presentation's time). The HELD tests are kept
// as regressions: each is an attack a fresh reviewer tried that earlier rounds had not
// pinned in exactly this form. veilcore.compact is unchanged by round D.
// Run: cd contract && npx vitest run --maxWorkers=1 src/test/hardening-roundD.test.ts
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  ChargedState,
  ContractState,
  StateValue,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger } from "../managed/veilcore/contract/index.js";
import {
  ChallengeBook,
  MAX_PRESENTATION_AGE_MS,
  acceptPresentation,
  acceptPresentationAt,
  checkLineage,
} from "../verify.js";
import {
  constructorLedgerDataHex,
  ledgerDataHex,
  startsFromConstructor,
} from "../veilcore.js";
import {
  C,
  VeilcoreSimulator,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";

let sim: VeilcoreSimulator;
const anyone = as(secret("rd-anyone"));
const anchor = (s: Uint8Array): Uint8Array => {
  const r = C.commit(s);
  if (!sim.state.recoveryOf.member(r))
    sim.call(as(s), "anchor", C.recoveryCommit(secret(`rd-rcv-${hex(s)}`)));
  return r;
};

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

/** A secret whose commitment has no zero bytes, so it is encoded the same everywhere. */
const cleanSecret = (label: string): Uint8Array => {
  for (let i = 0; ; i++) {
    const s = secret(`${label}-${i}`);
    if (C.commit(s).every((b) => b !== 0)) return s;
  }
};

/** Replace every byte string equal to `from` with `to`, anywhere in an encoded state. */
const swapBytes = (v: unknown, from: string, to: Uint8Array): unknown => {
  if (v instanceof Uint8Array) return hex(v) === from ? to : v;
  if (v instanceof Map)
    return new Map(
      [...v.entries()].map(([k, x]) => [
        swapBytes(k, from, to),
        swapBytes(x, from, to),
      ]),
    );
  if (Array.isArray(v)) return v.map((x) => swapBytes(x, from, to));
  if (v !== null && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, swapBytes(x, from, to)]),
    );
  return v;
};

const witnessesForConstructor = () => {
  const z = new Uint8Array(32);
  const w =
    <T>(v: T) =>
    (c: { privateState: unknown }) => [c.privateState, v];
  return {
    localGeneticSecret: w(z),
    incomingGeneticSecret: w(z),
    recoverySecret: w(z),
    licenseSecret: w(z),
    licenseRecord: w(z),
    licensePath: w(null),
    presentationChallenge: w(z),
  } as never;
};

// ───────────────────────────────────────── D-1: a keys-identical look-alike contract

describe("D-1 FIXED: a look-alike with this build's circuits and a forged starting state is told apart", () => {
  it("the forged deploy state passes every circuit comparison, but not the starting-state comparison join now makes", () => {
    // The real breeder B: only B's public commitment is needed. B never calls anything.
    const B = cleanSecret("rd-famous-breeder");
    const B_REC = C.commit(B);

    // The attacker builds the state they want with identities they control: X (stand-in
    // for B) anchored and confirmed as the parent of C (the counterfeit's record).
    const X = cleanSecret("rd-stand-in");
    const CHILD = cleanSecret("rd-counterfeit");
    const X_REC = anchor(X);
    const C_REC = anchor(CHILD);
    sim.call(as(CHILD), "proposeParent", X_REC);
    sim.call(as(X), "confirmParent", C_REC);

    // Rename X to B everywhere in the ledger data (an ordinary deploy carries whatever
    // ContractState the deployer builds; the network does not run the constructor).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built = (sim as any).ctx.currentQueryContext.state as ChargedState;
    const forgedValue = StateValue.decode(
      swapBytes(built.state.encode(), hex(X_REC), B_REC) as never,
    );

    // The genuine deploy state of this build: constructor output, operations and all.
    const genuine = new Contract(witnessesForConstructor()).initialState(
      createConstructorContext({}, "0".repeat(64)),
    ).currentContractState;

    // The look-alike: the genuine operations, byte for byte; forged data.
    const forged = new ContractState();
    forged.data = new ChargedState(forgedValue);
    for (const op of genuine.operations())
      forged.setOperation(op, genuine.operation(op)!);

    // 1. Nothing that compares circuits can tell them apart: same operation set, each
    //    operation identical (midnight-js verifyContractState, VeilcoreAPI.join and the
    //    "compare the verifier keys with the published fingerprints" check in design.md
    //    compare exactly these, and nothing else).
    expect(forged.operations().map(String).sort()).toEqual(
      genuine.operations().map(String).sort(),
    );
    for (const op of genuine.operations())
      expect(forged.operation(op)!.toString()).toBe(
        genuine.operation(op)!.toString(),
      );
    // It is a well-formed contract state a deploy transaction can carry.
    expect(() => ContractState.deserialize(forged.serialize())).not.toThrow();

    // 2. The forged ledger says B is anchored and is C's confirmed parent.
    const L = ledger(forged.data.state);
    expect(L.protocolVersion).toBe(1n);
    expect(L.recoveryOf.member(B_REC)).toBe(true);
    expect([...L.parentsOf.lookup(C_REC)].map(hex)).toEqual([hex(B_REC)]);
    expect(L.hasOffspring.member(B_REC)).toBe(true);

    // 3. The reference verifier accepts the counterfeit's pedigree back to B.
    const report = checkLineage(L, C_REC, [B_REC]);
    expect(report.accepted).toBe(true);
    expect(report.clean).toBe(true);
    expect(report.ancestors.map(hex)).toEqual([hex(B_REC)]);

    // 4. The genuine deploy state is empty, and the check join makes (VeilcoreAPI.join,
    //    startsFromConstructor) tells the two apart.
    const g = ledger(genuine.data.state);
    expect(g.anchorSeq).toBe(0n);
    expect(g.recoveryOf.member(B_REC)).toBe(false);
    expect(startsFromConstructor(genuine)).toBe(true);
    expect(startsFromConstructor(forged)).toBe(false);
    // Through a serialize/deserialize, as the indexer hands it over.
    expect(
      startsFromConstructor(ContractState.deserialize(genuine.serialize())),
    ).toBe(true);
    expect(
      startsFromConstructor(ContractState.deserialize(forged.serialize())),
    ).toBe(false);
  });

  it("the comparison is of ledger data only: the operations a deploy carries (its fragment of keys) do not matter", () => {
    const genuine = new Contract(witnessesForConstructor()).initialState(
      createConstructorContext({}, "0".repeat(64)),
    ).currentContractState;
    const fragment = new ContractState();
    fragment.data = genuine.data;
    const [first] = genuine.operations();
    fragment.setOperation(first, genuine.operation(first)!);
    expect(startsFromConstructor(fragment)).toBe(true);
    expect(ledgerDataHex(fragment)).toBe(constructorLedgerDataHex());
  });

  it("a single changed ledger field is enough to refuse", () => {
    sim.call(as(secret("rd1-one")), "anchor", freshRecovery());
    const one = new ContractState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    one.data = (sim as any).ctx.currentQueryContext.state as ChargedState;
    expect(startsFromConstructor(one)).toBe(false);
  });
  // A licence tree can be planted the same way (the deployer writes any tree, leaves
  // included); not demonstrated here, since leaves are hashes and cannot be renamed by
  // byte substitution.
});

// ───────────────────────────────────────── held

describe("HELD: licences", () => {
  it("one licence commitment issued under an origin and under its successor are two licences; neither countersigns as the other", () => {
    const I = secret("rd-issuer"),
      I2 = secret("rd-issuer-2");
    const I_REC = anchor(I);
    sim.call(as(I, { incoming: I2 }), "rotateRecordSecret", C.commit(I2));
    const S = secret("rd-licensee");
    const lcForOrigin = C.licenseCommit(S, I_REC);
    // The successor issues the commitment built for the origin: the contract cannot tell.
    sim.call(as(I2), "issueLicense", lcForOrigin);
    // Countersigning under the origin finds no licence keyed (lc, origin)...
    expect(() =>
      sim.withLicence({ secret: S, record: I_REC }, () =>
        sim.call(anyone, "countersignLicense", I_REC, 5n),
      ),
    ).toThrow(/No such license against that record/);
    // ...and under the successor the commitment does not match the secret.
    expect(() =>
      sim.withLicence({ secret: S, record: C.commit(I2) }, () =>
        sim.call(anyone, "countersignLicense", C.commit(I2), 5n),
      ),
    ).toThrow(/No such license against that record/);
    // The wasted place is the issuer's, and the issuer can revoke it.
    sim.call(as(I2), "revokeLicense", lcForOrigin, C.commit(I2));
    expect(sim.state.pendingLicensesBy.lookup(I_REC).read()).toBe(0n);
  });

  it("two holders proposing transfers to the SAME incoming commitment cannot both activate it", () => {
    const I = secret("rd-issuer-dup");
    const I_REC = anchor(I);
    const a = secret("rd-holder-a"),
      b = secret("rd-holder-b"),
      n = secret("rd-incoming");
    for (const s of [a, b]) {
      sim.call(as(I), "issueLicense", C.licenseCommit(s, I_REC));
      sim.withLicence({ secret: s, record: I_REC }, () =>
        sim.call(anyone, "countersignLicense", I_REC, sim.freeSlot()),
      );
    }
    const nlc = C.licenseCommit(n, I_REC);
    for (const s of [a, b])
      sim.withLicence({ secret: s, record: I_REC }, () =>
        sim.call(anyone, "proposeTransfer", I_REC, nlc),
      );
    sim.call(as(I), "approveTransfer", C.licenseCommit(a, I_REC), I_REC, nlc);
    expect(() =>
      sim.call(as(I), "approveTransfer", C.licenseCommit(b, I_REC), I_REC, nlc),
    ).toThrow(/already in use/);
    expect(sim.state.activeLicensesBy.lookup(I_REC).read()).toBe(2n);
  });

  it("a transfer proposal does not survive revoke and re-issue of the same commitment", () => {
    const I = secret("rd-issuer-re");
    const I_REC = anchor(I);
    const s = secret("rd-holder-re"),
      n = secret("rd-incoming-re");
    const lc = C.licenseCommit(s, I_REC),
      nlc = C.licenseCommit(n, I_REC);
    sim.call(as(I), "issueLicense", lc);
    sim.withLicence({ secret: s, record: I_REC }, () =>
      sim.call(anyone, "countersignLicense", I_REC, sim.freeSlot()),
    );
    sim.withLicence({ secret: s, record: I_REC }, () =>
      sim.call(anyone, "proposeTransfer", I_REC, nlc),
    );
    sim.call(as(I), "revokeLicense", lc, I_REC);
    sim.call(as(I), "issueLicense", lc); // same commitment again (the API refuses; the contract allows)
    sim.withLicence({ secret: s, record: I_REC }, () =>
      sim.call(anyone, "countersignLicense", I_REC, sim.freeSlot()),
    );
    expect(() => sim.call(as(I), "approveTransfer", lc, I_REC, nlc)).toThrow(
      /No transfer proposed/,
    );
  });

  it("a presentation proved before a revocation and landed after it is refused on chain (the flag and the root are read at landing)", () => {
    const I = secret("rd-issuer-p");
    const I_REC = anchor(I);
    const s = secret("rd-holder-p"),
      other = secret("rd-holder-other");
    for (const x of [s, other]) {
      sim.call(as(I), "issueLicense", C.licenseCommit(x, I_REC));
      sim.withLicence({ secret: x, record: I_REC }, () =>
        sim.call(anyone, "countersignLicense", I_REC, sim.freeSlot()),
      );
    }
    sim.advance(700n);
    sim.call(anyone, "sealRevocations", sim.now + 100n);
    const challenge = secret("rd-challenge");
    // Control: with nothing in between, a proved presentation lands.
    sim.land(
      sim.withLicence(
        { secret: s, record: I_REC, challenge: secret("rd-c0") },
        () => sim.prove(anyone, "proveLicense"),
      ),
    );
    const pending = sim.withLicence(
      { secret: s, record: I_REC, challenge },
      () => sim.prove(anyone, "proveLicense"),
    );
    // An unrelated revocation lands first: unsealedChanges flips to true.
    sim.call(as(I), "revokeLicense", C.licenseCommit(other, I_REC), I_REC);
    expect(() => sim.land(pending)).toThrow();
  });
});

describe("HELD: identity and lineage", () => {
  it("a record cannot name its own identity as parent through a successor commitment", () => {
    const P = secret("rd-self"),
      P2 = secret("rd-self-2");
    const P_REC = anchor(P);
    sim.call(as(P, { incoming: P2 }), "rotateRecordSecret", C.commit(P2));
    expect(() => sim.call(as(P2), "proposeParent", P_REC)).toThrow(
      /not its own parent/,
    );
  });

  it("no move resets what a record owes: re-anchor is refused, rotation and recovery keep the count", () => {
    const R = secret("rd-owing"),
      R2 = secret("rd-owing-2"),
      R3 = secret("rd-owing-3");
    const R_REC = anchor(R);
    sim.call(as(R), "encumberOwnRecord", secret("rd-term"));
    expect(() => sim.call(as(R), "anchor", freshRecovery())).toThrow();
    sim.call(as(R, { incoming: R2 }), "rotateRecordSecret", C.commit(R2));
    sim.call(
      as(R3, { recovery: secret(`rd-rcv-${hex(R)}`), incoming: R3 }),
      "recoverRecordSecret",
      R_REC,
      C.commit(R3),
      freshRecovery(),
    );
    expect(sim.state.obligationCountOf.lookup(R_REC).read()).toBe(1n);
    // The successor cannot be anchored as a fresh identity either.
    expect(() => sim.call(as(R3), "anchor", freshRecovery())).toThrow();
  });
});

// ───────────────────────────────────────── D-7 (low)

describe("D-7 FIXED: rule 5 with the presentation's time", () => {
  it("the round D attack: checked days later, after a revocation and a seal, it is refused as too old", () => {
    const I = secret("rd7-issuer");
    const I_REC = anchor(I);
    const s = secret("rd7-licensee");
    const lc = C.licenseCommit(s, I_REC);
    sim.call(as(I), "issueLicense", lc);
    sim.withLicence({ secret: s, record: I_REC }, () =>
      sim.call(anyone, "countersignLicense", I_REC, sim.freeSlot()),
    );
    const challenge = secret("rd7-challenge");
    sim.withLicence({ secret: s, record: I_REC, challenge }, () =>
      sim.call(anyone, "proveLicense"),
    );
    const afterTx = sim.state; // what presentationState returns for that transaction id
    const landedAt = Date.UTC(2026, 9, 4, 12, 0, 0);
    // Days later (the challenge book allows 7): revoked for cause, and sealed.
    sim.advance(3n * 86_400n);
    sim.call(as(I), "revokeLicense", lc, I_REC);
    sim.call(anyone, "sealRevocations", sim.now + 100n);
    expect(sim.state.licenseStatusOf.member(C.licenseKey(lc, I_REC))).toBe(
      false,
    );
    // The bare rule still says what it says about the state after the presentation...
    expect(acceptPresentation(afterTx, I_REC, challenge).accepted).toBe(true);
    // ...but the check the CLI and API make refuses it three days on.
    const v = acceptPresentationAt(afterTx, I_REC, challenge, {
      landedAt,
      issuedAt: landedAt - 60_000,
      now: landedAt + 3 * 86_400_000,
    });
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(
      /4320 minutes old \(at most 60\).*Ask for a new one/,
    );
  });

  const presented = () => {
    const I = secret("rd7b-issuer");
    const I_REC = anchor(I);
    const s = secret("rd7b-licensee");
    sim.call(as(I), "issueLicense", C.licenseCommit(s, I_REC));
    sim.withLicence({ secret: s, record: I_REC }, () =>
      sim.call(anyone, "countersignLicense", I_REC, sim.freeSlot()),
    );
    const challenge = secret("rd7b-challenge");
    sim.withLicence({ secret: s, record: I_REC, challenge }, () =>
      sim.call(anyone, "proveLicense"),
    );
    return { afterTx: sim.state, I_REC, challenge };
  };
  const T = Date.UTC(2026, 9, 4, 12, 0, 0);

  it("fresh: accepted, and the reason says live WHEN PRESENTED, with the block and the time", () => {
    const { afterTx, I_REC, challenge } = presented();
    const v = acceptPresentationAt(afterTx, I_REC, challenge, {
      landedAt: T,
      blockHeight: 1234,
      issuedAt: T - 120_000,
      now: T + 10 * 60_000,
    });
    expect(v.accepted).toBe(true);
    expect(v.reason).toBe(
      "the licence was live when presented (block 1234, 2026-10-04T12:00:00.000Z, 10 minutes ago); proved against the current root",
    );
  });

  it("the age limit is an hour, inclusive; a minute more is refused", () => {
    const { afterTx, I_REC, challenge } = presented();
    expect(MAX_PRESENTATION_AGE_MS).toBe(3_600_000);
    const at = (now: number) =>
      acceptPresentationAt(afterTx, I_REC, challenge, { landedAt: T, now })
        .accepted;
    expect(at(T + MAX_PRESENTATION_AGE_MS)).toBe(true);
    expect(at(T + MAX_PRESENTATION_AGE_MS + 60_000)).toBe(false);
  });

  it("refused when the time is unknown, or when it landed before the challenge was issued", () => {
    const { afterTx, I_REC, challenge } = presented();
    expect(
      acceptPresentationAt(afterTx, I_REC, challenge, {
        landedAt: undefined,
        now: T,
      }),
    ).toEqual({
      accepted: false,
      reason: "the indexer did not say when the presentation landed; ask again",
    });
    expect(
      acceptPresentationAt(afterTx, I_REC, challenge, {
        landedAt: T,
        issuedAt: T + 5 * 60_000,
        now: T + 6 * 60_000,
      }),
    ).toEqual({
      accepted: false,
      reason: "the presentation landed before you issued this challenge",
    });
  });

  it("a refusal by rule 5 itself is passed through unchanged", () => {
    const { afterTx, I_REC } = presented();
    const v = acceptPresentationAt(afterTx, I_REC, secret("rd7b-other"), {
      landedAt: T,
      now: T,
    });
    expect(v).toEqual(acceptPresentation(afterTx, I_REC, secret("rd7b-other")));
  });

  it("the challenge book gives the issue time option 27 passes", () => {
    const book = new ChallengeBook({ now: () => T });
    const { challenge } = book.issue("licence");
    expect(book.issuedAt(challenge)).toBe(T);
    expect(book.issuedAt(new Uint8Array(32).fill(3))).toBeUndefined();
  });
});
