// Royalties on offspring (protocol 3, docs/royalties-offspring-design.md): descent links
// with terms both holders agreed, a pedigree chart flattened once, and every licence sale
// and split top-up paying each ancestor its share in the same call.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  RoyaltiesSimulator,
  R,
  T0,
  type Caller,
} from "./royalties-simulator.js";
import { pureCircuits as V } from "../managed/veilcore/contract/index.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const b = (n: number): Uint8Array => {
  const o = new Uint8Array(32);
  o[0] = 0x6c;
  o[31] = n;
  return o;
};
const NIGHT = new Uint8Array(32);
const STABLE = b(200);
const ZERO = new Uint8Array(32);
const DAY = 86400n;
const YEAR = 365n * DAY;
const SALT = b(90);
const RATE = 4n;

// Records (secrets) and their wallets.
const A = b(1); // great-grandparent / grandparent
const B = b(2); // parent
const C = b(3); // child
const D = b(4); // grandchild
const S = b(5); // a "sock" record
const E = b(6); // a second parent
const wallet = (n: number) => ({ bytes: b(100 + n) });
const W = {
  A: wallet(1),
  B: wallet(2),
  C: wallet(3),
  D: wallet(4),
  S: wallet(5),
  E: wallet(6),
};
const PAYEE = b(70);
const ADMIN = b(80);

const rec = (secret: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(V.commit(secret));

type Terms = {
  color?: Uint8Array;
  fee?: bigint;
  share?: bigint;
  generations?: bigint;
  until?: bigint;
  payTo?: { bytes: Uint8Array };
};

const propose = (
  sim: RoyaltiesSimulator,
  child: Uint8Array,
  parent: Uint8Array,
  t: Terms = {},
) =>
  sim.call(
    { record: child },
    "proposeLink",
    rec(parent),
    t.color ?? NIGHT,
    t.fee ?? 0n,
    t.share ?? 1000n,
    t.generations ?? 2n,
    t.until ?? T0 + YEAR,
    t.payTo ?? { bytes: b(110) },
    R.payeeCommit(PAYEE),
  ).result as Uint8Array<ArrayBuffer>;

/** The parent confirms exactly the terms now on the link. */
const confirm = (
  sim: RoyaltiesSimulator,
  parent: Uint8Array,
  child: Uint8Array,
) => {
  const l = sim.state.links.lookup(R.linkId(rec(child), rec(parent)));
  return sim.call(
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
};

const finalise = (
  sim: RoyaltiesSimulator,
  child: Uint8Array,
  l1: Uint8Array = ZERO,
  l2: Uint8Array = ZERO,
) =>
  sim.call(
    { record: child },
    "finaliseStack",
    Uint8Array.from(l1),
    Uint8Array.from(l2),
  );

/** child links to parent with terms paid to the parent's wallet; parent confirms. */
const link = (
  sim: RoyaltiesSimulator,
  child: Uint8Array,
  parent: Uint8Array,
  payTo: { bytes: Uint8Array },
  t: Terms = {},
) => {
  const id = propose(sim, child, parent, { ...t, payTo });
  confirm(sim, parent, child);
  return id;
};

let nonce = 0;
const post = (
  sim: RoyaltiesSimulator,
  record: Uint8Array,
  payTo: { bytes: Uint8Array },
  o: { color?: Uint8Array; price?: bigint } = {},
) =>
  sim.call(
    { record },
    "postOffer",
    b(150 + ++nonce),
    R.adminCommit(ADMIN),
    b(20),
    o.color ?? NIGHT,
    o.price ?? 1000n,
    R.rateCommit(RATE, SALT),
    payTo,
    5n,
    T0 + YEAR,
    true,
  ).result as Uint8Array<ArrayBuffer>;

let lic = 0;
const buy = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  extra: Partial<Caller> = {},
) =>
  sim.call(
    { license: b(200 - ++lic), ...extra },
    "buyLicense",
    offer,
    sim.freeSlot(),
  ).moved;

/** What a wallet received of a token in one call. */
const paid = (
  moved: { spends: Array<[string, string, bigint]> },
  color: Uint8Array,
  w: { bytes: Uint8Array },
): bigint =>
  moved.spends
    .filter(([t, to]) => t === hex(color) && to.includes(hex(w.bytes)))
    .reduce((a, [, , v]) => a + v, 0n);

describe("descent links: terms both holders agreed", () => {
  it("a record with no links posts as before: no split, the whole price to its wallet", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim, A, W.A);
    expect(sim.state.offers.lookup(offer).split).toBe(false);
    expect(sim.state.stacks.member(rec(A))).toBe(true);
    const moved = buy(sim, offer);
    expect(paid(moved, NIGHT, W.A)).toBe(1000n);
  });

  it("a child pays its parent's share of the price and the fee, in the same call", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    const l = link(sim, C, B, W.B, { share: 1000n, fee: 50n });
    finalise(sim, C, l);
    const offer = post(sim, C, W.C);
    expect(sim.state.offers.lookup(offer).split).toBe(true);
    const moved = buy(sim, offer);
    expect(paid(moved, NIGHT, W.B)).toBe(100n + 50n);
    expect(paid(moved, NIGHT, W.C)).toBe(900n);
    expect(moved.inputs.get(hex(NIGHT))).toBe(1050n);
  });

  it("a grandparent gets half its share, a great-grandparent a quarter, only as far as each link runs", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(sim, B, link(sim, B, A, W.A, { share: 2000n, generations: 3n }));
    finalise(sim, C, link(sim, C, B, W.B, { share: 1000n, generations: 2n }));
    finalise(sim, D, link(sim, D, C, W.C, { share: 1000n, generations: 1n }));
    const chart = sim.state.stacks.lookup(rec(D));
    expect(hex(chart[0])).toBe(hex(R.linkId(rec(D), rec(C))));
    expect(hex(chart[2])).toBe(hex(R.linkId(rec(C), rec(B))));
    expect(hex(chart[6])).toBe(hex(R.linkId(rec(B), rec(A))));
    const moved = buy(sim, post(sim, D, W.D));
    expect(paid(moved, NIGHT, W.C)).toBe(100n); // 10%
    expect(paid(moved, NIGHT, W.B)).toBe(50n); // half of 10%
    expect(paid(moved, NIGHT, W.A)).toBe(50n); // a quarter of 20%
    expect(paid(moved, NIGHT, W.D)).toBe(800n);
    // C's link runs one generation only: D's children owe C nothing.
    const F = b(7);
    finalise(sim, F, link(sim, F, D, wallet(7), { share: 0n, fee: 0n }));
    const f = sim.state.stacks.lookup(rec(F));
    expect(
      f
        .slice(2)
        .every(
          (x) =>
            hex(x) === hex(ZERO) || hex(x) !== hex(R.linkId(rec(D), rec(C))),
        ),
    ).toBe(true);
  });

  it("a middle generation with no terms of its own still carries the grandparent's", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(sim, B, link(sim, B, A, W.A, { share: 2000n, generations: 2n }));
    finalise(
      sim,
      C,
      link(sim, C, B, W.B, { share: 0n, fee: 0n, generations: 1n }),
    );
    const moved = buy(sim, post(sim, C, W.C));
    expect(paid(moved, NIGHT, W.A)).toBe(100n);
    expect(paid(moved, NIGHT, W.B)).toBe(0n);
  });

  it("two parents, each with their own line, fill the chart in fixed places", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(sim, B, link(sim, B, A, W.A, { share: 1000n, generations: 2n }));
    finalise(sim, E);
    const l1 = link(sim, C, B, W.B, { share: 1000n });
    const l2 = link(sim, C, E, W.E, { share: 500n });
    finalise(sim, C, l1, l2);
    const chart = sim.state.stacks.lookup(rec(C));
    expect([0, 1, 2].map((i) => hex(chart[i]))).toEqual([
      hex(l1),
      hex(l2),
      hex(R.linkId(rec(B), rec(A))),
    ]);
    const moved = buy(sim, post(sim, C, W.C));
    expect(paid(moved, NIGHT, W.B)).toBe(100n);
    expect(paid(moved, NIGHT, W.E)).toBe(50n);
    expect(paid(moved, NIGHT, W.A)).toBe(50n);
    expect(paid(moved, NIGHT, W.C)).toBe(800n);
  });

  it("shares round down, so the ancestors never take more than agreed", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, W.B, { share: 15n }));
    const moved = buy(sim, post(sim, C, W.C, { price: 999n }));
    expect(paid(moved, NIGHT, W.B)).toBe(1n); // 0.15% of 999 is 1.4985
    expect(paid(moved, NIGHT, W.C)).toBe(998n);
    const up = Array.from({ length: 14 }, (_, i) => (i === 0 ? 2n : 0n));
    expect(() =>
      buy(sim, post(sim, C, W.C, { price: 999n }), { split: up }),
    ).toThrow(/rounded down/);
  });
});

describe("what neither side can do", () => {
  it("a buyer cannot short an ancestor, pay an empty place, or pay a link that has ended", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(
      sim,
      C,
      link(sim, C, B, W.B, { share: 1000n, until: T0 + 30n * DAY }),
    );
    const offer = post(sim, C, W.C);
    const short = Array.from({ length: 14 }, (_, i) => (i === 0 ? 99n : 0n));
    expect(() => buy(sim, offer, { split: short })).toThrow(/ancestor's share/);
    const stray = Array.from({ length: 14 }, (_, i) =>
      i === 0 ? 100n : i === 5 ? 1n : 0n,
    );
    expect(() => buy(sim, offer, { split: stray })).toThrow(/empty place/);
    sim.advance(31n * DAY);
    const stale = Array.from({ length: 14 }, (_, i) => (i === 0 ? 100n : 0n));
    expect(() => buy(sim, offer, { split: stale })).toThrow(/Nothing is owed/);
    const moved = buy(sim, offer);
    expect(paid(moved, NIGHT, W.C)).toBe(1000n);
  });

  it("a child cannot escape a share by posting in another token; a fee-only link may use any", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, W.B, { color: STABLE, share: 1000n }));
    expect(() => post(sim, C, W.C, { color: NIGHT })).toThrow(/another token/);
    const inStable = post(sim, C, W.C, { color: STABLE });
    expect(sim.state.offers.lookup(inStable).split).toBe(true);

    const sim2 = new RoyaltiesSimulator();
    finalise(sim2, B);
    finalise(
      sim2,
      C,
      link(sim2, C, B, W.B, { color: STABLE, share: 0n, fee: 25n }),
    );
    const offer = post(sim2, C, W.C, { color: NIGHT });
    expect(sim2.state.offers.lookup(offer).split).toBe(false);
    const moved = buy(sim2, offer);
    expect(paid(moved, STABLE, W.B)).toBe(25n);
    expect(paid(moved, NIGHT, W.C)).toBe(1000n);
  });

  it("ancestors take at most half: a link that would pass it is refused when the parent confirms", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(sim, B, link(sim, B, A, W.A, { share: 4000n, generations: 2n })); // C inherits 20%
    propose(sim, C, B, { share: 3001n, payTo: W.B });
    expect(() => confirm(sim, B, C)).toThrow(/more than half/);
    // A "sock" parent cannot squeeze the real one either: whoever confirms second is refused.
    const sim2 = new RoyaltiesSimulator();
    finalise(sim2, S);
    finalise(sim2, B);
    link(sim2, C, S, W.C, { share: 5000n });
    propose(sim2, C, B, { share: 1000n, payTo: W.B });
    expect(() => confirm(sim2, B, C)).toThrow(/more than half/);
  });

  it("the order is enforced: parent final before confirming, no links after the child is final", () => {
    const sim = new RoyaltiesSimulator();
    propose(sim, C, B, { payTo: W.B });
    expect(() => confirm(sim, B, C)).toThrow(/Finalise your own/);
    expect(() => post(sim, C, W.C)).toThrow(/finalise its ancestors/);
    finalise(sim, B);
    confirm(sim, B, C);
    expect(() => confirm(sim, B, C)).toThrow(/already confirmed/);
    finalise(sim, C, R.linkId(rec(C), rec(B)));
    expect(() => propose(sim, C, E)).toThrow(/final/);
    expect(() => finalise(sim, C)).toThrow(/already final/);
  });

  it("a record cannot finalise while one of its links is still waiting for the parent", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    propose(sim, C, B, { payTo: W.B });
    expect(() => finalise(sim, C)).toThrow(/waiting/);
    sim.call({ record: C }, "withdrawLink", rec(B));
    finalise(sim, C);
  });

  it("only a confirmed link of your own record can go in your chart; at most two parents", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, E);
    finalise(sim, A);
    const lDB = link(sim, D, B, W.B);
    expect(() => finalise(sim, C, lDB)).toThrow(/not a confirmed link/);
    propose(sim, C, B, { payTo: W.B });
    confirm(sim, B, C);
    link(sim, C, E, W.E, { share: 100n });
    propose(sim, C, A, { share: 100n, payTo: W.A });
    expect(() => confirm(sim, A, C)).toThrow(/two confirmed parents/);
    sim.call({ record: C }, "withdrawLink", rec(A));
    expect(sim.state.links.member(R.linkId(rec(C), rec(A)))).toBe(false);
    expect(() => sim.call({ record: C }, "withdrawLink", rec(B))).toThrow(
      /No unconfirmed link/,
    );
  });

  it("shares in two tokens are refused when the second link is confirmed, not discovered later", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(
      sim,
      B,
      link(sim, B, A, W.A, { color: STABLE, share: 100n, generations: 2n }),
    );
    propose(sim, C, B, { color: NIGHT, share: 1000n, payTo: W.B });
    expect(() => confirm(sim, B, C)).toThrow(/two tokens/);
    // Two parents asking for shares in different tokens: the second confirmation is refused.
    const sim2 = new RoyaltiesSimulator();
    finalise(sim2, B);
    finalise(sim2, E);
    link(sim2, C, B, W.B, { color: STABLE, share: 100n });
    propose(sim2, C, E, { color: NIGHT, share: 100n, payTo: W.E });
    expect(() => confirm(sim2, E, C)).toThrow(/two tokens/);
    // A fee-only link in another token is fine.
    propose(sim2, D, E, { color: NIGHT, share: 0n, fee: 5n, payTo: W.E });
    expect(() => confirm(sim2, E, D)).not.toThrow();
  });

  it("an ended ancestor link no longer counts toward the cap or the token when a child confirms", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(
      sim,
      B,
      link(sim, B, A, W.A, {
        color: STABLE,
        share: 5000n,
        generations: 2n,
        until: T0 + 10n * DAY,
      }),
    );
    sim.advance(11n * DAY);
    // A's link has ended: C may take its shares in NIGHT, and the full 50% is free again.
    propose(sim, C, B, { color: NIGHT, share: 5000n, payTo: W.B });
    expect(() => confirm(sim, B, C)).not.toThrow();
  });

  it("an offer whose ancestors take a royalty share must take royalties through the contract", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, W.B, { share: 1000n }));
    expect(() =>
      sim.call(
        { record: C },
        "postOffer",
        b(99),
        R.adminCommit(ADMIN),
        b(20),
        NIGHT,
        1000n,
        ZERO,
        W.C,
        5n,
        T0 + YEAR,
        true,
      ),
    ).toThrow(/must take royalties/);
  });

  it("once every ancestor's share has ended, new offers keep the private top-up", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(
      sim,
      C,
      link(sim, C, B, W.B, { share: 1000n, until: T0 + 10n * DAY }),
    );
    const first = post(sim, C, W.C);
    expect(sim.state.offers.lookup(first).split).toBe(true);
    sim.advance(11n * DAY);
    const later = post(sim, C, W.C);
    expect(sim.state.offers.lookup(later).split).toBe(false);
  });

  it("a parent confirms only the exact terms it names; a record that proposed and withdrew can still post", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    propose(sim, C, B, { share: 1000n, payTo: W.B });
    expect(() =>
      sim.call(
        { record: B },
        "confirmLink",
        rec(C),
        R.linkTermsHash(
          NIGHT,
          0n,
          2000n,
          2n,
          T0 + YEAR,
          W.B.bytes,
          R.payeeCommit(PAYEE),
        ),
      ),
    ).toThrow(/not the ones you are confirming/);
    sim.call({ record: C }, "withdrawLink", rec(B));
    const posted = post(sim, C, W.C);
    expect(sim.state.offers.member(posted)).toBe(true);
  });

  it("only the payee key moves where a link is paid; the child never can", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    const l = link(sim, C, B, W.B, { share: 1000n });
    finalise(sim, C, l);
    const offer = post(sim, C, W.C);
    expect(() => sim.call({ admin: C }, "movePayee", l, W.C)).toThrow(
      /payee key/,
    );
    sim.call({ admin: PAYEE }, "movePayee", l, W.E);
    const moved = buy(sim, offer);
    expect(paid(moved, NIGHT, W.E)).toBe(100n);
    expect(paid(moved, NIGHT, W.B)).toBe(0n);
  });

  it("a record that replaced another adopts its chart unchanged, with no parent asked again", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, W.B, { share: 1000n }));
    const C2 = b(30);
    sim.call({ record: C2 }, "adoptStack", rec(C));
    expect(sim.state.stacks.lookup(rec(C2)).map(hex)).toEqual(
      sim.state.stacks.lookup(rec(C)).map(hex),
    );
    const moved = buy(sim, post(sim, C2, W.C));
    expect(paid(moved, NIGHT, W.B)).toBe(100n);
  });
});

describe("royalty top-ups with ancestors' shares", () => {
  const setup = () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, W.B, { share: 1000n }));
    const offer = post(sim, C, W.C);
    const o = sim.state.offers.lookup(offer);
    const opening = {
      offer,
      payTo: o.payTo.bytes,
      color: o.color,
      rateCommit: o.rateCommit,
      expires: o.expires,
      split: o.split,
    };
    return { sim, offer, opening };
  };
  const code = (licence: Uint8Array, offer: Uint8Array, n: Uint8Array) =>
    R.topUpCode(R.spendKey(licence, offer), n);

  it("must go through topUpSplit, which pays each share; the private topUp refuses", () => {
    const { sim, offer, opening } = setup();
    const L = b(60);
    buy(sim, offer, { license: L });
    expect(() =>
      sim.call(
        {
          opening,
          code: code(L, offer, b(61)),
          rate: { rate: RATE, salt: SALT },
        },
        "topUp",
        W.C,
        NIGHT,
        500n,
        T0 + DAY,
      ),
    ).toThrow(/topUpSplit/);
    const moved = sim.call(
      { code: code(L, offer, b(61)), rate: { rate: RATE, salt: SALT } },
      "topUpSplit",
      offer,
      500n,
    ).moved;
    expect(paid(moved, NIGHT, W.B)).toBe(50n);
    expect(paid(moved, NIGHT, W.C)).toBe(450n);
    // The credit is a normal private note, and settles as one.
    const note = R.noteCommit(
      code(L, offer, b(61)),
      R.offerLeaf(
        offer,
        opening.payTo,
        NIGHT,
        opening.rateCommit,
        opening.expires,
        true,
      ),
      500n,
    );
    expect(sim.state.noteSeen.member(note)).toBe(true);
    sim.call(
      {
        license: L,
        opening,
        expires: opening.expires,
        note: { nonce: b(61), amount: 500n },
        rate: { rate: RATE, salt: SALT },
        period: b(40),
        units: 10n,
      },
      "settle",
    );
    expect(sim.state.settleSeq).toBe(1n);
  });

  it("an offer without shares keeps the private topUp, and topUpSplit refuses it", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim, A, W.A);
    expect(() =>
      sim.call(
        { code: b(62), rate: { rate: RATE, salt: SALT } },
        "topUpSplit",
        offer,
        500n,
      ),
    ).toThrow(/use topUp/);
  });

  it("topUpSplit needs the offer's real rate, so no credit is sold that cannot settle", () => {
    const { sim, offer } = setup();
    expect(() =>
      sim.call(
        { code: b(63), rate: { rate: RATE + 1n, salt: SALT } },
        "topUpSplit",
        offer,
        500n,
      ),
    ).toThrow(/royalty rate/);
  });
});
