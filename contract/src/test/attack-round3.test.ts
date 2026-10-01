// Attack round 3 (1 Oct): economics, privacy, fragmented deploy, composition, bounds.
// Each test either demonstrates a finding (named FINDING) or pins what held (HELD).
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyContractState } from "@midnight-ntwrk/midnight-js-contracts";
import { PROVABLE_CIRCUITS } from "../veilcore.js";
import { acceptPresentation } from "../verify.js";
import {
  C,
  VeilcoreSimulator,
  as,
  hex,
  secret,
  freshRecovery,
} from "./veilcore-simulator.js";

const sha = (b: Uint8Array | string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(b).digest());

const A = secret("r3-issuer-A"),
  A_REC = C.commit(A);
const B = secret("r3-issuer-B"),
  B_REC = C.commit(B);
const anyone = as(secret("r3-anyone"));
let sim: VeilcoreSimulator;

const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(secret(`r3-rcv-${hex(s)}`)));
};

/** What a chain observer records from each countersign transaction's event cells. */
type Observed = Map<string, string>; // licenseKey -> issuer record
const observe = (seen: Observed): void => {
  const lc = sim.state.lastActivatedLicense,
    rc = sim.state.lastActivatedRecord;
  seen.set(hex(C.licenseKey(lc, rc)), hex(rc));
};
const activate = (issuer: Uint8Array, l: Uint8Array, seen: Observed): void => {
  anchor(issuer);
  const rec = C.commit(issuer);
  sim.call(as(issuer), "issueLicense", C.licenseCommit(l, rec));
  sim.withLicence({ secret: l, record: rec }, () =>
    sim.call(anyone, "countersignLicense", rec, sim.freeSlot()),
  );
  observe(seen);
};
/** The issuers an observer can attribute a presentation to: issuers of the leaves under its root. */
const candidateIssuers = (seen: Observed): Set<string> => {
  expect(sim.state.lastPresentationRoot.field).toBe(
    sim.state.activeLicenses.root().field,
  );
  const out = new Set<string>();
  for (const [, key] of sim.state.licenseAtSlot) out.add(seen.get(hex(key))!);
  return out;
};

beforeEach(() => {
  sim = new VeilcoreSimulator();
});

describe("PRIVACY", () => {
  it("FINDING: a presentation hides the issuer only among the live leaves under its root; with one issuer live, an observer names it", () => {
    const seen: Observed = new Map();
    const L1 = secret("r3-l1");
    activate(A, L1, seen);
    const ch = secret("r3-ch");
    sim.withLicence({ secret: L1, record: A_REC, challenge: ch }, () =>
      sim.call(anyone, "proveLicense"),
    );
    // The observer never sees the challenge, yet knows exactly whose licensee presented.
    expect([...candidateIssuers(seen)]).toEqual([hex(A_REC)]);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);

    // With a second issuer live the set grows to two, no further.
    activate(B, secret("r3-l2"), seen);
    sim.withLicence(
      { secret: L1, record: A_REC, challenge: secret("r3-ch2") },
      () => sim.call(anyone, "proveLicense"),
    );
    expect(candidateIssuers(seen)).toEqual(new Set([hex(A_REC), hex(B_REC)]));
  });

  it("FINDING: CLI obligation commitments are unsalted SHA-256 of the terms text; a dictionary reads them off lastObligation", () => {
    anchor(A);
    const terms = "7% royalty on all clones"; // what a breeder would type at the CLI prompt
    sim.call(as(A), "encumberOwnRecord", sha(terms)); // exactly askObligation's commitment
    const published = hex(sim.state.lastObligation);
    let recovered: string | undefined;
    for (let p = 1; p <= 50 && !recovered; p++)
      for (const what of ["clones", "seeds", "sales", "derivatives"]) {
        const guess = `${p}% royalty on all ${what}`;
        if (hex(sha(guess)) === published) recovered = guess;
      }
    expect(recovered).toBe(terms);
  });

  it("FINDING: the UI's DNA fingerprint is commit(sha256(report)); anyone holding the report can anchor that value as a record of their own", () => {
    anchor(A);
    const report = new TextEncoder().encode(
      "lab report #4471 ... SNP panel ...",
    );
    const dnaFingerprint = C.commit(sha(report)); // bboard-ui fingerprintFile
    sim.call(as(A), "pairDna", dnaFingerprint);
    expect(hex(sim.state.lastPairedDna)).toBe(hex(dnaFingerprint));
    // The lab (or a buyer shown the report) now holds the "secret" behind it.
    const labHolder = sha(report);
    sim.call(as(labHolder), "anchor", freshRecovery());
    sim.call(as(labHolder), "proveOwnership", new Uint8Array(32).fill(9));
    expect(hex(sim.state.lastOwnershipProof)).toBe(hex(dnaFingerprint));
    expect(sim.state.recoveryOf.member(dnaFingerprint)).toBe(true);
  });
});

describe("COMPOSITION / verifier misreads", () => {
  it("FINDING: proveOwnership binds nothing verifier-specific: the state after it is identical whoever later cites it", () => {
    anchor(A);
    sim.call(as(A), "proveOwnership", new Uint8Array(32).fill(9));
    const after = sim.state;
    // Two different verifiers, each told "this tx is my proof", see the same cell and
    // nothing that ties it to their request or to the person citing it.
    expect(hex(after.lastOwnershipProof)).toBe(hex(A_REC));
    // Workaround available today: pairDna with a verifier-chosen nonce does bind.
    const nonce = secret("verifier-nonce");
    sim.call(as(A), "pairDna", nonce);
    expect(hex(sim.state.lastPairedRecord)).toBe(hex(A_REC));
    expect(hex(sim.state.lastPairedDna)).toBe(hex(nonce));
  });

  it.fails(
    "FINDING (info): a recovery bumps rotationSeq and lastRotatedTo but leaves lastRotatedFrom from someone else's rotation",
    () => {
      anchor(A);
      anchor(B);
      const B2 = secret("r3-B2");
      sim.call(as(B, { incoming: B2 }), "rotateRecordSecret", C.commit(B2));
      const A2 = secret("r3-A2");
      sim.call(
        as(secret("whoever"), {
          recovery: secret(`r3-rcv-${hex(A)}`),
          incoming: A2,
        }),
        "recoverRecordSecret",
        A_REC,
        C.commit(A2),
        freshRecovery(),
      );
      // A follower pairing (lastRotatedFrom -> lastRotatedTo) per rotationSeq step records B -> A2.
      expect(hex(sim.state.lastRotatedFrom)).toBe(hex(B_REC));
      expect(hex(sim.state.lastRotatedTo)).toBe(hex(C.commit(A2)));
    },
  );

  it.fails(
    "FINDING (info): rejectObligation bumps obligationSeq without writing the obligation cells (they still show the previous event)",
    () => {
      anchor(A);
      anchor(B);
      const o1 = secret("r3-o1"),
        o2 = secret("r3-o2");
      sim.call(as(B), "proposeObligation", A_REC, o1);
      sim.call(as(A), "acceptObligation", o1, B_REC);
      const seq = sim.state.obligationSeq;
      sim.call(as(B), "proposeObligation", A_REC, o2);
      sim.call(as(A), "rejectObligation", o2, B_REC);
      expect(sim.state.obligationSeq).toBe(seq + 1n);
      expect(hex(sim.state.lastObligation)).toBe(hex(o1)); // looks like o1 was accepted again
    },
  );
});

describe("FRAGMENTED DEPLOY", () => {
  // This build has no key files, so the chain's contract state is stood in for by an
  // object with the same operation() interface midnight-js's check reads.
  const vk = (n: string): Uint8Array => sha(`vk:${n}`);
  const localKeys = PROVABLE_CIRCUITS.map(
    (n) => [n, vk(n)] as [string, Uint8Array],
  );
  const chain = (ops: string[]) => {
    const m = new Map(ops.map((n) => [n, { verifierKey: vk(n) }]));
    return {
      operation: (n: string) => m.get(n),
      operations: () => [...m.keys()],
    };
  };

  it("HELD: join()'s check (verifyContractState) refuses a contract missing any circuit key", () => {
    expect(() =>
      verifyContractState(
        localKeys as never,
        chain(PROVABLE_CIRCUITS.slice(0, 8)) as never,
      ),
    ).toThrow();
    expect(() =>
      verifyContractState(
        localKeys as never,
        chain([...PROVABLE_CIRCUITS]) as never,
      ),
    ).not.toThrow();
  });

  it("FINDING (low): join()'s check passes a contract carrying an EXTRA operation the build does not have", () => {
    const withExtra = chain([...PROVABLE_CIRCUITS, "rewriteEverything"]);
    expect(() =>
      verifyContractState(localKeys as never, withExtra as never),
    ).not.toThrow();
    expect(withExtra.operations().length).toBe(PROVABLE_CIRCUITS.length + 1);
  });

  it("info: in the window after a default deploy, rotation, recovery and sealing are not yet callable", () => {
    const first = PROVABLE_CIRCUITS.slice(0, 8);
    expect(first).toContain("anchor");
    expect(first).toContain("approveTransfer");
    for (const late of [
      "rotateRecordSecret",
      "recoverRecordSecret",
      "sealRevocations",
      "revokeLicense",
    ])
      expect(first).not.toContain(late);
  });
});

describe("ECONOMICS / BOUNDS", () => {
  it("info: any sealer may set the bound 300 s ahead, so the next seal waits up to 900 s of block time", () => {
    const seen: Observed = new Map();
    const M = secret("r3-sealer");
    const x = secret("r3-x");
    activate(M, x, seen);
    sim.call(
      as(M),
      "revokeLicense",
      C.licenseCommit(x, C.commit(M)),
      C.commit(M),
    );
    sim.advance(600n);
    sim.call(anyone, "sealRevocations", sim.now + 300n); // the maximum the contract allows
    const sealedAt = sim.now;
    const y = secret("r3-y");
    activate(A, y, seen);
    sim.call(as(A), "revokeLicense", C.licenseCommit(y, A_REC), A_REC); // honest revocation
    sim.advance(899n);
    expect(() => sim.call(anyone, "sealRevocations", sim.now + 1n)).toThrow(
      "Too soon",
    );
    sim.advance(1n);
    sim.call(anyone, "sealRevocations", sim.now + 1n);
    expect(sim.now - sealedAt).toBe(900n);
  });

  it("HELD: slot bounds; exhausting the 2^24-slot tree needs ~15.6M paid activations before the client's 64 draws fail 1 time in 100", () => {
    anchor(A);
    const l = secret("r3-slot");
    sim.call(as(A), "issueLicense", C.licenseCommit(l, A_REC));
    sim.withLicence({ secret: l, record: A_REC }, () => {
      expect(() =>
        sim.call(anyone, "countersignLicense", A_REC, 16777216n),
      ).toThrow("outside");
      sim.call(anyone, "countersignLicense", A_REC, 16777215n);
    });
    const fill = Math.pow(0.01, 1 / 64); // fill fraction at which 64 random draws all hit taken slots 1% of the time
    expect(Math.round(fill * 2 ** 24)).toBeGreaterThan(15_000_000);
  });

  it("HELD: a discharge cannot drive a record's counter below zero, even proved twice", () => {
    anchor(A);
    anchor(B);
    const o = secret("r3-o");
    sim.call(as(B), "proposeObligation", A_REC, o);
    sim.call(as(A), "acceptObligation", o, B_REC);
    const p1 = sim.prove(as(B), "discharge", A_REC, o);
    const p2 = sim.prove(as(B), "discharge", A_REC, o);
    sim.land(p1);
    expect(() => sim.land(p2)).toThrow();
    expect(sim.state.obligationCountOf.lookup(A_REC).read()).toBe(0n);
  });

  it("HELD: concurrent activations, a seal and event-cell writers do not make an honest presentation fail on chain when nothing is revoked", () => {
    const seen: Observed = new Map();
    const L = secret("r3-live");
    activate(A, L, seen);
    const ch = secret("r3-live-ch");
    const p = sim.withLicence({ secret: L, record: A_REC, challenge: ch }, () =>
      sim.prove(anyone, "proveLicense"),
    );
    activate(B, secret("r3-other"), seen); // root moves, nothing unsealed
    sim.call(as(B), "anchorBatch", secret("batch"));
    sim.call(as(B), "proveOwnership", new Uint8Array(32).fill(9));
    sim.land(p);
    expect(acceptPresentation(sim.state, A_REC, ch).accepted).toBe(true);
  });
});
