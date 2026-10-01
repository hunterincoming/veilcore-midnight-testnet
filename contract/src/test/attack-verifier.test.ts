// Attacker pass on the off-chain verifier (rule 5) and the hash vectors.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { C, VeilcoreSimulator, as, hex, secret } from "./veilcore-simulator.js";
import { acceptPresentation, checkLineage } from "../verify.js";

const A = secret("atk-breeder-A");
const A_REC = C.commit(A);
const L1 = secret("atk-licensee-1");
const anyone = as(secret("atk-anyone"));
const INTERVAL = 600n;

let sim: VeilcoreSimulator;
beforeEach(() => {
  sim = new VeilcoreSimulator();
});

const anchor = (s: Uint8Array): void => {
  if (!sim.state.recoveryOf.member(C.commit(s)))
    sim.call(as(s), "anchor", C.recoveryCommit(secret(`rcv-${hex(s)}`)));
};
const activeA = (): Uint8Array => {
  anchor(A);
  const lc = C.licenseCommit(L1, A_REC);
  sim.call(as(A), "issueLicense", lc);
  sim.withLicence({ secret: L1, record: A_REC }, () =>
    sim.call(anyone, "countersignLicense", A_REC, sim.freeSlot()),
  );
  return lc;
};
const untilSealable = (): void => {
  const at = sim.state.lastSealTime + INTERVAL;
  if (sim.now < at) sim.advance(at - sim.now);
};

describe("ATTACK: revoked licensee bundles proveLicense + sealRevocations in ONE transaction", () => {
  it.fails(
    "the state after the whole transaction is accepted by acceptPresentation",
    () => {
      // A recent seal (e.g. for some unrelated revocation) means the issuer's revoke cannot
      // be sealed straight away; the client reports `waiting` and nobody retries.
      const lc = activeA();
      const junk = secret("junk"),
        J_REC = C.commit(junk),
        jl = secret("junk-lic");
      anchor(junk);
      sim.call(as(junk), "issueLicense", C.licenseCommit(jl, J_REC));
      sim.withLicence({ secret: jl, record: J_REC }, () =>
        sim.call(anyone, "countersignLicense", J_REC, sim.freeSlot()),
      );
      sim.call(as(junk), "revokeLicense", C.licenseCommit(jl, J_REC), J_REC);
      sim.call(anyone, "sealRevocations", sim.now + 60n);
      sim.advance(30n);
      const oldPath = sim.pathFor(L1, A_REC); // the licensee's path, fetched while live
      sim.call(as(A), "revokeLicense", lc, A_REC); // issuer revokes; seal not yet allowed
      expect(sim.state.unsealedChanges).toBe(true);

      // Later, once a seal is allowed, the revoked licensee answers a verifier's challenge.
      untilSealable();
      const ch = secret("verifier-fresh-challenge");
      // Call 1 of the transaction: prove against the stale root (still in history).
      sim.withLicence(
        { secret: L1, record: A_REC, challenge: ch, path: oldPath },
        () => sim.call(anyone, "proveLicense"),
      );
      const afterProveOnly = sim.state;
      // Call 2 of the SAME transaction (same block time): seal.
      sim.call(anyone, "sealRevocations", sim.now + 60n);
      const afterWholeTx = sim.state;

      // Per-call state: correctly rejected.
      expect(acceptPresentation(afterProveOnly, A_REC, ch).accepted).toBe(
        false,
      );
      // Post-transaction state (what an indexer that records one state per transaction
      // hands back for every action in it): ACCEPTED, for a revoked licence.
      const v = acceptPresentation(afterWholeTx, A_REC, ch);
      expect(v.accepted).toBe(true);
      expect(v.reason).toMatch(/no revocation was waiting/);
      // And the licence really is revoked.
      expect(afterWholeTx.licenseStatusOf.member(C.licenseKey(lc, A_REC))).toBe(
        false,
      );
    },
  );
});

describe("ATTACK: replay of an old presentation when a challenge is reused", () => {
  it("an old transaction id still passes after revocation and seal, because nothing binds the check to time", () => {
    const lc = activeA();
    const ch = secret("reused-challenge");
    sim.withLicence({ secret: L1, record: A_REC, challenge: ch }, () =>
      sim.call(anyone, "proveLicense"),
    );
    const oldTxState = sim.state; // what the lookup returns for the OLD tx id
    sim.call(as(A), "revokeLicense", lc, A_REC);
    untilSealable();
    sim.call(anyone, "sealRevocations", sim.now + 60n);
    // The verifier asks again with the same challenge; licensee hands over the old id.
    expect(acceptPresentation(oldTxState, A_REC, ch).accepted).toBe(true);
  });
});

describe("held up", () => {
  it("lineage: a recognised root reached only through an unconfirmed proposal is not a root", () => {
    const P = secret("parent"),
      K = secret("child");
    anchor(P);
    anchor(K);
    sim.call(as(K), "proposeParent", C.commit(P)); // never confirmed
    const r = checkLineage(sim.state, C.commit(K), [C.commit(P)]);
    expect(r.accepted).toBe(false);
  });

  it("challenge checks: zero and short challenges refused", () => {
    activeA();
    expect(
      acceptPresentation(sim.state, A_REC, new Uint8Array(32)).accepted,
    ).toBe(false);
    expect(
      acceptPresentation(sim.state, A_REC, new Uint8Array(31).fill(1)).accepted,
    ).toBe(false);
  });

  it("every pure hash circuit has a vector, and the vector tags match the contract source", () => {
    const here = (p: string): string =>
      fileURLToPath(new URL(p, import.meta.url));
    const vec = JSON.parse(
      readFileSync(here("../../vectors/v1.json"), "utf8"),
    ) as {
      inputs: Record<string, string>;
      vectors: { circuit: string; tag: string; args: string[]; out: string }[];
    };
    const src = readFileSync(here("../veilcore.compact"), "utf8");
    const names = [
      "commit",
      "recoveryCommit",
      "licenseCommit",
      "licenseKey",
      "presentationTag",
      "obligationKey",
    ];
    for (const n of names) {
      expect(vec.vectors.some((v) => v.circuit === n)).toBe(true);
      const m = new RegExp(
        `export circuit ${n}\\([\\s\\S]*?pad\\(32, "([^"]+)"\\)`,
      ).exec(src);
      for (const v of vec.vectors.filter((x) => x.circuit === n))
        expect(v.tag).toBe(m?.[1]);
    }
  });
});
