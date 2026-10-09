// Protocol 4 through the real client and menu: the breeder issues licences and credit for
// payments made off chain, in the offer's own unit, and nothing passes through the contract.
// First the preprod run (docs/royalties-preprod-run.md) as the menu walks it, prompt by
// prompt; then each attack on the flow, run against the client.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- fakes */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import { royaltiesPureCircuits as R, unitOf } from '../../contract/src/royalties.js';
import {
  AlreadyDoneError,
  type LicenceCard,
  type OfferCard,
  RoyaltiesAPI,
  candidateWarning,
  issueCandidates,
  licenceFingerprint,
  newPresentationRequest,
} from '../../api/src/royalties-api.js';
import { royaltiesPrivateStateKey } from '../../api/src/royalties-types.js';
import { as, secret } from '../../contract/src/test/veilcore-simulator.js';
import { type RoyaltiesMenuContext, handleRoyaltiesChoice } from './royalties-menu.js';
import { Chain, MAIN, ROYALTIES, hex, now } from './royalties-test-chain.js';

const tmp = mkdtempSync(path.join(tmpdir(), 'vc-royalties-credit-'));
let files = 0;
const file = (name: string, v: unknown): string => {
  const p = path.join(tmp, `${files++}-${name}`);
  writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
  return p;
};
const fresh = (name: string): string => path.join(tmp, `${files++}-${name}`);
const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

/** Drive the royalties menu with scripted answers; every log line is kept. */
const menu = (
  api: RoyaltiesAPI,
  answers: string[],
  o: { record?: Uint8Array } = {},
): { ctx: RoyaltiesMenuContext; said: () => string; left: () => number } => {
  const lines: string[] = [];
  const push = (m: unknown) => void lines.push(typeof m === 'string' ? m : JSON.stringify(m));
  const logger = { info: push, warn: push, error: push, debug: push } as unknown as Logger;
  const ctx: RoyaltiesMenuContext = {
    rli: { question: async (q: string) => (lines.push(`? ${q}`), answers.shift() ?? '') } as unknown as Interface,
    logger,
    providers: undefined,
    indexerUri: 'http://indexer.invalid/graphql',
    hidden: async () => '',
    during: <T>(f: () => Promise<T>) => f(),
    mainAddress: MAIN,
    recordSecret: async () => o.record,
    api,
  };
  return { ctx, said: () => lines.join('\n'), left: () => answers.length };
};

const anchor = (chain: Chain, s: Uint8Array): void =>
  void chain.main.call(as(s), 'anchor', C.recoveryCommit(secret(`rcv-${hex(s).slice(0, 8)}`)));

const UNIT = 'USD cents';
const offerTerms = (extra: object = {}) => ({
  terms: new Uint8Array(32).fill(7),
  unit: UNIT,
  price: 1000n,
  rate: 4n,
  count: 10n,
  expires: now() + 365n * 86400n,
  revocable: true,
  ...extra,
});

/** A breeder with an offer, and a grower whose licence the breeder issued. */
const issued = async () => {
  const chain = new Chain();
  const breeder = chain.party();
  const grower = chain.party();
  const B = secret('cr-breeder');
  anchor(chain, B);
  const posted = await breeder.api.postOffer(B, offerTerms(), MAIN);
  const req = await grower.api.requestLicence(posted.card, MAIN);
  await breeder.api.issueLicence(req.licenceCard);
  return { chain, breeder, grower, B, posted, offer: posted.offer, card: posted.card, licence: req };
};

/** A top-up request as the grower hands it over (without the nonce and fingerprint it keeps). */
const requestOf = async (api: RoyaltiesAPI, offer: Uint8Array) => {
  const { nonce: _n, fingerprint: _f, ...req } = await api.topUpRequest(offer);
  void _n;
  void _f;
  return req;
};

/**
 * A parent breeder (P) and a variety bred from it (K) whose chart names P at 10% of its
 * licence prices and credit, plus a fee of 10 per licence, all in USD cents.
 */
const family = async (chain: Chain) => {
  const A = chain.party(); // the parent breeder
  const Bw = chain.party(); // the new variety's breeder
  const P = secret(`fam-parent-${chain.n}`);
  const K = secret(`fam-child-${chain.n}`);
  anchor(chain, P);
  anchor(chain, K);
  // The parent's own chart is final (none here), as it is once it has posted an offer.
  await A.api.finaliseStack(P, MAIN);
  const termsCard = await A.api.linkTerms(P, {
    unit: UNIT,
    fee: 10n,
    share: 1000n,
    generations: 2n,
    until: now() + 30n * 86400n,
    child: C.commit(K),
  });
  chain.main.call(as(K), 'proposeParent', C.commit(P));
  await Bw.api.proposeLink(K, termsCard, MAIN);
  await A.api.confirmLink(P, C.commit(K));
  chain.main.call(as(P), 'confirmParent', C.commit(K));
  await Bw.api.finaliseStack(K, MAIN);
  return { A, Bw, P, K };
};

/** A fake indexer that returns the royalties state right now as the presentation `txId`. */
const indexerShowsNow = (chain: Chain): void => {
  const cs = new ContractState();
  cs.data = chain.ctx.currentQueryContext.state;
  const stateHex = Buffer.from(cs.serialize()).toString('hex');
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => ({
      data: {
        transactions: [
          {
            identifiers: ['abcd'],
            transactionResult: { status: 'SUCCESS' },
            contractActions: [{ address: ROYALTIES, state: stateHex, entryPoint: 'proveLicense' }],
          },
        ],
      },
    }),
  }));
};

const raw = (api: RoyaltiesAPI, circuit: string, input: object, f: (c: any) => Promise<any>) =>
  (api as any).call(circuit, input, f);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the preprod run, as the menu walks it (docs/royalties-preprod-run.md)', () => {
  it('post, ask for a licence, issue it, ask for credit, issue it, record, settle, read the books', async () => {
    const chain = new Chain();
    const A = chain.party(); // breeder, window A
    const Bw = chain.party(); // grower, window B
    const breederRecord = secret('pp-breeder');
    const growerRecord = secret('pp-grower');
    anchor(chain, breederRecord);
    anchor(chain, growerRecord);
    const terms = file('test-terms.txt', 'TEST licence terms, preprod only\n');
    const offerCard = fresh('offer-card.json');

    // Step 3, 53: terms file; unit USD cents; list price 100; royalty 10; 3 licences; 30 days;
    // revoke y; offer card; yes.
    const s53 = menu(A.api, [terms, 'USD cents', '100', '10', '3', '30', 'y', offerCard, 'yes'], {
      record: breederRecord,
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleRoyaltiesChoice('53', s53.ctx);
    expect(s53.left()).toBe(0);
    expect(s53.said()).toMatch(/Growers pay you off chain, in USD cents; you issue their licences and credit/);
    expect(s53.said()).toMatch(/royalty rate \(10 USD cents per unit of produce\)/);
    expect(s53.said()).not.toMatch(/wallet|on chain\?/i);
    const card = read<OfferCard>(offerCard);
    // The unit is committed in the offer: the card and the chain name the same one.
    expect(card.unit).toBe(hex(unitOf('USD cents')));
    expect(Object.keys(card)).not.toContain('payTo');
    const offer = card.offer;
    const before = chain.n;

    // Step 4 (window B): 54 shows the offer; 84 writes the licence card and its fingerprint.
    const s54 = menu(Bw.api, []);
    await handleRoyaltiesChoice('54', s54.ctx);
    expect(s54.said()).toMatch(/amounts in USD cents; list price 100 USD cents/);
    expect(s54.said()).toMatch(/paid off chain; the breeder issues licences and credit/);
    const licenceCard = fresh('licence-card.json');
    const s84 = menu(Bw.api, [offerCard, licenceCard, 'yes']);
    await handleRoyaltiesChoice('84', s84.ctx);
    expect(s84.left()).toBe(0);
    expect(s84.said()).toMatch(/Royalty rate in your offer card: 10 USD cents per unit of produce/);
    expect(s84.said()).toMatch(/Licence card written/);
    const growerFp = /its fingerprint: ([0-9a-f]{8})/.exec(s84.said())?.[1];
    expect(growerFp).toBe(licenceFingerprint(read<LicenceCard>(licenceCard).licence));
    expect(chain.n).toBe(before); // no transaction
    // No licence is live yet: a top-up request needs one.
    await expect(handleRoyaltiesChoice('60', menu(Bw.api, [offer, fresh('topup.json')]).ctx)).rejects.toThrow(
      /holds no live licence/,
    );

    // Step 5 (window A): 82 shows the same fingerprint and issues the licence; then 60, then 83.
    const s82 = menu(A.api, [licenceCard, 'yes']);
    await handleRoyaltiesChoice('82', s82.ctx);
    expect(s82.left()).toBe(0);
    expect(s82.said()).toContain(`Licence card fingerprint ${growerFp}`);
    expect(s82.said()).toMatch(/Issued\./);
    expect(chain.lastSpends).toEqual([]);
    const req = fresh('topup.json');
    const s60b = menu(Bw.api, [offer, req]);
    await handleRoyaltiesChoice('60', s60b.ctx);
    const fp = /fingerprint: ([0-9a-f]{8})/.exec(s60b.said())?.[1];
    expect(fp).toBeDefined();
    // 83: request; amount 100; yes. The only offer that has issued licences: it says so.
    const s83 = menu(A.api, [req, '100', 'yes']);
    await handleRoyaltiesChoice('83', s83.ctx);
    expect(s83.left()).toBe(0);
    expect(s83.said()).toContain(`Code fingerprint ${fp}`);
    expect(s83.said()).toMatch(/names neither the offer, the licensee nor the amount/);
    expect(s83.said()).toMatch(/there are 1 of those on this contract/);
    expect(s83.said()).toMatch(/WARNING: yours is the only offer on this contract that has issued licences/);
    expect(s83.said()).toMatch(/Issue 100 USD cents of credit to this request\?/);
    expect(s83.said()).toMatch(/Issued\. Transaction/);
    expect(s83.said()).toMatch(/Issued on this offer from this computer so far: 100 USD cents in 1 issuance\(s\)/);
    expect(chain.lastSpends).toEqual([]);

    // The breeder takes a licence and credit of its own, so the grower's settlement is not the newest.
    const own = fresh('breeder-licence.json');
    await handleRoyaltiesChoice('84', menu(A.api, [offerCard, own, 'yes']).ctx);
    await handleRoyaltiesChoice('82', menu(A.api, [own, 'yes']).ctx);
    const ownReq = fresh('breeder-topup.json');
    await handleRoyaltiesChoice('60', menu(A.api, [offer, ownReq]).ctx);
    await handleRoyaltiesChoice('83', menu(A.api, [ownReq, '30', 'yes']).ctx);
    await handleRoyaltiesChoice('61', menu(A.api, [offer, '30']).ctx);

    // Step 6 (window B): 61 records 100; 62 settles TEST-1 for 5 units; 63 shows it.
    const s61 = menu(Bw.api, [offer, '100']);
    await handleRoyaltiesChoice('61', s61.ctx);
    expect(s61.said()).toMatch(/Amount the breeder issued \(whole USD cents\)/);
    expect(s61.said()).toMatch(/credit: 100 USD cents/);
    const s62 = menu(Bw.api, [offer, 'TEST-1', '5', 'yes']);
    await handleRoyaltiesChoice('62', s62.ctx);
    expect(s62.left()).toBe(0);
    expect(s62.said()).toMatch(/Settled\./);
    const s63 = menu(Bw.api, []);
    await handleRoyaltiesChoice('63', s63.ctx);
    expect(s63.said()).toMatch(/credit 50 USD cents/);
    expect(s63.said()).toMatch(/licence .*: live/);
    expect(s63.said()).toMatch(/settled TEST-1: 5/);

    // Step 7 (window A): 55 reads TEST-1 for 5 units, and its own books.
    const s55 = menu(A.api, [licenceCard, 'TEST-1']);
    await handleRoyaltiesChoice('55', s55.ctx);
    expect(s55.said()).toMatch(/period TEST-1 {2}units 5/);
    expect(s55.said()).toMatch(/settled 5 unit\(s\), worth 50 USD cents; this computer issued 130 USD cents/);
    expect(s55.said()).not.toMatch(/WARNING/);

    // Steps 8 to 14: a licence request, answered (send anyway), checked, revoked, refused.
    const request = fresh('request.json');
    await handleRoyaltiesChoice('66', menu(A.api, [offer, 'TEST-1', '3', '', '', request]).ctx);
    const s64 = menu(Bw.api, [request, 'yes', 'yes']);
    await handleRoyaltiesChoice('64', s64.ctx);
    expect(s64.left()).toBe(0);
    expect(s64.said()).toMatch(/Send it anyway\?[\s\S]*Answered\./);
    indexerShowsNow(chain);
    const s67 = menu(A.api, [request, 'abcd']);
    await handleRoyaltiesChoice('67', s67.ctx);
    expect(s67.said()).toMatch(/The variety's pedigree matches the VeilCore contract[\s\S]*ACCEPTED\./);
    const s57 = menu(A.api, [read<LicenceCard>(licenceCard).licence, 'yes']);
    await handleRoyaltiesChoice('57', s57.ctx);
    expect(s57.said()).toMatch(/Revoked and sealed/);
    const request2 = fresh('request2.json');
    await handleRoyaltiesChoice('66', menu(A.api, [offer, 'TEST-1', '3', '', '', request2]).ctx);
    await expect(handleRoyaltiesChoice('64', menu(Bw.api, [request2, 'yes']).ctx)).rejects.toThrow(
      /No licence from that offer is held here that is live/,
    );

    // Nothing moved through the contract at any step.
    expect(chain.lastSpends).toEqual([]);
    expect(chain.ledger.issueSeq).toBe(2n);
  });

  it('part 2: a variety bred from yours records what its licences and credit owe you (85, 73)', async () => {
    const chain = new Chain();
    const { A, Bw, P, K } = await family(chain);
    const card2 = fresh('offer-card-2.json');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleRoyaltiesChoice(
      '53',
      menu(Bw.api, [file('t2.txt', 'terms 2'), 'USD cents', '100', '10', '3', '30', 'y', card2, 'yes'], {
        record: K,
      }).ctx,
    );
    const offer2 = read<OfferCard>(card2);
    expect(offer2.split).toBe(true);

    // Window A asks for a licence; window B issues it, and is shown what it records as owed.
    const lc2 = fresh('licence-card-2.json');
    await handleRoyaltiesChoice('84', menu(A.api, [card2, lc2, 'yes']).ctx);
    const s82 = menu(Bw.api, [lc2, 'yes']);
    await handleRoyaltiesChoice('82', s82.ctx);
    expect(s82.said()).toMatch(/records on chain that you owe them/);
    expect(s82.said()).toMatch(/parent .*: 10% \(about 10 USD cents\) \+ fee 10 USD cents/);
    expect(chain.lastSpends).toEqual([]);

    // Credit on it names the offer and records the parent's share.
    const req2 = fresh('topup-2.json');
    await handleRoyaltiesChoice('60', menu(A.api, [offer2.offer, req2]).ctx);
    const s83 = menu(Bw.api, [req2, '100', 'yes']);
    await handleRoyaltiesChoice('83', s83.ctx);
    expect(s83.said()).toMatch(/names the offer and the amount on chain/);
    expect(s83.said()).toMatch(/Issued\./);

    // The parent sees what is owed to it: 10 + 10 for the licence, 10 for the credit.
    const s85 = menu(A.api, [''], { record: P });
    await handleRoyaltiesChoice('85', s85.ctx);
    expect(s85.said()).toMatch(/30 USD cents \(1 licence\(s\), 1 credit issuance\(s\)\)/);
    const s73 = menu(A.api, [hex(C.commit(K))]);
    await handleRoyaltiesChoice('73', s73.ctx);
    expect(s73.said()).toMatch(/Pedigree: matches the VeilCore contract/);
    expect(s73.said()).toMatch(/Recorded as owed to its ancestors[\s\S]*parent .*30 USD cents/);
  });
});

describe('the flow through the client: attacks and guards', () => {
  it('no way to pay through the contract is left: no client call, no menu choice', async () => {
    const { chain, breeder, grower } = await issued();
    for (const gone of ['buyLicense', 'payTopUp', 'topUpOwn', 'movePayee', 'paymentPreview'])
      expect((breeder.api as any)[gone]).toBeUndefined();
    const before = chain.n;
    for (const choice of ['58', '59', '65', '74']) {
      const m = menu(grower.api, ['x', 'x', 'x']);
      expect(await handleRoyaltiesChoice(choice, m.ctx)).toBe(false);
    }
    expect(chain.n).toBe(before);
  });

  it("a forged licence card, another contract's, or one for an offer this computer does not run is refused", async () => {
    const { chain, breeder, card } = await issued();
    const g2 = chain.party();
    const { licenceCard } = await g2.api.requestLicence(card, MAIN);
    const before = chain.n;
    const other = chain.party();
    await expect(breeder.api.issueLicence({ ...licenceCard, viewKey: 'ab'.repeat(32) })).rejects.toThrow(
      /not the licensee's real card/,
    );
    await expect(breeder.api.issueLicence({ ...licenceCard, contract: 'cd'.repeat(32) })).rejects.toThrow(
      /another royalties contract/,
    );
    await expect(other.api.issueLicence(licenceCard)).rejects.toThrow(/holds no admin secret/);
    expect(chain.n).toBe(before);
    await breeder.api.issueLicence(licenceCard);
    // Twice is refused: it is already on chain.
    await expect(breeder.api.issueLicence(licenceCard)).rejects.toThrow(AlreadyDoneError);
  });

  it('a licence card swapped on the way shows a different fingerprint in 82 than the licensee read out in 84', async () => {
    const { chain, card } = await issued();
    const breeder = chain.party();
    await breeder.api.keepOfferCard(card);
    const g = chain.party();
    const offerFile = file('offer.json', card);
    const mine = fresh('mine.json');
    const s84 = menu(g.api, [offerFile, mine, 'yes']);
    await handleRoyaltiesChoice('84', s84.ctx);
    const said = /its fingerprint: ([0-9a-f]{8})/.exec(s84.said())?.[1];
    // An attacker swaps in its own licence card.
    const thief = chain.party();
    const theirs = (await thief.api.requestLicence(card, MAIN)).licenceCard;
    const s82 = menu(breeder.api, [file('swapped.json', theirs), 'no']);
    await handleRoyaltiesChoice('82', s82.ctx);
    const shown = /Licence card fingerprint ([0-9a-f]{8})/.exec(s82.said())?.[1];
    expect(said).toBeDefined();
    expect(shown).toBeDefined();
    expect(shown).not.toBe(said);
    expect(s82.said()).toMatch(/If it differs, the card was changed on the way\. Do not issue\./);
    expect(s82.said()).toMatch(/Nothing was sent/);
  });

  it('only the computer holding the issuer key issues credit; a licensee cannot issue its own', async () => {
    const { chain, grower, offer } = await issued();
    const req = await requestOf(grower.api, offer);
    const before = chain.n;
    await expect(grower.api.issueCredit(req, 100n)).rejects.toThrow(/holds no credit issuer key/);
    await expect(chain.party().api.issueCredit(req, 100n)).rejects.toThrow(/holds no credit issuer key/);
    expect(chain.n).toBe(before);
    expect(chain.ledger.issueSeq).toBe(0n);
  });

  it('double issuance: the same request and amount is refused, also after a timeout that landed', async () => {
    const { chain, breeder, grower, offer } = await issued();
    const req = await requestOf(grower.api, offer);
    chain.timeoutAfterLanding = true;
    await expect(breeder.api.issueCredit(req, 100n)).rejects.toThrow(/timed out/);
    const before = chain.n;
    await expect(breeder.api.issueCredit(req, 100n)).rejects.toThrow(
      /already on chain[\s\S]*ask the licensee for a new request/,
    );
    expect(chain.n).toBe(before);
    await grower.api.claimTopUp(offer, undefined, 100n);
    await expect(grower.api.claimTopUp(offer, undefined, 100n)).rejects.toThrow(/already recorded/);
    expect(await grower.api.credit(offer)).toBe(100n);
  });

  it('a request for another offer is credit on that offer: it settles nothing on this one', async () => {
    const { chain, breeder, grower, offer, B } = await issued();
    // The same breeder's second offer, and a licence on it for the grower.
    const second = await breeder.api.postOffer(B, offerTerms({ price: 2000n }), MAIN);
    const lic2 = await grower.api.requestLicence(second.card, MAIN);
    await breeder.api.issueLicence(lic2.licenceCard);
    const req = await requestOf(grower.api, second.offer);
    await breeder.api.issueCredit(req, 100n);
    await grower.api.claimTopUp(second.offer, undefined, 100n);
    expect(await grower.api.credit(offer)).toBe(0n);
    await expect(grower.api.settle(offer, 'P', 1n, { evenIfLinkable: true })).rejects.toThrow(/does not cover/);
    expect(chain.ledger.settleSeq).toBe(0n);
  });

  it('the unit is part of the offer: a card edited to another unit is refused, and amounts are typed in it', async () => {
    const { chain, card, offer, grower } = await issued();
    const g = chain.party();
    await expect(g.api.requestLicence({ ...card, unit: hex(unitOf('EUR cents')) }, MAIN)).rejects.toThrow(
      /does not match|not the offer/,
    );
    // Whole USD cents only: a decimal is refused before anything is sent.
    const before = chain.n;
    const s61 = menu(grower.api, [hex(offer), '1.5']);
    await handleRoyaltiesChoice('61', s61.ctx);
    expect(s61.said()).toMatch(/That is not a whole number of USD cents\. Nothing was sent\./);
    expect(chain.n).toBe(before);
    // A unit that is not plain text is refused at post.
    const B = secret('cr-unit');
    anchor(chain, B);
    const s53 = menu(grower.api, [file('t.txt', 'x'), 'USD cents'], { record: B });
    await handleRoyaltiesChoice('53', s53.ctx);
    expect(s53.said()).toMatch(/A unit is plain printable text[\s\S]*Nothing was sent/);
    expect(chain.n).toBe(before);
  });

  it('NIGHT is only a label: an offer counted in NIGHT shows and takes 6 decimals, and still moves nothing', async () => {
    const chain = new Chain();
    const breeder = chain.party();
    const grower = chain.party();
    const B = secret('cr-night');
    anchor(chain, B);
    const out = fresh('night-card.json');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const s53 = menu(breeder.api, [file('t.txt', 'night'), 'NIGHT', '1', '0.1', '3', '30', 'y', out, 'yes'], {
      record: B,
    });
    await handleRoyaltiesChoice('53', s53.ctx);
    expect(s53.left()).toBe(0);
    expect(s53.said()).toMatch(/list price of 1\.000000 NIGHT/);
    const card = read<OfferCard>(out);
    expect(card.rate).toBe('100000');
    const s54 = menu(grower.api, []);
    await handleRoyaltiesChoice('54', s54.ctx);
    expect(s54.said()).toMatch(/amounts in NIGHT; list price 1\.000000 NIGHT/);
    const lc = fresh('lc.json');
    const s84 = menu(grower.api, [out, lc, 'yes']);
    await handleRoyaltiesChoice('84', s84.ctx);
    expect(s84.said()).toMatch(/Royalty rate in your offer card: 0\.100000 NIGHT per unit of produce/);
    await handleRoyaltiesChoice('82', menu(breeder.api, [lc, 'yes']).ctx);
    const req = fresh('req.json');
    await handleRoyaltiesChoice('60', menu(grower.api, [card.offer, req]).ctx);
    const s83 = menu(breeder.api, [req, '0.5', 'yes']);
    await handleRoyaltiesChoice('83', s83.ctx);
    expect(s83.said()).toMatch(/Issue 0\.500000 NIGHT of credit/);
    expect(chain.lastSpends).toEqual([]);
    const s61 = menu(grower.api, [card.offer, '0.5']);
    await handleRoyaltiesChoice('61', s61.ctx);
    expect(s61.said()).toMatch(/credit: 0\.500000 NIGHT/);
  });

  it('the issuance warning counts the offers it could be from: issued licences and a royalty rate', async () => {
    const { chain, breeder, grower, offer } = await issued();
    expect(issueCandidates(chain.ledger)).toBe(1);
    expect((await breeder.api.issuePreview(offer)).warning).toMatch(/yours is the only offer/);
    // Offers without a licence issued, or without a royalty, do not count.
    const add = async (name: string, extra: object, licence: boolean) => {
      const b = chain.party();
      const S = secret(name);
      anchor(chain, S);
      const p = await b.api.postOffer(S, offerTerms(extra), MAIN);
      if (licence) await b.api.issueLicence((await chain.party().api.requestLicence(p.card, MAIN)).licenceCard);
    };
    await add('cand-unsold', {}, false);
    await add('cand-norate', { rate: 0n }, true);
    expect(issueCandidates(chain.ledger)).toBe(1);
    await add('cand-2', {}, true);
    expect(issueCandidates(chain.ledger)).toBe(2);
    expect((await breeder.api.issuePreview(offer)).warning).toMatch(/only 2 offers on this contract/);
    await add('cand-3', {}, true);
    await add('cand-4', {}, true);
    expect(issueCandidates(chain.ledger)).toBe(4);
    expect(candidateWarning(4)).toBeUndefined();
    const req = await requestOf(grower.api, offer);
    const s83 = menu(breeder.api, [file('req.json', req), '100', 'yes']);
    await handleRoyaltiesChoice('83', s83.ctx);
    expect(s83.said()).toMatch(/there are 4 of those on this contract/);
    expect(s83.said()).not.toMatch(/WARNING/);
    expect(s83.said()).toMatch(/Issued\./);
  });

  it('an issuance whose issuer root a seal retired on the way is proved again once, and lands', async () => {
    const { chain, breeder, grower, offer } = await issued();
    const other = chain.party();
    const O = secret('cr-other2');
    anchor(chain, O);
    const theirs = await other.api.postOffer(O, offerTerms(), MAIN);
    const req = await requestOf(grower.api, offer);
    let sealed = false;
    chain.beforeLanding = async () => {
      sealed = (await other.api.changeCreditIssuer(theirs.offer)).sealed;
    };
    await breeder.api.issueCredit(req, 100n);
    expect(sealed).toBe(true);
    expect(chain.ledger.issueSeq).toBe(1n);
  });

  it('a replaced issuer key: the old computer can no longer issue; the new one can', async () => {
    const { chain, breeder, grower, offer, posted } = await issued();
    const laptop = chain.party();
    // The admin, on paper, names a new issuer from another computer.
    const r = await laptop.api.changeCreditIssuer(offer, posted.adminSecret);
    expect(r.sealed).toBe(true);
    const req = await requestOf(grower.api, offer);
    await expect(breeder.api.issueCredit(req, 100n)).rejects.toThrow(/holds no credit issuer key/);
    await laptop.api.keepOfferCard(posted.card);
    await laptop.api.issueCredit(req, 100n);
    expect(chain.ledger.issueSeq).toBe(1n);
  });

  it('a replaced key waiting for its seal: 86 says when; the next royalties choice once due sends the seal', async () => {
    const { chain, breeder, offer } = await issued();
    // The first change is sealed at once; a second within the hour has to wait.
    expect((await breeder.api.changeCreditIssuer(offer)).sealed).toBe(true);
    const s86 = menu(breeder.api, [hex(offer), 'yes']);
    await handleRoyaltiesChoice('86', s86.ctx);
    expect(s86.said()).toMatch(/can still issue until a seal is sent/);
    expect(s86.said()).toMatch(/The old key can still issue until a seal is sent: run 68 from 20\d\d-/);
    expect(chain.ledger.issuerChanges).toBe(true);
    const at = await breeder.api.issuerChangeSealableAt();
    expect(at).toBeDefined();
    // Before it is due, a royalties choice sends nothing.
    const before = chain.n;
    await handleRoyaltiesChoice('54', menu(breeder.api, []).ctx);
    expect(chain.n).toBe(before);
    expect(chain.ledger.issuerChanges).toBe(true);
    // Once due, any royalties choice (here 54, which reads only) sends the seal first.
    const real = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => Math.max(real, Number(at!) * 1000) + 120_000);
    const s54 = menu(breeder.api, []);
    await handleRoyaltiesChoice('54', s54.ctx);
    expect(s54.said()).toMatch(/Sealed: a replaced credit issuer key can no longer issue/);
    expect(chain.ledger.issuerChanges).toBe(false);
    expect(chain.n).toBe(before + 1);
  });

  it('55 warns when more was settled than this computer issued (credit from elsewhere: maybe a stolen issuer key)', async () => {
    const { breeder, grower, offer, posted, licence } = await issued();
    const req = await requestOf(grower.api, offer);
    // Issued around this computer's books (as a thief holding the key would).
    const issuer = Buffer.from(
      ((await breeder.api.held()).issuerKeys ?? []).find((k) => k.offer === hex(offer))!.secret,
      'hex',
    );
    const op = {
      offer,
      unit: Buffer.from(posted.card.unit, 'hex'),
      rateCommit: Buffer.from(posted.card.rateCommit, 'hex'),
      expires: BigInt(posted.card.expires),
      split: false,
    };
    await raw(
      breeder.api,
      'issueCredit',
      { issuerSecret: issuer, opening: op, code: Buffer.from(req.code, 'hex'), amount: 400n },
      (c) => c.callTx.issueCredit(),
    );
    await grower.api.claimTopUp(offer, undefined, 400n);
    await grower.api.settle(offer, 'Q1', 50n, { evenIfLinkable: true });
    const s55 = menu(breeder.api, [file('lc.json', licence.licenceCard), 'Q1']);
    await handleRoyaltiesChoice('55', s55.ctx);
    expect(s55.said()).toMatch(/worth 200 USD cents; this computer issued 0 USD cents/);
    expect(s55.said()).toMatch(/WARNING: more was settled than this computer issued/);
  });

  it('85 finds what is owed to you by identity: after a key change in the VeilCore contract, the new record sees it', async () => {
    const chain = new Chain();
    const { A, Bw, P, K } = await family(chain);
    const posted = await Bw.api.postOffer(K, offerTerms({ price: 100n }), MAIN);
    expect(posted.card.split).toBe(true);
    await Bw.api.issueLicence((await A.api.requestLicence(posted.card, MAIN)).licenceCard);
    // The parent moves to a new record secret in the main contract.
    const P2 = secret('fam-parent-rotated');
    chain.main.call(as(P, { incoming: P2 }), 'rotateRecordSecret', C.commit(P2));
    // Matched by the record alone, the new record is owed nothing; through the main contract, it is.
    expect(await A.api.owed({ parent: C.commit(P2) })).toEqual([]);
    const rows = await A.api.owed({ parent: C.commit(P2), mainAddress: MAIN });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.parent === hex(C.commit(P)))).toBe(true);
    // Each row keeps the base amount and the weight: due is exact.
    expect(rows.find((r) => r.kind === 'licence')?.total).toBe(100n);
    const s85 = menu(A.api, [''], { record: P2 });
    await handleRoyaltiesChoice('85', s85.ctx);
    expect(s85.said()).toMatch(/20 USD cents \(1 licence\(s\), 0 credit issuance\(s\)\)/);
  });

  it('asking twice for a licence is refused unless asked; 78 writes the waiting card again', async () => {
    const { chain, card, offer } = await issued();
    const g = chain.party();
    const first = await g.api.requestLicence(card, MAIN);
    await expect(g.api.requestLicence(card, MAIN)).rejects.toThrow(AlreadyDoneError);
    const out = fresh('again.json');
    await handleRoyaltiesChoice('78', menu(g.api, [hex(offer), out]).ctx);
    expect(read<LicenceCard>(out)).toEqual(first.licenceCard);
  });

  it('a verifier checks a licence and settlement made from issued credit, as any other', async () => {
    const { chain, breeder, grower, offer } = await issued();
    const req = await requestOf(grower.api, offer);
    await breeder.api.issueCredit(req, 100n);
    await grower.api.claimTopUp(offer, undefined, 100n);
    await grower.api.settle(offer, '2027-Q1', 20n, { evenIfLinkable: true });
    const ask = newPresentationRequest({ contract: ROYALTIES, offer, period: '2027-Q1', minUnits: 10n });
    await grower.api.prove(ask, { evenIfLinkable: true });
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
    for (const p of [breeder, grower]) expect(p.store.get(royaltiesPrivateStateKey)?.input ?? {}).toEqual({});
  });
});
