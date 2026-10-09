// Regression tests for the attack pass on the royalties CLIENT (api/src/royalties-api.ts,
// bboard-cli/src/royalties-menu.ts, the stores). Each test is one of the attacks, run
// against the fixed client: it asserts the attack no longer works, or is shown to the
// person before anything is sent. The chain is the real contract in the simulator.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- fakes */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import { type RoyaltiesPrivateState, royaltiesPureCircuits as R } from '../../contract/src/royalties.js';
import {
  AlreadyDoneError,
  NIGHT_COLOR,
  RoyaltiesAPI,
  type LicenceCard,
  type TopUpRequest,
  codeFingerprint,
  mergingPrivateStateProvider,
  newPresentationRequest,
} from '../../api/src/royalties-api.js';
import { royaltiesPrivateStateKey } from '../../api/src/royalties-types.js';
import { as, secret } from '../../contract/src/test/veilcore-simulator.js';
import { type RoyaltiesMenuContext, expandPath, handleRoyaltiesChoice } from './royalties-menu.js';
import { copyLiveStore, openStores } from './private-store.js';
import { Chain, MAIN, ROYALTIES, hex, now } from './royalties-test-chain.js';

const tmp = mkdtempSync(path.join(tmpdir(), 'vc-royalties-attacks-'));
let files = 0;
const file = (name: string, v: unknown): string => {
  const p = path.join(tmp, `${files++}-${name}`);
  writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
  return p;
};
const fresh = (name: string): string => path.join(tmp, `${files++}-${name}`);

/** Drive the royalties menu with scripted answers; every log line is kept. */
const menu = (
  api: RoyaltiesAPI,
  answers: string[],
  o: { record?: Uint8Array; wallet?: Uint8Array } = {},
): { ctx: RoyaltiesMenuContext; lines: string[]; said: () => string } => {
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
  return { ctx, lines, said: () => lines.join('\n') };
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

/** A breeder with a posted offer, and two growers who bought from it. */
const market = async () => {
  const chain = new Chain();
  const breeder = chain.party();
  const g1 = chain.party();
  const g2 = chain.party();
  const payer = chain.party();
  const B = secret('att-breeder');
  anchor(chain, B);
  const wB = new Uint8Array(32).fill(9);
  const posted = await breeder.api.postOffer(B, offerTerms(wB), MAIN);
  const b1 = await g1.api.buyLicense(posted.card, MAIN);
  const b2 = await g2.api.buyLicense(posted.card, MAIN);
  return { chain, breeder, g1, g2, payer, B, wB, posted, offer: posted.offer, card: posted.card, b1, b2 };
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('malicious files', () => {
  it('65 shows the offer, the breeder record, the wallet paid and the code fingerprint before paying', async () => {
    const { chain, payer } = await market();
    const mallory = chain.party();
    const M = secret('att-mallory');
    anchor(chain, M);
    const wM = new Uint8Array(32).fill(0xee);
    const mo = await mallory.api.postOffer(M, offerTerms(wM), MAIN);
    await mallory.api.buyLicense(mo.card, MAIN);
    const { nonce: _n, fingerprint, ...req } = await mallory.api.topUpRequest(mo.offer);
    void _n;
    const m = menu(payer.api, [file('topup.json', req), '0.0001', 'no']);
    const before = chain.n;
    await handleRoyaltiesChoice('65', m.ctx);
    expect(m.said()).toContain(hex(wM));
    expect(m.said()).toContain(hex(mo.offer));
    expect(m.said()).toContain(hex(C.commit(M)));
    expect(m.said()).toContain(fingerprint);
    expect(chain.n).toBe(before);
  });

  it('a swapped top-up code shows a different fingerprint from the one the licensee gives', async () => {
    const { offer, g1, g2, payer } = await market();
    const real = await g1.api.topUpRequest(offer);
    const thief = await g2.api.topUpRequest(offer);
    expect(codeFingerprint(real.code)).toBe(real.fingerprint);
    const m = menu(payer.api, [
      file('swapped.json', { kind: real.kind, card: real.card, code: thief.code }),
      '0.0001',
      'no',
    ]);
    await handleRoyaltiesChoice('65', m.ctx);
    expect(m.said()).toContain(thief.fingerprint);
    expect(m.said()).not.toContain(real.fingerprint);
  });

  it('an offer card with upper-case hex is normalised: top-ups and settlements work', async () => {
    const { chain, card, offer, wB } = await market();
    const grower = chain.party();
    const upper = file('offer-card-upper.json', { ...card, offer: `0x${card.offer.toUpperCase()}` });
    const m = menu(grower.api, [upper, fresh('lic.json'), 'yes']);
    await handleRoyaltiesChoice('58', m.ctx);
    expect(m.said()).toMatch(/Bought\./);
    await grower.api.topUpOwn(offer, 100n, MAIN);
    expect(chain.paid(NIGHT_COLOR, wB)).toBe(100n);
    expect(await grower.api.credit(offer)).toBe(100n);
  });

  it('70 shows the parent record, and refuses a card whose parent is not the one proposed in the main contract', async () => {
    const chain = new Chain();
    const parent = chain.party();
    const child = chain.party();
    const mallory = chain.party();
    const [P, K, M] = [secret('att-p'), secret('att-k'), secret('att-m')];
    for (const s of [P, K, M]) anchor(chain, s);
    const until = now() + 365n * 86400n;
    await parent.api.postOffer(P, offerTerms(new Uint8Array(32).fill(1)), MAIN);
    await mallory.api.postOffer(M, offerTerms(new Uint8Array(32).fill(2)), MAIN);
    const junk = new Uint8Array(32).fill(0x77);
    const evil = await mallory.api.linkTerms(M, {
      color: junk,
      fee: 0n,
      share: 1n,
      generations: 1n,
      until,
      payTo: junk,
    });
    // With no parent proposed yet, 70 shows the parent record and token, and warns.
    const shown = menu(child.api, [file('terms.json', evil), 'no'], { record: K });
    await handleRoyaltiesChoice('70', shown.ctx);
    expect(shown.said()).toContain(evil.parent);
    expect(shown.said()).toContain(hex(junk));
    expect(shown.said()).toMatch(/proposed no parent/);
    // Once the child proposes its real parent in the main contract, Mallory's card is refused.
    chain.main.call(as(K), 'proposeParent', C.commit(P));
    const refused = menu(child.api, [file('terms.json', evil), 'yes'], { record: K });
    await expect(handleRoyaltiesChoice('70', refused.ctx)).rejects.toThrow(/not the parent your record proposed/);
    expect(chain.ledger.links.member(R.linkId(C.commit(K), C.commit(M)))).toBe(false);
    // A card made for another child is refused too.
    const other = await mallory.api.linkTerms(M, {
      color: NIGHT_COLOR,
      fee: 0n,
      share: 1n,
      generations: 1n,
      until,
      payTo: junk,
      child: C.commit(secret('someone-else')),
    });
    await expect(child.api.proposeLink(K, other)).rejects.toThrow(/made for another record/);
  });

  it('a terms card whose token clashes with the other parent is refused before proposing', async () => {
    const chain = new Chain();
    const [P, Q, K] = [secret('att-tp'), secret('att-tq'), secret('att-tk')];
    const [p, q, k] = [chain.party(), chain.party(), chain.party()];
    for (const s of [P, Q, K]) anchor(chain, s);
    const until = now() + 365n * 86400n;
    await p.api.postOffer(P, offerTerms(new Uint8Array(32).fill(1)), MAIN);
    await q.api.postOffer(Q, offerTerms(new Uint8Array(32).fill(2)), MAIN);
    const night = await p.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 0n,
      share: 100n,
      generations: 1n,
      until,
      payTo: new Uint8Array(32).fill(1),
    });
    await k.api.proposeLink(K, night);
    await p.api.confirmLink(P, C.commit(K));
    const other = await q.api.linkTerms(Q, {
      color: new Uint8Array(32).fill(5),
      fee: 0n,
      share: 100n,
      generations: 1n,
      until,
      payTo: new Uint8Array(32).fill(2),
    });
    await expect(k.api.proposeLink(K, other)).rejects.toThrow(/two tokens/);
  });

  it('55 refuses a card from an offer this computer does not run, and a malformed card, without crashing', async () => {
    const { chain, breeder, b1 } = await market();
    const mallory = chain.party();
    const M = secret('att-m2');
    anchor(chain, M);
    const mo = await mallory.api.postOffer(M, offerTerms(new Uint8Array(32).fill(3)), MAIN);
    const mine = await mallory.api.buyLicense(mo.card, MAIN);
    const r = await breeder.api.readSettlements(
      [mine.licenceCard, b1.licenceCard, { kind: 'veilcore-licence-card' }],
      [],
    );
    expect(r.refused.map((x) => x.why).join('\n')).toMatch(/not one this computer runs/);
    expect(r.refused.map((x) => x.why).join('\n')).toMatch(/missing/);
    expect(r.refused.length).toBe(2);
  });

  it('a request or card file that is not JSON is refused without repeating its contents', async () => {
    const { g1 } = await market();
    const m = menu(g1.api, [file('bad.json', 'SECRET-SEED-WORDS not json')]);
    await handleRoyaltiesChoice('58', m.ctx);
    expect(m.said()).toMatch(/not valid JSON/);
    expect(m.said()).not.toContain('SECRET-SEED-WORDS');
  });
});

describe('held state across crashes and retries', () => {
  it('a settle that timed out after landing is not repeated unasked', async () => {
    const { offer, g1, g2 } = await market();
    await g1.api.topUpOwn(offer, 100n);
    await g2.api.topUpOwn(offer, 1n);
    const callTx = (g1.api as any).deployedContract.callTx;
    const settle = callTx.settle;
    (g1.api as any).deployedContract = {
      ...(g1.api as any).deployedContract,
      callTx: new Proxy(callTx, {
        get: (t, name: string) =>
          name === 'settle'
            ? async (...a: unknown[]) => {
                await settle(...a);
                throw new Error('timed out waiting for the transaction (test)');
              }
            : t[name],
      }),
    };
    await expect(g1.api.settle(offer, '2026-Q4', 10n)).rejects.toThrow(/timed out/);
    await g2.api.topUpOwn(offer, 1n);
    await expect(g1.api.settle(offer, '2026-Q4', 10n, { evenIfLinkable: true })).rejects.toThrow(AlreadyDoneError);
    expect(await g1.api.credit(offer)).toBe(60n);
  });

  it('a purchase that timed out after landing is not repeated unasked; 58 asks first', async () => {
    const { chain, card, offer } = await market();
    const grower = chain.party();
    chain.timeoutAfterLanding = true;
    await expect(grower.api.buyLicense(card, MAIN)).rejects.toThrow(/timed out/);
    const sold = chain.ledger.soldOf.lookup(offer).read();
    const m = menu(grower.api, [file('card.json', card), fresh('lic.json'), 'yes', 'no']);
    await handleRoyaltiesChoice('58', m.ctx);
    expect(m.said()).toMatch(/already holds a live licence/);
    expect(chain.ledger.soldOf.lookup(offer).read()).toBe(sold);
  });

  it('a top-up of your own that timed out after landing is found and recorded', async () => {
    const { chain, offer, g1, wB } = await market();
    chain.timeoutAfterLanding = true;
    await expect(g1.api.topUpOwn(offer, 70n)).rejects.toThrow(/did land, and the credit is recorded/);
    expect(chain.paid(NIGHT_COLOR, wB)).toBe(70n);
    expect(await g1.api.credit(offer)).toBe(70n);
  });

  it('62 says the merge landed when the settlement is then held back', async () => {
    const { chain, offer, g1, g2 } = await market();
    await g1.api.topUpOwn(offer, 30n);
    await g1.api.topUpOwn(offer, 30n);
    await g2.api.topUpOwn(offer, 1n);
    const before = chain.n;
    const m = menu(g1.api, [hex(offer), 'Q1', '10', 'yes', 'no']);
    await handleRoyaltiesChoice('62', m.ctx);
    expect(chain.n).toBe(before + 1);
    expect(m.said()).toMatch(/merged/);
    expect(m.said()).toMatch(/settlement was not sent/);
    expect(m.said()).not.toMatch(/Nothing was sent/);
  });

  it('MOVE from an old store keeps the royalties store', async () => {
    const PASSWORD = 'Veilcore-Attack-Pw-7q';
    const STORE = 'veilcore-preprod-private-state';
    const home = mkdtempSync(path.join(tmpdir(), 'vc-att-home-'));
    const old = path.join(home, 'midnight-level-db');
    const s1 = await openStores<string, any, string, any>({
      dir: old,
      storeName: STORE,
      password: () => PASSWORD,
      accountId: 'cd'.repeat(32),
      home,
    });
    (s1.main as any).setContractAddress(MAIN);
    await (s1.main as any).set('veilcorePrivateState', { geneticSecret: new Uint8Array(32).fill(5) });
    (s1.royalties as any).setContractAddress(ROYALTIES);
    await (s1.royalties as any).set(royaltiesPrivateStateKey, {
      input: {},
      held: { admins: { ['ab'.repeat(32)]: 'cd'.repeat(32) }, licences: [], receipts: [] },
    });
    const to = path.join(home, 'new-store');
    await copyLiveStore(old, to, STORE, PASSWORD, tmp);
    const s2 = await openStores<string, any, string, any>({
      dir: to,
      storeName: STORE,
      password: () => PASSWORD,
      accountId: 'cd'.repeat(32),
      home,
    });
    (s2.royalties as any).setContractAddress(ROYALTIES);
    expect((await (s2.royalties as any).get(royaltiesPrivateStateKey)).held.admins).toEqual({
      ['ab'.repeat(32)]: 'cd'.repeat(32),
    });
  });
});

describe('rule enforcement', () => {
  /** A thief posts as A; a grower buys; then the owner recovers A. */
  const stolen = async () => {
    const chain = new Chain();
    const thief = chain.party();
    const grower = chain.party();
    const payer = chain.party();
    const A = secret('att-stolen');
    const RCV = secret('att-stolen-rcv');
    chain.main.call(as(A), 'anchor', C.recoveryCommit(RCV));
    const wT = new Uint8Array(32).fill(0x66);
    const o = await thief.api.postOffer(A, offerTerms(wT), MAIN);
    await grower.api.buyLicense(o.card, MAIN);
    const recover = () =>
      chain.main.call(
        as(secret('att-nobody'), { incoming: secret('att-new'), recovery: RCV }),
        'recoverRecordSecret',
        C.commit(A),
        C.commit(secret('att-new')),
        C.recoveryCommit(secret('att-rcv2')),
      );
    return { chain, grower, payer, o, wT, recover };
  };

  it('top-ups refuse an offer whose record was recovered from theft, from a payer and from the grower', async () => {
    const { chain, grower, payer, o, recover } = await stolen();
    recover();
    const req = await grower.api.topUpRequest(o.offer);
    const before = chain.n;
    await expect(payer.api.payTopUp(req, 500n, MAIN)).rejects.toThrow(/recovered from theft/);
    await expect(grower.api.topUpOwn(o.offer, 300n, MAIN)).rejects.toThrow(/recovered from theft/);
    expect(chain.n).toBe(before);
  });

  it("a verifier's check is NOT accepted for an offer whose record was recovered from theft", async () => {
    const { chain, grower, o, recover } = await stolen();
    const verifier = chain.party();
    const ask = newPresentationRequest({ contract: ROYALTIES, offer: o.offer });
    await grower.api.prove(ask, { evenIfLinkable: true });
    recover();
    indexerShowsNow(chain);
    const v = await verifier.api.verifyPresentation(ask, 'abcd', 'http://indexer.invalid', MAIN);
    expect(v.lines.join('\n')).toMatch(/FAILED .*recovered from theft/);
    expect(v.accepted).toBe(false);
  });

  it('a child cannot finalise a link whose parent the main contract does not confirm', async () => {
    const chain = new Chain();
    const [parent, child] = [chain.party(), chain.party()];
    const [P, K] = [secret('att-par'), secret('att-kid')];
    anchor(chain, P);
    anchor(chain, K);
    await parent.api.postOffer(P, offerTerms(new Uint8Array(32).fill(41)), MAIN);
    const card = await parent.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 25n,
      share: 1000n,
      generations: 1n,
      until: now() + 365n * 86400n,
      payTo: new Uint8Array(32).fill(41),
    });
    await child.api.proposeLink(K, card);
    await parent.api.confirmLink(P, C.commit(K));
    await expect(child.api.finaliseStack(K, MAIN)).rejects.toThrow(/does not confirm it as your record's parent/);
    chain.main.call(as(K), 'proposeParent', C.commit(P));
    chain.main.call(as(P), 'confirmParent', C.commit(K));
    // 72 shows the chart before making it final.
    const m = menu(child.api, ['yes'], { record: K });
    await handleRoyaltiesChoice('72', m.ctx);
    expect(m.said()).toMatch(/pedigree chart will be:[\s\S]*parent .*10%/);
    expect(chain.ledger.stacks.member(C.commit(K))).toBe(true);
  });

  it('58 shows the whole amount leaving the wallet, the parent fee included', async () => {
    const chain = new Chain();
    const [parent, child, grower] = [chain.party(), chain.party(), chain.party()];
    const [P, K] = [secret('att-fp'), secret('att-fk')];
    anchor(chain, P);
    anchor(chain, K);
    const wP = new Uint8Array(32).fill(51);
    await parent.api.postOffer(P, offerTerms(wP), MAIN);
    const card = await parent.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 25n,
      share: 1000n,
      generations: 1n,
      until: now() + 365n * 86400n,
      payTo: wP,
    });
    chain.main.call(as(K), 'proposeParent', C.commit(P));
    await child.api.proposeLink(K, card, MAIN);
    await parent.api.confirmLink(P, C.commit(K));
    chain.main.call(as(P), 'confirmParent', C.commit(K));
    await child.api.finaliseStack(K, MAIN);
    const ko = await child.api.postOffer(K, offerTerms(new Uint8Array(32).fill(52)), MAIN);
    const m = menu(grower.api, [file('offer-card-2.json', ko.card), fresh('lic-2.json'), 'yes']);
    await handleRoyaltiesChoice('58', m.ctx);
    expect(m.said()).toMatch(/in all, this sends from this wallet: 0\.001025 NIGHT/);
    expect(chain.lastSpends.reduce((a, [, , v]) => a + v, 0n)).toBe(1025n);
  });

  it('a link changes at most once in 30 days, and its terms can only be lowered', async () => {
    const chain = new Chain();
    const [parent, child] = [chain.party(), chain.party()];
    const [P, K] = [secret('att-lp'), secret('att-lk')];
    anchor(chain, P);
    anchor(chain, K);
    await parent.api.postOffer(P, offerTerms(new Uint8Array(32).fill(61)), MAIN);
    const card = await parent.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 25n,
      share: 1000n,
      generations: 1n,
      until: now() + 365n * 86400n,
      payTo: new Uint8Array(32).fill(61),
    });
    const { link } = await child.api.proposeLink(K, card);
    await parent.api.confirmLink(P, C.commit(K));
    await expect(parent.api.relaxLink(link, { share: 2000n })).rejects.toThrow(/only be lowered/);
    await parent.api.relaxLink(link, { share: 500n });
    expect(chain.ledger.links.lookup(link).share).toBe(500n);
    await expect(parent.api.movePayee(link, new Uint8Array(32).fill(62))).rejects.toThrow(/less than 30 days ago/);
  });
});

describe('files and paths', () => {
  it('a leading ~ means the home folder', () => {
    vi.stubEnv('HOME', '/home/someone');
    expect(expandPath('~/Desktop/x.json')).toBe(path.join('/home/someone', 'Desktop/x.json'));
    expect(expandPath('"~/a b.json"')).toBe(path.join('/home/someone', 'a b.json'));
    expect(expandPath('/abs/x')).toBe('/abs/x');
  });

  it('53 reads "~/..." and refuses an output folder that does not exist BEFORE posting', async () => {
    const { chain } = await market();
    const breeder = chain.party();
    const B = secret('att-doc');
    anchor(chain, B);
    vi.stubEnv('HOME', tmp);
    writeFileSync(path.join(tmp, 'terms.txt'), 'TEST licence terms, preprod only\n');
    const offers = [...chain.ledger.offers].length;
    const m = menu(
      breeder.api,
      ['~/terms.txt', '', '0.001', '0.000004', '3', '30', 'y', '', '~/no-such-dir/card.json'],
      {
        record: B,
      },
    );
    await handleRoyaltiesChoice('53', m.ctx);
    expect(m.said()).toMatch(/Cannot write in/);
    expect([...chain.ledger.offers].length).toBe(offers);
  });

  it('53 shows the admin secret first, then writes the card; 77 writes it again', async () => {
    const { chain } = await market();
    const breeder = chain.party();
    const B = secret('att-doc2');
    anchor(chain, B);
    const out = fresh('offer-card.json');
    const shown: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => (shown.push(String(s)), true));
    const m = menu(breeder.api, [file('t.txt', 'x'), '', '0.001', '0.000004', '3', '30', 'y', '', out, 'yes'], {
      record: B,
    });
    await handleRoyaltiesChoice('53', m.ctx);
    expect(shown.join('')).toMatch(/OFFER ADMIN SECRET/);
    const card = JSON.parse(readFileSync(out, 'utf8')) as { offer: string };
    const again = fresh('again.json');
    await handleRoyaltiesChoice('77', menu(breeder.api, [card.offer, again]).ctx);
    expect(JSON.parse(readFileSync(again, 'utf8'))).toEqual(card);
  });

  it('58 refuses a bad licence card path before buying; 78 writes the card again later', async () => {
    const { chain, card, offer } = await market();
    const grower = chain.party();
    const before = chain.n;
    const m = menu(grower.api, [file('card.json', card), path.join(tmp, 'nope', 'lic.json'), 'yes']);
    await handleRoyaltiesChoice('58', m.ctx);
    expect(m.said()).toMatch(/Cannot write in/);
    expect(chain.n).toBe(before);
    await grower.api.buyLicense(card, MAIN);
    const out = fresh('lic-again.json');
    await handleRoyaltiesChoice('78', menu(grower.api, [hex(offer), out]).ctx);
    const lic = JSON.parse(readFileSync(out, 'utf8')) as LicenceCard;
    expect(lic.offer).toBe(hex(offer));
    expect(existsSync(out)).toBe(true);
  });
});

describe('delegated presentations', () => {
  it('a presentation card answers a request for a settled period, and cannot spend', async () => {
    const { chain, offer, g1, g2 } = await market();
    await g1.api.topUpOwn(offer, 100n);
    await g2.api.topUpOwn(offer, 1n);
    await g1.api.settle(offer, '2026-Q4', 10n);
    const out = fresh('present.json');
    await handleRoyaltiesChoice('79', menu(g1.api, [hex(offer), 'yes', out]).ctx);
    const delegate = chain.party();
    const verifier = chain.party();
    const ask = await verifier.api.presentationRequest({ offer, period: '2026-Q4', minUnits: 5n });
    const reqFile = file('request.json', ask);
    await g2.api.topUpOwn(offer, 1n);
    const m = menu(delegate.api, [out, reqFile, 'yes', 'yes']);
    await handleRoyaltiesChoice('80', m.ctx);
    expect(m.said()).toMatch(/Answered/);
    expect(hex(chain.ledger.lastPresentation)).toBe(
      hex(
        R.presentationTag(
          offer,
          Buffer.from(ask.period, 'hex'),
          5n,
          BigInt(ask.validAt),
          Buffer.from(ask.scope, 'hex'),
          Buffer.from(ask.challenge, 'hex'),
          true,
        ),
      ),
    );
    // The card holds no licence secret: nothing on it spends credit.
    const card = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(card).sort()).toEqual(
      ['contract', 'expires', 'kind', 'licence', 'offer', 'present', 'receipts', 'spendKey'].sort(),
    );
  });
});

describe('round 6: checking the fixes', () => {
  const raw = (api: RoyaltiesAPI, circuit: string, input: object, f: (c: any) => Promise<any>) =>
    (api as any).call(circuit, input, f);

  it("a terms card from a parent's OLD record (recovered from theft) is refused before proposing", async () => {
    const chain = new Chain();
    const [owner, thief, child] = [chain.party(), chain.party(), chain.party()];
    const [P, RCV, Pnew, K] = [secret('r6-p'), secret('r6-p-rcv'), secret('r6-p-new'), secret('r6-k')];
    chain.main.call(as(P), 'anchor', C.recoveryCommit(RCV));
    anchor(chain, K);
    await owner.api.postOffer(P, offerTerms(new Uint8Array(32).fill(0x11)), MAIN);
    chain.main.call(
      as(secret('r6-nobody'), { incoming: Pnew, recovery: RCV }),
      'recoverRecordSecret',
      C.commit(P),
      C.commit(Pnew),
      C.recoveryCommit(secret('r6-rcv2')),
    );
    chain.main.call(as(K), 'proposeParent', C.commit(Pnew));
    chain.main.call(as(Pnew), 'confirmParent', C.commit(K));
    const card = await thief.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 300n,
      share: 4000n,
      generations: 1n,
      until: now() + 365n * 86400n,
      payTo: new Uint8Array(32).fill(0x66),
    });
    await expect(child.api.proposeLink(K, card, MAIN)).rejects.toThrow(/no longer its identity's current record/);
  });

  it('a parent that confirms the link but never the parentage cannot hold the child up: 72 asks for FINAL', async () => {
    const chain = new Chain();
    const [parent, child] = [chain.party(), chain.party()];
    const [P, K] = [secret('r6-hp'), secret('r6-hk')];
    anchor(chain, P);
    anchor(chain, K);
    await parent.api.postOffer(P, offerTerms(new Uint8Array(32).fill(0x31)), MAIN);
    chain.main.call(as(K), 'proposeParent', C.commit(P));
    const card = await parent.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 0n,
      share: 500n,
      generations: 1n,
      until: now() + 365n * 86400n,
      payTo: new Uint8Array(32).fill(0x31),
    });
    await child.api.proposeLink(K, card, MAIN);
    await parent.api.confirmLink(P, C.commit(K));
    chain.main.call(as(K), 'withdrawParent');
    await expect(child.api.finaliseStack(K, MAIN)).rejects.toThrow(/Not made final/);
    const m = menu(child.api, ['FINAL'], { record: K });
    await handleRoyaltiesChoice('72', m.ctx);
    expect(m.said()).toMatch(/STOP: .*does not confirm it as your record's parent/);
    expect(m.said()).toMatch(/Final\./);
    expect(chain.ledger.stacks.member(C.commit(K))).toBe(true);
  });

  it("58 shows a chart's warnings BEFORE the buyer agrees, with their own yes", async () => {
    const chain = new Chain();
    const [breeder, sock, grower] = [chain.party(), chain.party(), chain.party()];
    const [K, S] = [secret('r6-dk'), secret('r6-ds')];
    anchor(chain, K);
    anchor(chain, S);
    const wS = new Uint8Array(32).fill(0x77);
    await sock.api.postOffer(S, offerTerms(wS), MAIN);
    const card = await sock.api.linkTerms(S, {
      color: NIGHT_COLOR,
      fee: 5000n,
      share: 0n,
      generations: 1n,
      until: now() + 365n * 86400n,
      payTo: wS,
    });
    await breeder.api.proposeLink(K, card);
    await sock.api.confirmLink(S, C.commit(K));
    const lid = R.linkId(C.commit(K), C.commit(S));
    await raw(breeder.api, 'finaliseStack', { recordSecret: K }, (c) =>
      c.callTx.finaliseStack(lid, new Uint8Array(32)),
    );
    const ko = await breeder.api.postOffer(K, offerTerms(new Uint8Array(32).fill(0x78)), MAIN);
    const before = chain.n;
    const m = menu(grower.api, [file('card.json', ko.card), 'no']);
    await handleRoyaltiesChoice('58', m.ctx);
    const warnAt = m.lines.findIndex((l) => l.includes('does not confirm as its parent'));
    const askAt = m.lines.findIndex((l) => l.includes('despite these warnings'));
    expect(warnAt).toBeGreaterThan(-1);
    expect(askAt).toBeGreaterThan(warnAt);
    expect(m.said()).not.toMatch(/Buy one licence from this offer\?/);
    expect(chain.n).toBe(before);
  });

  it('68 sends at most 20 transactions in all, ended offers included', async () => {
    const chain = new Chain();
    const [spammer, runner] = [chain.party(), chain.party()];
    const S = secret('r6-spam');
    for (let i = 0; i < 25; i++)
      await spammer.api.postOffer(S, offerTerms(new Uint8Array(32).fill(5), { expires: now() + 2n }), undefined, {
        again: true,
      });
    await new Promise((r) => setTimeout(r, 3500));
    expect((await runner.api.clearable()).offers).toBe(25);
    const before = chain.n;
    const r = await runner.api.clearEnded();
    expect(r.offers).toBe(20);
    expect(chain.n - before).toBe(20);
  });

  it('a period typed with spaces is the same period: not settled twice unasked', async () => {
    const { offer, g1, g2 } = await market();
    await g1.api.topUpOwn(offer, 100n);
    await g2.api.topUpOwn(offer, 1n);
    await g1.api.settle(offer, ' 2026-Q4', 5n, { evenIfLinkable: true });
    await expect(g1.api.settle(offer, '2026-Q4 ', 5n, { evenIfLinkable: true })).rejects.toThrow(AlreadyDoneError);
    expect((await g1.api.settlements(offer)).map((r) => r.period)).toEqual(['2026-Q4']);
  });

  it("a verifier's period label with terminal codes is shown as hex", async () => {
    const { offer, g1 } = await market();
    const label = Buffer.alloc(32);
    label.write('Q4\u001b[2K\u001b[1A');
    const req = {
      ...newPresentationRequest({ contract: ROYALTIES, offer, period: 'x', minUnits: 1n }),
      period: label.toString('hex'),
    };
    const m = menu(g1.api, [file('req.json', req), 'no']);
    await handleRoyaltiesChoice('64', m.ctx);
    expect(m.said()).toContain('not plain text');
    expect(m.said()).not.toContain('\u001b');
  });
});

describe('round 7', () => {
  const raw = (api: RoyaltiesAPI, circuit: string, input: object, f: (c: any) => Promise<any>) =>
    (api as any).call(circuit, input, f);

  it('a settlement whose root a revocation seal retired on the way is proved again once, and lands', async () => {
    const { chain, breeder, offer, g1, g2, b2 } = await market();
    await g1.api.topUpOwn(offer, 100n);
    await g2.api.topUpOwn(offer, 1n);
    // While g1's settlement is being proved, the breeder revokes g2's licence and seals it
    // (the first revocation seal is due at once): the root g1 proved against is retired.
    let sealed = false;
    chain.beforeLanding = async () => {
      sealed = (await breeder.api.revokeLicense(b2.license)).sealed;
    };
    await g1.api.settle(offer, '2026-Q4', 10n);
    expect(sealed).toBe(true);
    expect(chain.ledger.settleSeq).toBe(1n);
    expect(await g1.api.credit(offer)).toBe(60n);
    expect((await g1.api.settlements(offer)).map((r) => r.units)).toEqual(['10']);
  });

  it('a presentation whose root went stale on the way is proved again once', async () => {
    const { chain, breeder, offer, g1, g2, b2 } = await market();
    const verifier = chain.party();
    const ask = await verifier.api.presentationRequest({ offer });
    await g2.api.topUpOwn(offer, 1n);
    chain.beforeLanding = async () => void (await breeder.api.revokeLicense(b2.license));
    await g1.api.prove(ask);
    expect(chain.ledger.presentationSeq).toBe(1n);
  });

  it('only settle, merge and presentations are sent again, only once, and never after a timeout', async () => {
    const { g1 } = await market();
    let tries = 0;
    const failed = async () => {
      tries++;
      throw Object.assign(new Error('failed on chain'), { name: 'CallTxFailedError' });
    };
    await expect(raw(g1.api, 'settle', {}, failed)).rejects.toThrow(/failed on chain/);
    expect(tries).toBe(2);
    tries = 0;
    await expect(raw(g1.api, 'buyLicense', {}, failed)).rejects.toThrow(/failed on chain/);
    expect(tries).toBe(1);
    tries = 0;
    await expect(
      raw(g1.api, 'proveLicense', {}, async () => {
        tries++;
        throw new Error('timed out waiting for the transaction; the path is stale');
      }),
    ).rejects.toThrow(/timed out/);
    expect(tries).toBe(1);
  });

  it('a revocation within the hour waits for its seal; the client sends no seal before then, and the verifier is told when', async () => {
    const { chain, breeder, offer, b1, b2 } = await market();
    expect((await breeder.api.revokeLicense(b2.license)).sealed).toBe(true);
    const r = await breeder.api.revokeLicense(b1.license);
    expect(r.sealed).toBe(false);
    expect(r.waiting).toBe(true);
    const due = Number(chain.ledger.lastRevocationReset + 3600n);
    expect(r.sealableAt).toBeGreaterThanOrEqual(due);
    const before = chain.n;
    expect((await breeder.api.seal()).sealed).toBe(false);
    expect(chain.n).toBe(before);
    const verifier = chain.party();
    const ask = await verifier.api.presentationRequest({ offer });
    indexerShowsNow(chain);
    const v = await verifier.api.verifyPresentation(ask, 'abcd', 'http://indexer.invalid');
    expect(v.lines.join('\n')).toMatch(/WAIT .*can be sealed .* from 20\d\d-.*up to an hour/);
    expect(v.accepted).toBe(false);
  });

  it('a top-up request carries no rate; the payer pays without it; an older request is read without its rate', async () => {
    const { chain, offer, g1, payer, wB, card } = await market();
    const { nonce: _n, fingerprint: _f, ...req } = await g1.api.topUpRequest(offer);
    void _n;
    void _f;
    expect(Object.keys(req.card).sort()).toEqual(
      ['color', 'contract', 'expires', 'kind', 'offer', 'payTo', 'rateCommit', 'split'].sort(),
    );
    expect(JSON.stringify(req)).not.toContain(card.rateSalt);
    // Through the menu, from a file.
    const m = menu(payer.api, [file('topup.json', req), '0.0001', 'yes', 'yes']);
    await handleRoyaltiesChoice('65', m.ctx);
    expect(m.said()).toMatch(/Paid\./);
    expect(chain.paid(NIGHT_COLOR, wB)).toBe(100n);
    await g1.api.claimTopUp(offer, undefined, 100n);
    // An older request carried the whole offer card: it still pays, and the rate is not used.
    const old = await g1.api.topUpRequest(offer);
    await payer.api.payTopUp({ kind: old.kind, code: old.code, card } as unknown as TopUpRequest, 50n, MAIN);
    await g1.api.claimTopUp(offer, old.nonce, 50n);
    expect(await g1.api.credit(offer)).toBe(150n);
    // A payer card that does not match the chain is refused before anything is sent.
    const before = chain.n;
    await expect(
      payer.api.payTopUp({ ...req, card: { ...req.card, expires: String(BigInt(req.card.expires) + 1n) } }, 5n),
    ).rejects.toThrow(/does not match the offer on chain/);
    expect(chain.n).toBe(before);
  });

  it('an offer post that timed out after landing is not repeated unasked; 53 asks first', async () => {
    const { chain } = await market();
    const breeder = chain.party();
    const B = secret('r7-post');
    anchor(chain, B);
    const termsFile = file('r7-terms.txt', 'r7 terms');
    const t = offerTerms(new Uint8Array(32).fill(3), {
      terms: Uint8Array.from(createHash('sha256').update('r7 terms').digest()),
      price: 1000n,
      count: 3n,
      expires: now() + 30n * 86400n,
    });
    chain.timeoutAfterLanding = true;
    await expect(breeder.api.postOffer(B, t, MAIN)).rejects.toThrow(/timed out/);
    const offers = [...chain.ledger.offers].length;
    await expect(breeder.api.postOffer(B, { ...t, expires: t.expires + 60n }, MAIN)).rejects.toThrow(AlreadyDoneError);
    const m = menu(
      breeder.api,
      [termsFile, '', '0.001', '0.000004', '3', '30', 'y', '', fresh('c.json'), 'yes', 'no'],
      {
        record: B,
      },
    );
    await handleRoyaltiesChoice('53', m.ctx);
    expect(m.said()).toMatch(/already posted an offer from this record[\s\S]*Post another offer with the same terms\?/);
    expect([...chain.ledger.offers].length).toBe(offers);
    // Other terms are another offer; asked again, the same terms are posted.
    await breeder.api.postOffer(B, { ...t, price: 2000n }, MAIN);
    await breeder.api.postOffer(B, t, MAIN, { again: true });
    expect([...chain.ledger.offers].length).toBe(offers + 2);
  });

  it("lowering a link's share so far that a descendant's offer could not be sold is shown first, and needs a yes", async () => {
    const chain = new Chain();
    const [parent, child, grower] = [chain.party(), chain.party(), chain.party()];
    const [P, K] = [secret('r7-rp'), secret('r7-rk')];
    anchor(chain, P);
    anchor(chain, K);
    const wP = new Uint8Array(32).fill(71);
    await parent.api.postOffer(P, offerTerms(wP), MAIN);
    const card = await parent.api.linkTerms(P, {
      color: NIGHT_COLOR,
      fee: 0n,
      share: 1000n,
      generations: 1n,
      until: now() + 365n * 86400n,
      payTo: wP,
    });
    chain.main.call(as(K), 'proposeParent', C.commit(P));
    const { link } = await child.api.proposeLink(K, card, MAIN);
    await parent.api.confirmLink(P, C.commit(K));
    chain.main.call(as(P), 'confirmParent', C.commit(K));
    await child.api.finaliseStack(K, MAIN);
    const ko = await child.api.postOffer(K, offerTerms(new Uint8Array(32).fill(72)), MAIN); // price 1000
    // 0.05% of 1000 is half a unit: the contract would refuse every purchase.
    expect(await parent.api.relaxWarnings(link, 10n)).toEqual([]);
    await expect(parent.api.relaxLink(link, { share: 5n })).rejects.toThrow(/could no longer be sold/);
    const before = chain.n;
    const no = menu(parent.api, [hex(link), '0.05', '', '', 'no']);
    await handleRoyaltiesChoice('81', no.ctx);
    expect(no.said()).toMatch(/WARNING: offer .*could no longer be sold[\s\S]*despite these warnings/);
    expect(chain.n).toBe(before);
    const yes = menu(parent.api, [hex(link), '0.05', '', '', 'yes']);
    await handleRoyaltiesChoice('81', yes.ctx);
    expect(chain.ledger.links.lookup(link).share).toBe(5n);
    await expect(grower.api.buyLicense(ko.card, MAIN)).rejects.toThrow(/Too small a payment/);
  });

  // Two CLI runs on one computer share one store (round 7's PoC). midnight-js reads the
  // private state when a call starts and writes that snapshot back when it is final.
  type Store = Map<string, RoyaltiesPrivateState>;
  const run = (
    chain: Chain,
    store: Store,
    slow?: { name: string; during: () => Promise<void>; viaProvider?: boolean },
  ): RoyaltiesAPI => {
    const chainCall = (chain as any).call.bind(chain) as (n: string, s: unknown, a: unknown[]) => Promise<unknown>;
    const privateStateProvider = mergingPrivateStateProvider({
      setContractAddress: () => undefined,
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      set: (k: string, v: RoyaltiesPrivateState) => Promise.resolve(void store.set(k, v)),
    } as unknown as Parameters<typeof mergingPrivateStateProvider>[0]);
    const publicDataProvider = {
      queryContractState: (addr: string) =>
        Promise.resolve({
          data: addr === MAIN ? (chain.main as any).ctx.currentQueryContext.state : chain.ctx.currentQueryContext.state,
        }),
    };
    const callTx = new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          async (...args: unknown[]) => {
            if (slow === undefined || slow.name !== name) return chainCall(name, store, args);
            const snapshot = new Map(store);
            const r = await chainCall(name, snapshot, args);
            await slow.during();
            const back = snapshot.get(royaltiesPrivateStateKey)!;
            // midnight-js writes back through the provider it was given (merged with the disk);
            // the PoC wrote straight to the store (the other run must then restore its own).
            if (slow.viaProvider === true) await privateStateProvider.set(royaltiesPrivateStateKey, back);
            else store.set(royaltiesPrivateStateKey, back);
            return r;
          },
      },
    );
    const deployed = { deployTxData: { public: { contractAddress: ROYALTIES } }, callTx };
    const Api = RoyaltiesAPI as unknown as new (d: unknown, p: unknown) => RoyaltiesAPI;
    return new Api(deployed, { privateStateProvider, publicDataProvider });
  };

  const twoRuns = async (viaProvider: boolean) => {
    const chain = new Chain();
    const breeder = chain.party();
    const payer = chain.party();
    const B = secret(`r7-two-${viaProvider}`);
    anchor(chain, B);
    const wB = new Uint8Array(32).fill(9);
    const o1 = await breeder.api.postOffer(B, offerTerms(wB), MAIN);
    const o2 = await breeder.api.postOffer(B, offerTerms(wB, { terms: new Uint8Array(32).fill(8) }), MAIN);
    const store: Store = new Map();
    const runB = run(chain, store);
    let req: Awaited<ReturnType<RoyaltiesAPI['topUpRequest']>> | undefined;
    const runA = run(chain, store, {
      name: 'settle',
      viaProvider,
      during: async () => {
        await runB.buyLicense(o2.card, MAIN);
        req = await runB.topUpRequest(o1.offer);
      },
    });
    await runA.buyLicense(o1.card, MAIN);
    await runA.topUpOwn(o1.offer, 100n);
    const other = chain.party();
    await other.api.buyLicense(o1.card, MAIN);
    await other.api.topUpOwn(o1.offer, 1n);
    await runA.settle(o1.offer, '2026-Q4', 5n);
    return { chain, payer, wB, o1, o2, store, runA, runB, req: req! };
  };

  it("two runs on one store: A's write-back after a slow settle no longer erases what B kept meanwhile", async () => {
    const { chain, payer, wB, o1, o2, runB, req } = await twoRuns(false);
    expect((await runB.held()).licences).toHaveLength(2);
    await runB.licenceCard(o2.offer);
    const { nonce: _n, fingerprint: _f, ...f } = req;
    void _n;
    void _f;
    await payer.api.payTopUp(f, 500n, MAIN);
    expect(chain.paid(NIGHT_COLOR, wB)).toBe(500n);
    await runB.claimTopUp(o1.offer, undefined, 500n);
    expect(await runB.credit(o1.offer)).toBe(100n - 20n + 500n);
  });

  it("two runs on one store: midnight-js's write-back merges with the disk, even if the other run never looks again", async () => {
    const { o2, store, req } = await twoRuns(true);
    const held = store.get(royaltiesPrivateStateKey)!.held;
    expect(held.licences.map((l) => l.offer)).toContain(hex(o2.offer));
    expect((held.codes ?? []).map((c) => c.nonce)).toContain(req.nonce);
    // A's own change note and receipt are there too.
    expect(held.receipts).toHaveLength(1);
  });
});
