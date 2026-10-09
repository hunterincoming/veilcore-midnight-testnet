// Protocol 4: "We never touch the money. We prove the books." The breeder issues licences
// and royalty credit for payments made off chain; nothing moves through the contract.
// Licensees settle against issued credit exactly as against paid credit. On a variety
// with ancestors, every issued licence and credit records what it owes them. And each
// attack on issuing: without the key, on the wrong offer, twice, forged by a licensee,
// skipping the ancestors, with a replaced key.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type {
  NoteOpening,
  OfferOpening,
} from "../managed/veilcore-royalties/contract/index.js";
import { pureCircuits as V } from "../managed/veilcore/contract/index.js";
import {
  type Caller,
  type Movements,
  R,
  RoyaltiesSimulator,
  T0,
  changeNonceOf,
  hex,
  licenceKeyOf,
  noteOf,
  offerLeafOf,
  stubPath,
} from "./royalties-simulator.js";

const b = (n: number): Uint8Array<ArrayBuffer> => {
  const o = new Uint8Array(32);
  o[0] = 0x7d;
  o[31] = n;
  return o;
};
const STABLE = b(200);
const ZERO = new Uint8Array(32);
const HOUR = 3600n;
const DAY = 24n * HOUR;
const YEAR = 365n * DAY;
const EXPIRES = T0 + YEAR;
const RATE = 4n;
const SALT = b(90);
const TERMS = b(20);

// Records (secrets) and keys.
const BREEDER = b(1);
const OTHER = b(2);
const ADMIN = b(5);
const ISSUER = b(6);
const ISSUER2 = b(7);
const ADMIN_B = b(8);
const ISSUER_B = b(9);
const LIC = b(10);
const LIC2 = b(11);
const P1 = b(30);
const P2 = b(31);
const WALLET = { bytes: b(40) };
const WALLET_B = { bytes: b(41) };
const PAYEE = b(70);

const rec = (secret: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(V.commit(secret));

type PostOpts = {
  record?: Uint8Array;
  admin?: Uint8Array;
  issuer?: Uint8Array;
  onChain?: boolean;
  rate?: bigint;
  price?: bigint;
  count?: bigint;
  expires?: bigint;
  color?: Uint8Array;
  payTo?: { bytes: Uint8Array };
  slot?: bigint;
};

let nonce = 0;
const post = (sim: RoyaltiesSimulator, o: PostOpts = {}): Uint8Array =>
  sim.call(
    {
      record: o.record ?? BREEDER,
      rate: { rate: o.rate ?? RATE, salt: SALT },
    },
    "postOffer",
    b(150 + (++nonce % 50)),
    R.adminCommit(o.admin ?? ADMIN),
    TERMS,
    o.color ?? STABLE,
    o.price ?? 1000n,
    o.rate === 0n ? ZERO : R.rateCommit(o.rate ?? RATE, SALT),
    o.payTo ?? WALLET,
    o.count ?? 3n,
    o.expires ?? EXPIRES,
    true,
    R.adminCommit(o.issuer ?? ISSUER),
    o.slot ?? sim.freeIssuerSlot(),
    o.onChain ?? false,
  ).result as Uint8Array;

const openingOf = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
): OfferOpening => {
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

const codeOf = (license: Uint8Array, offer: Uint8Array, n: Uint8Array) =>
  R.topUpCode(R.spendKey(license, offer), n);

/** The breeder issues a licence from the licensee's licence key (from the licence card). */
const issueLicence = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  license = LIC,
  who: Caller = { admin: ADMIN },
) =>
  sim.call(
    who,
    "issueLicense",
    offer,
    licenceKeyOf(license, offer, sim.state.offers.lookup(offer).expires),
    sim.freeSlot(),
  );

/** The offer's credit issuer issues `amount` to the licensee's code (private path). */
const issue = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  amount: bigint,
  n: Uint8Array,
  extra: Caller = {},
  license = LIC,
) =>
  sim.call(
    {
      issuer: ISSUER,
      opening: openingOf(sim, offer),
      code: codeOf(license, offer, n),
      amount,
      ...extra,
    },
    "issueCredit",
  );

const settle = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  note: NoteOpening,
  period: Uint8Array,
  units: bigint,
  license = LIC,
) =>
  sim.call(
    {
      license,
      opening: openingOf(sim, offer),
      note,
      rate: { rate: RATE, salt: SALT },
      period,
      units,
    },
    "settle",
  );

const noMoney = (m: Movements) => {
  expect(m.inputs.size).toBe(0);
  expect(m.outputs.size).toBe(0);
  expect(m.spends.length).toBe(0);
};

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
const text = (p: unknown): string =>
  JSON.stringify(p, (_k: string, v: unknown): unknown =>
    typeof v === "bigint"
      ? v.toString()
      : v instanceof Uint8Array
        ? Buffer.from(v).toString("hex")
        : v,
  );

/** The issuer tree path of `issuer` on `offer`, as it stands now. */
const pathOf = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  issuer: Uint8Array,
) => {
  const p = sim.state.issuerLeaves.findPathForLeaf(
    R.issuerLeaf(offerLeafOf(openingOf(sim, offer)), R.adminCommit(issuer)),
  );
  if (p === undefined) throw new Error("no such issuer leaf");
  return p;
};

/** A first seal (the daily one), so later seals are judged by the hourly rule alone. */
const firstSeal = (sim: RoyaltiesSimulator) => {
  sim.call({}, "sealRevocations", sim.now + 100n);
  sim.advance(2n * HOUR);
};

describe("the breeder issues; no money passes through the contract", () => {
  it("licence and credit issued, settled privately, read by the breeder, presented: nothing moves", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    const o = sim.state.offers.lookup(offer);
    expect(o.onChainPayment).toBe(false);
    expect(hex(o.issuer)).toBe(hex(R.adminCommit(ISSUER)));

    noMoney(issueLicence(sim, offer).moved);
    expect(
      sim.state.licenseOffer.member(licenceKeyOf(LIC, offer, EXPIRES)),
    ).toBe(true);
    expect(sim.state.soldOf.lookup(offer).read()).toBe(1n);

    // The licensee was paid for off chain; the breeder acknowledges 200 of credit.
    noMoney(issue(sim, offer, 200n, b(51)).moved);
    expect(sim.state.issueSeq).toBe(1n);
    expect(sim.state.topUpSeq).toBe(0n);
    const op = openingOf(sim, offer);
    expect(sim.state.noteSeen.member(noteOf(LIC, b(51), op, 200n))).toBe(true);

    // Settled exactly as paid credit is: no money, change kept.
    noMoney(settle(sim, offer, { nonce: b(51), amount: 200n }, P1, 30n).moved);
    const change = { nonce: changeNonceOf(LIC, b(51), op, 200n), amount: 80n };
    expect(sim.state.noteSeen.member(noteOf(LIC, change.nonce, op, 80n))).toBe(
      true,
    );

    // The breeder reads the units with the viewing key.
    const view = R.viewKey(LIC, offer);
    const [changeNote, st] = [...sim.state.settlements][0];
    const FIELD =
      0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
    expect(
      (st.unitsMasked - R.unitsMask(view, changeNote) + FIELD) % FIELD,
    ).toBe(30n);

    // A buyer checks "live licence, P1 settled for at least 25 units".
    sim.call(
      {
        license: LIC,
        offer,
        expires: EXPIRES,
        challenge: b(60),
        period: P1,
        units: 30n,
      },
      "proveLicense",
      P1,
      25n,
      sim.now + HOUR,
      b(80),
      true,
    );
    expect(sim.state.presentationSeq).toBe(1n);
  });

  it("an issuance names neither the offer, the licensee, the code, the issuer nor the amount", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    issueLicence(sim, offer);
    const AMOUNT = 0x1234567890abcn;
    const op = openingOf(sim, offer);
    const code = codeOf(LIC, offer, b(51));
    const p = sim.prove(
      { issuer: ISSUER, opening: op, code, amount: AMOUNT },
      "issueCredit",
    );
    for (const secret of [
      offer,
      code,
      R.adminCommit(ISSUER),
      offerLeafOf(op),
      WALLET.bytes,
      STABLE,
      op.rateCommit,
      licenceKeyOf(LIC, offer, EXPIRES),
    ])
      expect(appears(p, secret)).toBe(false);
    // The note itself is public (it is what the licensee looks for), so the check can see it.
    expect(appears(p, noteOf(LIC, b(51), op, AMOUNT))).toBe(true);
    const t = text(p);
    expect(t).not.toContain(AMOUNT.toString());
    expect(t).not.toContain(AMOUNT.toString(16));
  });

  it("an offer that takes no payment here refuses purchases and top-ups; one that opted in takes both, and issuing too", () => {
    const sim = new RoyaltiesSimulator();
    const off = post(sim);
    expect(() =>
      sim.call({ license: LIC }, "buyLicense", off, sim.freeSlot()),
    ).toThrow(/takes no payment through the contract/);
    const op = openingOf(sim, off);
    expect(() =>
      sim.call(
        { opening: op, code: codeOf(LIC, off, b(51)) },
        "topUp",
        WALLET,
        STABLE,
        100n,
        sim.now + DAY,
      ),
    ).toThrow(/takes no payment through the contract/);

    const on = post(sim, { onChain: true, record: OTHER });
    const bought = sim.call(
      { license: LIC2 },
      "buyLicense",
      on,
      sim.freeSlot(),
    ).moved;
    expect(bought.inputs.get(hex(STABLE))).toBe(1000n);
    issueLicence(sim, on, LIC);
    const opOn = openingOf(sim, on);
    sim.call(
      { opening: opOn, code: codeOf(LIC2, on, b(52)) },
      "topUp",
      WALLET,
      STABLE,
      100n,
      sim.now + DAY,
    );
    issue(sim, on, 50n, b(53), {}, LIC);
    expect(sim.state.topUpSeq).toBe(1n);
    expect(sim.state.issueSeq).toBe(1n);
  });
});

describe("attacks on issuing", () => {
  it("credit cannot be issued without the offer's issuer key: not by the admin key, a licensee, or a made-up path", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    issueLicence(sim, offer);
    expect(() => issue(sim, offer, 100n, b(51), { issuer: ADMIN })).toThrow(
      /Only the offer's credit issuer/,
    );
    expect(() => issue(sim, offer, 100n, b(51), { issuer: LIC })).toThrow(
      /Only the offer's credit issuer/,
    );
    // A path built for the right leaf but not in the tree fails the root check.
    const leaf = R.issuerLeaf(
      offerLeafOf(openingOf(sim, offer)),
      R.adminCommit(LIC),
    );
    expect(() =>
      issue(sim, offer, 100n, b(51), {
        issuer: LIC,
        issuerPath: stubPath(leaf, 32),
      }),
    ).toThrow(/or the path is stale/);
    expect(sim.state.issueSeq).toBe(0n);
  });

  it("a licensee who issues credit on an offer of its own cannot spend it on the breeder's offer", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    issueLicence(sim, offer);
    // The licensee posts its own offer, with itself as issuer, and claims the breeder's opening.
    const mine = post(sim, { record: OTHER, admin: ADMIN_B, issuer: ISSUER_B });
    expect(() =>
      sim.call(
        {
          issuer: ISSUER_B,
          opening: openingOf(sim, offer),
          code: codeOf(LIC, offer, b(51)),
          amount: 1000n,
        },
        "issueCredit",
      ),
    ).toThrow(/Only the offer's credit issuer/);
    // Credit on its own offer is bound to that offer's leaf: it settles nothing on the breeder's.
    sim.call(
      {
        issuer: ISSUER_B,
        opening: openingOf(sim, mine),
        code: codeOf(LIC, offer, b(51)),
        amount: 1000n,
      },
      "issueCredit",
    );
    expect(() =>
      settle(sim, offer, { nonce: b(51), amount: 1000n }, P1, 10n),
    ).toThrow(/not on chain|not yours/);
  });

  it("issuing to the wrong offer: one breeder's issuer cannot make credit for another breeder's offer", () => {
    const sim = new RoyaltiesSimulator();
    const a = post(sim);
    const bOffer = post(sim, {
      record: OTHER,
      admin: ADMIN_B,
      issuer: ISSUER_B,
      payTo: WALLET_B,
    });
    issueLicence(sim, a);
    expect(() => issue(sim, a, 100n, b(51), { issuer: ISSUER_B })).toThrow(
      /Only the offer's credit issuer/,
    );
    // Its own issuer is fine on its own offer, and that note does not settle offer a.
    issue(sim, bOffer, 100n, b(51), { issuer: ISSUER_B });
    expect(() =>
      settle(sim, a, { nonce: b(51), amount: 100n }, P1, 1n),
    ).toThrow(/not on chain|not yours/);
  });

  it("double issuance: the same code, offer and amount twice is refused, and a proof lands once", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    issueLicence(sim, offer);
    const p = sim.prove(
      {
        issuer: ISSUER,
        opening: openingOf(sim, offer),
        code: codeOf(LIC, offer, b(51)),
        amount: 100n,
      },
      "issueCredit",
    );
    sim.land(p);
    expect(() => sim.land(p)).toThrow();
    expect(() => issue(sim, offer, 100n, b(51))).toThrow(/already exists/);
    expect(sim.state.issueSeq).toBe(1n);
    // Another amount to the same code is another note (the licensee holds both).
    issue(sim, offer, 101n, b(51));
    expect(sim.state.issueSeq).toBe(2n);
  });

  it("refuses zero credit and credit on an offer that takes no royalties", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    expect(() => issue(sim, offer, 0n, b(51))).toThrow(/more than zero/);
    const free = post(sim, { rate: 0n, record: OTHER });
    expect(() => issue(sim, free, 10n, b(51))).toThrow(/takes no royalties/);
  });

  it("only the admin issues a licence; not the issuer key; not on a closed, ended or sold-out offer; never twice", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim, { count: 2n });
    expect(() => issueLicence(sim, offer, LIC, { admin: ISSUER })).toThrow(
      /Only the offer's admin/,
    );
    expect(() => issueLicence(sim, offer, LIC, { admin: ADMIN_B })).toThrow(
      /Only the offer's admin/,
    );
    expect(() =>
      sim.call({ admin: ADMIN }, "issueLicense", offer, ZERO, sim.freeSlot()),
    ).toThrow(/cannot be empty/);
    issueLicence(sim, offer);
    expect(() => issueLicence(sim, offer)).toThrow(/already bought or issued/);
    issueLicence(sim, offer, LIC2);
    expect(() => issueLicence(sim, offer, b(12))).toThrow(/sold out/);
    const closed = post(sim, { record: OTHER });
    sim.call({ admin: ADMIN }, "closeOffer", closed);
    expect(() => issueLicence(sim, closed)).toThrow(/closed/);
    const ending = post(sim, { record: OTHER, expires: T0 + DAY });
    sim.advance(2n * DAY);
    expect(() => issueLicence(sim, ending)).toThrow(/ended/);
  });

  it("posting refuses an empty issuer, a taken place and a place outside the issuer tree", () => {
    const sim = new RoyaltiesSimulator();
    post(sim, { slot: 7n });
    expect(() => post(sim, { slot: 7n, record: OTHER })).toThrow(
      /place is taken/,
    );
    expect(() => post(sim, { slot: 1n << 32n, record: OTHER })).toThrow(
      /outside the issuer tree/,
    );
    expect(() =>
      sim.call(
        { record: OTHER, rate: { rate: RATE, salt: SALT } },
        "postOffer",
        b(99),
        R.adminCommit(ADMIN),
        TERMS,
        STABLE,
        1000n,
        R.rateCommit(RATE, SALT),
        WALLET,
        3n,
        EXPIRES,
        true,
        ZERO,
        sim.freeIssuerSlot(),
        false,
      ),
    ).toThrow(/issuer commitment cannot be empty/);
  });
});

describe("replacing a credit issuer", () => {
  it("only the admin replaces it; the old key works until the next due seal, then never again", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    issueLicence(sim, offer);
    firstSeal(sim);
    expect(() =>
      sim.call(
        { admin: ISSUER },
        "changeCreditIssuer",
        offer,
        R.adminCommit(ISSUER2),
      ),
    ).toThrow(/Only the offer's admin/);
    expect(() =>
      sim.call(
        { admin: ADMIN },
        "changeCreditIssuer",
        offer,
        R.adminCommit(ISSUER),
      ),
    ).toThrow(/already the offer's credit issuer/);
    // Whoever holds the old key can keep its path from before the change.
    const oldPath = pathOf(sim, offer, ISSUER);
    sim.call(
      { admin: ADMIN },
      "changeCreditIssuer",
      offer,
      R.adminCommit(ISSUER2),
    );
    expect(sim.state.issuerChanges).toBe(true);
    // The new key works at once; the old one still proves against a root that held it.
    issue(sim, offer, 10n, b(51), { issuer: ISSUER2 });
    issue(sim, offer, 11n, b(52), { issuerPath: oldPath });
    // The seal is due (no seal of a change yet), and retires the old roots.
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.issuerChanges).toBe(false);
    expect(() =>
      issue(sim, offer, 12n, b(53), { issuerPath: oldPath }),
    ).toThrow(/path is stale/);
    expect(() => issue(sim, offer, 12n, b(53))).toThrow(/credit issuer/);
    issue(sim, offer, 13n, b(54), { issuer: ISSUER2 });
  });

  it("a second replacement within the hour waits for its seal, as a revocation does", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    firstSeal(sim);
    sim.call(
      { admin: ADMIN },
      "changeCreditIssuer",
      offer,
      R.adminCommit(ISSUER2),
    );
    sim.call({}, "sealRevocations", sim.now + 100n);
    sim.advance(20n * 60n);
    const oldPath = pathOf(sim, offer, ISSUER2);
    sim.call(
      { admin: ADMIN },
      "changeCreditIssuer",
      offer,
      R.adminCommit(b(13)),
    );
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.issuerChanges).toBe(true);
    // Still within the hour: the replaced key still proves against its old root.
    issue(sim, offer, 10n, b(51), { issuer: ISSUER2, issuerPath: oldPath });
    sim.advance(HOUR);
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(sim.state.issuerChanges).toBe(false);
    expect(() =>
      issue(sim, offer, 11n, b(52), { issuer: ISSUER2, issuerPath: oldPath }),
    ).toThrow(/path is stale/);
    issue(sim, offer, 12n, b(53), { issuer: b(13) });
  });

  it("an issuance in flight survives a revocation seal, and is voided (stale) only by an issuer-change seal", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    const other = post(sim, {
      record: OTHER,
      admin: ADMIN_B,
      issuer: ISSUER_B,
    });
    issueLicence(sim, offer);
    issueLicence(sim, other, LIC2, { admin: ADMIN_B });
    firstSeal(sim);
    const flight = (n: number) =>
      sim.prove(
        {
          issuer: ISSUER,
          opening: openingOf(sim, offer),
          code: codeOf(LIC, offer, b(n)),
          amount: 10n,
        },
        "issueCredit",
      );
    // A revocation (on another offer) and its seal retire licence roots, not issuer roots.
    const p1 = flight(51);
    sim.call(
      { admin: ADMIN_B },
      "revokeLicense",
      licenceKeyOf(LIC2, other, EXPIRES),
    );
    sim.call({}, "sealRevocations", sim.now + 100n);
    sim.land(p1);
    // Someone replacing their own issuer, and the seal of it an hour later, does void it.
    sim.advance(HOUR + 60n);
    const p2 = flight(52);
    sim.call(
      { admin: ADMIN_B },
      "changeCreditIssuer",
      other,
      R.adminCommit(b(14)),
    );
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(() => sim.land(p2)).toThrow();
    // Proved again against the current tree, it lands.
    sim.land(flight(52));
    expect(sim.state.issueSeq).toBe(2n);
  });
});

// ─────────────────────────────────────────────────────────────── ancestors

const propose = (
  sim: RoyaltiesSimulator,
  child: Uint8Array,
  parent: Uint8Array,
  t: {
    share?: bigint;
    fee?: bigint;
    generations?: bigint;
    payTo: { bytes: Uint8Array };
  },
) =>
  sim.call(
    { record: child },
    "proposeLink",
    rec(parent),
    STABLE,
    t.fee ?? 0n,
    t.share ?? 1000n,
    t.generations ?? 2n,
    T0 + YEAR,
    t.payTo,
    R.payeeCommit(PAYEE),
  ).result as Uint8Array;

const link = (
  sim: RoyaltiesSimulator,
  child: Uint8Array,
  parent: Uint8Array,
  t: {
    share?: bigint;
    fee?: bigint;
    generations?: bigint;
    payTo: { bytes: Uint8Array };
  },
): Uint8Array => {
  const id = propose(sim, child, parent, t);
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
  return id;
};

const finalise = (
  sim: RoyaltiesSimulator,
  child: Uint8Array,
  l1: Uint8Array = ZERO,
) => sim.call({ record: child }, "finaliseStack", Uint8Array.from(l1), ZERO);

const GP = b(21);
const PARENT = b(22);
const CHILD = b(23);
const W_GP = { bytes: b(121) };
const W_P = { bytes: b(122) };
const W_C = { bytes: b(123) };

/** Grandparent -> parent (20% for 2 generations, fee 30) -> child (10%, fee 50). */
const family = (onChain = false) => {
  const sim = new RoyaltiesSimulator();
  finalise(sim, GP);
  finalise(
    sim,
    PARENT,
    link(sim, PARENT, GP, { share: 2000n, generations: 2n, payTo: W_GP }),
  );
  const toParent = link(sim, CHILD, PARENT, {
    share: 1000n,
    fee: 50n,
    payTo: W_P,
  });
  finalise(sim, CHILD, toParent);
  const offer = post(sim, { record: CHILD, payTo: W_C, onChain });
  return { sim, offer, toParent };
};

/** Every `owed` entry's amount to chart place `i` of each record. */
const owedAt = (sim: RoyaltiesSimulator, i: number): bigint =>
  [...sim.state.owed].reduce((a, [, e]) => a + e.shares[i], 0n);

describe("ancestors of a variety paid off chain: what is owed is recorded, and cannot be skipped", () => {
  it("an issued licence records each share of the list price and each parent's fee", () => {
    const { sim, offer } = family();
    expect(sim.state.offers.lookup(offer).split).toBe(true);
    noMoney(issueLicence(sim, offer).moved);
    const k = licenceKeyOf(LIC, offer, EXPIRES);
    const e = sim.state.owed.lookup(k);
    expect(hex(e.record)).toBe(hex(rec(CHILD)));
    expect(hex(e.offer)).toBe(hex(offer));
    expect(e.shares[0]).toBe(100n); // the parent: 10% of 1000
    expect(e.shares[2]).toBe(100n); // the grandparent: half of 20%
    expect(e.fees).toEqual([50n, 0n]);
    expect(sim.state.owedSeq).toBe(1n);
  });

  it("credit on such a variety goes through issueCreditSplit, names the offer, and records each share", () => {
    const { sim, offer } = family();
    issueLicence(sim, offer);
    // The private path is refused: it could not show the ancestors' shares.
    expect(() => issue(sim, offer, 500n, b(51))).toThrow(/issueCreditSplit/);
    const code = codeOf(LIC, offer, b(51));
    noMoney(
      sim.call({ issuer: ISSUER, code }, "issueCreditSplit", offer, 500n).moved,
    );
    const op = openingOf(sim, offer);
    const note = noteOf(LIC, b(51), op, 500n);
    const e = sim.state.owed.lookup(note);
    expect(e.shares[0]).toBe(50n);
    expect(e.shares[2]).toBe(50n);
    expect(e.fees).toEqual([0n, 0n]);
    // The credit settles as any other.
    settle(sim, offer, { nonce: b(51), amount: 500n }, P1, 10n);
    expect(owedAt(sim, 0)).toBe(100n + 50n);
    expect(owedAt(sim, 2)).toBe(100n + 50n);
  });

  it("ancestors' shares cannot be skipped: wrong or missing amounts, a tiny amount, or a stranger's key are refused", () => {
    const { sim, offer } = family();
    const none = Array.from({ length: 14 }, () => 0n);
    expect(() =>
      sim.call(
        { admin: ADMIN, split: none },
        "issueLicense",
        offer,
        licenceKeyOf(LIC, offer, EXPIRES),
        sim.freeSlot(),
      ),
    ).toThrow(/ancestor's share/);
    issueLicence(sim, offer);
    const code = codeOf(LIC, offer, b(51));
    expect(() =>
      sim.call(
        { issuer: ISSUER, code, split: none },
        "issueCreditSplit",
        offer,
        500n,
      ),
    ).toThrow(/ancestor's share/);
    const short = Array.from({ length: 14 }, (_, i) => (i === 0 ? 50n : 0n));
    expect(() =>
      sim.call(
        { issuer: ISSUER, code, split: short },
        "issueCreditSplit",
        offer,
        500n,
      ),
    ).toThrow(/ancestor's share/);
    // 10% of 9 is under one unit: refused, never recorded as nothing.
    expect(() =>
      sim.call({ issuer: ISSUER, code }, "issueCreditSplit", offer, 9n),
    ).toThrow(/Too small/);
    expect(() =>
      sim.call({ issuer: ISSUER_B, code }, "issueCreditSplit", offer, 500n),
    ).toThrow(/Only the offer's credit issuer/);
    // The named path is only for such offers.
    const plain = post(sim, { record: OTHER });
    expect(() =>
      sim.call({ issuer: ISSUER, code }, "issueCreditSplit", plain, 500n),
    ).toThrow(/use issueCredit/);
    expect(sim.state.owedSeq).toBe(1n);
  });

  it("a variety with ancestors that takes payment on chain pays them in the call; issuing on it still records", () => {
    const { sim, offer } = family(true);
    const moved = sim.call(
      { license: LIC2 },
      "buyLicense",
      offer,
      sim.freeSlot(),
    ).moved;
    const paid = (w: { bytes: Uint8Array }) =>
      moved.spends
        .filter(([t, to]) => t === hex(STABLE) && to.includes(hex(w.bytes)))
        .reduce((a, [, , v]) => a + v, 0n);
    expect(paid(W_P)).toBe(100n + 50n);
    expect(paid(W_GP)).toBe(100n);
    expect(sim.state.owedSeq).toBe(0n);
    issueLicence(sim, offer);
    expect(sim.state.owedSeq).toBe(1n);
  });

  it("the record follows a replaced issuer: the named path takes the new key at once", () => {
    const { sim, offer } = family();
    issueLicence(sim, offer);
    sim.call(
      { admin: ADMIN },
      "changeCreditIssuer",
      offer,
      R.adminCommit(ISSUER2),
    );
    const code = codeOf(LIC, offer, b(51));
    expect(() =>
      sim.call({ issuer: ISSUER, code }, "issueCreditSplit", offer, 500n),
    ).toThrow(/Only the offer's credit issuer/);
    sim.call({ issuer: ISSUER2, code }, "issueCreditSplit", offer, 500n);
    expect(owedAt(sim, 0)).toBe(100n + 50n);
  });

  it("once the ancestors' links end, issuing records nothing, and owes nothing", () => {
    const sim = new RoyaltiesSimulator();
    finalise(sim, PARENT);
    const id = propose(sim, CHILD, PARENT, {
      share: 1000n,
      fee: 50n,
      payTo: W_P,
    });
    // A short link: proposeLink took T0 + YEAR; lower it to 10 days with the payee key.
    sim.call(
      { admin: PAYEE },
      "relaxLink",
      id,
      1000n,
      50n,
      T0 + 10n * DAY,
      sim.now,
    );
    const l = sim.state.links.lookup(id);
    sim.call(
      { record: PARENT },
      "confirmLink",
      rec(CHILD),
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
    finalise(sim, CHILD, id);
    const offer = post(sim, { record: CHILD, payTo: W_C });
    sim.advance(11n * DAY);
    issueLicence(sim, offer);
    sim.call(
      { issuer: ISSUER, code: codeOf(LIC, offer, b(51)) },
      "issueCreditSplit",
      offer,
      500n,
    );
    expect(sim.state.owedSeq).toBe(0n);
  });
});

describe("the settle path is unchanged for issued credit", () => {
  it("merging two issued notes and settling the period twice works as with paid credit", () => {
    const sim = new RoyaltiesSimulator();
    const offer = post(sim);
    issueLicence(sim, offer);
    issue(sim, offer, 30n, b(51));
    issue(sim, offer, 30n, b(52));
    const op = openingOf(sim, offer);
    sim.call(
      {
        license: LIC,
        opening: op,
        note: { nonce: b(51), amount: 30n },
        note2: { nonce: b(52), amount: 30n },
      },
      "mergeNotes",
    );
    const merged = { nonce: changeNonceOf(LIC, b(51), op, 30n), amount: 60n };
    settle(sim, offer, merged, P1, 10n);
    settle(
      sim,
      offer,
      { nonce: changeNonceOf(LIC, merged.nonce, op, 60n), amount: 20n },
      P2,
      5n,
    );
    expect(sim.state.settleSeq).toBe(2n);
    // More units than the issued credit covers is refused.
    issue(sim, offer, 3n, b(53));
    expect(() =>
      settle(sim, offer, { nonce: b(53), amount: 3n }, P1, 1n),
    ).toThrow(/does not cover/);
  });
});
