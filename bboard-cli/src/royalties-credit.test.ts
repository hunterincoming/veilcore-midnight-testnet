// Protocol 4 through the real client and menu: the breeder issues licences and credit for
// payments made off chain, and nothing passes through the contract. First the preprod run
// (docs/royalties-preprod-run.md) as the menu walks it, prompt by prompt; then each attack
// on the new flow, run against the client.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- fakes */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import { royaltiesPureCircuits as R } from '../../contract/src/royalties.js';
import {
  AlreadyDoneError,
  NIGHT_COLOR,
  type LicenceCard,
  type OfferCard,
  RoyaltiesAPI,
  WouldLinkError,
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
  o: { record?: Uint8Array; wallet?: Uint8Array } = {},
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
    ownWallet: () => o.wallet ?? new Uint8Array(32).fill(1),
    api,
  };
  return { ctx, said: () => lines.join('\n'), left: () => answers.length };
};

const anchor = (chain: Chain, s: Uint8Array): void =>
  void chain.main.call(as(s), 'anchor', C.recoveryCommit(secret(`rcv-${hex(s).slice(0, 8)}`)));

const offerTerms = (payTo: Uint8Array, extra: object = {}) => ({
  terms: new Uint8Array(32).fill(7),
  color: NIGHT_COLOR,
  price: 1000n,
  rate: 4n,
  payTo,
  count: 10n,
  expires: now() + 365n * 86400n,
  revocable: true,
  ...extra,
});

/** A breeder with an offer paid off chain, and a grower whose licence the breeder issued. */
const issued = async () => {
  const chain = new Chain();
  const breeder = chain.party();
  const grower = chain.party();
  const B = secret('cr-breeder');
  anchor(chain, B);
  const wB = new Uint8Array(32).fill(9);
  const posted = await breeder.api.postOffer(B, offerTerms(wB), MAIN);
  const req = await grower.api.requestLicence(posted.card, MAIN);
  await breeder.api.issueLicence(req.licenceCard);
  return { chain, breeder, grower, B, wB, posted, offer: posted.offer, card: posted.card, licence: req };
};

const raw = (api: RoyaltiesAPI, circuit: string, input: object, f: (c: any) => Promise<any>) =>
  (api as any).call(circuit, input, f);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the preprod run, as the menu walks it (docs/royalties-preprod-run.md)', () => {
  it('post, ask for a licence, issue it, ask for credit, issue it, record, settle, read the books, check owed', async () => {
    const chain = new Chain();
    const A = chain.party(); // breeder, window A
    const Bw = chain.party(); // grower, window B
    const breederRecord = secret('pp-breeder');
    const growerRecord = secret('pp-grower');
    anchor(chain, breederRecord);
    anchor(chain, growerRecord);
    const terms = file('test-terms.txt', 'TEST licence terms, preprod only\n');
    const offerCard = fresh('offer-card.json');

    // Step 3, 53: terms file; token Enter; list price 1; royalty 0.1; 3; 30 days; revoke y;
    // on chain Enter (no); wallet Enter; offer card; yes.
    const s53 = menu(A.api, [terms, '', '1', '0.1', '3', '30', 'y', '', '', offerCard, 'yes'], {
      record: breederRecord,
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleRoyaltiesChoice('53', s53.ctx);
    expect(s53.left()).toBe(0);
    expect(s53.said()).toMatch(/paid off chain \(you issue licences and credit\)/);
    const card = read<OfferCard>(offerCard);
    expect(card.onChainPayment).toBe(false);
    const offer = card.offer;
    const nightBefore = chain.n;

    // Step 4 (window B): 54 shows the offer is paid off chain; 84 writes the licence card;
    // 60 writes the top-up request and shows its fingerprint.
    const s54 = menu(Bw.api, []);
    await handleRoyaltiesChoice('54', s54.ctx);
    expect(s54.said()).toMatch(/payment: off chain; the breeder issues licences and credit/);
    expect(s54.said()).toMatch(/list price 1\.000000 NIGHT/);
    const licenceCard = fresh('licence-card.json');
    const s84 = menu(Bw.api, [offerCard, licenceCard, 'yes']);
    await handleRoyaltiesChoice('84', s84.ctx);
    expect(s84.left()).toBe(0);
    expect(s84.said()).toMatch(/Royalty rate in your offer card: 0\.100000 NIGHT per unit/);
    expect(s84.said()).toMatch(/Licence card written/);
    expect(chain.n).toBe(nightBefore); // no transaction
    // No licence is live yet: a top-up request needs one.
    await expect(handleRoyaltiesChoice('60', menu(Bw.api, [offer, fresh('topup.json')]).ctx)).rejects.toThrow(
      /holds no live licence/,
    );

    // Step 5 (window A): 82 issues the licence; then the request can be made; 83 issues 1.
    const s82 = menu(A.api, [licenceCard, 'yes']);
    await handleRoyaltiesChoice('82', s82.ctx);
    expect(s82.left()).toBe(0);
    expect(s82.said()).toMatch(/Issued\./);
    expect(chain.lastSpends).toEqual([]);
    const req = fresh('topup.json');
    const s60b = menu(Bw.api, [offer, req]);
    await handleRoyaltiesChoice('60', s60b.ctx);
    const fp = /fingerprint: ([0-9a-f]{8})/.exec(s60b.said())?.[1];
    expect(fp).toBeDefined();
    // 83: request; amount 1; yes; the breeder's own offer is the newest issuer leaf, so it asks: yes.
    const s83 = menu(A.api, [req, '1', 'yes', 'yes']);
    await handleRoyaltiesChoice('83', s83.ctx);
    expect(s83.left()).toBe(0);
    expect(s83.said()).toContain(`Code fingerprint ${fp}`);
    expect(s83.said()).toMatch(/not the offer, the licensee or the amount/);
    expect(s83.said()).toMatch(/Send it anyway\?/);
    expect(s83.said()).toMatch(/Issued\. Transaction/);
    expect(chain.lastSpends).toEqual([]);

    // The breeder takes a licence and credit of its own, so the grower's settlement is not the newest.
    const own = fresh('breeder-licence.json');
    await handleRoyaltiesChoice('84', menu(A.api, [offerCard, own, 'yes']).ctx);
    await handleRoyaltiesChoice('82', menu(A.api, [own, 'yes']).ctx);
    const ownReq = fresh('breeder-topup.json');
    await handleRoyaltiesChoice('60', menu(A.api, [offer, ownReq]).ctx);
    await handleRoyaltiesChoice('83', menu(A.api, [ownReq, '0.3', 'yes', 'yes']).ctx);
    await handleRoyaltiesChoice('61', menu(A.api, [offer, '0.3']).ctx);

    // Step 6 (window B): 61 records 1; 62 settles TEST-1 for 5 units; 63 shows it.
    const s61 = menu(Bw.api, [offer, '1']);
    await handleRoyaltiesChoice('61', s61.ctx);
    expect(s61.said()).toMatch(/credit: 1\.000000 NIGHT/);
    const s62 = menu(Bw.api, [offer, 'TEST-1', '5', 'yes']);
    await handleRoyaltiesChoice('62', s62.ctx);
    expect(s62.left()).toBe(0);
    expect(s62.said()).toMatch(/Settled\./);
    const s63 = menu(Bw.api, []);
    await handleRoyaltiesChoice('63', s63.ctx);
    expect(s63.said()).toMatch(/credit 0\.500000 NIGHT/);
    expect(s63.said()).toMatch(/licence .*: live/);
    expect(s63.said()).toMatch(/settled TEST-1: 5/);

    // Step 7 (window A): 55 reads TEST-1 for 5 units, and its own books.
    const s55 = menu(A.api, [licenceCard, 'TEST-1']);
    await handleRoyaltiesChoice('55', s55.ctx);
    expect(s55.said()).toMatch(/period TEST-1 {2}units 5/);
    expect(s55.said()).toMatch(/settled 5 unit\(s\), worth 0\.500000 NIGHT; this computer issued 1\.300000 NIGHT/);
    expect(s55.said()).not.toMatch(/WARNING/);

    // No NIGHT moved through the contract at any step.
    expect(chain.ledger.topUpSeq).toBe(0n);
    expect(chain.ledger.issueSeq).toBe(2n);
  });

  it('part 2: a variety bred from yours, paid off chain, records what it owes you (85, 73)', async () => {
    const chain = new Chain();
    const A = chain.party(); // the parent breeder
    const Bw = chain.party(); // the new variety's breeder
    const P = secret('pp2-parent');
    const K = secret('pp2-child');
    anchor(chain, P);
    anchor(chain, K);
    const wP = new Uint8Array(32).fill(41);
    await A.api.postOffer(P, offerTerms(wP), MAIN);
    const termsCard = await A.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 100_000n,
      share: 1000n,
      generations: 2n,
      until: now() + 30n * 86400n,
      payTo: wP,
      child: C.commit(K),
    });
    chain.main.call(as(K), 'proposeParent', C.commit(P));
    await Bw.api.proposeLink(K, termsCard, MAIN);
    await A.api.confirmLink(P, C.commit(K));
    chain.main.call(as(P), 'confirmParent', C.commit(K));
    await Bw.api.finaliseStack(K, MAIN);
    const card2 = fresh('offer-card-2.json');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleRoyaltiesChoice(
      '53',
      menu(Bw.api, [file('t2.txt', 'terms 2'), '', '1', '0.1', '3', '30', 'y', '', '', card2, 'yes'], { record: K })
        .ctx,
    );
    const offer2 = read<OfferCard>(card2);
    expect(offer2.split).toBe(true);

    // Window A asks for a licence; window B issues it, and is shown what it records as owed.
    const lc2 = fresh('licence-card-2.json');
    await handleRoyaltiesChoice('84', menu(A.api, [card2, lc2, 'yes']).ctx);
    const s82 = menu(Bw.api, [lc2, 'yes']);
    await handleRoyaltiesChoice('82', s82.ctx);
    expect(s82.said()).toMatch(/records on chain that you owe them/);
    expect(s82.said()).toMatch(/parent .*: 10% \(about 0\.100000 NIGHT\) \+ fee 0\.100000 NIGHT/);
    expect(chain.lastSpends).toEqual([]);

    // Credit on it names the offer and records the parent's share.
    const req2 = fresh('topup-2.json');
    await handleRoyaltiesChoice('60', menu(A.api, [offer2.offer, req2]).ctx);
    const s83 = menu(Bw.api, [req2, '1', 'yes']);
    await handleRoyaltiesChoice('83', s83.ctx);
    expect(s83.said()).toMatch(/names the offer and the amount on chain/);
    expect(s83.said()).toMatch(/Issued\./);

    // The parent sees what is owed to it: 0.1 + 0.1 for the licence, 0.1 for the credit.
    const s85 = menu(A.api, [''], { record: P });
    await handleRoyaltiesChoice('85', s85.ctx);
    expect(s85.said()).toMatch(/0\.300000 NIGHT \(1 licence\(s\), 1 credit issuance\(s\)\)/);
    const s73 = menu(A.api, [hex(C.commit(K))]);
    await handleRoyaltiesChoice('73', s73.ctx);
    expect(s73.said()).toMatch(/Recorded as owed to its ancestors[\s\S]*parent .*0\.300000 NIGHT/);
  });

  it('part 3: an offer that takes payment on chain still sells and tops up through the contract', async () => {
    const chain = new Chain();
    const A = chain.party();
    const Bw = chain.party();
    const B = secret('pp3-breeder');
    anchor(chain, B);
    const wallet = new Uint8Array(32).fill(1);
    const card3 = fresh('offer-card-3.json');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleRoyaltiesChoice(
      '53',
      menu(A.api, [file('t3.txt', 'terms 3'), '', '1', '0.1', '3', '30', 'y', 'y', '', card3, 'yes'], { record: B })
        .ctx,
    );
    expect(read<OfferCard>(card3).onChainPayment).toBe(true);
    const s58 = menu(Bw.api, [card3, fresh('lc3.json'), 'yes']);
    await handleRoyaltiesChoice('58', s58.ctx);
    expect(s58.said()).toMatch(/in all, this sends from this wallet: 1\.000000 NIGHT/);
    expect(chain.paid(NIGHT_COLOR, wallet)).toBe(1_000_000n);
    const offer3 = read<OfferCard>(card3).offer;
    await handleRoyaltiesChoice('59', menu(Bw.api, [offer3, '0.5', 'yes', 'yes']).ctx);
    expect(chain.ledger.topUpSeq).toBe(1n);
    expect(await Bw.api.credit(Buffer.from(offer3, 'hex'))).toBe(500_000n);
  });
});

describe('the new flow through the client: attacks and guards', () => {
  it('an offer paid off chain refuses purchases and paid top-ups before anything is sent', async () => {
    const { chain, card, offer, grower } = await issued();
    const payer = chain.party();
    const before = chain.n;
    await expect(chain.party().api.buyLicense(card, MAIN)).rejects.toThrow(/takes no payment through the contract/);
    await expect(grower.api.topUpOwn(offer, 10n)).rejects.toThrow(/takes no payment through the contract/);
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
    await expect(payer.api.payTopUp(req, 10n, MAIN)).rejects.toThrow(/takes no payment through the contract/);
    const s65 = menu(payer.api, [file('req.json', req)]);
    await handleRoyaltiesChoice('65', s65.ctx);
    expect(s65.said()).toMatch(/pay the breeder as the licensee's terms say/);
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

  it('only the computer holding the issuer key issues credit; a licensee cannot issue its own', async () => {
    const { chain, grower, offer } = await issued();
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
    const before = chain.n;
    await expect(grower.api.issueCredit(req, 100n)).rejects.toThrow(/holds no credit issuer key/);
    await expect(chain.party().api.issueCredit(req, 100n)).rejects.toThrow(/holds no credit issuer key/);
    expect(chain.n).toBe(before);
    expect(chain.ledger.issueSeq).toBe(0n);
  });

  it('double issuance: the same request and amount is refused, also after a timeout that landed', async () => {
    const { chain, breeder, grower, offer } = await issued();
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
    chain.timeoutAfterLanding = true;
    await expect(breeder.api.issueCredit(req, 100n, { evenIfLinkable: true })).rejects.toThrow(/timed out/);
    const before = chain.n;
    await expect(breeder.api.issueCredit(req, 100n, { evenIfLinkable: true })).rejects.toThrow(
      /already on chain[\s\S]*ask the licensee for a new request/,
    );
    expect(chain.n).toBe(before);
    // The breeder's books counted it once, the grower records it once.
    expect(await breeder.api.issuedTotal(offer)).toEqual({ total: 100n, count: 1 });
    await grower.api.claimTopUp(offer, undefined, 100n);
    await expect(grower.api.claimTopUp(offer, undefined, 100n)).rejects.toThrow(/already recorded/);
    expect(await grower.api.credit(offer)).toBe(100n);
  });

  it('a request for another offer is credit on that offer: it settles nothing on this one', async () => {
    const { chain, breeder, grower, offer, B } = await issued();
    // The same breeder's second offer, and a licence on it for the grower.
    const second = await breeder.api.postOffer(B, offerTerms(new Uint8Array(32).fill(8), { price: 2000n }), MAIN);
    const lic2 = await grower.api.requestLicence(second.card, MAIN);
    await breeder.api.issueLicence(lic2.licenceCard);
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(second.offer);
    void _n;
    void _f;
    // A request edited to name the first offer no longer matches the chain.
    await expect(
      breeder.api.issueCredit({ ...req, card: { ...req.card, offer: hex(offer) } }, 100n, { evenIfLinkable: true }),
    ).rejects.toThrow(/does not match the offer on chain/);
    await breeder.api.issueCredit(req, 100n, { evenIfLinkable: true });
    await grower.api.claimTopUp(second.offer, undefined, 100n);
    expect(await grower.api.credit(offer)).toBe(0n);
    await expect(grower.api.settle(offer, 'P', 1n, { evenIfLinkable: true })).rejects.toThrow(/does not cover/);
    expect(chain.ledger.settleSeq).toBe(0n);
  });

  it("rule 2: an issuance waits while the breeder's own offer is the newest issuer leaf; 83 asks first", async () => {
    const { chain, breeder, grower, offer } = await issued();
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
    await expect(breeder.api.issueCredit(req, 100n)).rejects.toThrow(WouldLinkError);
    const s = menu(breeder.api, [file('req.json', req), '0.0001', 'yes', 'no']);
    await handleRoyaltiesChoice('83', s.ctx);
    expect(s.said()).toMatch(/Send it anyway\?[\s\S]*Nothing was sent/);
    expect(chain.ledger.issueSeq).toBe(0n);
    // Once someone else posts an offer, it goes without asking.
    const other = chain.party();
    const O = secret('cr-other');
    anchor(chain, O);
    await other.api.postOffer(O, offerTerms(new Uint8Array(32).fill(4)), MAIN);
    await breeder.api.issueCredit(req, 100n);
    expect(chain.ledger.issueSeq).toBe(1n);
  });

  it('an issuance whose issuer root a seal retired on the way is proved again once, and lands', async () => {
    const { chain, breeder, grower, offer } = await issued();
    const other = chain.party();
    const O = secret('cr-other2');
    anchor(chain, O);
    const theirs = await other.api.postOffer(O, offerTerms(new Uint8Array(32).fill(4)), MAIN);
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
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
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
    await expect(breeder.api.issueCredit(req, 100n, { evenIfLinkable: true })).rejects.toThrow(
      /holds no credit issuer key/,
    );
    await laptop.api.keepOfferCard(posted.card);
    await laptop.api.issueCredit(req, 100n, { evenIfLinkable: true });
    expect(chain.ledger.issueSeq).toBe(1n);
  });

  it('55 warns when more was settled than this computer issued (credit from elsewhere: maybe a stolen issuer key)', async () => {
    const { breeder, grower, offer, posted, licence } = await issued();
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
    // Issued around this computer's books (as a thief holding the key would).
    const issuer = Buffer.from(
      ((await breeder.api.held()).issuerKeys ?? []).find((k) => k.offer === hex(offer))!.secret,
      'hex',
    );
    const op = {
      offer,
      payTo: Buffer.from(posted.card.payTo, 'hex'),
      color: NIGHT_COLOR,
      rateCommit: Buffer.from(posted.card.rateCommit, 'hex'),
      expires: BigInt(posted.card.expires),
      split: false,
      onChainPayment: false,
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
    expect(s55.said()).toMatch(/worth 0\.000200 NIGHT; this computer issued 0\.000000 NIGHT/);
    expect(s55.said()).toMatch(/WARNING: more was settled than this computer issued/);
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
    const { nonce: _n, fingerprint: _f, ...req } = await grower.api.topUpRequest(offer);
    void _n;
    void _f;
    await breeder.api.issueCredit(req, 100n, { evenIfLinkable: true });
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
