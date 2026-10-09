// The royalties client (api/src/royalties-api.ts) end to end, with no network: every
// transaction runs the real contract in the simulator, each party keeps its own private
// store, and the chain can be told to fail a call or to time out after it landed.
// Breeder, two growers and a verifier, through offers, licences and credit the breeder
// issues for payments made off chain, private settlements, a merge, the breeder reading
// the books, and a presentation. No money passes through the contract.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import { royaltiesPureCircuits as R, unitOf } from '../../contract/src/royalties.js';
import {
  AlreadyDoneError,
  type OfferCard,
  type RoyaltiesAPI,
  chartOf,
  owedTotal,
  WouldLinkError,
  newPresentationRequest,
  revocationVerdict,
} from '../../api/src/royalties-api.js';
import { royaltiesPrivateStateKey } from '../../api/src/royalties-types.js';
import { as, secret } from '../../contract/src/test/veilcore-simulator.js';
import { Chain, MAIN, ROYALTIES, hex, now } from './royalties-test-chain.js';

type Party = { api: RoyaltiesAPI };
/** The grower asks for a licence; the breeder issues it from the licence card. */
const licensed = async (breeder: Party, grower: Party, card: OfferCard) => {
  const r = await grower.api.requestLicence(card, MAIN);
  await breeder.api.issueLicence(r.licenceCard);
  return r;
};
/** The grower pays off chain and asks for credit; the breeder issues it; the grower records it. */
const fund = async (breeder: Party, grower: Party, offer: Uint8Array, amount: bigint) => {
  const req = await grower.api.topUpRequest(offer);
  await breeder.api.issueCredit(req, amount);
  await grower.api.claimTopUp(offer, req.nonce, amount);
};

describe('the royalties client, end to end on the simulator', () => {
  it('offer, licences and credit issued, settle in private, merge, read the books, present', async () => {
    const chain = new Chain();
    const breeder = chain.party();
    const g1 = chain.party();
    const g2 = chain.party();

    // The breeder's record is anchored in the main contract.
    const record = secret('journey-breeder');
    chain.main.call(as(record), 'anchor', C.recoveryCommit(secret('journey-breeder-rcv')));

    const terms = new Uint8Array(32).fill(7);
    const posted = await breeder.api.postOffer(
      record,
      {
        terms,
        unit: 'USD cents',
        price: 1000n,
        rate: 4n,
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

    const b1 = await licensed(breeder, g1, card);
    const b2 = await licensed(breeder, g2, card);
    await breeder.api.checkLicenceCard(b1.licenceCard);
    // Nothing passed through the contract.
    expect(chain.lastSpends).toEqual([]);

    // A second licence from the same offer is refused unless asked for.
    await expect(g1.api.requestLicence(card, MAIN)).rejects.toThrow(AlreadyDoneError);

    // g1 pays the breeder off chain; the breeder issues credit to g1's request, without
    // learning anything on chain beyond what it already knows. Recorded twice changes nothing.
    const req = await g1.api.topUpRequest(offer);
    await breeder.api.issueCredit(req, 100n);
    await g1.api.claimTopUp(offer, undefined, 100n);
    await expect(g1.api.claimTopUp(offer, undefined, 100n)).rejects.toThrow(/already recorded/);
    expect(await g1.api.credit(offer)).toBe(100n);
    await fund(breeder, g1, offer, 60n);
    expect(await g1.api.credit(offer)).toBe(160n);

    // Rule 2: the latest note is g1's own, so g1 may not settle yet.
    await expect(g1.api.settle(offer, '2026-Q4', 20n)).rejects.toThrow(/credit note is still the newest/);
    await fund(breeder, g2, offer, 50n);

    // Settle 20 units at 4: spends the 100 note, keeps 20 change. The client is told the
    // call timed out after it landed: the change must not be lost.
    chain.timeoutAfterLanding = true;
    await expect(g1.api.settle(offer, '2026-Q4', 20n)).rejects.toThrow(/timed out/);
    expect(await g1.api.credit(offer)).toBe(80n);
    expect(chain.ledger.settleSeq).toBe(1n);

    // 19 units owe 76: no single note covers it (60 and 20), so the client merges first,
    // then waits for someone else (rule 2) before settling.
    await fund(breeder, g2, offer, 10n);
    await expect(g1.api.settle(offer, '2027-Q1', 19n)).rejects.toThrow(/credit was merged/);
    expect(await g1.api.credit(offer)).toBe(80n);
    await fund(breeder, g2, offer, 10n);
    await g1.api.settle(offer, '2027-Q1', 19n);
    expect(await g1.api.credit(offer)).toBe(4n);

    // g2 settles too, so the breeder has two licensees' books to read.
    // g2 bought last, and nobody has bought since: settling now could be guessed to be g2.
    // The client waits by default; g2 may choose to send anyway.
    await fund(breeder, g1, offer, 1n);
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
    await fund(breeder, g2, offer, 1n);
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
    await fund(breeder, g2, offer, 1n);
    const tooMany = newPresentationRequest({ contract: ROYALTIES, offer, period: '2027-Q1', minUnits: 20n });
    await expect(g1.api.prove(tooMany)).rejects.toThrow(/fewer units/);

    // Two top-up requests, each issued the same amount, are both recorded.
    const r1 = await g1.api.topUpRequest(offer);
    const r2 = await g1.api.topUpRequest(offer);
    const before = await g1.api.credit(offer);
    await breeder.api.issueCredit(r1, 5n);
    await breeder.api.issueCredit(r2, 5n);
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
    // The first revocation seals at once (no seal yet); a second within the hour waits for its seal.
    expect((await breeder.api.revokeLicense(b2.license)).sealed).toBe(true);
    expect(revocationVerdict(offer, atProof, chain.ledger).revokedSince).toBe(true);
    expect((await breeder.api.revokeLicense(b1.license)).sealed).toBe(false);
    expect(revocationVerdict(offer, chain.ledger, chain.ledger).unsealed).toBe(true);

    // No call left its input in a store.
    for (const p of [breeder, g1, g2, verifier]) expect(p.store.get(royaltiesPrivateStateKey)?.input ?? {}).toEqual({});
  });
});

describe('royalties on offspring, through the client', () => {
  it('a parent sets terms, the child links and finalises, and every licence and credit records what it owes', async () => {
    const chain = new Chain();
    const parent = chain.party();
    const child = chain.party();
    const grower = chain.party();
    const P = secret('offspring-parent');
    const K = secret('offspring-child');
    const recP = C.commit(P);
    const recK = C.commit(K);
    chain.main.call(as(P), 'anchor', C.recoveryCommit(secret('offspring-parent-rcv')));
    chain.main.call(as(K), 'anchor', C.recoveryCommit(secret('offspring-child-rcv')));
    const terms = new Uint8Array(32).fill(3);
    const expires = now() + 365n * 86400n;
    const offerTerms = {
      terms,
      unit: 'USD cents',
      price: 1000n,
      rate: 4n,
      count: 5n,
      expires,
      revocable: true,
    };

    // The parent's own variety: posting finalises an empty chart, so it can confirm children.
    await parent.api.postOffer(P, offerTerms, MAIN);

    // The parent offers terms for varieties bred from it: 10% for two generations, 25 per licence.
    const card = await parent.api.linkTerms(P, {
      unit: 'USD cents',
      fee: 25n,
      share: 1000n,
      generations: 2n,
      until: expires,
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
    const posted = await child.api.postOffer(K, offerTerms, MAIN);
    expect(posted.card.split).toBe(true);

    // The child issues a grower's licence: 10% of the list price and the fee are recorded as owed.
    await licensed(child, grower, posted.card);
    expect(chain.lastSpends).toEqual([]);
    expect(owedTotal(await parent.api.owed({ parent: recP, mainAddress: MAIN })).get(hex(unitOf('USD cents')))).toBe(
      100n + 25n,
    );

    // Credit issued on it records the parent's 10% too.
    await fund(child, grower, posted.offer, 200n);
    expect(owedTotal(await parent.api.owed({ parent: recP, mainAddress: MAIN })).get(hex(unitOf('USD cents')))).toBe(
      125n + 20n,
    );

    // The credit is ordinary private credit, settled privately.
    expect(await grower.api.credit(posted.offer)).toBe(200n);
    await grower.api.settle(posted.offer, '2027-Q1', 10n, { evenIfLinkable: true });
    expect(await grower.api.credit(posted.offer)).toBe(160n);
  });

  it('a variety cannot leave out a parent it agreed terms with; a parent with no terms is owed nothing', async () => {
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
    const t = {
      terms: new Uint8Array(32).fill(3),
      unit: 'USD cents',
      price: 1000n,
      rate: 4n,
      count: 5n,
      expires,
      revocable: true,
    };
    await parent.api.postOffer(P, t, MAIN);

    // K agrees 10% with P, both confirm. K cannot finalise a chart that leaves P out: the
    // contract demands every confirmed link.
    const card = await parent.api.linkTerms(P, {
      unit: 'USD cents',
      fee: 0n,
      share: 1000n,
      generations: 1n,
      until: expires,
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
    const linked = await child.api.postOffer(K, t, MAIN);
    await licensed(child, grower, linked.card);
    const rows = await parent.api.owed({ parent: C.commit(P), mainAddress: MAIN });
    expect(owedTotal(rows).get(hex(unitOf('USD cents')))).toBe(100n);

    // Q's parentage is confirmed with no terms at all: shown as owing nothing, not refused.
    chain.main.call(as(Q), 'proposeParent', C.commit(P));
    chain.main.call(as(P), 'confirmParent', C.commit(Q));
    // Q's own client finalises without a link to P (P set no terms), with a warning, not a refusal.
    await other.api.finaliseStack(Q, MAIN);
    const plain = await other.api.postOffer(Q, t, MAIN);
    const ped = await grower.api.pedigreeIn(MAIN, C.commit(Q));
    expect(ped.ok && ped.warnings.some((w) => /takes nothing/.test(w))).toBe(true);
    await licensed(other, chain.party(), plain.card);
  });
});
