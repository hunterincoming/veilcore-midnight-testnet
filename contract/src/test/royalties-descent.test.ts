// Royalties on offspring (docs/royalties-offspring-design.md): descent links with terms
// both holders agreed, a pedigree chart flattened once, and every licence and credit
// issued on a descendant recording, in the same call, exactly what each ancestor is owed.
// No money passes through the contract.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  RoyaltiesSimulator,
  R,
  ISSUER,
  T0,
  offerLeafOf,
} from "./royalties-simulator.js";
import { pureCircuits as V } from "../managed/veilcore/contract/index.js";
import type {
  OfferOpening,
  Owed,
} from "../managed/veilcore-royalties/contract/index.js";
import { unitOf } from "../royalties.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const b = (n: number): Uint8Array => {
  const o = new Uint8Array(32);
  o[0] = 0x6c;
  o[31] = n;
  return o;
};
const USD = unitOf("USD cents");
const EUR = unitOf("EUR cents");
const ZERO = new Uint8Array(32);
const DAY = 86400n;
const YEAR = 365n * DAY;
const SALT = b(90);
const RATE = 4n;

// Records (secrets).
const A = b(1); // great-grandparent / grandparent
const B = b(2); // parent
const C = b(3); // child
const D = b(4); // grandchild
const S = b(5); // a "sock" record
const E = b(6); // a second parent
const PAYEE = b(70);
const ADMIN = b(80);

const rec = (secret: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(V.commit(secret));

type Terms = {
  unit?: Uint8Array;
  fee?: bigint;
  share?: bigint;
  generations?: bigint;
  until?: bigint;
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
    t.unit ?? USD,
    t.fee ?? 0n,
    t.share ?? 1000n,
    t.generations ?? 2n,
    t.until ?? T0 + YEAR,
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
    R.linkTermsHash(l.unit, l.fee, l.share, l.generations, l.until, l.payee),
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

/** child links to parent on these terms; parent confirms. */
const link = (
  sim: RoyaltiesSimulator,
  child: Uint8Array,
  parent: Uint8Array,
  t: Terms = {},
) => {
  const id = propose(sim, child, parent, t);
  confirm(sim, parent, child);
  return id;
};

let nonce = 0;
const post = (
  sim: RoyaltiesSimulator,
  record: Uint8Array,
  o: { unit?: Uint8Array; price?: bigint } = {},
) =>
  sim.call(
    { record, rate: { rate: RATE, salt: SALT } },
    "postOffer",
    b(150 + ++nonce),
    R.adminCommit(ADMIN),
    b(20),
    o.unit ?? USD,
    o.price ?? 1000n,
    R.rateCommit(RATE, SALT),
    5n,
    T0 + YEAR,
    true,
    R.adminCommit(ISSUER),
    sim.freeIssuerSlot(),
  ).result as Uint8Array<ArrayBuffer>;

let lic = 0;
/** The breeder issues a licence (paid off chain). Returns its key. */
const issue = (sim: RoyaltiesSimulator, offer: Uint8Array): Uint8Array => {
  const L = b(200 - ++lic);
  const moved = sim.call(
    { admin: ADMIN },
    "issueLicense",
    offer,
    R.licenseCommit(R.viewKey(L, offer), R.spendKey(L, offer), offer),
    sim.freeSlot(),
  ).moved;
  expect(moved.inputs.size + moved.outputs.size + moved.spends.length).toBe(0);
  return sim.state.lastSale;
};

/** What `key` records as owed, or undefined. */
const owedBy = (sim: RoyaltiesSimulator, key: Uint8Array): Owed | undefined =>
  sim.state.owed.member(key) ? sim.state.owed.lookup(key) : undefined;

/** Place i's due from one record: total x weight / 40,000 (exact here when it divides). */
const due = (e: Owed | undefined, i: number): bigint =>
  e === undefined ? 0n : (e.total * e.weights[i]) / 40000n;

describe("descent links: terms both holders agreed", () => {
  it("a record with no links posts as before: no split, and its licences owe nothing", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim, A);
    expect(sim.state.offers.lookup(offer).split).toBe(false);
    expect(sim.state.stacks.member(rec(A))).toBe(true);
    issue(sim, offer);
    expect(sim.state.owedSeq).toBe(0n);
  });

  it("a licence records the parent's share of the list price and its fee, in the same call", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    const l = link(sim, C, B, { share: 1000n, fee: 50n });
    finalise(sim, C, l);
    const offer = post(sim, C);
    expect(sim.state.offers.lookup(offer).split).toBe(true);
    const e = owedBy(sim, issue(sim, offer));
    expect(e?.total).toBe(1000n);
    expect(e?.weights[0]).toBe(4000n); // 10% of the base, in 40,000ths
    expect(due(e, 0)).toBe(100n);
    expect(e?.fees).toEqual([50n, 0n]);
    expect(hex(e!.record)).toBe(hex(rec(C)));
    expect(hex(e!.unit)).toBe(hex(USD));
  });

  it("a grandparent is owed half its share, a great-grandparent a quarter, only as far as each link runs", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(sim, B, link(sim, B, A, { share: 2000n, generations: 3n }));
    finalise(sim, C, link(sim, C, B, { share: 1000n, generations: 2n }));
    finalise(sim, D, link(sim, D, C, { share: 1000n, generations: 1n }));
    const chart = sim.state.stacks.lookup(rec(D));
    expect(hex(chart[0])).toBe(hex(R.linkId(rec(D), rec(C))));
    expect(hex(chart[2])).toBe(hex(R.linkId(rec(C), rec(B))));
    expect(hex(chart[6])).toBe(hex(R.linkId(rec(B), rec(A))));
    const e = owedBy(sim, issue(sim, post(sim, D)));
    expect(due(e, 0)).toBe(100n); // C: 10%
    expect(due(e, 2)).toBe(50n); // B: half of 10%
    expect(due(e, 6)).toBe(50n); // A: a quarter of 20%
    // C's link runs one generation only: D's children owe C nothing.
    const F = b(7);
    finalise(sim, F, link(sim, F, D, { share: 0n, fee: 0n }));
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
    finalise(sim, B, link(sim, B, A, { share: 2000n, generations: 2n }));
    finalise(sim, C, link(sim, C, B, { share: 0n, fee: 0n, generations: 1n }));
    const e = owedBy(sim, issue(sim, post(sim, C)));
    expect(due(e, 2)).toBe(100n);
    expect(due(e, 0)).toBe(0n);
  });

  it("two parents, each with their own line, fill the chart in fixed places", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(sim, B, link(sim, B, A, { share: 1000n, generations: 2n }));
    finalise(sim, E);
    const l1 = link(sim, C, B, { share: 1000n });
    const l2 = link(sim, C, E, { share: 500n });
    finalise(sim, C, l1, l2);
    const chart = sim.state.stacks.lookup(rec(C));
    expect([0, 1, 2].map((i) => hex(chart[i]))).toEqual([
      hex(l1),
      hex(l2),
      hex(R.linkId(rec(B), rec(A))),
    ]);
    const e = owedBy(sim, issue(sim, post(sim, C)));
    expect([due(e, 0), due(e, 1), due(e, 2)]).toEqual([100n, 50n, 50n]);
  });

  it("shares are recorded exactly, never rounded per issuance: small or chunked amounts lose nothing", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, { share: 15n }));
    // 0.15% of 999 is 1.4985: the record keeps the base and the weight, not a rounded 1.
    const e = owedBy(sim, issue(sim, post(sim, C, { price: 999n })));
    expect(e?.total).toBe(999n);
    expect(e?.weights[0]).toBe(60n);
    // The review's chunking case: 100 credits of 19 at 10% are owed 190 in all, not 100.
    const sim2 = new RoyaltiesSimulator();
    finalise(sim2, B);
    finalise(sim2, C, link(sim2, C, B, { share: 1000n }));
    const offer = post(sim2, C);
    for (let i = 0; i < 100; i++)
      sim2.call(
        {
          issuer: ISSUER,
          code: Uint8Array.from([0x99, i, ...new Uint8Array(30)]),
        },
        "issueCreditSplit",
        offer,
        19n,
      );
    const sum = [...sim2.state.owed].reduce(
      (a, [, x]) => a + x.total * x.weights[0],
      0n,
    );
    expect(sum / 40000n).toBe(190n);
  });
});

describe("what neither side can do", () => {
  it("the issuer supplies no amounts: the contract works each share out; an ended link is owed nothing", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, { share: 1000n, until: T0 + 30n * DAY }));
    const offer = post(sim, C);
    expect(due(owedBy(sim, issue(sim, offer)), 0)).toBe(100n);
    sim.advance(31n * DAY);
    issue(sim, offer);
    expect(sim.state.owedSeq).toBe(1n);
  });

  it("a child cannot escape a share by posting in another unit; a fee-only link may use any", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, { unit: EUR, share: 1000n }));
    expect(() => post(sim, C, { unit: USD })).toThrow(/another unit/);
    const inEur = post(sim, C, { unit: EUR });
    expect(sim.state.offers.lookup(inEur).split).toBe(true);

    const sim2 = new RoyaltiesSimulator();
    finalise(sim2, B);
    finalise(sim2, C, link(sim2, C, B, { unit: EUR, share: 0n, fee: 25n }));
    const offer = post(sim2, C, { unit: USD });
    expect(sim2.state.offers.lookup(offer).split).toBe(false);
    // The fee is recorded; it is counted in its own link's unit (EUR cents).
    const e = owedBy(sim2, issue(sim2, offer));
    expect(e?.fees).toEqual([25n, 0n]);
    expect(
      hex(sim2.state.links.lookup(sim2.state.stacks.lookup(rec(C))[0]).unit),
    ).toBe(hex(EUR));
  });

  it("ancestors take at most half: a link that would pass it is refused when the parent confirms", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(sim, B, link(sim, B, A, { share: 4000n, generations: 2n })); // C inherits 20%
    propose(sim, C, B, { share: 3001n });
    expect(() => confirm(sim, B, C)).toThrow(/more than half/);
    // A "sock" parent cannot squeeze the real one either: whoever confirms second is refused.
    const sim2 = new RoyaltiesSimulator();
    finalise(sim2, S);
    finalise(sim2, B);
    link(sim2, C, S, { share: 5000n });
    propose(sim2, C, B, { share: 1000n });
    expect(() => confirm(sim2, B, C)).toThrow(/more than half/);
  });

  it("the order is enforced: parent final before confirming, no links after the child is final", () => {
    const sim = new RoyaltiesSimulator();
    propose(sim, C, B);
    expect(() => confirm(sim, B, C)).toThrow(/Finalise your own/);
    expect(() => post(sim, C)).toThrow(/finalise its ancestors/);
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
    propose(sim, C, B);
    expect(() => finalise(sim, C)).toThrow(/waiting/);
    sim.call({ record: C }, "withdrawLink", rec(B));
    finalise(sim, C);
  });

  it("only a confirmed link of your own record can go in your chart; at most two parents", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, E);
    finalise(sim, A);
    const lDB = link(sim, D, B);
    expect(() => finalise(sim, C, lDB)).toThrow(
      /not a confirmed link|Name every confirmed link/,
    );
    propose(sim, C, B);
    confirm(sim, B, C);
    link(sim, C, E, { share: 100n });
    propose(sim, C, A, { share: 100n });
    expect(() => confirm(sim, A, C)).toThrow(/two confirmed parents/);
    sim.call({ record: C }, "withdrawLink", rec(A));
    expect(sim.state.links.member(R.linkId(rec(C), rec(A)))).toBe(false);
    expect(() => sim.call({ record: C }, "withdrawLink", rec(B))).toThrow(
      /No unconfirmed link/,
    );
  });

  it("shares in two units are refused when the second link is confirmed, not discovered later", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(
      sim,
      B,
      link(sim, B, A, { unit: EUR, share: 100n, generations: 2n }),
    );
    propose(sim, C, B, { unit: USD, share: 1000n });
    expect(() => confirm(sim, B, C)).toThrow(/two units/);
    // Two parents asking for shares in different units: the second confirmation is refused.
    const sim2 = new RoyaltiesSimulator();
    finalise(sim2, B);
    finalise(sim2, E);
    link(sim2, C, B, { unit: EUR, share: 100n });
    propose(sim2, C, E, { unit: USD, share: 100n });
    expect(() => confirm(sim2, E, C)).toThrow(/two units/);
    // A fee-only link in another unit is fine.
    propose(sim2, D, E, { unit: USD, share: 0n, fee: 5n });
    expect(() => confirm(sim2, E, D)).not.toThrow();
  });

  it("an ended ancestor link no longer counts toward the cap or the unit when a child confirms", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, A);
    finalise(
      sim,
      B,
      link(sim, B, A, {
        unit: EUR,
        share: 5000n,
        generations: 2n,
        until: T0 + 10n * DAY,
      }),
    );
    sim.advance(11n * DAY);
    // A's link has ended: C may take its shares in USD, and the full 50% is free again.
    propose(sim, C, B, { unit: USD, share: 5000n });
    expect(() => confirm(sim, B, C)).not.toThrow();
  });

  it("an offer whose ancestors take a royalty share must take royalties, and name a unit", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, { share: 1000n }));
    const raw = (unit: Uint8Array, rate: Uint8Array) =>
      sim.call(
        { record: C },
        "postOffer",
        b(99),
        R.adminCommit(ADMIN),
        b(20),
        unit,
        1000n,
        rate,
        5n,
        T0 + YEAR,
        true,
        R.adminCommit(ISSUER),
        sim.freeIssuerSlot(),
      );
    expect(() => raw(USD, ZERO)).toThrow(/must take royalties/);
    expect(() => raw(ZERO, ZERO)).toThrow(/name the unit/);
  });

  it("once every ancestor's share has ended, new offers keep the private issuance", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, { share: 1000n, until: T0 + 10n * DAY }));
    const first = post(sim, C);
    expect(sim.state.offers.lookup(first).split).toBe(true);
    sim.advance(11n * DAY);
    const later = post(sim, C);
    expect(sim.state.offers.lookup(later).split).toBe(false);
  });

  it("a parent confirms only the exact terms it names; a record that proposed and withdrew can still post", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    propose(sim, C, B, { share: 1000n });
    expect(() =>
      sim.call(
        { record: B },
        "confirmLink",
        rec(C),
        R.linkTermsHash(USD, 0n, 2000n, 2n, T0 + YEAR, R.payeeCommit(PAYEE)),
      ),
    ).toThrow(/not the ones you are confirming/);
    sim.call({ record: C }, "withdrawLink", rec(B));
    const posted = post(sim, C);
    expect(sim.state.offers.member(posted)).toBe(true);
  });

  it("only the payee key lowers a link, never raises it; the child never can", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    const l = link(sim, C, B, { share: 1000n, fee: 50n });
    finalise(sim, C, l);
    const offer = post(sim, C);
    expect(() =>
      sim.call({ admin: C }, "relaxLink", l, 500n, 50n, T0 + YEAR, sim.now),
    ).toThrow(/payee key/);
    expect(() =>
      sim.call(
        { admin: PAYEE },
        "relaxLink",
        l,
        2000n,
        50n,
        T0 + YEAR,
        sim.now,
      ),
    ).toThrow(/only be lowered/);
    sim.call({ admin: PAYEE }, "relaxLink", l, 500n, 50n, T0 + YEAR, sim.now);
    expect(due(owedBy(sim, issue(sim, offer)), 0)).toBe(50n);
  });

  it("a record that replaced another adopts its chart unchanged, with no parent asked again", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, { share: 1000n }));
    const C2 = b(30);
    sim.call({ record: C2 }, "adoptStack", rec(C));
    expect(sim.state.stacks.lookup(rec(C2)).map(hex)).toEqual(
      sim.state.stacks.lookup(rec(C)).map(hex),
    );
    expect(due(owedBy(sim, issue(sim, post(sim, C2))), 0)).toBe(100n);
  });
});

describe("royalty credit with ancestors' shares", () => {
  const setup = () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, B);
    finalise(sim, C, link(sim, C, B, { share: 1000n }));
    const offer = post(sim, C);
    const o = sim.state.offers.lookup(offer);
    const opening: OfferOpening = {
      offer,
      unit: o.unit,
      rateCommit: o.rateCommit,
      expires: o.expires,
      split: o.split,
    };
    return { sim, offer, opening };
  };
  const code = (licence: Uint8Array, offer: Uint8Array, n: Uint8Array) =>
    R.topUpCode(R.spendKey(licence, offer), n);

  it("must go through issueCreditSplit, which records each share; the private issuance refuses", () => {
    const { sim, offer, opening } = setup();
    const L = b(60);
    sim.call(
      { admin: ADMIN },
      "issueLicense",
      offer,
      R.licenseCommit(R.viewKey(L, offer), R.spendKey(L, offer), offer),
      sim.freeSlot(),
    );
    expect(() =>
      sim.call(
        { issuer: ISSUER, opening, code: code(L, offer, b(61)), amount: 500n },
        "issueCredit",
      ),
    ).toThrow(/issueCreditSplit/);
    const moved = sim.call(
      { issuer: ISSUER, code: code(L, offer, b(61)) },
      "issueCreditSplit",
      offer,
      500n,
    ).moved;
    expect(moved.inputs.size + moved.outputs.size + moved.spends.length).toBe(
      0,
    );
    const note = R.noteCommit(
      code(L, offer, b(61)),
      offerLeafOf(opening),
      500n,
    );
    expect(sim.state.noteSeen.member(note)).toBe(true);
    expect(due(owedBy(sim, note), 0)).toBe(50n);
    // The credit is a normal private note, and settles as one.
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

  it("an offer without shares keeps the private issuance, and issueCreditSplit refuses it", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim, A);
    expect(() =>
      sim.call(
        { issuer: ISSUER, code: b(62) },
        "issueCreditSplit",
        offer,
        500n,
      ),
    ).toThrow(/use issueCredit/);
  });

  it("a split offer's rate commitment was opened at posting: no credit is issued that cannot settle", () => {
    const { sim, offer } = setup();
    expect(() =>
      sim.call(
        { record: C, rate: { rate: 0n, salt: SALT } },
        "postOffer",
        b(90),
        R.adminCommit(b(91)),
        b(92),
        USD,
        1000n,
        R.rateCommit(0n, SALT),
        5n,
        T0 + YEAR,
        false,
        R.adminCommit(ISSUER),
        sim.freeIssuerSlot(),
      ),
    ).toThrow(/does not open to a rate above zero/);
    sim.call({ issuer: ISSUER, code: b(63) }, "issueCreditSplit", offer, 500n);
    expect(sim.state.issueSeq).toBe(1n);
  });
});
