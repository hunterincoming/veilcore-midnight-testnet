// The royalties contract as midnight-js runs it (src/royalties.ts): the client's own
// witnesses read one call's input from private state and find every Merkle path in the
// ledger the call runs against. A full licensee journey runs on them here: buy, top up,
// settle twice, merge, and present a settled period.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  type CircuitContext,
  ContractState,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  ROYALTIES_PROVABLE_CIRCUITS,
  type OfferOpening,
  type RoyaltiesPrivateState,
  type RoyaltyInput,
  changeNonceOf,
  emptyRoyaltiesPrivateState,
  licenceKeyOf,
  noteOf,
  royaltiesDeployingContract,
  royaltiesLedger,
  royaltiesPureCircuits as R,
  royaltiesWitnesses,
} from "../royalties.js";
import { Contract } from "../managed/veilcore-royalties/contract/index.js";

const COIN = "0".repeat(64);
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const b = (n: number): Uint8Array => {
  const o = new Uint8Array(32);
  o[0] = 0x6b;
  o[31] = n;
  return o;
};
const NIGHT = new Uint8Array(32);
const T0 = 1_800_000_000n;
const DAY = 86400n;
const EXPIRES = T0 + 365n * DAY;
const RATE = 4n;
const SALT = b(90);

type Ctx = CircuitContext<RoyaltiesPrivateState>;

class Client {
  ctx: Ctx;
  constructor() {
    const c = new Contract<RoyaltiesPrivateState>(royaltiesWitnesses);
    const init = c.initialState(
      createConstructorContext(emptyRoyaltiesPrivateState(), COIN),
    );
    this.ctx = createCircuitContext(
      sampleContractAddress(),
      COIN,
      init.currentContractState,
      emptyRoyaltiesPrivateState(),
    );
    this.ctx.currentQueryContext.block = {
      ...this.ctx.currentQueryContext.block,
      secondsSinceEpoch: T0,
    };
  }
  get ledger() {
    return royaltiesLedger(this.ctx.currentQueryContext.state);
  }
  /** As RoyaltiesAPI.call: the input goes into private state for this call only. */
  run(
    input: RoyaltyInput,
    f: (
      c: Contract<RoyaltiesPrivateState>,
      ctx: Ctx,
    ) => { context: Ctx; result: unknown },
  ) {
    const c = new Contract<RoyaltiesPrivateState>(royaltiesWitnesses);
    const ctx = {
      ...this.ctx,
      currentPrivateState: { ...this.ctx.currentPrivateState, input },
    };
    const r = f(c, ctx);
    this.ctx = {
      ...r.context,
      currentPrivateState: { ...r.context.currentPrivateState, input: {} },
    };
    return r.result;
  }
}

describe("the client's witnesses, through a whole licensee journey", () => {
  it("buy, top up, settle twice, merge, and present a settled period", () => {
    const k = new Client();
    const offer = k.run(
      { recordSecret: b(1), rate: { rate: RATE, salt: SALT } },
      (c, ctx) =>
        c.impureCircuits.postOffer(
          ctx,
          b(50),
          R.adminCommit(b(5)),
          b(20),
          NIGHT,
          1000n,
          R.rateCommit(RATE, SALT),
          { bytes: b(40) },
          3n,
          EXPIRES,
          true,
        ),
    ) as Uint8Array;
    const lic = b(10);
    k.run(
      {
        licenseSecret: lic,
        split: {
          record: R.recordCommit(b(1)),
          color: NIGHT,
          total: 1000n,
          now: T0,
        },
      },
      (c, ctx) => c.impureCircuits.buyLicense(ctx, offer, 5n),
    );
    expect(hex(k.ledger.lastSale)).toBe(hex(licenceKeyOf(lic, offer, EXPIRES)));

    const op: OfferOpening = {
      offer,
      payTo: b(40),
      color: NIGHT,
      rateCommit: R.rateCommit(RATE, SALT),
      expires: EXPIRES,
      split: false,
    };
    const rate = { rate: RATE, salt: SALT };
    const topUp = (nonce: Uint8Array, amount: bigint) =>
      k.run(
        { opening: op, code: R.topUpCode(R.spendKey(lic, offer), nonce), rate },
        (c, ctx) =>
          c.impureCircuits.topUp(
            ctx,
            { bytes: op.payTo },
            NIGHT,
            amount,
            T0 + DAY,
          ),
      );
    topUp(b(51), 100n);
    topUp(b(52), 100n);
    expect(k.ledger.noteSeen.member(noteOf(lic, b(51), op, 100n))).toBe(true);

    const settle = (
      note: { nonce: Uint8Array; amount: bigint },
      period: string,
      units: bigint,
      index: bigint,
    ) =>
      k.run(
        {
          licenseSecret: lic,
          opening: op,
          expires: EXPIRES,
          note,
          rate,
          period: new Uint8Array(32)
            .fill(0)
            .map((_, i) => Buffer.from(period).at(i) ?? 0),
          units,
          index,
        },
        (c, ctx) => c.impureCircuits.settle(ctx),
      );
    settle({ nonce: b(51), amount: 100n }, "2026-Q4", 20n, 0n);
    const change = { nonce: changeNonceOf(lic, b(51), op, 100n), amount: 20n };
    expect(k.ledger.noteSeen.member(noteOf(lic, change.nonce, op, 20n))).toBe(
      true,
    );

    k.run(
      {
        licenseSecret: lic,
        opening: op,
        note: change,
        note2: { nonce: b(52), amount: 100n },
      },
      (c, ctx) => c.impureCircuits.mergeNotes(ctx),
    );
    const merged = {
      nonce: changeNonceOf(lic, change.nonce, op, 20n),
      amount: 120n,
    };
    settle(merged, "2027-Q1", 30n, 1n);
    const q1Change = k.ledger.lastNote;

    const q1 = new Uint8Array(32);
    q1.set(Buffer.from("2027-Q1"));
    k.ctx.currentQueryContext.block = {
      ...k.ctx.currentQueryContext.block,
      secondsSinceEpoch: T0 + 10n,
    };
    k.run(
      {
        licenseSecret: lic,
        offer,
        expires: EXPIRES,
        challenge: b(60),
        period: q1,
        units: 30n,
        change: q1Change,
      },
      (c, ctx) =>
        c.impureCircuits.proveLicense(ctx, q1, 25n, T0 + 3600n, b(80), true),
    );
    expect(hex(k.ledger.lastPresentation)).toBe(
      hex(R.presentationTag(offer, q1, 25n, T0 + 3600n, b(80), b(60), true)),
    );
    expect(k.ctx.currentPrivateState.input).toEqual({});
  });

  it("a witness asked for something the client did not give throws before anything is proved", () => {
    const k = new Client();
    expect(() =>
      k.run({}, (c, ctx) => c.impureCircuits.buyLicense(ctx, b(1), 0n)),
    ).toThrow();
  });
});

describe("deploying in fragments", () => {
  it("lists every circuit, and a deploy carrying a subset keeps the same state", () => {
    expect(ROYALTIES_PROVABLE_CIRCUITS).toContain("settle");
    expect(ROYALTIES_PROVABLE_CIRCUITS).toContain("topUp");
    const keep = ROYALTIES_PROVABLE_CIRCUITS.slice(0, 4);
    const D = royaltiesDeployingContract(keep);
    const d = new D<RoyaltiesPrivateState>(royaltiesWitnesses);
    const s = d.initialState(
      createConstructorContext(emptyRoyaltiesPrivateState(), COIN),
    ).currentContractState;
    const names = (x: ContractState) =>
      x
        .operations()
        .map((o) =>
          typeof o === "string" ? o : Buffer.from(o).toString("utf8"),
        )
        .sort();
    expect(names(s)).toEqual([...keep].sort());
    expect(() => royaltiesDeployingContract(["nope"])).toThrow(
      /No royalties circuit/,
    );
  });
});
