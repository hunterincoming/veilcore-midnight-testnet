// The royalties contract: offers, sales, royalty payments and presentations.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pureCircuits as V } from "../managed/veilcore/contract/index.js";
import { R, RoyaltiesSimulator, hex } from "./royalties-simulator.js";

const b = (n: number): Uint8Array => {
  const out = new Uint8Array(32);
  out[31] = n;
  out[0] = 0x5a;
  return out;
};
const NIGHT = new Uint8Array(32);
const STABLE = b(200);
const BREEDER = b(1);
const GROWER = b(2);
const OTHER = b(3);
const LIC = b(10);
const LIC2 = b(11);
const TERMS = b(20);
const PERIOD = b(30);
const WALLET = { bytes: b(40) };
const NONCE = b(50);

/** A breeder offer of `count` licences at `price` NIGHT. Returns the sim and the offer id. */
const withOffer = (count = 2n, price = 1000n, color: Uint8Array = NIGHT) => {
  const sim = new RoyaltiesSimulator();
  const { result } = sim.call(
    { record: BREEDER },
    "postOffer",
    NONCE,
    TERMS,
    color,
    price,
    WALLET,
    count,
  );
  return { sim, offer: result as Uint8Array };
};

describe("one record, two contracts", () => {
  it("names a record exactly as veilcore.compact's commit() does", () => {
    for (const s of [BREEDER, GROWER, NIGHT])
      expect(hex(R.recordCommit(s))).toBe(hex(V.commit(s)));
  });

  it("an offer's record is the poster's own, proved by the secret", () => {
    const { sim, offer } = withOffer();
    expect(hex(offer)).toBe(hex(R.offerId(V.commit(BREEDER), NONCE)));
    const o = sim.state.offers.lookup(offer);
    expect(hex(o.record)).toBe(hex(V.commit(BREEDER)));
    expect(o.open).toBe(true);
    expect(o.remaining).toBe(2n);
  });
});

describe("offers", () => {
  it("refuses an empty terms fingerprint, a zero price and zero licences", () => {
    const sim = new RoyaltiesSimulator();
    expect(() =>
      sim.call(
        { record: BREEDER },
        "postOffer",
        NONCE,
        NIGHT,
        NIGHT,
        1n,
        WALLET,
        1n,
      ),
    ).toThrow(/terms/);
    expect(() =>
      sim.call(
        { record: BREEDER },
        "postOffer",
        NONCE,
        TERMS,
        NIGHT,
        0n,
        WALLET,
        1n,
      ),
    ).toThrow(/price/);
    expect(() =>
      sim.call(
        { record: BREEDER },
        "postOffer",
        NONCE,
        TERMS,
        NIGHT,
        1n,
        WALLET,
        0n,
      ),
    ).toThrow(/at least one/);
  });

  it("refuses the same id twice; another nonce is another offer", () => {
    const { sim } = withOffer();
    expect(() =>
      sim.call(
        { record: BREEDER },
        "postOffer",
        NONCE,
        TERMS,
        NIGHT,
        1n,
        WALLET,
        1n,
      ),
    ).toThrow(/already exists/);
    sim.call(
      { record: BREEDER },
      "postOffer",
      b(51),
      TERMS,
      NIGHT,
      1n,
      WALLET,
      1n,
    );
  });

  it("another person posting with the same nonce makes a different offer, not a takeover", () => {
    const { sim, offer } = withOffer();
    const { result } = sim.call(
      { record: OTHER },
      "postOffer",
      NONCE,
      TERMS,
      NIGHT,
      1n,
      { bytes: b(41) },
      1n,
    );
    expect(hex(result as Uint8Array)).not.toBe(hex(offer));
    expect(hex(sim.state.offers.lookup(offer).payTo.bytes)).toBe(
      hex(WALLET.bytes),
    );
  });

  it("only the record's holder can close it", () => {
    const { sim, offer } = withOffer();
    expect(() => sim.call({ record: OTHER }, "closeOffer", offer)).toThrow(
      /Only the record's holder/,
    );
    sim.call({ record: BREEDER }, "closeOffer", offer);
    expect(sim.state.offers.lookup(offer).open).toBe(false);
    expect(() => sim.call({ record: BREEDER }, "closeOffer", offer)).toThrow(
      /closed/,
    );
  });
});

describe("sales", () => {
  it("passes the whole price to the breeder's wallet in the same call, and holds nothing", () => {
    const { sim, offer } = withOffer(2n, 1000n);
    const { moved } = sim.call({ license: LIC }, "buyLicense", offer);
    const color = hex(NIGHT);
    expect(moved.inputs.get(color)).toBe(1000n);
    expect(moved.outputs.get(color)).toBe(1000n);
    expect(moved.spends).toHaveLength(1);
    expect(moved.spends[0][0]).toBe(color);
    expect(moved.spends[0][1]).toContain(hex(WALLET.bytes));
    expect(moved.spends[0][2]).toBe(1000n);
  });

  it("works in any token the offer names, so a stablecoin needs no rebuild", () => {
    const { sim, offer } = withOffer(1n, 25n, STABLE);
    const { moved } = sim.call({ license: LIC }, "buyLicense", offer);
    expect(moved.inputs.get(hex(STABLE))).toBe(25n);
    expect(moved.outputs.get(hex(STABLE))).toBe(25n);
    expect(moved.inputs.has(hex(NIGHT))).toBe(false);
  });

  it("issues the licence to the buyer's own secret, without a step from the breeder", () => {
    const { sim, offer } = withOffer();
    sim.call({ license: LIC }, "buyLicense", offer);
    const k = R.licenseKey(R.licenseCommit(LIC, offer), offer);
    expect(sim.state.sold.member(k)).toBe(true);
    expect(sim.pathFor(LIC, offer)).toBeDefined();
    expect(sim.state.offers.lookup(offer).remaining).toBe(1n);
    expect(sim.state.saleSeq).toBe(1n);
  });

  it("refuses the same licence secret twice, and sells out", () => {
    const { sim, offer } = withOffer(2n);
    sim.call({ license: LIC }, "buyLicense", offer);
    expect(() => sim.call({ license: LIC }, "buyLicense", offer)).toThrow(
      /already bought/,
    );
    sim.call({ license: LIC2 }, "buyLicense", offer);
    expect(() => sim.call({ license: b(12) }, "buyLicense", offer)).toThrow(
      /sold out/,
    );
  });

  it("sells nothing from a closed or unknown offer", () => {
    const { sim, offer } = withOffer();
    expect(() => sim.call({ license: LIC }, "buyLicense", b(99))).toThrow(
      /No such offer/,
    );
    sim.call({ record: BREEDER }, "closeOffer", offer);
    expect(() => sim.call({ license: LIC }, "buyLicense", offer)).toThrow(
      /closed/,
    );
  });

  it("a licence bought from one offer is not a licence from another", () => {
    const { sim, offer } = withOffer();
    const { result } = sim.call(
      { record: BREEDER },
      "postOffer",
      b(51),
      TERMS,
      NIGHT,
      1n,
      WALLET,
      1n,
    );
    sim.call({ license: LIC }, "buyLicense", offer);
    expect(() =>
      sim.call(
        { license: LIC, offer: result as Uint8Array, challenge: b(60) },
        "proveLicense",
      ),
    ).toThrow(/No licence from that offer/);
  });
});

describe("royalties", () => {
  it("passes a royalty to the breeder's wallet and records an unlinkable receipt", () => {
    const { sim, offer } = withOffer();
    sim.call({ license: LIC }, "buyLicense", offer);
    const { moved } = sim.call(
      { license: LIC, offer },
      "payRoyalty",
      offer,
      PERIOD,
      70n,
    );
    expect(moved.inputs.get(hex(NIGHT))).toBe(70n);
    expect(moved.outputs.get(hex(NIGHT))).toBe(70n);
    expect(moved.spends[0][1]).toContain(hex(WALLET.bytes));
    const r = R.receiptKey(LIC, offer, PERIOD);
    expect(sim.state.receipts.member(r)).toBe(true);
    const leaf = R.licenseKey(R.licenseCommit(LIC, offer), offer);
    expect(hex(r)).not.toBe(hex(leaf));
    expect(sim.state.royaltySeq).toBe(1n);
  });

  it("one payment per licence and period; a new period pays again", () => {
    const { sim, offer } = withOffer();
    sim.call({ license: LIC }, "buyLicense", offer);
    sim.call({ license: LIC, offer }, "payRoyalty", offer, PERIOD, 70n);
    expect(() =>
      sim.call({ license: LIC, offer }, "payRoyalty", offer, PERIOD, 70n),
    ).toThrow(/already recorded/);
    sim.call({ license: LIC, offer }, "payRoyalty", offer, b(31), 70n);
  });

  it("only a licensee of that offer can pay through it, and not zero", () => {
    const { sim, offer } = withOffer();
    expect(() =>
      sim.call({ license: LIC, offer }, "payRoyalty", offer, PERIOD, 70n),
    ).toThrow(/No licence/);
    sim.call({ license: LIC }, "buyLicense", offer);
    expect(() =>
      sim.call({ license: LIC, offer }, "payRoyalty", offer, PERIOD, 0n),
    ).toThrow(/more than zero/);
  });

  it("a stale path from an earlier tree still proves a licence that was never removed", () => {
    const { sim, offer } = withOffer(3n);
    sim.call({ license: LIC }, "buyLicense", offer);
    const old = sim.pathFor(LIC, offer)!;
    sim.call({ license: LIC2 }, "buyLicense", offer);
    sim.call(
      { license: LIC, offer, path: old },
      "payRoyalty",
      offer,
      PERIOD,
      5n,
    );
  });
  it("closing an offer stops sales, not royalties on licences already sold", () => {
    const { sim, offer } = withOffer();
    sim.call({ license: LIC }, "buyLicense", offer);
    sim.call({ record: BREEDER }, "closeOffer", offer);
    expect(() => sim.call({ license: LIC2 }, "buyLicense", offer)).toThrow(
      /closed/,
    );
    const { moved } = sim.call(
      { license: LIC, offer },
      "payRoyalty",
      offer,
      PERIOD,
      9n,
    );
    expect(moved.outputs.get(hex(NIGHT))).toBe(9n);
  });
});

describe("presentations", () => {
  it("proves a licence to one verifier, publishing only the challenge-bound tag", () => {
    const { sim, offer } = withOffer();
    sim.call({ license: LIC }, "buyLicense", offer);
    sim.call({ license: LIC, offer, challenge: b(60) }, "proveLicense");
    expect(hex(sim.state.lastPresentation)).toBe(
      hex(R.presentationTag(offer, b(60))),
    );
    expect(sim.state.presentationSeq).toBe(1n);
  });

  it("needs a challenge and a real licence", () => {
    const { sim, offer } = withOffer();
    sim.call({ license: LIC }, "buyLicense", offer);
    expect(() => sim.call({ license: LIC, offer }, "proveLicense")).toThrow(
      /challenge/,
    );
    expect(() =>
      sim.call({ license: OTHER, offer, challenge: b(60) }, "proveLicense"),
    ).toThrow(/No licence/);
  });

  it("a path for someone else's leaf does not work with your secret", () => {
    const { sim, offer } = withOffer();
    sim.call({ license: LIC }, "buyLicense", offer);
    const theirs = sim.pathFor(LIC, offer)!;
    expect(() =>
      sim.call(
        { license: OTHER, offer, challenge: b(60), path: theirs },
        "proveLicense",
      ),
    ).toThrow(/No licence/);
  });
});
