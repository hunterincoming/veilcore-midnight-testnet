// The royalties contract, version 2: offers, sales, private credit and settlement,
// presentations, revocation; and every attack from the reviews kept as a regression.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pureCircuits as V } from "../managed/veilcore/contract/index.js";
import type {
  NoteOpening,
  OfferOpening,
} from "../managed/veilcore-royalties/contract/index.js";
import {
  type Caller,
  R,
  RoyaltiesSimulator,
  ISSUER,
  T0,
  changeNonceOf,
  hex,
  licenceKeyOf,
  noteOf,
} from "./royalties-simulator.js";
import { unitOf } from "../royalties.js";

const b = (n: number): Uint8Array => {
  const out = new Uint8Array(32);
  out[0] = 0x5a;
  out[31] = n;
  return out;
};
const NIGHT = new Uint8Array(32);
const UNIT = unitOf("USD cents");
const BREEDER = b(1);
const OTHER = b(3);
const ADMIN = b(5);
const ADMIN2 = b(6);
const LIC = b(10);
const LIC2 = b(11);
const TERMS = b(20);
const P1 = b(30);
const P2 = b(31);
const NONCE = b(50);
const CH = b(60);
const SCOPE = b(80);
const RATE = 4n;
const SALT = b(90);
const HOUR = 3600n;
const DAY = 24n * HOUR;
const YEAR = 365n * DAY;
const EXPIRES = T0 + YEAR;
const GRACE = 30n * DAY;
/** The BLS12-381 scalar field the masked units live in. */
const FIELD =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

type OfferOpts = {
  record?: Uint8Array;
  nonce?: Uint8Array;
  admin?: Uint8Array;
  count?: bigint;
  price?: bigint;
  rate?: bigint | null;
  unit?: Uint8Array;
  revocable?: boolean;
  expires?: bigint;
  /** The credit issuer secret. */
  issuer?: Uint8Array;
};

/** The masked units of the settlement that made the latest note. */
const masked = (sim: RoyaltiesSimulator): bigint =>
  sim.state.settlements.lookup(sim.state.lastNote).unitsMasked;

/** Whether a revocation on `offer` is still waiting for a seal. */
const offerUnsealed = (sim: RoyaltiesSimulator, offer: Uint8Array): boolean =>
  sim.state.offerRevokedAt.member(offer) &&
  sim.state.offerRevokedAt.lookup(offer) > sim.state.sealedRevocations;

const post = (sim: RoyaltiesSimulator, o: OfferOpts = {}): Uint8Array =>
  sim.call(
    { record: o.record ?? BREEDER, rate: { rate: o.rate ?? RATE, salt: SALT } },
    "postOffer",
    o.nonce ?? NONCE,
    R.adminCommit(o.admin ?? ADMIN),
    TERMS,
    o.unit ?? UNIT,
    o.price ?? 1000n,
    o.rate === null ? NIGHT : R.rateCommit(o.rate ?? RATE, SALT),
    o.count ?? 3n,
    o.expires ?? EXPIRES,
    o.revocable ?? true,
    R.adminCommit(o.issuer ?? ISSUER),
    sim.freeIssuerSlot(),
  ).result as Uint8Array;

const withOffer = (o: OfferOpts = {}) => {
  const sim = new RoyaltiesSimulator();
  return { sim, offer: post(sim, o) };
};

/** The licence commitment on a licensee's licence card. */
const commitmentOf = (license: Uint8Array, offer: Uint8Array) =>
  R.licenseCommit(R.viewKey(license, offer), R.spendKey(license, offer), offer);

/** The breeder issues `license`'s licence (paid for off chain), at `slot`. */
const issue = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  license = LIC,
  slot = sim.freeSlot(),
  admin = ADMIN,
) =>
  sim.call(
    { admin },
    "issueLicense",
    offer,
    commitmentOf(license, offer),
    slot,
  );

const keyOf = (offer: Uint8Array, license = LIC, expires = EXPIRES) =>
  licenceKeyOf(license, offer, expires);

/** The opening of an offer as its licensees know it (from the chain and the terms). */
const openingOf = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
): OfferOpening => {
  const o = sim.state.offers.lookup(offer);
  return {
    offer,
    unit: o.unit,
    rateCommit: o.rateCommit,
    expires: o.expires,
    split: o.split,
  };
};

/** The breeder's credit issuer issues credit for `license`'s note (nonce, amount) on `offer`. */
const credit = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  amount: bigint,
  nonce: Uint8Array,
  license = LIC,
) =>
  sim.call(
    {
      issuer: ISSUER,
      opening: openingOf(sim, offer),
      code: R.topUpCode(R.spendKey(license, offer), nonce),
      amount,
    },
    "issueCredit",
  );

const settleCaller = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  note: NoteOpening,
  period: Uint8Array,
  units: bigint,
  extra: Caller = {},
): Caller => ({
  license: LIC,
  opening: openingOf(sim, offer),
  note,
  rate: { rate: RATE, salt: SALT },
  period,
  units,
  ...extra,
});

const settleAs = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  note: NoteOpening,
  period: Uint8Array,
  units: bigint,
  extra: Caller = {},
) => sim.call(settleCaller(sim, offer, note, period, units, extra), "settle");

/** The change note a settlement or merge leaves, as its licensee knows it. */
const changeOf = (
  sim: RoyaltiesSimulator,
  offer: Uint8Array,
  spent: NoteOpening,
  amount: bigint,
  license = LIC,
): NoteOpening => ({
  nonce: changeNonceOf(
    license,
    spent.nonce,
    openingOf(sim, offer),
    spent.amount,
  ),
  amount,
});

const who = (offer: Uint8Array, extra: Caller = {}): Caller => ({
  license: LIC,
  offer,
  expires: EXPIRES,
  challenge: CH,
  ...extra,
});

const prove = (
  sim: RoyaltiesSimulator,
  caller: Caller,
  period: Uint8Array = NIGHT,
  minUnits = 0n,
  validAt = sim.now + HOUR,
  scope = SCOPE,
  live = true,
) => sim.call(caller, "proveLicense", period, minUnits, validAt, scope, live);

/** The receipt a licence's settlement of (period, units) left on chain, found by its change note. */
const receiptOf = (
  sim: RoyaltiesSimulator,
  license: Uint8Array,
  offer: Uint8Array,
  period: Uint8Array,
  units: bigint,
): Uint8Array => {
  const commit = R.receiptCommit(R.viewKey(license, offer), period);
  for (const [change, st] of sim.state.settlements)
    if (hex(R.receiptLeaf(commit, offer, units, change)) === hex(st.receipt))
      return st.receipt;
  return new Uint8Array(32);
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

/** A grower who bought a licence and has 200 of credit in note (b(51), 200). */
const funded = (o: OfferOpts = {}) => {
  const { sim, offer } = withOffer(o);
  issue(sim, offer);
  credit(sim, offer, 200n, b(51));
  return { sim, offer, note: { nonce: b(51), amount: 200n } };
};

const unmask = (masked: bigint, view: Uint8Array, change: Uint8Array): bigint =>
  (masked - R.unitsMask(view, change) + FIELD) % FIELD;

describe("one record, two contracts", () => {
  it("names a record exactly as veilcore.compact's commit() does", () => {
    for (const s of [BREEDER, OTHER, NIGHT])
      expect(hex(R.recordCommit(s))).toBe(hex(V.commit(s)));
  });

  it("an offer's record is the poster's own; the rate is only committed to", () => {
    const { sim, offer } = withOffer({ revocable: false });
    expect(hex(offer)).toBe(hex(R.offerId(V.commit(BREEDER), NONCE)));
    const o = sim.state.offers.lookup(offer);
    expect(hex(o.record)).toBe(hex(V.commit(BREEDER)));
    expect(hex(o.rateCommit)).toBe(hex(R.rateCommit(RATE, SALT)));
    expect(
      sim.state.offerLeaves.findPathForLeaf(
        R.offerLeaf(offer, UNIT, o.rateCommit, EXPIRES, false),
      ),
    ).toBeDefined();
  });
});

describe("offers", () => {
  it("refuses empty terms or admin, a zero price, zero licences and an end date already past", () => {
    const sim = new RoyaltiesSimulator();
    const A = R.adminCommit(ADMIN);
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
        UNIT,
        price,
        NIGHT,
        count,
        expires,
        true,
        R.adminCommit(ISSUER),
        sim.freeIssuerSlot(),
      );
    expect(() => raw(NIGHT, TERMS, 1n, 1n, EXPIRES)).toThrow(/admin/);
    expect(() => raw(A, NIGHT, 1n, 1n, EXPIRES)).toThrow(/terms/);
    expect(() => raw(A, TERMS, 0n, 1n, EXPIRES)).toThrow(/price/);
    expect(() => raw(A, TERMS, 1n, 0n, EXPIRES)).toThrow(/at least one/);
    expect(() => raw(A, TERMS, 1n, 1n, T0)).toThrow(/ended/);
    raw(A, TERMS, 1n, 1n, T0 + 1n);
  });

  it("an offer id is never posted twice, even after it is removed; another poster's nonce is another offer", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n });
    expect(() => post(sim, { expires: T0 + 1000n })).toThrow(/already posted/);
    sim.advance(1000n);
    sim.call({}, "removeEnded", offer);
    expect(() => post(sim, { expires: T0 + YEAR, rate: 100n })).toThrow(
      /already posted/,
    );
    expect(hex(post(sim, { record: OTHER, expires: T0 + YEAR }))).not.toBe(
      hex(offer),
    );
  });

  it("only the admin can close it or hand it over; the record secret alone cannot", () => {
    const { sim, offer } = withOffer();
    expect(() => sim.call({ admin: BREEDER }, "closeOffer", offer)).toThrow(
      /admin/,
    );
    expect(() =>
      sim.call(
        { admin: OTHER },
        "changeOfferAdmin",
        offer,
        R.adminCommit(OTHER),
      ),
    ).toThrow(/admin/);
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
    expect(() => sim.call({ admin: ADMIN2 }, "closeOffer", offer)).toThrow(
      /already closed/,
    );
  });
});

describe("licences", () => {
  it("the breeder issues a licence: nothing moves, no circuit can take a payment", () => {
    const { sim, offer } = withOffer();
    const { moved } = issue(sim, offer);
    expect(moved.inputs.size + moved.outputs.size + moved.spends.length).toBe(
      0,
    );
    expect(Object.keys(sim.state)).not.toContain("topUpSeq");
  });

  it("the breeder checks a licence card (viewing and spending keys) against the licence", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    const k = R.licenseKey(
      R.licenseCommit(R.viewKey(LIC, offer), R.spendKey(LIC, offer), offer),
      offer,
      EXPIRES,
    );
    expect(hex(sim.state.lastSale)).toBe(hex(k));
    expect(sim.state.licenseOffer.member(k)).toBe(true);
  });

  it("keys are per offer: one secret's licences on two offers share no key a breeder could match", () => {
    const sim = new RoyaltiesSimulator();
    const a = post(sim);
    const c = post(sim, { record: OTHER, nonce: b(51) });
    expect(hex(R.viewKey(LIC, a))).not.toBe(hex(R.viewKey(LIC, c)));
    expect(hex(R.spendKey(LIC, a))).not.toBe(hex(R.spendKey(LIC, c)));
    expect(hex(keyOf(a))).not.toBe(hex(keyOf(c)));
  });

  it("refuses a repeated secret, a taken slot, a slot off the tree, and sells out", () => {
    const { sim, offer } = withOffer({ count: 2n });
    issue(sim, offer);
    expect(() => issue(sim, offer)).toThrow(/already bought/);
    expect(() => issue(sim, offer, LIC2, 0n)).toThrow(/slot is taken/);
    expect(() => issue(sim, offer, LIC2, 16777216n)).toThrow(/outside/);
    issue(sim, offer, LIC2);
    expect(() => issue(sim, offer, b(12))).toThrow(/sold out/);
  });

  it("issues nothing from an unknown, closed or ended offer", () => {
    const { sim, offer } = withOffer();
    expect(() => issue(sim, b(99))).toThrow(/No such offer/);
    sim.advance(YEAR);
    expect(() => issue(sim, offer)).toThrow(/ended/);
    const fresh = withOffer();
    fresh.sim.call({ admin: ADMIN }, "closeOffer", fresh.offer);
    expect(() => issue(fresh.sim, fresh.offer)).toThrow(/closed/);
  });
});

describe("credit: issued", () => {
  it("a made-up offer opening is refused", () => {
    const { sim, offer } = withOffer();
    const fake = {
      ...openingOf(sim, offer),
      rateCommit: R.rateCommit(1n, SALT),
    };
    expect(() =>
      sim.call(
        { issuer: ISSUER, opening: fake, code: b(70), amount: 5n },
        "issueCredit",
      ),
    ).toThrow(/credit issuer/);
    const none = withOffer({ rate: null });
    expect(() => credit(none.sim, none.offer, 5n, b(51))).toThrow(
      /no royalties/,
    );
  });
});

describe("credit: private settlement", () => {
  it("settles a period: no money moves, change is kept, and nothing names the offer, licensee, period, rate or units", () => {
    const { sim, offer, note } = funded();
    const caller = settleCaller(sim, offer, note, P1, 30n);
    const p = sim.prove(caller, "settle");
    const view = R.viewKey(LIC, offer);
    for (const secretish of [
      offer,
      P1,
      view,
      R.spendKey(LIC, offer),
      LIC,
      keyOf(offer),
      R.receiptCommit(view, P1),
      SALT,
    ])
      expect(appears(p, secretish)).toBe(false);
    expect(text(p)).not.toMatch(/"(30|120|80)"/);
    expect(text(p)).not.toContain(EXPIRES.toString());
    const { moved } = sim.call(caller, "settle");
    expect(moved.inputs.size + moved.outputs.size + moved.spends.length).toBe(
      0,
    );
    const change = changeOf(sim, offer, note, 200n - 30n * RATE);
    expect(hex(sim.state.lastNote)).toBe(
      hex(noteOf(LIC, change.nonce, openingOf(sim, offer), change.amount)),
    );
    expect(hex(sim.state.lastReceipt)).toBe(
      hex(
        R.receiptLeaf(
          R.receiptCommit(view, P1),
          offer,
          30n,
          sim.state.lastNote,
        ),
      ),
    );
  });

  it("the breeder reads the units with the viewing key; others read noise; pads never repeat", () => {
    const { sim, offer, note } = funded();
    const view = R.viewKey(LIC, offer);
    settleAs(sim, offer, note, P1, 30n);
    const m1 = masked(sim);
    const c1 = sim.state.lastNote;
    expect(unmask(m1, view, c1)).toBe(30n);
    expect(unmask(m1, R.viewKey(OTHER, offer), c1)).not.toBe(30n);
    settleAs(sim, offer, changeOf(sim, offer, note, 80n), P1, 13n);
    const m2 = masked(sim);
    expect(unmask(m2, view, sim.state.lastNote)).toBe(13n);
    expect((m1 - m2 + FIELD) % FIELD).not.toBe(17n);
  });

  it("M1: every settlement stays readable, not only the latest", () => {
    const { sim, offer, note } = funded();
    const view = R.viewKey(LIC, offer);
    settleAs(sim, offer, note, P1, 30n);
    const c1 = sim.state.lastNote;
    settleAs(sim, offer, changeOf(sim, offer, note, 80n), P2, 13n);
    expect(sim.state.settlements.size()).toBe(2n);
    const first = sim.state.settlements.lookup(c1);
    expect(unmask(first.unitsMasked, view, c1)).toBe(30n);
    expect(hex(first.receipt)).toBe(
      hex(R.receiptLeaf(R.receiptCommit(view, P1), offer, 30n, c1)),
    );
  });

  it("refuses more units than the note covers, a wrong rate, and zero units", () => {
    const { sim, offer, note } = funded();
    expect(() => settleAs(sim, offer, note, P1, 51n)).toThrow(/does not cover/);
    expect(() =>
      settleAs(sim, offer, note, P1, 30n, { rate: { rate: 1n, salt: SALT } }),
    ).toThrow(/royalty rate/);
    expect(() => settleAs(sim, offer, note, P1, 0n)).toThrow(
      /at least one unit/,
    );
  });

  it("an offer committing to a zero rate takes no credit at all (a zero rate would prove any units for nothing)", () => {
    expect(() => funded({ rate: 0n })).toThrow(/zero/);
  });

  it("a note spends once; someone else's note, or a note of another offer, cannot be spent", () => {
    const { sim, offer, note } = funded();
    settleAs(sim, offer, note, P1, 10n);
    expect(() => settleAs(sim, offer, note, P2, 10n)).toThrow(/already spent/);
    issue(sim, offer, LIC2);
    credit(sim, offer, 100n, b(55), LIC2);
    expect(() =>
      settleAs(sim, offer, { nonce: b(55), amount: 100n }, P2, 1n),
    ).toThrow(/not yours|not on chain/);
    const other = post(sim, { nonce: b(57) });
    credit(sim, other, 100n, b(58));
    expect(() =>
      settleAs(sim, offer, { nonce: b(58), amount: 100n }, P2, 1n),
    ).toThrow(/not yours|not on chain/);
  });

  it("settling needs a live licence: none bought, or revoked and sealed, is refused", () => {
    const { sim, offer } = withOffer();
    credit(sim, offer, 100n, b(51));
    expect(() =>
      settleAs(sim, offer, { nonce: b(51), amount: 100n }, P1, 1n),
    ).toThrow(/No live licence/);
    issue(sim, offer);
    sim.advance(700n);
    sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer));
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(() =>
      settleAs(sim, offer, { nonce: b(51), amount: 100n }, P1, 1n),
    ).toThrow(/No live licence/);
  });

  it("the change note keeps paying later periods; the same period can be settled again", () => {
    const { sim, offer, note } = funded();
    settleAs(sim, offer, note, P1, 10n);
    const c1 = changeOf(sim, offer, note, 160n);
    settleAs(sim, offer, c1, P1, 10n);
    const c2 = changeOf(sim, offer, c1, 120n);
    settleAs(sim, offer, c2, P2, 30n);
    const c3 = changeOf(sim, offer, c2, 0n);
    expect(() => settleAs(sim, offer, c3, b(32), 1n)).toThrow(/does not cover/);
  });

  it("two notes merge into one, and neither can be spent again", () => {
    const { sim, offer, note } = funded();
    credit(sim, offer, 50n, b(53));
    const n2 = { nonce: b(53), amount: 50n };
    sim.call(
      { license: LIC, opening: openingOf(sim, offer), note, note2: n2 },
      "mergeNotes",
    );
    const merged = changeOf(sim, offer, note, 250n);
    expect(hex(sim.state.lastNote)).toBe(
      hex(noteOf(LIC, merged.nonce, openingOf(sim, offer), 250n)),
    );
    expect(() => settleAs(sim, offer, note, P1, 1n)).toThrow(/already spent/);
    expect(() => settleAs(sim, offer, n2, P1, 1n)).toThrow(/already spent/);
    settleAs(sim, offer, merged, P1, 60n);
  });

  it("settling still works after an offer closes; credit for the last season can be issued after the end", () => {
    const { sim, offer, note } = funded({ expires: T0 + 2n * DAY });
    sim.call({ admin: ADMIN }, "closeOffer", offer);
    settleAs(sim, offer, note, P1, 5n);
    sim.advance(2n * DAY);
    // Issuing moves no money: a late payment for the last season can still be acknowledged.
    credit(sim, offer, 10n, b(60));
    settleAs(sim, offer, { nonce: b(60), amount: 10n }, P2, 2n, {
      expires: T0 + 2n * DAY,
    });
  });

  it("E2: the last season, settled after the licence ended, can still be proved (without asking for a live licence)", () => {
    const { sim, offer, note } = funded({ expires: T0 + 2n * DAY });
    sim.advance(3n * DAY);
    settleAs(sim, offer, note, P1, 5n);
    expect(() =>
      prove(
        sim,
        who(offer, { period: P1, units: 5n, expires: T0 + 2n * DAY }),
        P1,
        5n,
      ),
    ).toThrow(/ends at or before/);
    prove(
      sim,
      who(offer, { period: P1, units: 5n, expires: T0 + 2n * DAY }),
      P1,
      5n,
      sim.now + HOUR,
      SCOPE,
      false,
    );
    expect(sim.state.presentationSeq).toBe(1n);
    // Without a period, a presentation must ask for a live licence.
    expect(() =>
      prove(
        sim,
        who(offer, { expires: T0 + 2n * DAY }),
        NIGHT,
        0n,
        sim.now + HOUR,
        SCOPE,
        false,
      ),
    ).toThrow(/must ask for a live licence/);
  });
});

describe("presentations", () => {
  it("proves a live licence to one verifier, publishing only the tag and a scoped holder tag", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    const at = sim.now + HOUR;
    prove(sim, who(offer));
    expect(hex(sim.state.lastPresentation)).toBe(
      hex(R.presentationTag(offer, NIGHT, 0n, at, SCOPE, CH, true)),
    );
    expect(hex(sim.state.lastPresentationHolder)).toBe(
      hex(R.holderTag(R.presentKey(LIC, offer), offer, SCOPE)),
    );
  });

  it("proves a settled period covering at least the units asked; not more, not another period", () => {
    const { sim, offer, note } = funded();
    settleAs(sim, offer, note, P1, 30n);
    prove(sim, who(offer, { period: P1, units: 30n }), P1, 25n);
    expect(() =>
      prove(sim, who(offer, { period: P1, units: 30n }), P1, 31n),
    ).toThrow(/covers that many/);
    expect(() =>
      prove(sim, who(offer, { period: P2, units: 30n }), P2, 1n),
    ).toThrow(/No settlement/);
    expect(() =>
      prove(sim, who(offer, { period: P1, units: 40n }), P1, 1n),
    ).toThrow(/No settlement/);
  });

  it("someone else's settlement does not count as yours", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    issue(sim, offer, LIC2);
    credit(sim, offer, 200n, b(51), LIC2);
    settleAs(sim, offer, { nonce: b(51), amount: 200n }, P1, 30n, {
      license: LIC2,
    });
    const theirs = sim.receiptPathFor(receiptOf(sim, LIC2, offer, P1, 30n))!;
    expect(() =>
      prove(
        sim,
        who(offer, { period: P1, units: 30n, receiptPath: theirs }),
        P1,
        1n,
      ),
    ).toThrow(/No settlement/);
  });

  it("a paid-up presentation names neither the licence, the offer, the receipt nor the units", () => {
    const { sim, offer, note } = funded();
    settleAs(sim, offer, note, P1, 30n);
    const p = sim.prove(
      who(offer, { period: P1, units: 30n }),
      "proveLicense",
      P1,
      1n,
      sim.now + HOUR,
      SCOPE,
      true,
    );
    const leaf = receiptOf(sim, LIC, offer, P1, 30n);
    for (const secretish of [
      keyOf(offer),
      offer,
      leaf,
      LIC,
      R.viewKey(LIC, offer),
    ])
      expect(appears(p, secretish)).toBe(false);
  });

  it("the holder tag repeats within a scope and differs across scopes; a zero scope is refused", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    prove(sim, who(offer));
    const first = hex(sim.state.lastPresentationHolder);
    prove(sim, who(offer, { challenge: b(61) }));
    expect(hex(sim.state.lastPresentationHolder)).toBe(first);
    prove(sim, who(offer), NIGHT, 0n, sim.now + HOUR, b(81));
    expect(hex(sim.state.lastPresentationHolder)).not.toBe(first);
    expect(() =>
      prove(sim, who(offer), NIGHT, 0n, sim.now + HOUR, NIGHT),
    ).toThrow(/scope/);
  });

  it("needs a challenge, the real secret and end date, and a future time before the end", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
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
    expect(() => prove(sim, who(offer), NIGHT, 0n, EXPIRES)).toThrow(
      /ends at or before/,
    );
    prove(sim, who(offer), NIGHT, 0n, EXPIRES - 1n);
  });

  it("the breeder's licence card cannot present the licence or spend the credit (it lacks the secret)", () => {
    const { sim, offer, note } = funded();
    for (const k of [R.viewKey(LIC, offer), R.spendKey(LIC, offer)]) {
      expect(() => prove(sim, who(offer, { license: k }))).toThrow(
        /No live licence/,
      );
      expect(() => settleAs(sim, offer, note, P1, 1n, { license: k })).toThrow(
        /No live licence|not yours|not on chain/,
      );
    }
  });
});

describe("revocation, ending and seals", () => {
  it("only the admin, and only if the offer said so", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    expect(() =>
      sim.call({ admin: OTHER }, "revokeLicense", keyOf(offer)),
    ).toThrow(/admin/);
    const fixed = withOffer({ revocable: false });
    issue(fixed.sim, fixed.offer);
    expect(() =>
      fixed.sim.call({ admin: ADMIN }, "revokeLicense", keyOf(fixed.offer)),
    ).toThrow(/cannot be revoked/);
  });

  it("a revoked licence leaves the tree, is flagged until the seal, then stops proving; never re-bought", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    sim.advance(700n);
    sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer));
    expect(sim.pathFor(LIC, offer, EXPIRES)).toBeUndefined();
    expect(() => issue(sim, offer)).toThrow(/already bought/);
    prove(sim, who(offer));
    expect(offerUnsealed(sim, offer)).toBe(true);
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(offerUnsealed(sim, offer)).toBe(false);
    expect(() => prove(sim, who(offer))).toThrow(/No live licence/);
  });

  it("H1: a revocation on another offer (say, an attacker revoking their own) holds up no one else's presentations", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    const spam = post(sim, { record: OTHER, nonce: b(52), admin: ADMIN2 });
    issue(sim, spam, LIC2, sim.freeSlot(), ADMIN2);
    sim.advance(700n);
    sim.call({ admin: ADMIN2 }, "revokeLicense", keyOf(spam, LIC2));
    prove(sim, who(offer));
    expect(offerUnsealed(sim, spam)).toBe(true);
    expect(offerUnsealed(sim, offer)).toBe(false);
  });

  it("removing an offer keeps its revocation record, so a verifier still sees it", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n });
    issue(sim, offer);
    sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer, LIC, T0 + 1000n));
    expect(sim.state.offerRevokedAt.member(offer)).toBe(true);
    sim.advance(2000n);
    sim.call({}, "removeEnded", offer);
    expect(sim.state.offerRevokedAt.member(offer)).toBe(true);
  });

  it("a presentation proved before a revocation is rejected if it lands after the seal", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
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
    sim.call({ admin: ADMIN }, "revokeLicense", keyOf(offer));
    sim.call({}, "sealRevocations", sim.now + 100n);
    expect(() => sim.land(p)).toThrow();
  });

  it("anyone clears an ended licence and then the ended offer; not before", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n });
    issue(sim, offer);
    const k = keyOf(offer, LIC, T0 + 1000n);
    expect(() => sim.call({}, "clearEnded", k)).toThrow(/not ended/);
    expect(() => sim.call({}, "removeEnded", offer)).toThrow(/not ended/);
    sim.advance(1000n);
    expect(() => sim.call({}, "removeEnded", offer)).toThrow(/Clear/);
    expect(() => sim.call({}, "clearEnded", k)).toThrow(/30 days/);
    sim.advance(GRACE);
    sim.call({}, "clearEnded", k);
    sim.call({}, "removeEnded", offer);
    expect(sim.state.offers.member(offer)).toBe(false);
  });

  it("seals are rate-limited; a credit note path survives licence-only seals within the day", () => {
    const { sim, offer, note } = funded();
    sim.advance(DAY);
    sim.call({}, "sealRevocations", sim.now + 100n);
    const held = sim.notePathFor(
      noteOf(LIC, note.nonce, openingOf(sim, offer), note.amount),
    )!;
    issue(sim, offer, LIC2);
    expect(() => sim.call({}, "sealRevocations", sim.now + 200n)).toThrow(
      /Too soon/,
    );
    sim.advance(700n);
    sim.call({}, "sealRevocations", sim.now + 100n);
    settleAs(sim, offer, note, P1, 1n, { notePath: held });
  });
});

describe("attacks from the reviews, kept as regressions", () => {
  it("A1: a receipt cannot claim more units than were settled", () => {
    const { sim, offer, note } = funded();
    settleAs(sim, offer, note, P1, 1n);
    expect(() =>
      prove(sim, who(offer, { period: P1, units: 1_000_000n }), P1, 1_000_000n),
    ).toThrow(/No settlement/);
  });

  it("A2: credit issued on your own cheap offer cannot settle the breeder's offer", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    const mine = post(sim, {
      record: OTHER,
      nonce: b(57),
      rate: 1n,
      admin: OTHER,
    });
    credit(sim, mine, 1000n, b(51));
    expect(() =>
      settleAs(sim, offer, { nonce: b(51), amount: 1000n }, P1, 1n),
    ).toThrow(/not yours|not on chain/);
  });

  it("A3: nobody can squat a top-up code: it is never published", () => {
    const { sim, offer } = withOffer();
    const op = openingOf(sim, offer);
    const code = R.topUpCode(R.spendKey(LIC, offer), b(51));
    expect(
      appears(
        sim.prove(
          { issuer: ISSUER, opening: op, code, amount: 50n },
          "issueCredit",
        ),
        code,
      ),
    ).toBe(false);
  });

  it("A5: an old or stolen record secret cannot close, revoke or hand over the offer", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    expect(() =>
      sim.call({ admin: BREEDER }, "revokeLicense", keyOf(offer)),
    ).toThrow(/admin/);
    expect(() => sim.call({ admin: BREEDER }, "closeOffer", offer)).toThrow(
      /admin/,
    );
  });

  it("A7: an ended licence frees its slot", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n, revocable: false });
    issue(sim, offer, LIC, 7n);
    sim.advance(2000n + GRACE);
    sim.call({}, "clearEnded", keyOf(offer, LIC, T0 + 1000n));
    const o2 = post(sim, {
      record: OTHER,
      nonce: b(51),
      expires: T0 + YEAR + 2000n,
    });
    issue(sim, o2, LIC2, 7n);
  });

  it("X1: a reused top-up code no longer burns credit (each note has its own nullifier)", () => {
    const { sim, offer } = withOffer();
    issue(sim, offer);
    credit(sim, offer, 100n, b(51));
    credit(sim, offer, 300n, b(51));
    settleAs(sim, offer, { nonce: b(51), amount: 300n }, P1, 1n);
    settleAs(sim, offer, { nonce: b(51), amount: 100n }, P1, 2n);
  });

  it("X3: two settlements of one period do not publish their units difference", () => {
    const { sim, offer, note } = funded();
    settleAs(sim, offer, note, P1, 30n);
    const m1 = masked(sim);
    settleAs(sim, offer, changeOf(sim, offer, note, 80n), P1, 13n);
    expect((m1 - masked(sim) + FIELD) % FIELD).not.toBe(17n);
  });

  it("X7: a removed offer's id cannot come back with other terms", () => {
    const { sim, offer } = withOffer({ expires: T0 + 1000n });
    sim.advance(1000n);
    sim.call({}, "removeEnded", offer);
    expect(() => post(sim, { expires: T0 + YEAR, rate: 100n })).toThrow(
      /already posted/,
    );
  });

  it("N1: an expired licence cannot present as live by answering a different end date", () => {
    const { sim, offer } = withOffer({ expires: T0 + 2n * HOUR });
    issue(sim, offer);
    const year = sim.now + YEAR;
    expect(() =>
      prove(sim, who(offer, { expires: 2n ** 64n - 1n }), NIGHT, 0n, year),
    ).toThrow(/No live licence/);
    expect(() =>
      prove(sim, who(offer, { expires: T0 + 2n * HOUR }), NIGHT, 0n, year),
    ).toThrow(/ends at or before/);
  });

  it("N2: the last period can still be settled after the end; nobody can clear the licence for 30 days", () => {
    const { sim, offer, note } = funded({ expires: T0 + DAY });
    sim.advance(DAY);
    expect(() =>
      sim.call({}, "clearEnded", keyOf(offer, LIC, T0 + DAY)),
    ).toThrow(/30 days/);
    settleAs(sim, offer, note, P1, 5n, { expires: T0 + DAY });
  });

  it("N5: a rate commitment must open to a rate above zero, so no credit is issued that nothing could settle", () => {
    // Refused when the offer is posted, before any credit could be issued for it.
    expect(() => withOffer({ rate: 0n })).toThrow(
      /does not open to a rate above zero/,
    );
    // So issuing needs no rate opening, and every offer leaf it can prove came from postOffer.
    const { sim, offer } = withOffer();
    issue(sim, offer);
    credit(sim, offer, 500n, b(51));
    expect(sim.state.issueSeq).toBe(1n);
  });
});
