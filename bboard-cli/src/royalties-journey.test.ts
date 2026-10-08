// The royalties client (api/src/royalties-api.ts) end to end, with no network: every
// transaction runs the real contract in the simulator, each party keeps its own private
// store, and the chain can be told to fail a call or to time out after it landed.
// Breeder, two growers, a payer and a verifier, through offers, top-ups, private
// settlements, a merge, the breeder reading the books, and a presentation.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import { royaltiesPureCircuits as R } from '../../contract/src/royalties.js';
import {
  AlreadyDoneError,
  NIGHT_COLOR,
  chartOf,
  WouldLinkError,
  newPresentationRequest,
  revocationVerdict,
} from '../../api/src/royalties-api.js';
import { royaltiesPrivateStateKey } from '../../api/src/royalties-types.js';
import { as, secret } from '../../contract/src/test/veilcore-simulator.js';
import { Chain, MAIN, ROYALTIES, hex, now } from './royalties-test-chain.js';

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

    // A second purchase from the same offer is refused unless asked for (one that timed out
    // may have landed). One that never lands leaves a licence in g1's store the chain never saw.
    await expect(g1.api.buyLicense(card, MAIN)).rejects.toThrow(AlreadyDoneError);
    chain.failNext = true;
    await expect(g1.api.buyLicense(card, MAIN, { again: true })).rejects.toThrow(/test/);

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
          true,
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

describe('royalties on offspring, through the client', () => {
  it('a parent sets terms, the child links and finalises, and growers pay the ancestor automatically', async () => {
    const chain = new Chain();
    const parent = chain.party();
    const child = chain.party();
    const grower = chain.party();
    const payer = chain.party();
    const P = secret('offspring-parent');
    const K = secret('offspring-child');
    const recP = C.commit(P);
    const recK = C.commit(K);
    chain.main.call(as(P), 'anchor', C.recoveryCommit(secret('offspring-parent-rcv')));
    chain.main.call(as(K), 'anchor', C.recoveryCommit(secret('offspring-child-rcv')));
    const terms = new Uint8Array(32).fill(3);
    const wP = new Uint8Array(32).fill(41);
    const wK = new Uint8Array(32).fill(42);
    const expires = now() + 365n * 86400n;
    const offerTerms = (payTo: Uint8Array) => ({
      terms,
      color: NIGHT_COLOR,
      price: 1000n,
      rate: 4n,
      payTo,
      count: 5n,
      expires,
      revocable: true,
    });

    // The parent's own variety: posting finalises an empty chart, so it can confirm children.
    await parent.api.postOffer(P, offerTerms(wP), MAIN);

    // The parent offers terms for varieties bred from it: 10% for two generations, 25 per licence.
    const card = await parent.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 25n,
      share: 1000n,
      generations: 2n,
      until: expires,
      payTo: wP,
    });

    // The child proposes them. A child that alters them is refused by the parent's client.
    await child.api.proposeLink(K, { ...card, share: '10' });
    await expect(parent.api.confirmLink(P, recK)).rejects.toThrow(/terms you offered/);
    await child.api.withdrawLink(K, recP);
    await child.api.proposeLink(K, card);

    // Parentage in the main contract, then the link, then the child's chart is final.
    chain.main.call(as(K), 'proposeParent', recP);
    chain.main.call(as(P), 'confirmParent', recK);
    await expect(child.api.finaliseStack(K, MAIN)).rejects.toThrow(/still waiting for its parent/);
    await parent.api.confirmLink(P, recK);
    await child.api.finaliseStack(K, MAIN);
    expect(chartOf(chain.ledger, recK).map((p) => [p.generation, p.effectiveShare, p.fee])).toEqual([[1, 1000, 25n]]);

    // The child's offer takes royalties and carries the split.
    const posted = await child.api.postOffer(K, offerTerms(wK), MAIN);
    expect(posted.card.split).toBe(true);

    // A grower buys: the parent gets 10% of the price and its fee, in the same transaction.
    await grower.api.buyLicense(posted.card, MAIN);
    expect(chain.paid(NIGHT_COLOR, wP)).toBe(100n + 25n);
    expect(chain.paid(NIGHT_COLOR, wK)).toBe(900n);

    // A processor tops up the grower's credit: the parent gets 10% of that too.
    const req = await grower.api.topUpRequest(posted.offer);
    await payer.api.payTopUp(req, 200n, MAIN);
    expect(chain.paid(NIGHT_COLOR, wP)).toBe(20n);
    expect(chain.paid(NIGHT_COLOR, wK)).toBe(180n);

    // The credit is ordinary private credit: recorded, then settled privately.
    await grower.api.claimTopUp(posted.offer, undefined, 200n);
    expect(await grower.api.credit(posted.offer)).toBe(200n);
    await grower.api.settle(posted.offer, '2027-Q1', 10n, { evenIfLinkable: true });
    expect(await grower.api.credit(posted.offer)).toBe(160n);
  });

  it('a variety cannot leave out a parent it agreed terms with; a parent with no terms takes nothing', async () => {
    const chain = new Chain();
    const parent = chain.party();
    const child = chain.party();
    const other = chain.party();
    const grower = chain.party();
    const P = secret('hider-parent');
    const K = secret('hider-child');
    const Q = secret('no-terms-child');
    for (const x of [P, K, Q]) chain.main.call(as(x), 'anchor', C.recoveryCommit(secret(`rcv-${hex(x).slice(0, 6)}`)));
    const expires = now() + 365n * 86400n;
    const t = (payTo: Uint8Array) => ({
      terms: new Uint8Array(32).fill(3),
      color: NIGHT_COLOR,
      price: 1000n,
      rate: 4n,
      payTo,
      count: 5n,
      expires,
      revocable: true,
    });
    await parent.api.postOffer(P, t(new Uint8Array(32).fill(51)), MAIN);

    // K agrees 10% with P, both confirm. K cannot finalise a chart that leaves P out: the
    // contract demands every confirmed link.
    const card = await parent.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 0n,
      share: 1000n,
      generations: 1n,
      until: expires,
      payTo: new Uint8Array(32).fill(51),
    });
    await child.api.proposeLink(K, card);
    await parent.api.confirmLink(P, C.commit(K));
    chain.main.call(as(K), 'proposeParent', C.commit(P));
    chain.main.call(as(P), 'confirmParent', C.commit(K));
    const raw = child.api as unknown as {
      call: (
        n: string,
        i: unknown,
        f: (c: { callTx: Record<string, (...a: unknown[]) => unknown> }) => unknown,
      ) => Promise<unknown>;
    };
    const none = new Uint8Array(32);
    await expect(
      raw.call('finaliseStack', { recordSecret: K }, (c) => c.callTx.finaliseStack(none, none)),
    ).rejects.toThrow(/Name every confirmed link/);
    await child.api.finaliseStack(K, MAIN);
    const linked = await child.api.postOffer(K, t(new Uint8Array(32).fill(52)), MAIN);
    await grower.api.buyLicense(linked.card, MAIN);
    expect(chain.paid(NIGHT_COLOR, new Uint8Array(32).fill(51))).toBe(100n);

    // Q's parentage is confirmed with no terms at all: shown as taking nothing, not refused.
    chain.main.call(as(Q), 'proposeParent', C.commit(P));
    chain.main.call(as(P), 'confirmParent', C.commit(Q));
    // Q's own client finalises without a link to P (P set no terms), with a warning, not a refusal.
    await other.api.finaliseStack(Q, MAIN);
    const plain = await other.api.postOffer(Q, t(new Uint8Array(32).fill(53)), MAIN);
    const ped = await grower.api.pedigreeIn(MAIN, C.commit(Q));
    expect(ped.ok && ped.warnings.some((w) => /takes nothing/.test(w))).toBe(true);
    await grower.api.buyLicense(plain.card, MAIN);
  });
});
