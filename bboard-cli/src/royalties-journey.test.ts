// The royalties client (api/src/royalties-api.ts) end to end, with no network: every
// transaction runs the real contract in the simulator, each party keeps its own private
// store, and the chain can be told to fail a call or to time out after it landed.
// Breeder, two growers, a payer and a verifier, through offers, top-ups, private
// settlements, a merge, the breeder reading the books, and a presentation.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { type CircuitContext, createCircuitContext, createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import { Contract } from '../../contract/src/managed/veilcore-royalties/contract/index.js';
import {
  type RoyaltiesPrivateState,
  emptyRoyaltiesPrivateState,
  royaltiesLedger,
  royaltiesPureCircuits as R,
  royaltiesWitnesses,
} from '../../contract/src/royalties.js';
import {
  NIGHT_COLOR,
  RoyaltiesAPI,
  WouldLinkError,
  newPresentationRequest,
  revocationVerdict,
} from '../../api/src/royalties-api.js';
import { type RoyaltiesProviders, royaltiesPrivateStateKey } from '../../api/src/royalties-types.js';
import { VeilcoreSimulator, as, secret } from '../../contract/src/test/veilcore-simulator.js';

const ROYALTIES = 'aa'.repeat(32);
const MAIN = 'bb'.repeat(32);
const COIN = '0'.repeat(64);
const now = (): bigint => BigInt(Math.floor(Date.now() / 1000));
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
type Ctx = CircuitContext<RoyaltiesPrivateState>;

/** One chain: the royalties contract in the simulator, the main contract beside it. */
class Chain {
  ctx: Ctx;
  n = 0;
  /** The next call fails before it lands. */
  failNext = false;
  /** The next call lands, then the client is told it timed out. */
  timeoutAfterLanding = false;
  readonly main = new VeilcoreSimulator();

  constructor() {
    const c = new Contract<RoyaltiesPrivateState>(royaltiesWitnesses);
    const init = c.initialState(createConstructorContext(emptyRoyaltiesPrivateState(), COIN));
    this.ctx = createCircuitContext(ROYALTIES, COIN, init.currentContractState, emptyRoyaltiesPrivateState());
  }

  get ledger() {
    return royaltiesLedger(this.ctx.currentQueryContext.state);
  }

  party(): { api: RoyaltiesAPI; store: Map<string, RoyaltiesPrivateState> } {
    const store = new Map<string, RoyaltiesPrivateState>();
    const privateStateProvider = {
      setContractAddress: () => undefined,
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      set: (k: string, v: RoyaltiesPrivateState) => Promise.resolve(void store.set(k, v)),
    };
    const publicDataProvider = {
      queryContractState: (addr: string) =>
        Promise.resolve({
          data:
            addr === MAIN
              ? (this.main as unknown as { ctx: Ctx }).ctx.currentQueryContext.state
              : this.ctx.currentQueryContext.state,
        }),
    };
    const callTx = new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          async (...args: unknown[]) =>
            this.call(name, store, args),
      },
    );
    const deployed = { deployTxData: { public: { contractAddress: ROYALTIES } }, callTx };
    const providers = { privateStateProvider, publicDataProvider } as unknown as RoyaltiesProviders;
    const Api = RoyaltiesAPI as unknown as new (d: unknown, p: RoyaltiesProviders) => RoyaltiesAPI;
    return { api: new Api(deployed, providers), store };
  }

  // A failed circuit throws before anything lands, as a rejected submission would.
  private call(name: string, store: Map<string, RoyaltiesPrivateState>, args: unknown[]) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('submission failed (test)'));
    }
    const c = new Contract<RoyaltiesPrivateState>(royaltiesWitnesses);
    this.ctx.currentQueryContext.block = { ...this.ctx.currentQueryContext.block, secondsSinceEpoch: now() };
    const ctx: Ctx = { ...this.ctx, currentPrivateState: store.get(royaltiesPrivateStateKey)! };
    const circuits = c.impureCircuits as unknown as Record<string, (ctx: Ctx, ...a: unknown[]) => { context: Ctx }>;
    const r = circuits[name](ctx, ...args);
    this.ctx = r.context;
    store.set(royaltiesPrivateStateKey, r.context.currentPrivateState);
    this.n++;
    if (this.timeoutAfterLanding) {
      this.timeoutAfterLanding = false;
      return Promise.reject(new Error('timed out waiting for the transaction (test)'));
    }
    return Promise.resolve({
      public: { txId: `tx${this.n}`, txHash: `h${this.n}`, blockHeight: this.n, nextContractState: null },
    });
  }
}

describe('the royalties client, end to end on the simulator', () => {
  it('offer, buy, top up, settle in private, merge, read the books, present', async () => {
    const chain = new Chain();
    const breeder = chain.party();
    const g1 = chain.party();
    const g2 = chain.party();
    const payer = chain.party();

    // The breeder's record is anchored in the main contract.
    const record = secret('journey-breeder');
    chain.main.call(as(record), 'anchor', C.recoveryCommit(secret('journey-breeder-rcv')));

    const terms = new Uint8Array(32).fill(7);
    const payTo = new Uint8Array(32).fill(9);
    const posted = await breeder.api.postOffer(
      record,
      {
        terms,
        color: NIGHT_COLOR,
        price: 1000n,
        rate: 4n,
        payTo,
        count: 5n,
        expires: now() + 365n * 86400n,
        revocable: true,
      },
      MAIN,
    );
    const card = posted.card;
    const offer = posted.offer;
    expect(card.rate).toBe('4');
    // The chain holds only the rate's commitment.
    expect(hex(chain.ledger.offers.lookup(offer).rateCommit)).toBe(card.rateCommit);

    const b1 = await g1.api.buyLicense(card, MAIN);
    const b2 = await g2.api.buyLicense(card, MAIN);
    await breeder.api.checkLicenceCard(b1.licenceCard);

    // A purchase that never lands leaves a licence in g1's store that the chain never saw.
    chain.failNext = true;
    await expect(g1.api.buyLicense(card, MAIN)).rejects.toThrow(/test/);

    // A payer tops up g1 without learning who g1 is; g1 records it. Twice is refused and changes nothing.
    const req = await g1.api.topUpRequest(offer);
    await payer.api.payTopUp(req, 100n);
    await g1.api.claimTopUp(offer, undefined, 100n);
    await expect(g1.api.claimTopUp(offer, undefined, 100n)).rejects.toThrow(/already recorded/);
    expect(await g1.api.credit(offer)).toBe(100n);
    await g1.api.topUpOwn(offer, 60n);
    expect(await g1.api.credit(offer)).toBe(160n);

    // Rule 2: the latest note is g1's own, so g1 may not settle yet.
    await expect(g1.api.settle(offer, '2026-Q4', 20n)).rejects.toThrow(/credit note is still the newest/);
    await g2.api.topUpOwn(offer, 50n);

    // Settle 20 units at 4: spends the 100 note, keeps 20 change. The client is told the
    // call timed out after it landed: the change must not be lost.
    chain.timeoutAfterLanding = true;
    await expect(g1.api.settle(offer, '2026-Q4', 20n)).rejects.toThrow(/timed out/);
    expect(await g1.api.credit(offer)).toBe(80n);
    expect(chain.ledger.settleSeq).toBe(1n);

    // 19 units owe 76: no single note covers it (60 and 20), so the client merges first,
    // then waits for someone else (rule 2) before settling.
    await g2.api.topUpOwn(offer, 10n);
    await expect(g1.api.settle(offer, '2027-Q1', 19n)).rejects.toThrow(/credit was merged/);
    expect(await g1.api.credit(offer)).toBe(80n);
    await g2.api.topUpOwn(offer, 10n);
    await g1.api.settle(offer, '2027-Q1', 19n);
    expect(await g1.api.credit(offer)).toBe(4n);

    // g2 settles too, so the breeder has two licensees' books to read.
    // g2 bought last, and nobody has bought since: settling now could be guessed to be g2.
    // The client waits by default; g2 may choose to send anyway.
    await g1.api.topUpOwn(offer, 1n);
    await expect(g2.api.settle(offer, '2026-Q4', 7n)).rejects.toThrow(WouldLinkError);
    await g2.api.settle(offer, '2026-Q4', 7n, { evenIfLinkable: true });

    // Nothing on chain names the period, the units or the rate: the breeder reads them
    // with the licence cards.
    const who = (l: string): string => (l === b1.licenceCard.licence ? 'g1' : 'g2');
    // The contract's map has no order; compare as sorted rows.
    const rows = (xs: unknown[][]): string[] => xs.map((x) => x.map(String).join(' ')).sort();
    const books = await breeder.api.readSettlements(
      [b1.licenceCard, b2.licenceCard, b1.licenceCard],
      ['2026-Q4', '2027-Q1'],
    );
    expect(rows(books.found.map((s) => [who(s.licence), s.period, s.units]))).toEqual(
      rows([
        ['g1', '2026-Q4', 20n],
        ['g1', '2027-Q1', 19n],
        ['g2', '2026-Q4', 7n],
      ]),
    );
    // A period the breeder did not list is still reported, without its label.
    const partial = await breeder.api.readSettlements([b1.licenceCard], ['2026-Q4']);
    expect(rows(partial.found.map((s) => [s.period, s.units]))).toEqual(
      rows([
        ['2026-Q4', 20n],
        [undefined, 19n],
      ]),
    );
    // A card whose keys do not make its licence is skipped, and the others are still read.
    const forged = await breeder.api.readSettlements(
      [{ ...b1.licenceCard, viewKey: b2.licenceCard.viewKey }, b2.licenceCard],
      ['2026-Q4'],
    );
    expect(forged.refused[0].why).toMatch(/not the licensee's real card/);
    expect(forged.found.map((s) => who(s.licence))).toEqual(['g2']);

    // A buyer asks g1 to prove a live licence and at least 10 units settled for 2027-Q1.
    // A verifier's requests about one offer share a scope; another verifier's do not.
    const verifier = chain.party();
    const ask = await verifier.api.presentationRequest({ offer, period: '2027-Q1', minUnits: 10n });
    expect((await verifier.api.presentationRequest({ offer })).scope).toBe(ask.scope);
    expect((await chain.party().api.presentationRequest({ offer })).scope).not.toBe(ask.scope);
    await g2.api.topUpOwn(offer, 1n);
    await g1.api.prove(ask);
    expect(hex(chain.ledger.lastPresentation)).toBe(
      hex(
        R.presentationTag(
          offer,
          Buffer.from(ask.period, 'hex'),
          10n,
          BigInt(ask.validAt),
          Buffer.from(ask.scope, 'hex'),
          Buffer.from(ask.challenge, 'hex'),
        ),
      ),
    );
    // Asking for more units than were settled is refused before anything is sent.
    await g2.api.topUpOwn(offer, 1n);
    const tooMany = newPresentationRequest({ contract: ROYALTIES, offer, period: '2027-Q1', minUnits: 20n });
    await expect(g1.api.prove(tooMany)).rejects.toThrow(/fewer units/);

    // Two top-up requests, each paid the same amount, are both recorded.
    const r1 = await g1.api.topUpRequest(offer);
    const r2 = await g1.api.topUpRequest(offer);
    const before = await g1.api.credit(offer);
    await payer.api.payTopUp(r1, 5n);
    await payer.api.payTopUp(r2, 5n);
    await g1.api.claimTopUp(offer, undefined, 5n);
    await g1.api.claimTopUp(offer, undefined, 5n);
    await expect(g1.api.claimTopUp(offer, undefined, 5n)).rejects.toThrow(/already recorded/);
    expect(await g1.api.credit(offer)).toBe(before + 10n);

    // The verifier's revocation check, from the state right after g1's presentation.
    const atProof = chain.ledger;
    expect(revocationVerdict(offer, atProof, chain.ledger)).toEqual({
      gone: false,
      unsealed: false,
      revokedSince: false,
    });
    // The first revocation seals at once (no seal yet); a second within 10 minutes cannot.
    expect((await breeder.api.revokeLicense(b2.license)).sealed).toBe(true);
    expect(revocationVerdict(offer, atProof, chain.ledger).revokedSince).toBe(true);
    expect((await breeder.api.revokeLicense(b1.license)).sealed).toBe(false);
    expect(revocationVerdict(offer, chain.ledger, chain.ledger).unsealed).toBe(true);

    // No call left its input in a store.
    for (const p of [breeder, g1, g2, payer, verifier])
      expect(p.store.get(royaltiesPrivateStateKey)?.input ?? {}).toEqual({});
  });
});
