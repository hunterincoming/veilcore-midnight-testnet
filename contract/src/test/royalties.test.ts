// The royalties contract: offers, sales, revocation, royalty payments and presentations,
// and the attacks from the first review (8 Oct 2026, A1-A7), kept as regression tests.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pureCircuits as V } from "../managed/veilcore/contract/index.js";
import {
  type Caller,
  R,
  RoyaltiesSimulator,
  T0,
  hex,
} from "./royalties-simulator.js";

const b = (n: number): Uint8Array => {
  const out = new Uint8Array(32);
  out[0] = 0x5a;
  out[31] = n;
  return out;
};
const NIGHT = new Uint8Array(32);
const STABLE = b(200);
const BREEDER = b(1);
const ROTATED = b(2);
const OTHER = b(3);
const ADMIN = b(5);
const ADMIN2 = b(6);
const LIC = b(10);
const LIC2 = b(11);
const TERMS = b(20);
const P1 = b(30);
const P2 = b(31);
const WALLET = { bytes: b(40) };
const MINE = { bytes: b(41) };
const NONCE = b(50);
const CH = b(60);
const SCOPE = b(80);
const HOUR = 3600n;
const YEAR = 365n * 24n * HOUR;
const EXPIRES = T0 + YEAR;

type OfferOpts = {
  record?: Uint8Array;
  nonce?: Uint8Array;
  admin?: Uint8Array;
  count?: bigint;
  price?: bigint;
  perUnit?: bigint;
  color?: Uint8Array;
  payTo?: { bytes: Uint8Array };
  revocable?: boolean;
  expires?: bigint;
};

const post = (sim: RoyaltiesSimulator, o: OfferOpts = {}): Uint8Array =>
  sim.call(
    { record: o.record ?? BREEDER },
    "postOffer",
    o.nonce ?? NONCE,
    R.adminCommit(o.admin ?? ADMIN),
    TERMS,
    o.color ?? NIGHT,
    o.price ?? 1000n,
    o.perUnit ?? 4n,
    o.payTo ?? WALLET,
    o.count ?? 3n,
    o.expires ?? EXPIRES,
    o.revocable ?? true,
  ).result as Uint8Array;

/** A fresh contract with one breeder offer. */
const withOffer = (o: OfferOpts = {}) => {
  const sim = new RoyaltiesSimulator();
  return { sim, offer: post(sim, o) };
};

const buy = (sim: RoyaltiesSimulator, offer: Uint8Array, license = LIC) =>
  sim.call({ license }, "buyLicense", offer, sim.freeSlot());

const keyOf = (offer: Uint8Array, license = LIC, expires = EXPIRES) =>
  R.licenseKey(R.licenseCommit(license, offer), offer, expires);

/** A royalty paid by someone holding no secret at all, for the licensee's receipt commitment. */
const payFor = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  period: Uint8Array,
  units: bigint,
  license = LIC,
) => sim.call({}, "payRoyalty", offer, R.receiptCommit(license, period), units);

const who = (offer: Uint8Array, extra: Caller = {}): Caller => ({
  license: LIC,
  offer,
  expires: EXPIRES,
  challenge: CH,
  ...extra,
});

/** A presentation for a verifier asking validity one hour from now, in SCOPE. */
const prove = (
  sim: RoyaltiesSimulator,
  caller: Caller,
  period: Uint8Array = NIGHT,
  minUnits = 0n,
  validAt = sim.now + HOUR,
  scope = SCOPE,
) => sim.call(caller, "proveLicense", period, minUnits, validAt, scope);

/** Whether `needle` appears anywhere in a transcript / effects object. */
const appears = (
  hay: unknown,
  needle: Uint8Array,
  seen = new Set<unknown>(),
): boolean => {
  if (hay === null || typeof hay !== "object" || seen.has(hay)) return false;
  seen.add(hay);
  if (hay instanceof Uint8Array) return hex(hay).includes(hex(needle));
  if (hay instanceof Map) return [...hay].some((e) => appears(e, needle, seen));
  return Object.values(hay as Record<string, unknown>).some((v) =>
    appears(v, needle, seen),
  );
};

describe("one record, two contracts", () => {
  it("names a record exactly as veilcore.compact's commit() does", () => {
    for (const s of [BREEDER, OTHER, NIGHT])
      expect(hex(R.recordCommit(s))).toBe(hex(V.commit(s)));
  });

  it("an offer's record is the poster's own, proved by the secret, with every rule public", () => {
    const { sim, offer } = withOffer({ revocable: false });
    expect(hex(offer)).toBe(hex(R.offerId(V.commit(BREEDER), NONCE)));
    const o = sim.state.offers.lookup(offer);
    expect(hex(o.record)).toBe(hex(V.commit(BREEDER)));
    expect(hex(o.admin)).toBe(hex(R.adminCommit(ADMIN)));
    expect([
      o.price,
      o.perUnit,
      o.remaining,
      o.expires,
      o.revocable,
      o.open,
    ]).toEqual([1000n, 4n, 3n, EXPIRES, false, true]);
  });
});

describe("offers", () => {
  it("refuses empty terms or admin, a zero price, zero licences and an end date already past", () => {
    const sim = new RoyaltiesSimulator();
    const raw = (
      admin: Uint8Array,
      terms: Uint8Array,
      price: bigint,
      count: bigint,
      expires: bigint,
    ) =>
      sim.call(
        { record: BREEDER },
        "postOffer",
        NONCE,
        admin,
        terms,
        NIGHT,
        price,
        0n,
        WALLET,
        count,
        expires,
        true,
      );
    const A = R.adminCommit(ADMIN);
    expect(() => raw(NIGHT, TERMS, 1n, 1n, EXPIRES)).toThrow(/admin/);
    expect(() => raw(A, NIGHT, 1n, 1n, EXPIRES)).toThrow(/terms/);
    expect(() => raw(A, TERMS, 0n, 1n, EXPIRES)).toThrow(/price/);
    expect(() => raw(A, TERMS, 1n, 0n, EXPIRES)).toThrow(/at least one/);
    expect(() => raw(A, TERMS, 1n, 1n, T0)).toThrow(/ended/);
    raw(A, TERMS, 1n, 1n, T0 + 1n);
  });

  it("refuses the same id twice; another person's same nonce is another offer, not a takeover", () => {
    const { sim, offer } = withOffer();
    expect(() => post(sim)).toThrow(/already exists/);
    const theirs = post(sim, { record: OTHER, payTo: MINE });
    expect(hex(theirs)).not.toBe(hex(offer));
    expect(hex(sim.state.offers.lookup(offer).payTo.bytes)).toBe(
      hex(WALLET.bytes),
    );
  });

  it("only the admin can close it, once; the record secret alone cannot", () => {
    const { sim, offer } = withOffer();
    expect(() => sim.call({ admin: OTHER }, "closeOffer", offer)).toThrow(
      /admin/,
    );
    expect(() => sim.call({ admin: BREEDER }, "closeOffer", offer)).toThrow(
      /admin/,
    );
    sim.call({ admin: ADMIN }, "closeOffer", offer);
    expect(sim.state.offers.lookup(offer).open).toBe(false);
    expect(() => sim.call({ admin: ADMIN }, "closeOffer", offer)).toThrow(
      /already closed/,
    );
  });

  it("the admin can hand the offer to a new key; the old key stops working", () => {
    const { sim, offer } = withOffer();
    expect(() =>
      sim.call(
        { admin: OTHER },
        "changeOfferAdmin",
        offer,
        R.adminCommit(OTHER),
      ),
    ).toThrow(/admin/);
    expect(() =>
      sim.call({ admin: ADMIN }, "changeOfferAdmin", offer, NIGHT),
    ).toThrow(/empty/);
    sim.call(
      { admin: ADMIN },
      "changeOfferAdmin",
      offer,
      R.adminCommit(ADMIN2),
    );
    expect(() => sim.call({ admin: ADMIN }, "closeOffer", offer)).toThrow(
      /admin/,
    );
    sim.call({ admin: ADMIN2 }, "closeOffer", offer);
  });
});

describe("sales", () => {
  it("passes the whole price to the breeder's wallet in the same call, and holds nothing", () => {
    const { sim, offer } = withOffer();
    const { moved } = buy(sim, offer);
    expect(moved.inputs.get(hex(NIGHT))).toBe(1000n);
    expect(moved.outputs.get(hex(NIGHT))).toBe(1000n);
    expect(moved.spends).toHaveLength(1);
    expect(moved.spends[0][0]).toBe(hex(NIGHT));
    expect(moved.spends[0][1]).toContain(hex(WALLET.bytes));
    expect(moved.spends[0][2]).toBe(1000n);
  });

  it("works in any token the offer names, so a stablecoin needs no rebuild", () => {
    const { sim, offer } = withOffer({ color: STABLE, price: 25n });
    const { moved } = buy(sim, offer);
    expect(moved.inputs.get(hex(STABLE))).toBe(25n);
    expect(moved.outputs.get(hex(STABLE))).toBe(25n);
    expect(moved.inputs.has(hex(NIGHT))).toBe(false);
  });

  it("issues the licence to the buyer's own secret, with its end date, and no step from the breeder", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    const k = keyOf(offer);
    expect(sim.state.licenseOffer.member(k)).toBe(true);
    expect(sim.pathFor(LIC, offer, EXPIRES)).toBeDefined();
    expect(sim.state.offers.lookup(offer).remaining).toBe(2n);
    expect(hex(sim.state.lastSale)).toBe(hex(k));
  });

  it("refuses the same licence secret twice, a taken slot, a slot off the tree, and sells out", () => {
    const { sim, offer } = withOffer({ count: 2n });
    buy(sim, offer);
    expect(() => buy(sim, offer)).toThrow(/already bought/);
    expect(() => sim.call({ license: LIC2 }, "buyLicense", offer, 0n)).toThrow(
      /slot is taken/,
    );
    expect(() =>
      sim.call({ license: LIC2 }, "buyLicense", offer, 16777216n),
    ).toThrow(/outside/);
    buy(sim, offer, LIC2);
    expect(() => buy(sim, offer, b(12))).toThrow(/sold out/);
  });

  it("sells nothing from an unknown, closed or ended offer", () => {
    const { sim, offer } = withOffer();
    expect(() => buy(sim, b(99))).toThrow(/No such offer/);
    sim.advance(YEAR);
    expect(() => buy(sim, offer)).toThrow(/ended/);
    const fresh = withOffer();
    fresh.sim.call({ admin: ADMIN }, "closeOffer", fresh.offer);
    expect(() => buy(fresh.sim, fresh.offer)).toThrow(/closed/);
  });
});

describe("royalties", () => {
  it("anyone can pay for a licensee: units x rate passes to the breeder, the bound receipt joins the tree", () => {
    const { sim, offer } = withOffer({ perUnit: 4n });
    buy(sim, offer);
    const { moved } = payFor(sim, offer, P1, 30n);
    expect(moved.inputs.get(hex(NIGHT))).toBe(120n);
    expect(moved.outputs.get(hex(NIGHT))).toBe(120n);
    expect(moved.spends[0][1]).toContain(hex(WALLET.bytes));
    const leaf = R.receiptLeaf(R.receiptCommit(LIC, P1), offer, 30n);
    expect(sim.state.receiptSeen.member(leaf)).toBe(true);
    expect(sim.receiptPathFor(leaf)).toBeDefined();
    expect(sim.state.royaltySeq).toBe(1n);
  });

  it("a receipt is paid once; zero units, an empty commitment, a no-royalty offer and an ended offer are refused", () => {
    const { sim, offer } = withOffer();
    payFor(sim, offer, P1, 30n);
    expect(() => payFor(sim, offer, P1, 30n)).toThrow(/already paid/);
    expect(() => sim.call({}, "payRoyalty", offer, b(70), 0n)).toThrow(
      /at least one unit/,
    );
    expect(() => sim.call({}, "payRoyalty", offer, NIGHT, 1n)).toThrow(/empty/);
    sim.advance(YEAR);
    expect(() => payFor(sim, offer, P2, 30n)).toThrow(/ended/);
    const none = withOffer({ perUnit: 0n });
    expect(() => payFor(none.sim, none.offer, P1, 1n)).toThrow(/no royalties/);
  });

  it("closing an offer stops sales, not royalties on licences already sold", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    sim.call({ admin: ADMIN }, "closeOffer", offer);
    expect(() => buy(sim, offer, LIC2)).toThrow(/closed/);
    const { moved } = payFor(sim, offer, P1, 2n);
    expect(moved.outputs.get(hex(NIGHT))).toBe(8n);
  });

  it("the payment names the offer and units, never the licence", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    const p = sim.prove({}, "payRoyalty", offer, R.receiptCommit(LIC, P1), 30n);
    expect(appears(p, keyOf(offer))).toBe(false);
    expect(appears(p, LIC)).toBe(false);
  });
});

describe("presentations", () => {
  it("proves a live licence to one verifier, publishing only the challenge-bound tag and a scoped holder tag", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    const at = sim.now + HOUR;
    prove(sim, who(offer));
    expect(hex(sim.state.lastPresentation)).toBe(
      hex(R.presentationTag(offer, NIGHT, 0n, at, SCOPE, CH)),
    );
    expect(hex(sim.state.lastPresentationHolder)).toBe(
      hex(R.holderTag(LIC, offer, SCOPE)),
    );
    expect(sim.state.lastPresentationUnsealed).toBe(false);
  });

  it("proves royalties paid for a period, for at least the units the verifier asks", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    payFor(sim, offer, P1, 30n);
    prove(sim, who(offer, { period: P1, units: 30n }), P1, 25n);
    expect(() =>
      prove(sim, who(offer, { period: P1, units: 30n }), P1, 31n),
    ).toThrow(/covers that many/);
    expect(() =>
      prove(sim, who(offer, { period: P2, units: 30n }), P2, 1n),
    ).toThrow(/No royalty paid/);
    expect(() =>
      prove(sim, who(offer, { period: P1, units: 40n }), P1, 1n),
    ).toThrow(/No royalty paid/);
  });

  it("someone else's receipt does not count as yours", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    buy(sim, offer, LIC2);
    payFor(sim, offer, P1, 30n, LIC2);
    const theirs = sim.receiptPathFor(
      R.receiptLeaf(R.receiptCommit(LIC2, P1), offer, 30n),
    )!;
    expect(() =>
      prove(
        sim,
        who(offer, { period: P1, units: 30n, receiptPath: theirs }),
        P1,
        1n,
      ),
    ).toThrow(/No royalty paid/);
  });

  it("a paid-up presentation names neither the licence, the offer, the end date nor the receipt", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    payFor(sim, offer, P1, 30n);
    const p = sim.prove(
      who(offer, { period: P1, units: 30n }),
      "proveLicense",
      P1,
      1n,
      sim.now + HOUR,
      SCOPE,
    );
    const leaf = R.receiptLeaf(R.receiptCommit(LIC, P1), offer, 30n);
    for (const secretish of [
      keyOf(offer),
      offer,
      leaf,
      R.receiptCommit(LIC, P1),
      LIC,
    ])
      expect(appears(p, secretish)).toBe(false);
  });

  it("the holder tag repeats within a scope and differs across scopes", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    prove(sim, who(offer));
    const first = hex(sim.state.lastPresentationHolder);
    prove(sim, who(offer, { challenge: b(61) }));
    expect(hex(sim.state.lastPresentationHolder)).toBe(first);
    prove(sim, who(offer), NIGHT, 0n, sim.now + HOUR, b(81));
    expect(hex(sim.state.lastPresentationHolder)).not.toBe(first);
  });

  it("needs a challenge, a real licence, the right end date, a future time it is still live at", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    expect(() => prove(sim, who(offer, { challenge: undefined }))).toThrow(
      /challenge/,
    );
    expect(() => prove(sim, who(offer, { license: OTHER }))).toThrow(
      /No live licence/,
    );
    expect(() => prove(sim, who(offer, { expires: EXPIRES + YEAR }))).toThrow(
      /No live licence/,
    );
    expect(() => prove(sim, who(offer), NIGHT, 0n, sim.now)).toThrow(/future/);
    expect(() => prove(sim, who(offer), NIGHT, 0n, EXPIRES + 1n)).toThrow(
      /ends at or before/,
    );
    expect(() => prove(sim, who(offer), NIGHT, 0n, EXPIRES)).toThrow(
      /ends at or before/,
    );
    prove(sim, who(offer), NIGHT, 0n, EXPIRES - 1n);
    expect(() =>
      prove(sim, who(offer), NIGHT, 0n, sim.now + HOUR, NIGHT),
    ).toThrow(/scope/);
    sim.advance(YEAR);
    expect(() => prove(sim, who(offer))).toThrow(/ends at or before/);
  });

  it("a licence from one offer is not a licence from another, and a stolen path does not help", () => {
    const { sim, offer } = withOffer();
    const second = post(sim, { nonce: b(51) });
    buy(sim, offer);
    expect(() => prove(sim, who(second))).toThrow(/No live licence/);
    const theirs = sim.pathFor(LIC, offer, EXPIRES)!;
    expect(() =>
      prove(sim, who(offer, { license: OTHER, path: theirs })),
    ).toThrow(/No live licence/);
  });
});

describe("revocation, ending and seals", () => {
  it("only the admin, and only if the offer said so", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    expect(() =>
      sim.call({ admin: OTHER }, "revokeLicense", keyOf(offer)),
    ).toThrow(/admin/);
    expect(() => sim.call({ admin: ADMIN }, "revokeLicense", b(77))).toThrow(
      /No such live/,
    );
    const fixed = withOffer({ revocable: false });
    buy(fixed.sim, fixed.offer);
    expect(() =>
      fixed.sim.call({ admin: ADMIN }, "revokeLicense", keyOf(fixed.offer)),
    ).toThrow(/cannot be revoked/);
  });

  it("a revoked licence leaves the tree at once, is flagged until the seal, and cannot be bought back", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    sim.advance(700n);
    sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer));
    expect(sim.pathFor(LIC, offer, EXPIRES)).toBeUndefined();
    expect(sim.state.licenseOffer.member(keyOf(offer))).toBe(false);
    expect(() => buy(sim, offer)).toThrow(/already bought/);
    expect(() =>
      sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer)),
    ).toThrow(/No such live/);
    // Until the seal, an older root still verifies, and the presentation says so.
    prove(sim, who(offer));
    expect(sim.state.lastPresentationUnsealed).toBe(true);
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(() => prove(sim, who(offer))).toThrow(/No live licence/);
  });

  it("a presentation proved before a revocation is rejected if it lands after the seal", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    sim.advance(700n);
    const p = sim.prove(
      who(offer),
      "proveLicense",
      NIGHT,
      0n,
      sim.now + HOUR,
      SCOPE,
    );
    sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer));
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(() => sim.land(p)).toThrow();
  });

  it("anyone clears an ended licence, freeing its slot; not before it ends", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n, revocable: false });
    sim.call({ license: LIC }, "buyLicense", offer, 7n);
    const k = keyOf(offer, LIC, T0 + 1000n);
    expect(() => sim.call({}, "clearEnded", k)).toThrow(/not ended/);
    sim.advance(1000n);
    sim.call({}, "clearEnded", k);
    expect(sim.state.licenseAtSlot.member(7n)).toBe(false);
    const other = post(sim, { record: OTHER, nonce: b(51) });
    sim.call({ license: LIC2 }, "buyLicense", other, 7n);
  });

  it("seals are rate-limited and need something to seal", () => {
    const { sim, offer } = withOffer();
    sim.advance(700n);
    expect(() => sim.call({}, "sealRevocations", sim.now + 100n)).toThrow(
      /Nothing has changed/,
    );
    buy(sim, offer);
    sim.call({}, "sealRevocations", sim.now + 100n);
    buy(sim, offer, LIC2);
    expect(() => sim.call({}, "sealRevocations", sim.now + 200n)).toThrow(
      /Too soon/,
    );
    sim.advance(700n);
    expect(() => sim.call({}, "sealRevocations", sim.now + 400n)).toThrow(
      /too far ahead/,
    );
    expect(() => sim.call({}, "sealRevocations", sim.now)).toThrow(/not ahead/);
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.sealSeq).toBe(2n);
  });

  it("a seal retires old receipt roots at most once a day, so paid-up proofs in flight survive", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    payFor(sim, offer, P1, 30n);
    sim.advance(86400n);
    sim.call({}, "sealRevocations", sim.now + 100n);
    const leaf = R.receiptLeaf(R.receiptCommit(LIC, P1), offer, 30n);
    const held = sim.receiptPathFor(leaf)!;
    buy(sim, offer, LIC2);
    payFor(sim, offer, P2, 5n, LIC2);
    sim.advance(700n);
    sim.call({}, "sealRevocations", sim.now + 100n);
    prove(
      sim,
      who(offer, { period: P1, units: 30n, receiptPath: held }),
      P1,
      30n,
    );
  });
});

describe("attacks from the first review (8 Oct 2026), now refused", () => {
  it("A1: a receipt cannot claim more units than were paid for", () => {
    const { sim, offer } = withOffer({ perUnit: 4n });
    buy(sim, offer);
    payFor(sim, offer, P1, 1n);
    expect(() =>
      prove(sim, who(offer, { period: P1, units: 1_000_000n }), P1, 1_000_000n),
    ).toThrow(/No royalty paid/);
    prove(sim, who(offer, { period: P1, units: 1n }), P1, 1n);
  });

  it("A2: paying through your own offer does not count for the breeder's", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    const mine = post(sim, {
      record: OTHER,
      nonce: b(51),
      perUnit: 1n,
      payTo: MINE,
      admin: OTHER,
    });
    payFor(sim, mine, P1, 500n);
    expect(() =>
      prove(sim, who(offer, { period: P1, units: 500n }), P1, 500n),
    ).toThrow(/No royalty paid/);
  });

  it("A3: squatting a receipt commitment through another offer does not block the real payment", () => {
    const { sim, offer } = withOffer();
    const junk = post(sim, {
      record: OTHER,
      nonce: b(51),
      perUnit: 1n,
      payTo: MINE,
      admin: OTHER,
    });
    payFor(sim, junk, P1, 1n);
    payFor(sim, offer, P1, 30n);
    buy(sim, offer);
    prove(sim, who(offer, { period: P1, units: 30n }), P1, 30n);
  });

  it("A4: a presentation publishes the verifier's time, not the licence's end date", () => {
    const { sim, offer } = withOffer({ expires: EXPIRES + 12345n });
    buy(sim, offer);
    const p = sim.prove(
      who(offer, { expires: EXPIRES + 12345n }),
      "proveLicense",
      NIGHT,
      0n,
      sim.now + HOUR,
      SCOPE,
    );
    expect(
      JSON.stringify(p, (_k: string, v: unknown): unknown =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ).not.toContain((EXPIRES + 12345n).toString());
  });

  it("A5: an old or stolen record secret cannot close, revoke or hand over the offer", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    for (const s of [BREEDER, ROTATED]) {
      expect(() =>
        sim.call({ admin: s }, "revokeLicense", keyOf(offer)),
      ).toThrow(/admin/);
      expect(() => sim.call({ admin: s }, "closeOffer", offer)).toThrow(
        /admin/,
      );
      expect(() =>
        sim.call({ admin: s }, "changeOfferAdmin", offer, R.adminCommit(s)),
      ).toThrow(/admin/);
    }
  });

  it("A6: a presentation with no period leaves no stale receipt root behind", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    payFor(sim, offer, P1, 3n);
    prove(sim, who(offer, { period: P1, units: 3n }), P1, 3n);
    prove(sim, who(offer, { challenge: b(61) }));
    expect(sim.state.lastPresentationReceiptRoot).toEqual(
      new RoyaltiesSimulator().state.lastPresentationReceiptRoot,
    );
  });

  it("A7: an ended licence on a non-revocable offer no longer holds its slot for ever", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n, revocable: false });
    sim.call({ license: LIC }, "buyLicense", offer, 7n);
    sim.advance(2000n);
    sim.call({}, "clearEnded", keyOf(offer, LIC, T0 + 1000n));
    const o2 = post(sim, {
      record: OTHER,
      nonce: b(51),
      expires: T0 + YEAR + 2000n,
    });
    sim.call({ license: LIC2 }, "buyLicense", o2, 7n);
  });
});

describe("second review (8 Oct 2026)", () => {
  it("clearing an ended licence does not flag presentations as unsealed", () => {
    const { sim, offer } = withOffer();
    const short = post(sim, { nonce: b(51), expires: T0 + 1000n });
    buy(sim, offer);
    sim.call({ license: LIC2 }, "buyLicense", short, sim.freeSlot());
    sim.advance(1000n);
    sim.call({}, "clearEnded", keyOf(short, LIC2, T0 + 1000n));
    prove(sim, who(offer));
    expect(sim.state.lastPresentationUnsealed).toBe(false);
  });

  it("an ended offer can be removed once its licences are cleared, not before", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n });
    buy(sim, offer);
    buy(sim, offer, LIC2);
    expect(sim.state.offers.lookup(offer).live).toBe(2n);
    expect(() => sim.call({}, "removeEnded", offer)).toThrow(/not ended/);
    sim.advance(1000n);
    expect(() => sim.call({}, "removeEnded", offer)).toThrow(/Clear/);
    sim.call({}, "clearEnded", keyOf(offer, LIC, T0 + 1000n));
    sim.call({}, "clearEnded", keyOf(offer, LIC2, T0 + 1000n));
    sim.call({}, "removeEnded", offer);
    expect(sim.state.offers.member(offer)).toBe(false);
  });

  it("revoking counts down the offer's live licences", () => {
    const { sim, offer } = withOffer();
    buy(sim, offer);
    sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer));
    expect(sim.state.offers.lookup(offer).live).toBe(0n);
    expect(sim.state.offers.lookup(offer).remaining).toBe(2n);
  });
});
