// Stateful fuzzing: random sequences of calls by honest parties, wrong parties, retired
// secrets and stale proofs, some proved on one state and landed on a later one. After
// every step the invariants below must hold. A failure prints the seed and the step, so
// the run can be replayed exactly (FUZZ_SEED=<seed>).
//
// FUZZ_RUNS and FUZZ_STEPS make it run longer locally; CI runs the defaults.
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, it } from "vitest";
import { LicenseState } from "../managed/veilcore/contract/index.js";
import { acceptOwnership, acceptPresentation, identityOf } from "../verify.js";
import {
  C,
  type Proved,
  VeilcoreSimulator,
  as,
  hex,
  secret,
} from "./veilcore-simulator.js";

type MerklePath = NonNullable<ReturnType<VeilcoreSimulator["pathFor"]>>;

const RUNS = Number(process.env.FUZZ_RUNS ?? 4);
const STEPS = Number(process.env.FUZZ_STEPS ?? 80);
/** Successful calls per circuit across all runs: a fuzzer whose calls all fail proves nothing. */
const landed = new Map<string, number>();
const FIXED_SEED = process.env.FUZZ_SEED;

/** Small seeded generator, so every failure can be replayed. */
const rng = (seed: number) => {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number): number => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number): boolean => next() < p,
  };
};

type Agent = {
  name: string;
  secrets: Uint8Array[]; // every record secret it has held; the last is current
  recovery: Uint8Array; // current recovery secret
  oldRecoveries: Uint8Array[];
  anchored: boolean;
  origin: Uint8Array;
};

type Licence = {
  ls: Uint8Array;
  issuerRecord: Uint8Array;
  key: Uint8Array;
  issuer: Agent;
};

type Pending =
  | { kind: "call"; proved: Proved }
  | {
      kind: "presentation";
      proved: Proved;
      lic: Licence;
      challenge: Uint8Array;
    }
  | {
      kind: "ownership";
      proved: Proved;
      agent: Agent;
      prover: Uint8Array;
      challenge: Uint8Array;
    };

const run = (seed: number): void => {
  const r = rng(seed);
  const sim = new VeilcoreSimulator();
  let counter = 0;
  const fresh = (label: string): Uint8Array =>
    secret(`fz-${seed}-${label}-${counter++}`);

  const agents: Agent[] = Array.from({ length: 5 }, (_, i) => {
    const s = fresh(`rec${i}`);
    return {
      name: `agent${i}`,
      secrets: [s],
      recovery: fresh(`rcv${i}`),
      oldRecoveries: [],
      anchored: false,
      origin: C.commit(s),
    };
  });
  const cur = (a: Agent): Uint8Array => a.secrets[a.secrets.length - 1];
  const anySecret = (a: Agent): Uint8Array =>
    r.chance(0.8) ? cur(a) : r.pick(a.secrets);
  const someRecord = (a: Agent): Uint8Array =>
    C.commit(r.chance(0.5) ? a.secrets[0] : anySecret(a));

  const licences: Licence[] = [];
  const pathsSeen = new Map<string, MerklePath[]>(); // key -> paths fetched while active
  const obligations: { r: Uint8Array; o: Uint8Array; b: Uint8Array }[] = [];
  const terms = [fresh("t1"), fresh("t2"), fresh("t3")];
  const pending: Pending[] = [];
  const parentsAtLock = new Map<string, string>(); // identity -> its parent set when it got offspring

  let current = "";
  const attempt = (f: () => void): boolean => {
    try {
      f();
      landed.set(current, (landed.get(current) ?? 0) + 1);
      return true;
    } catch {
      return false;
    }
  };

  const keyActive = (k: Uint8Array): boolean =>
    sim.state.licenseStatusOf.member(k) &&
    sim.state.licenseStatusOf.lookup(k) === LicenseState.ACTIVE;

  /** The safety property for presentations: never accept a licence that is not live. */
  const checkPresentation = (
    lic: Licence,
    challenge: Uint8Array,
    step: string,
  ): void => {
    const verdict = acceptPresentation(sim.state, lic.issuerRecord, challenge);
    if (verdict.accepted && !keyActive(lic.key)) {
      throw new Error(
        `${step}: a presentation of a licence that is not active was ACCEPTED (${verdict.reason})`,
      );
    }
  };

  const checkOwnership = (
    agent: Agent,
    prover: Uint8Array,
    challenge: Uint8Array,
    step: string,
  ): void => {
    const verdict = acceptOwnership(sim.state, agent.origin, challenge);
    const head = sim.state.headOf.member(agent.origin)
      ? sim.state.headOf.lookup(agent.origin)
      : agent.origin;
    if (verdict.accepted && hex(head) !== hex(prover)) {
      throw new Error(
        `${step}: an ownership proof from a commitment that is not the live head was ACCEPTED`,
      );
    }
  };

  const invariants = (step: string): void => {
    const s = sim.state;
    // Identity: every head is a successor of its origin, or the origin itself.
    for (const [o, h] of s.headOf) {
      if (hex(o) !== hex(h)) {
        if (!s.originOf.member(h) || hex(s.originOf.lookup(h)) !== hex(o))
          throw new Error(
            `${step}: headOf names a head that is not a successor of that origin`,
          );
      }
    }
    // A successor is never itself anchored or an origin with history.
    for (const [succ, o] of s.originOf) {
      if (s.recoveryOf.member(succ))
        throw new Error(`${step}: a successor is also anchored`);
      if (s.headOf.member(succ))
        throw new Error(`${step}: a successor is also an origin with a head`);
      if (!s.recoveryOf.member(o))
        throw new Error(`${step}: a successor's origin is not anchored`);
    }
    // Licences: slots and statuses agree both ways, and every active key is in the tree.
    for (const [k, slot] of s.licenseSlotOf) {
      if (!keyActive(k))
        throw new Error(`${step}: a slotted licence is not ACTIVE`);
      if (
        !s.licenseAtSlot.member(slot) ||
        hex(s.licenseAtSlot.lookup(slot)) !== hex(k)
      )
        throw new Error(`${step}: licenseSlotOf and licenseAtSlot disagree`);
      if (s.activeLicenses.findPathForLeaf(k) === undefined)
        throw new Error(`${step}: an active licence is missing from the tree`);
    }
    for (const [slot, k] of s.licenseAtSlot) {
      if (!s.licenseSlotOf.member(k) || s.licenseSlotOf.lookup(k) !== slot)
        throw new Error(
          `${step}: a slot names a key that does not name it back`,
        );
    }
    for (const [k, st] of s.licenseStatusOf) {
      if (st === LicenseState.ACTIVE && !s.licenseSlotOf.member(k))
        throw new Error(`${step}: an ACTIVE licence has no slot`);
      if (st === LicenseState.PENDING && s.licenseSlotOf.member(k))
        throw new Error(`${step}: a PENDING licence holds a slot`);
    }
    for (const [k] of s.pendingTransferOf) {
      if (!keyActive(k))
        throw new Error(
          `${step}: a transfer is pending on a licence that is not ACTIVE`,
        );
    }
    // Obligations: each identity's counter equals the obligations in force against it.
    const owed = new Map<string, Set<string>>();
    for (const { r: rr, o, b } of obligations) {
      const k = C.obligationKey(rr, o, b);
      if (s.openObligations.member(k)) {
        const set = owed.get(hex(rr)) ?? new Set<string>();
        set.add(hex(k));
        owed.set(hex(rr), set);
      }
    }
    for (const a of agents) {
      if (!s.obligationCountOf.member(a.origin)) continue;
      const n = s.obligationCountOf.lookup(a.origin).read();
      const want = BigInt(owed.get(hex(a.origin))?.size ?? 0);
      if (n !== want)
        throw new Error(
          `${step}: obligation counter ${n} but ${want} in force for ${a.name}`,
        );
    }
    // Lineage: no cycles, hasOffspring is exactly the set of parents, and a parent's own
    // parents never change after it got offspring.
    const parents = new Map<string, string[]>();
    // A map whose values are sets cannot be iterated, so walk the identities we created.
    for (const a of agents) {
      if (s.parentsOf.member(a.origin))
        parents.set(
          hex(a.origin),
          [...s.parentsOf.lookup(a.origin)].map(hex).sort(),
        );
    }
    const allParents = new Set<string>([...parents.values()].flat());
    for (const p of allParents)
      if (!s.hasOffspring.member(Buffer.from(p, "hex")))
        throw new Error(`${step}: a parent is missing from hasOffspring`);
    for (const p of s.hasOffspring)
      if (!allParents.has(hex(p)))
        throw new Error(
          `${step}: hasOffspring holds a record that is nobody's parent`,
        );
    for (const p of allParents) {
      const now = (parents.get(p) ?? []).join(",");
      const was = parentsAtLock.get(p);
      if (was === undefined) parentsAtLock.set(p, now);
      else if (was !== now)
        throw new Error(
          `${step}: a record's parents changed after it had offspring`,
        );
    }
    const state = new Map<string, number>();
    const visit = (n: string): void => {
      if (state.get(n) === 1)
        throw new Error(`${step}: the pedigree has a cycle`);
      if (state.get(n) === 2) return;
      state.set(n, 1);
      for (const p of parents.get(n) ?? []) visit(p);
      state.set(n, 2);
    };
    for (const n of parents.keys()) visit(n);
  };

  const actions: Record<string, () => void> = {
    anchor: () => {
      const a = r.pick(agents);
      if (
        attempt(() =>
          sim.call(as(anySecret(a)), "anchor", C.recoveryCommit(a.recovery)),
        )
      )
        a.anchored = true;
    },
    rotate: () => {
      const a = r.pick(agents);
      const next = fresh("rot");
      if (
        attempt(() =>
          sim.call(
            as(anySecret(a), { incoming: next }),
            "rotateRecordSecret",
            C.commit(next),
          ),
        )
      )
        a.secrets.push(next);
    },
    recover: () => {
      const a = r.pick(agents);
      const thief = r.pick(agents);
      const usingOld = a.oldRecoveries.length > 0 && r.chance(0.3);
      const rcv = usingOld
        ? r.pick(a.oldRecoveries)
        : r.chance(0.85)
          ? a.recovery
          : thief.recovery;
      const next = fresh("recov");
      const nextRcv = fresh("rcvnext");
      const ok = attempt(() =>
        sim.call(
          as(fresh("nobody"), { recovery: rcv, incoming: next }),
          "recoverRecordSecret",
          a.origin,
          C.commit(next),
          C.recoveryCommit(nextRcv),
        ),
      );
      if (ok) {
        if (usingOld)
          throw new Error("a used-up recovery secret recovered an identity");
        a.secrets.push(next);
        a.oldRecoveries.push(a.recovery);
        a.recovery = nextRcv;
      }
    },
    replaceRecovery: () => {
      const a = r.pick(agents);
      const next = fresh("rcvrepl");
      if (
        attempt(() =>
          sim.call(
            as(fresh("x"), { recovery: a.recovery }),
            "replaceRecoveryCommitment",
            a.origin,
            C.recoveryCommit(next),
          ),
        )
      ) {
        a.oldRecoveries.push(a.recovery);
        a.recovery = next;
      }
    },
    issue: () => {
      const a = r.pick(agents);
      const ls = fresh("lic");
      const s0 = anySecret(a);
      // Usually against the caller's own commitment (the honest case); sometimes another
      // of its commitments, which must not produce a usable licence.
      const issuerRecord = r.chance(0.85) ? C.commit(s0) : someRecord(a);
      const lc = C.licenseCommit(ls, issuerRecord);
      const ok = attempt(() => sim.call(as(s0), "issueLicense", lc));
      if (ok || r.chance(0.2))
        licences.push({
          ls,
          issuerRecord,
          key: C.licenseKey(lc, issuerRecord),
          issuer: a,
        });
    },
    countersign: () => {
      if (licences.length === 0) return;
      const l = r.pick(licences);
      const slot = BigInt(r.int(8)); // few slots, to force collisions
      attempt(() =>
        sim.withLicence({ secret: l.ls, record: l.issuerRecord }, () =>
          sim.call(as(fresh("x")), "countersignLicense", l.issuerRecord, slot),
        ),
      );
      if (keyActive(l.key)) {
        const p = sim.pathFor(l.ls, l.issuerRecord);
        if (p)
          pathsSeen.set(hex(l.key), [...(pathsSeen.get(hex(l.key)) ?? []), p]);
      }
    },
    revoke: () => {
      if (licences.length === 0) return;
      const l = r.pick(licences);
      const a = r.chance(0.7) ? l.issuer : r.pick(agents);
      attempt(() =>
        sim.call(
          as(anySecret(a)),
          "revokeLicense",
          C.licenseCommit(l.ls, l.issuerRecord),
          l.issuerRecord,
        ),
      );
    },
    transfer: () => {
      if (licences.length === 0) return;
      const l = r.pick(licences);
      const ls2 = fresh("lic2");
      const nlc = C.licenseCommit(ls2, l.issuerRecord);
      attempt(() =>
        sim.withLicence({ secret: l.ls, record: l.issuerRecord }, () =>
          sim.call(as(fresh("x")), "proposeTransfer", l.issuerRecord, nlc),
        ),
      );
      const a = r.chance(0.7) ? l.issuer : r.pick(agents);
      if (
        attempt(() =>
          sim.call(
            as(anySecret(a)),
            "approveTransfer",
            C.licenseCommit(l.ls, l.issuerRecord),
            l.issuerRecord,
            nlc,
          ),
        )
      )
        licences.push({
          ls: ls2,
          issuerRecord: l.issuerRecord,
          key: C.licenseKey(nlc, l.issuerRecord),
          issuer: l.issuer,
        });
    },
    withdrawTransfer: () => {
      if (licences.length === 0) return;
      const l = r.pick(licences);
      attempt(() =>
        sim.withLicence({ secret: l.ls, record: l.issuerRecord }, () =>
          sim.call(as(fresh("x")), "withdrawTransfer", l.issuerRecord),
        ),
      );
    },
    seal: () => {
      sim.advance(BigInt(r.int(700)));
      attempt(() =>
        sim.call(
          as(fresh("x")),
          "sealRevocations",
          sim.now + 1n + BigInt(r.int(300)),
        ),
      );
    },
    present: () => {
      if (licences.length === 0) return;
      const l = r.pick(licences);
      const challenge = fresh("ch");
      const old = pathsSeen.get(hex(l.key));
      const path = old && r.chance(0.5) ? r.pick(old) : undefined; // a stale path, sometimes
      const prove = (): Proved =>
        sim.withLicence(
          { secret: l.ls, record: l.issuerRecord, challenge, path },
          () => sim.prove(as(fresh("x")), "proveLicense"),
        );
      if (r.chance(0.5)) {
        let proved: Proved | undefined;
        if (attempt(() => (proved = prove())) && proved)
          pending.push({ kind: "presentation", proved, lic: l, challenge });
      } else if (
        attempt(() =>
          sim.withLicence(
            { secret: l.ls, record: l.issuerRecord, challenge, path },
            () => sim.call(as(fresh("x")), "proveLicense"),
          ),
        )
      ) {
        checkPresentation(l, challenge, "present");
      }
    },
    own: () => {
      const a = r.pick(agents);
      const s = anySecret(a);
      const challenge = fresh("och");
      if (r.chance(0.5)) {
        let proved: Proved | undefined;
        if (
          attempt(
            () => (proved = sim.prove(as(s), "proveOwnership", challenge)),
          ) &&
          proved
        )
          pending.push({
            kind: "ownership",
            proved,
            agent: a,
            prover: C.commit(s),
            challenge,
          });
      } else if (attempt(() => sim.call(as(s), "proveOwnership", challenge))) {
        checkOwnership(a, C.commit(s), challenge, "own");
      }
    },
    parent: () => {
      const child = r.pick(agents),
        parent = r.pick(agents);
      attempt(() =>
        sim.call(as(anySecret(child)), "proposeParent", someRecord(parent)),
      );
      if (r.chance(0.7))
        attempt(() =>
          sim.call(as(anySecret(parent)), "confirmParent", someRecord(child)),
        );
      else if (r.chance(0.3))
        attempt(() => sim.call(as(anySecret(child)), "withdrawParent"));
    },
    raceParent: () => {
      // Prove a confirm now, land it after other steps: the lock must still hold.
      const child = r.pick(agents),
        parent = r.pick(agents);
      attempt(() =>
        sim.call(as(anySecret(child)), "proposeParent", someRecord(parent)),
      );
      let proved: Proved | undefined;
      if (
        attempt(
          () =>
            (proved = sim.prove(
              as(anySecret(parent)),
              "confirmParent",
              someRecord(child),
            )),
        ) &&
        proved
      )
        pending.push({ kind: "call", proved });
    },
    obligation: () => {
      const holder = r.pick(agents),
        ben = r.pick(agents);
      const o = r.pick(terms);
      const rId = identityOf(sim.state, holder.origin),
        bId = identityOf(sim.state, ben.origin);
      obligations.push({ r: rId, o, b: bId }, { r: rId, o, b: rId });
      const which = r.int(6);
      if (which === 0)
        attempt(() =>
          sim.call(
            as(anySecret(ben)),
            "proposeObligation",
            someRecord(holder),
            o,
          ),
        );
      if (which === 1)
        attempt(() =>
          sim.call(
            as(anySecret(holder)),
            "acceptObligation",
            o,
            someRecord(ben),
          ),
        );
      if (which === 2)
        attempt(() =>
          sim.call(
            as(anySecret(holder)),
            "rejectObligation",
            o,
            someRecord(ben),
          ),
        );
      if (which === 3)
        attempt(() =>
          sim.call(
            as(anySecret(ben)),
            "withdrawObligation",
            someRecord(holder),
            o,
          ),
        );
      if (which === 4)
        attempt(() =>
          sim.call(as(anySecret(ben)), "discharge", someRecord(holder), o),
        );
      if (which === 5)
        attempt(() => sim.call(as(anySecret(holder)), "encumberOwnRecord", o));
    },
    land: () => {
      if (pending.length === 0) return;
      const i = r.int(pending.length);
      const p = pending.splice(i, 1)[0];
      if (!attempt(() => sim.land(p.proved))) return;
      if (p.kind === "presentation")
        checkPresentation(p.lic, p.challenge, "land presentation");
      if (p.kind === "ownership")
        checkOwnership(p.agent, p.prover, p.challenge, "land ownership");
    },
    wait: () => sim.advance(BigInt(r.int(400))),
  };
  // Weighted, so the interesting paths (licences live and presented) are reached often.
  const weights: Record<string, number> = {
    anchor: 3,
    rotate: 2,
    recover: 2,
    replaceRecovery: 1,
    issue: 4,
    countersign: 4,
    revoke: 2,
    transfer: 2,
    withdrawTransfer: 1,
    seal: 2,
    present: 4,
    own: 2,
    parent: 2,
    raceParent: 2,
    obligation: 4,
    land: 3,
    wait: 1,
  };
  const bag = Object.entries(weights).flatMap(([n, w]) =>
    Array<string>(w).fill(n),
  );

  for (let step = 0; step < STEPS; step++) {
    const name = step < 6 ? "anchor" : r.pick(bag);
    try {
      current = name;
      actions[name]();
      invariants(`${name}#${step}`);
    } catch (e) {
      throw new Error(
        `seed ${seed}, step ${step} (${name}): ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }
};

describe("stateful fuzzing: invariants hold after every step", () => {
  afterAll(() => {
    if (process.env.FUZZ_STATS === "1")
      console.log("successful calls by action:", Object.fromEntries(landed));
    // Every kind of action must succeed sometimes, or the run explored nothing.
    for (const a of [
      "anchor",
      "rotate",
      "recover",
      "issue",
      "countersign",
      "revoke",
      "present",
      "own",
      "parent",
      "obligation",
      "land",
    ])
      expect(landed.get(a) ?? 0, a).toBeGreaterThan(0);
  });
  const seeds =
    FIXED_SEED !== undefined
      ? [Number(FIXED_SEED)]
      : Array.from({ length: RUNS }, (_, i) => 1000 + i * 7919);
  for (const seed of seeds) {
    it(`seed ${seed}`, () => {
      expect(() => run(seed)).not.toThrow();
    }, 120_000);
  }
});
