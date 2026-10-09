// Regressions for the attack round of 8 October 2026 (four attackers: a Midnight engineer,
// a privacy researcher, an economic attacker, a client attacker). Each test is an attack
// that worked before the fix and must keep failing.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  RoyaltiesSimulator,
  R,
  ISSUER,
  T0,
  type Caller,
} from "./royalties-simulator.js";
import { pureCircuits as V } from "../managed/veilcore/contract/index.js";
import { changeNonceOf, licenceKeyOf, noteOf } from "../royalties.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const b = (n: number): Uint8Array<ArrayBuffer> => {
  const o = new Uint8Array(32);
  o[0] = 0x6d;
  o[31] = n;
  return o;
};
const NIGHT = new Uint8Array(32);
const ZERO = new Uint8Array(32);
const DAY = 86400n;
const HOUR = 3600n;
const YEAR = 365n * DAY;
const EXPIRES = T0 + YEAR;
const RATE = 4n;
const SALT = b(90);
const RO = { rate: RATE, salt: SALT };
const BREEDER = b(1);
const ADMIN = b(5);
const WALLET = { bytes: b(40) };
const LIC = b(10);
const LIC2 = b(11);
const P1 = b(30);
const SCOPE = b(80);
const CH = b(60);
const PAYEE = b(70);
const rec = (s: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(V.commit(s));

let nonce = 0;
const post = (
  sim: RoyaltiesSimulator,
  o: {
    record?: Uint8Array;
    expires?: bigint;
    rate?: Uint8Array;
    price?: bigint;
    caller?: Caller;
  } = {},
) =>
  sim.call(
    o.caller ?? { record: o.record ?? BREEDER, rate: RO },
    "postOffer",
    b(150 + ++nonce),
    R.adminCommit(ADMIN),
    b(20),
    NIGHT,
    o.price ?? 1000n,
    o.rate ?? R.rateCommit(RATE, SALT),
    WALLET,
    5n,
    o.expires ?? EXPIRES,
    true,
    R.adminCommit(ISSUER),
    sim.freeIssuerSlot(),
    true,
  ).result as Uint8Array<ArrayBuffer>;

const opening = (sim: RoyaltiesSimulator, offer: Uint8Array) => {
  const o = sim.state.offers.lookup(offer);
  return {
    offer,
    payTo: o.payTo.bytes,
    color: o.color,
    rateCommit: o.rateCommit,
    expires: o.expires,
    split: o.split,
    onChainPayment: o.onChainPayment,
  };
};
const buy = (sim: RoyaltiesSimulator, offer: Uint8Array, license = LIC) =>
  sim.call({ license }, "buyLicense", offer, sim.freeSlot());
const topUp = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  amount: bigint,
  n: Uint8Array,
  license = LIC,
) =>
  sim.call(
    {
      opening: opening(sim, offer),
      code: R.topUpCode(R.spendKey(license, offer), n),
    },
    "topUp",
    { bytes: opening(sim, offer).payTo },
    NIGHT,
    amount,
    sim.now + DAY,
  );
const settle = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  note: { nonce: Uint8Array; amount: bigint },
  period: Uint8Array,
  units: bigint,
  license = LIC,
) =>
  sim.call(
    { license, opening: opening(sim, offer), note, rate: RO, period, units },
    "settle",
  );
const prove = (
  sim: RoyaltiesSimulator,
  caller: Caller,
  period: Uint8Array = NIGHT,
  minUnits = 0n,
  live = true,
) =>
  sim.call(
    caller,
    "proveLicense",
    period,
    minUnits,
    sim.now + HOUR,
    SCOPE,
    live,
  );
const who = (offer: Uint8Array, extra: Caller = {}): Caller => ({
  license: LIC,
  offer,
  expires: EXPIRES,
  challenge: CH,
  ...extra,
});

describe("offers and sales", () => {
  it("two buyers of one offer, proved at the same time, both land (counts are counters, not a rewritten offer)", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    const a = sim.prove({ license: LIC }, "buyLicense", offer, sim.freeSlot());
    const s2 = sim.freeSlot() + 1n;
    const c = sim.prove({ license: LIC2 }, "buyLicense", offer, s2);
    sim.land(a);
    sim.land(c);
    expect(sim.state.soldOf.lookup(offer).read()).toBe(2n);
    expect(sim.state.liveOf.lookup(offer).read()).toBe(2n);
  });

  it("a rate commitment nobody can open is refused at posting", () => {
    const sim = new RoyaltiesSimulator();
    expect(() => post(sim, { rate: b(99) })).toThrow(/does not open/);
  });

  it("an end date near 2^64 is refused, so end + 30 days can never overflow and block clearing", () => {
    const sim = new RoyaltiesSimulator();
    expect(() => post(sim, { expires: 2n ** 63n })).toThrow(/too far ahead/);
  });

  it("the offer tree is 32 deep (posting is free, so it must never fill)", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    const path = sim.state.offerLeaves.findPathForLeaf(
      R.offerLeaf(
        offer,
        WALLET.bytes,
        NIGHT,
        R.rateCommit(RATE, SALT),
        EXPIRES,
        false,
        true,
      ),
    );
    expect(path?.path.length).toBe(32);
  });

  it("an offer's admin cannot revoke after the end, cutting short the 30 days to settle", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim, { expires: T0 + DAY });
    buy(sim, offer);
    sim.advance(2n * DAY);
    expect(() =>
      sim.call(
        { admin: ADMIN },
        "revokeLicense",
        licenceKeyOf(LIC, offer, T0 + DAY),
      ),
    ).toThrow(/have ended/);
  });
});

describe("seals", () => {
  it("a seal after mere sales voids nobody's proof in flight; only a waiting revocation retires licence roots", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    buy(sim, offer);
    // The first seal is also the daily one (it bounds every tree's history); start after it.
    sim.call({}, "sealRevocations", sim.now + 100n);
    sim.advance(700n);
    const p = sim.prove(
      who(offer),
      "proveLicense",
      NIGHT,
      0n,
      sim.now + HOUR,
      SCOPE,
      true,
    );
    buy(sim, offer, LIC2); // an attacker's purchase changes the licence root...
    sim.call({}, "sealRevocations", sim.now + 100n); // ...and anyone seals
    sim.land(p); // the proof still lands
    expect(sim.state.presentationSeq).toBe(1n);
    // A revocation does retire licence roots at its seal: a proof made before it fails to land.
    sim.advance(700n);
    const q = sim.prove(
      who(offer),
      "proveLicense",
      NIGHT,
      0n,
      sim.now + HOUR,
      SCOPE,
      true,
    );
    sim.call(
      { admin: ADMIN },
      "revokeLicense",
      licenceKeyOf(LIC2, offer, EXPIRES),
    );
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(() => sim.land(q)).toThrow();
  });

  it("a revocation retires licence roots at most once an hour: revoking your own licence cannot void proofs every 10 minutes", () => {
    // Round 7: Eve posts a cheap offer, buys from herself, revokes and seals. Each such seal
    // used to void every settle and presentation in flight, every 600 s.
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    buy(sim, offer);
    topUp(sim, offer, 400n, b(51));
    const EVE = b(41);
    const eves = sim.call(
      { record: b(40), rate: RO },
      "postOffer",
      b(140),
      R.adminCommit(EVE),
      b(20),
      NIGHT,
      1n,
      R.rateCommit(RATE, SALT),
      { bytes: b(42) },
      100n,
      EXPIRES,
      true,
      R.adminCommit(ISSUER),
      sim.freeIssuerSlot(),
      true,
    ).result as Uint8Array;
    const eveLeaf = (n: number) => licenceKeyOf(b(60 + n), eves, EXPIRES);
    sim.call({}, "sealRevocations", sim.now + 100n); // the first seal is the daily one
    const op = opening(sim, offer);
    let note: { nonce: Uint8Array; amount: bigint } = {
      nonce: b(51),
      amount: 400n,
    };
    const inFlight = (n: number) => ({
      s: sim.prove(
        {
          license: LIC,
          opening: op,
          note,
          rate: RO,
          period: b(70 + n),
          units: 1n,
        },
        "settle",
      ),
      p: sim.prove(
        who(offer),
        "proveLicense",
        NIGHT,
        0n,
        sim.now + HOUR,
        SCOPE,
        true,
      ),
    });
    // Cycle 0: the first revocation does retire the licence roots: in-flight proofs fail.
    sim.advance(700n);
    sim.call({ license: b(60) }, "buyLicense", eves, sim.freeSlot());
    let f = inFlight(0);
    sim.call({ admin: EVE }, "revokeLicense", eveLeaf(0));
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(() => sim.land(f.s)).toThrow();
    expect(() => sim.land(f.p)).toThrow();
    expect(sim.state.unsealedChanges).toBe(false);
    const resetAt = sim.state.lastRevocationReset;
    // Cycles 1 to 3, ten minutes apart, all within the hour: the seals go through but retire
    // nothing, the revocation stays waiting (verifiers keep waiting), and every proof lands.
    for (let n = 1; n <= 3; n++) {
      sim.advance(700n);
      sim.call({ license: b(60 + n) }, "buyLicense", eves, sim.freeSlot());
      f = inFlight(n);
      sim.call({ admin: EVE }, "revokeLicense", eveLeaf(n));
      const sealedBefore = sim.state.sealedRevocations;
      sim.call({}, "sealRevocations", sim.now + 100n);
      expect(sim.state.unsealedChanges).toBe(true);
      expect(sim.state.sealedRevocations).toBe(sealedBefore);
      expect(
        sim.state.offerRevokedAt.lookup(eves) > sim.state.sealedRevocations,
      ).toBe(true);
      sim.land(f.s);
      sim.land(f.p);
      note = {
        nonce: changeNonceOf(LIC, note.nonce, op, note.amount),
        amount: note.amount - RATE,
      };
      expect(sim.state.settleSeq).toBe(BigInt(n));
      expect(sim.state.lastRevocationReset).toBe(resetAt);
    }
    // Just before the hour, a seal still retires nothing. It cannot push back the one that
    // is due: an hour after the last retirement, a seal goes through at once (it skips the
    // 600 s wait) and seals the waiting revocations.
    sim.advance(resetAt + HOUR - sim.now - 150n);
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.unsealedChanges).toBe(true);
    sim.advance(160n);
    expect(sim.now < sim.state.lastSealTime + 600n).toBe(true);
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.unsealedChanges).toBe(false);
    expect(sim.state.sealedRevocations).toBe(sim.state.revocationSeq);
    expect(sim.state.lastRevocationReset > resetAt).toBe(true);
    // The revoked licences no longer prove.
    expect(() =>
      sim.call(
        { offer: eves, expires: EXPIRES, license: b(61), challenge: CH },
        "proveLicense",
        NIGHT,
        0n,
        sim.now + HOUR,
        SCOPE,
        true,
      ),
    ).toThrow(/No live licence/);
  }, 60_000);

  it("a revocation waits at most an hour for its seal, even after a seal whose bound was 300 s ahead", () => {
    // Verify round 2: the hour was counted from the seal's bound (up to 300 s ahead of its
    // block), so a revocation could wait about 65 minutes. It is now counted from the bound
    // less SEAL_SLACK, never later than the block.
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    buy(sim, offer);
    buy(sim, offer, LIC2);
    buy(sim, offer, b(12));
    sim.call({}, "sealRevocations", sim.now + 100n); // daily
    sim.advance(700n);
    sim.call(
      { admin: ADMIN },
      "revokeLicense",
      licenceKeyOf(b(12), offer, EXPIRES),
    );
    const sealBlock = sim.now;
    sim.call({}, "sealRevocations", sim.now + 300n); // as far ahead as allowed
    expect(sim.state.lastRevocationReset <= sealBlock).toBe(true);
    sim.advance(1n);
    const p = sim.prove(
      who(offer, { license: LIC2 }),
      "proveLicense",
      NIGHT,
      0n,
      sim.now + 2n * HOUR,
      SCOPE,
      true,
    );
    sim.call(
      { admin: ADMIN },
      "revokeLicense",
      licenceKeyOf(LIC2, offer, EXPIRES),
    );
    const revokedAt = sim.now;
    sim.advance(HOUR);
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.unsealedChanges).toBe(false);
    expect(sim.now - revokedAt <= HOUR).toBe(true);
    expect(() => sim.land(p)).toThrow();
  });

  it("the daily seal also seals a waiting revocation, without counting as the hourly one", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    buy(sim, offer);
    buy(sim, offer, LIC2);
    buy(sim, offer, b(12));
    sim.call({}, "sealRevocations", sim.now + 100n); // daily, due again at T0 + 100 + DAY
    sim.advance(DAY - 600n);
    sim.call(
      { admin: ADMIN },
      "revokeLicense",
      licenceKeyOf(LIC2, offer, EXPIRES),
    );
    sim.call({}, "sealRevocations", sim.now + 100n); // the hourly revocation seal
    const resetAt = sim.state.lastRevocationReset;
    expect(resetAt).toBe(sim.now + 100n - 300n); // the bound less SEAL_SLACK
    sim.advance(700n); // within the hour, but the daily seal is due
    sim.call(
      { admin: ADMIN },
      "revokeLicense",
      licenceKeyOf(b(12), offer, EXPIRES),
    );
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.unsealedChanges).toBe(false);
    expect(sim.state.sealedRevocations).toBe(sim.state.revocationSeq);
    expect(sim.state.lastRevocationReset).toBe(resetAt);
  });
});

describe("settlements", () => {
  const funded = () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    buy(sim, offer);
    topUp(sim, offer, 400n, b(51));
    return { sim, offer };
  };

  it("two settlements of the same period and units leave different receipts (no public link between them)", () => {
    const { sim, offer } = funded();
    settle(sim, offer, { nonce: b(51), amount: 400n }, P1, 10n);
    const first = sim.state.lastReceipt;
    const change = sim.state.lastNote;
    const op = opening(sim, offer);
    const nonce2 = R.changeNonceFor(
      LIC,
      R.nullifier(R.nullifierKey(LIC), noteOf(LIC, b(51), op, 400n)),
    );
    expect(hex(noteOf(LIC, nonce2, op, 360n))).toBe(hex(change));
    settle(sim, offer, { nonce: nonce2, amount: 360n }, P1, 10n);
    expect(hex(sim.state.lastReceipt)).not.toBe(hex(first));
  });

  it("the breeder finds a licence's settlements by tag, without scanning every settlement", () => {
    const { sim, offer } = funded();
    settle(sim, offer, { nonce: b(51), amount: 400n }, P1, 10n);
    const view = R.viewKey(LIC, offer);
    const change = sim.state.settlementByTag.lookup(R.settleTag(view, 0n));
    expect(hex(change)).toBe(hex(sim.state.lastNote));
    expect(sim.state.settlementByTag.member(R.settleTag(view, 1n))).toBe(false);
  });
});

describe("presentations", () => {
  it("a delegate with the presentation key (and the public spending key) can prove, and cannot settle", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    buy(sim, offer);
    topUp(sim, offer, 400n, b(51));
    settle(sim, offer, { nonce: b(51), amount: 400n }, P1, 10n);
    sim.advance(10n);
    const present = R.presentKey(LIC, offer);
    const spend = R.spendKey(LIC, offer);
    // The delegate holds no licence secret, only these two keys.
    prove(
      sim,
      {
        offer,
        expires: EXPIRES,
        challenge: CH,
        present,
        spend,
        period: P1,
        units: 10n,
      },
      P1,
      10n,
    );
    expect(sim.state.presentationSeq).toBe(1n);
    // The breeder holds the spending and viewing keys (the licence card), not the presentation key: no proof.
    expect(() =>
      prove(sim, {
        offer,
        expires: EXPIRES,
        challenge: CH,
        present: R.viewKey(LIC, offer),
        spend,
      }),
    ).toThrow(/No live licence/);
  });
});

describe("descent links", () => {
  const ready = () => {
    const sim = new RoyaltiesSimulator();
    const parent = b(2);
    const child = b(3);
    sim.call({ record: parent }, "finaliseStack", ZERO, ZERO);
    sim.call(
      { record: child },
      "proposeLink",
      rec(parent),
      NIGHT,
      0n,
      1000n,
      2n,
      T0 + YEAR,
      { bytes: b(41) },
      R.payeeCommit(PAYEE),
    );
    const id = R.linkId(rec(child), rec(parent));
    const l = sim.state.links.lookup(id);
    sim.call(
      { record: parent },
      "confirmLink",
      rec(child),
      R.linkTermsHash(
        l.color,
        l.fee,
        l.share,
        l.generations,
        l.until,
        l.payTo.bytes,
        l.payee,
      ),
    );
    return { sim, parent, child, id };
  };

  it("a child cannot leave out a link its parent confirmed, nor dodge it by adopting another chart", () => {
    const { sim, child, id } = ready();
    expect(() =>
      sim.call({ record: child }, "finaliseStack", ZERO, ZERO),
    ).toThrow(/Name every confirmed link/);
    const stranger = b(9);
    sim.call({ record: stranger }, "finaliseStack", ZERO, ZERO);
    expect(() =>
      sim.call({ record: child }, "adoptStack", rec(stranger)),
    ).toThrow(/links of its own/);
    sim.call({ record: child }, "finaliseStack", id, ZERO);
  });

  it("the payee key can change a link at most once in 30 days, and only ever lower its terms", () => {
    const { sim, id } = ready();
    sim.call({ admin: PAYEE }, "movePayee", id, { bytes: b(42) }, sim.now);
    expect(() =>
      sim.call({ admin: PAYEE }, "movePayee", id, { bytes: b(43) }, sim.now),
    ).toThrow(/30 days/);
    sim.advance(31n * DAY);
    expect(() =>
      sim.call(
        { admin: PAYEE },
        "relaxLink",
        id,
        2000n,
        0n,
        T0 + YEAR,
        sim.now,
      ),
    ).toThrow(/only be lowered/);
    sim.call(
      { admin: PAYEE },
      "relaxLink",
      id,
      500n,
      0n,
      T0 + 100n * DAY,
      sim.now,
    );
    expect(sim.state.links.lookup(id).share).toBe(500n);
    // A time that is not the block time is refused, so changedAt cannot be backdated.
    sim.advance(31n * DAY);
    expect(() =>
      sim.call(
        { admin: PAYEE },
        "movePayee",
        id,
        { bytes: b(44) },
        sim.now - DAY,
      ),
    ).toThrow(/not the current time/);
  });

  it("a split payment too small to give every ancestor at least one unit is refused", () => {
    const { sim, child, id } = ready();
    sim.call({ record: child }, "finaliseStack", id, ZERO);
    const offer = post(sim, {
      record: child,
      price: 9n,
      caller: { record: child, rate: RO },
    });
    expect(() => buy(sim, offer)).toThrow(/Too small a payment/);
  });
});
