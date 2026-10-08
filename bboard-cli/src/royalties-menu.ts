// SPDX-License-Identifier: Apache-2.0
/**
 * Main menu options 50 to 68: the royalties contract, version 2 (contract/src/veilcore-royalties.compact).
 * Test networks only until it is approved for mainnet (api/src/deploy-guard.ts).
 *
 * Four roles, four kinds of file handed between them:
 *   breeder  posts an offer       -> OFFER CARD (rate and salt) to licensees and payers
 *   grower   buys a licence       -> LICENCE CARD (viewing keys) back to the breeder
 *   grower   asks someone to pay  -> TOP-UP REQUEST to a buyer, lab or processor
 *   verifier asks for proof       -> LICENCE REQUEST to the grower, who answers on chain
 * Cards and requests hold no secret that can spend or present anything, but the offer
 * card and top-up request hold the private rate: hand them only to the parties.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk/address-format';
import {
  type LicenceCard,
  NIGHT_COLOR,
  type OfferCard,
  type OfferView,
  type PresentationRequest,
  RoyaltiesAPI,
  type TopUpRequest,
  WouldLinkError,
  newPresentationRequest,
  periodBytes,
} from '../../api/src/royalties-api.js';
import { assertRoyaltiesDeployAllowed } from '../../api/src/deploy-guard.js';
import { type RoyaltiesProviders } from '../../api/src/royalties-types.js';
import { showSecret } from './secret-out.js';

export const ROYALTIES_MENU = `
 Royalties (third contract: licences sold on chain, royalties prepaid in public and settled in private; test networks only)
 50. Deploy the royalties contract        Grower
 51. Join the royalties contract          58. Buy a licence (with the offer card)
 52. Finish a royalties deploy            59. Top up your own royalty credit
 Breeder                                  60. Make a top-up request for someone to pay
 53. Post an offer (writes an offer card) 61. Record credit someone paid for you
 54. List offers                          62. Settle a period (private)
 55. Read your licensees' settlements     63. Show your credit and settlements
 56. Close an offer                       64. Answer a licence request
 57. Revoke a licence                     Payer: 65. Pay a top-up request
 Verifier: 66. Make a licence request     67. Check an answer
 68. Seal and tidy up (anyone)`;

export type RoyaltiesMenuContext = {
  readonly rli: Interface;
  readonly logger: Logger;
  readonly providers: RoyaltiesProviders | undefined;
  readonly indexerUri: string;
  readonly hidden: (question: string) => Promise<string>;
  readonly during: <T>(f: () => Promise<T>) => Promise<T>;
  /** The main VeilCore contract this run joined: offers are checked against it. */
  readonly mainAddress: string;
  /** The record secret this run acts as in the main contract, if any. */
  readonly recordSecret: () => Promise<Uint8Array | undefined>;
  /** This wallet's unshielded address (32 bytes), where its offers are paid by default. */
  readonly ownWallet: () => Uint8Array;
  api: RoyaltiesAPI | undefined;
};

class RoyaltiesInputError extends Error {}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const short = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;
const ask = async (c: RoyaltiesMenuContext, q: string): Promise<string> => (await c.rli.question(q)).trim();
const askYes = async (c: RoyaltiesMenuContext, q: string): Promise<boolean> =>
  (await ask(c, `${q} Type yes to send it, anything else to stop: `)).toLowerCase() === 'yes';

const needProviders = (c: RoyaltiesMenuContext): RoyaltiesProviders => {
  if (c.providers === undefined) throw new RoyaltiesInputError('The royalties contract is not set up in this run.');
  return c.providers;
};

const needApi = (c: RoyaltiesMenuContext): RoyaltiesAPI => {
  if (c.api === undefined) throw new RoyaltiesInputError('Deploy (50) or join (51) the royalties contract first.');
  return c.api;
};

const ask32 = async (c: RoyaltiesMenuContext, q: string): Promise<Uint8Array> => {
  const a = (await ask(c, q)).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(a)) throw new RoyaltiesInputError('That is not 64 hex characters. Nothing was sent.');
  return Uint8Array.from(Buffer.from(a, 'hex'));
};

const askWhole = async (c: RoyaltiesMenuContext, q: string, min = 1n): Promise<bigint> => {
  const a = await ask(c, q);
  if (!/^\d{1,30}$/.test(a) || BigInt(a) < min)
    throw new RoyaltiesInputError(`That is not a whole number of at least ${min}. Nothing was sent.`);
  return BigInt(a);
};

const askPeriod = async (c: RoyaltiesMenuContext, q: string): Promise<string> => {
  const p = await ask(c, q);
  try {
    periodBytes(p);
  } catch (e) {
    throw new RoyaltiesInputError(e instanceof Error ? e.message : String(e));
  }
  return p;
};

/** STARs per NIGHT (1 NIGHT = 10^6 STAR). */
const STAR = 1_000_000n;

const askAmount = async (c: RoyaltiesMenuContext, q: string, color: Uint8Array, allowZero = false): Promise<bigint> => {
  const night = hex(color) === hex(NIGHT_COLOR);
  const a = await ask(c, `${q} (${night ? 'NIGHT, up to 6 decimals' : "the token's smallest unit"}): `);
  let v: bigint;
  if (night) {
    const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(a);
    if (m === null) throw new RoyaltiesInputError('That is not an amount of NIGHT. Nothing was sent.');
    v = BigInt(m[1]) * STAR + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  } else {
    if (!/^\d{1,30}$/.test(a)) throw new RoyaltiesInputError('That is not a whole number. Nothing was sent.');
    v = BigInt(a);
  }
  if (v === 0n && !allowZero) throw new RoyaltiesInputError('The amount must be more than zero. Nothing was sent.');
  return v;
};

const showAmount = (amount: bigint, color: Uint8Array): string =>
  hex(color) === hex(NIGHT_COLOR)
    ? `${amount / STAR}.${(amount % STAR).toString().padStart(6, '0')} NIGHT`
    : `${amount} of token ${short(hex(color))}`;

const askWallet = async (c: RoyaltiesMenuContext): Promise<Uint8Array> => {
  const a = await ask(c, 'Wallet to be paid (Enter for this wallet, or an unshielded address mn_addr...): ');
  if (a === '') return c.ownWallet();
  if (/^[0-9a-fA-F]{64}$/.test(a)) return Uint8Array.from(Buffer.from(a, 'hex'));
  try {
    return Uint8Array.from(MidnightBech32m.parse(a).decode(UnshieldedAddress, getNetworkId()).data);
  } catch {
    throw new RoyaltiesInputError(`That is not an unshielded address on ${getNetworkId()}. Nothing was sent.`);
  }
};

const day = (unix: bigint): string => new Date(Number(unix) * 1000).toISOString().slice(0, 10);

const adminTyped = (typed: string): Uint8Array | undefined => {
  const t = typed.replace(/[\s-]/g, '').replace(/^0x/i, '');
  if (t === '') return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(t))
    throw new RoyaltiesInputError('An admin secret is 64 hex characters. Nothing was sent.');
  return Uint8Array.from(Buffer.from(t, 'hex'));
};

const describeOffer = (o: OfferView): string =>
  [
    `offer ${hex(o.id)}`,
    `  price ${showAmount(o.price, o.color)}; royalty ${o.rateCommit.every((x) => x === 0) ? 'none through the contract' : 'per unit, rate in the offer card (private)'}`,
    `  ${o.remaining} left, ${o.live} sold and live, ends ${day(o.expires)}, ${o.revocable ? 'revocable' : 'NOT revocable'}, ${o.open ? 'open' : 'closed'}`,
    `  terms fingerprint ${hex(o.terms)}`,
  ].join('\n');

/** A JSON file of the given kind; refusals never repeat its contents. */
const readKind = <T extends { kind?: string }>(file: string, kind: string): T => {
  let v: T;
  try {
    v = JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    throw new RoyaltiesInputError(`Could not read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (v.kind !== kind)
    throw new RoyaltiesInputError(`${file} is not a ${kind.replace('veilcore-', '').replace(/-/g, ' ')}.`);
  return v;
};

const writePrivate = (file: string, value: unknown): void => {
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
};

const readRequest = (file: string): PresentationRequest => {
  let r: PresentationRequest;
  try {
    r = JSON.parse(readFileSync(file, 'utf8')) as PresentationRequest;
  } catch (e) {
    throw new RoyaltiesInputError(`Could not read that request file: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const k of ['contract', 'offer', 'period', 'minUnits', 'validAt', 'scope', 'challenge'] as const)
    if (typeof r[k] !== 'string') throw new RoyaltiesInputError(`That request file has no ${k}.`);
  return r;
};

/** Licence card files: a folder of them, or paths separated by commas. */
const readCards = (typed: string): LicenceCard[] => {
  const paths = typed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .flatMap((p) => {
      try {
        return statSync(p).isDirectory()
          ? readdirSync(p)
              .filter((f) => f.endsWith('.json'))
              .map((f) => path.join(p, f))
          : [p];
      } catch {
        throw new RoyaltiesInputError(`Could not read ${p}.`);
      }
    });
  const cards: LicenceCard[] = [];
  for (const p of paths) {
    try {
      const v = JSON.parse(readFileSync(p, 'utf8')) as LicenceCard;
      if (v.kind === 'veilcore-licence-card') cards.push(v);
    } catch {
      // Not a card: skipped.
    }
  }
  if (cards.length === 0) throw new RoyaltiesInputError('No licence cards found there.');
  return cards;
};

/**
 * Run a private proof. If the client would rather wait (your own transaction is still the
 * newest, so a watcher could guess this one is yours), say so and let the user choose.
 */
const linkable = async <T>(
  c: RoyaltiesMenuContext,
  f: (evenIfLinkable: boolean) => Promise<T>,
): Promise<T | undefined> => {
  try {
    return await f(false);
  } catch (e) {
    if (!(e instanceof WouldLinkError)) throw e;
    c.logger.info(e.message);
    c.logger.info(
      'Sending now still hides the variety, period, units and rate, but someone watching the chain closely could ' +
        'guess this proof came from the same person as your last transaction.',
    );
    if (!(await askYes(c, 'Send it anyway?'))) {
      c.logger.info('Nothing was sent. Try again later.');
      return undefined;
    }
    return f(true);
  }
};

/** Handle a main-menu choice 50-68. Returns false for any other choice. */
export const handleRoyaltiesChoice = async (choice: string, c: RoyaltiesMenuContext): Promise<boolean> => {
  try {
    switch (choice) {
      case '50': {
        const p = needProviders(c);
        assertRoyaltiesDeployAllowed(c.logger);
        c.logger.info(
          'This deploys a royalties contract, adds its circuit keys, then replaces its maintenance authority with an ' +
            'empty committee, so nobody can ever change it. There is no key to write down.',
        );
        if (!(await askYes(c, 'Deploy a royalties contract now?'))) return (c.logger.info('Nothing was sent.'), true);
        c.api = await c.during(() => RoyaltiesAPI.deploy(p, c.logger));
        c.logger.info(`Royalties contract address: ${c.api.deployedContractAddress}`);
        return true;
      }
      case '51':
        c.api = await RoyaltiesAPI.join(
          needProviders(c),
          hex(await ask32(c, 'Royalties contract address (hex): ')),
          c.logger,
        );
        c.logger.info(`Joined royalties contract at ${c.api.deployedContractAddress}.`);
        return true;
      case '52': {
        const address = hex(await ask32(c, 'Royalties contract address (hex): '));
        c.api = await c.during(() => RoyaltiesAPI.finishDeploy(needProviders(c), address, c.logger));
        return true;
      }
      case '53':
        await postOffer(c);
        return true;
      case '54': {
        const all = await needApi(c).offers();
        if (all.length === 0) c.logger.info('No offers on this contract yet.');
        for (const o of all) c.logger.info(describeOffer(o));
        return true;
      }
      case '55': {
        const api = needApi(c);
        const cards = readCards(
          await ask(c, "Your licensees' licence cards (a folder, or files separated by commas): "),
        );
        const periods = (await ask(c, 'Periods to look for (labels separated by commas, e.g. 2026-Q3,2026-Q4): '))
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        for (const p of periods) periodBytes(p);
        const { found, refused } = await api.readSettlements(cards, periods);
        for (const r of refused) c.logger.error(`Skipped a card for licence ${short(r.card.licence)}: ${r.why}`);
        if (found.length === 0) c.logger.info('None of those licensees has settled anything yet.');
        for (const s of found)
          c.logger.info(
            `licence ${short(s.licence)}  ${s.period === undefined ? 'a period NOT in your list' : `period ${s.period}`}` +
              `  units ${s.units}  (offer ${short(s.offer)})`,
          );
        const accepted = cards.filter(
          (card, i) =>
            !refused.some((r) => r.card === card) &&
            cards.findIndex((x) => x.licence.toLowerCase() === card.licence.toLowerCase()) === i,
        );
        const missing = accepted.flatMap((card) =>
          periods
            .filter((p) => !found.some((f) => f.licence === card.licence && f.period === p))
            .map((p) => `${short(card.licence)} ${p}`),
        );
        if (missing.length > 0) c.logger.info(`Not settled yet: ${missing.join('; ')}`);
        return true;
      }
      case '56': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id (hex): ');
        const admin = adminTyped(
          await c.hidden('Admin secret (64 hex; Enter if this computer posted it; nothing shows): '),
        );
        if (!(await askYes(c, 'Close this offer (no new sales; sold licences and settlements carry on)?')))
          return (c.logger.info('Nothing was sent.'), true);
        await api.closeOffer(offer, admin);
        c.logger.info('Closed.');
        return true;
      }
      case '57': {
        const api = needApi(c);
        const key = await ask32(c, 'Licence key to revoke (hex, from the licence card or the sale): ');
        const admin = adminTyped(
          await c.hidden('Admin secret (64 hex; Enter if this computer posted it; nothing shows): '),
        );
        if (!(await askYes(c, 'Revoke this licence? The buyer is not refunded by the contract.')))
          return (c.logger.info('Nothing was sent.'), true);
        const r = await api.revokeLicense(key, admin);
        c.logger.info(
          r.sealed
            ? 'Revoked and sealed: it stops proving and settling now.'
            : `Revoked. It keeps working until the next seal (68)${r.sealableAt ? `, possible from ${new Date(r.sealableAt * 1000).toISOString()}` : ''}.`,
        );
        return true;
      }
      case '58': {
        const api = needApi(c);
        const card = readKind<OfferCard>(
          await ask(c, 'The offer card the breeder gave you (path): '),
          'veilcore-offer-card',
        );
        const o = await api.offer(Uint8Array.from(Buffer.from(card.offer, 'hex')));
        c.logger.info(describeOffer(o));
        if (o.rateCommit.some((x) => x !== 0))
          c.logger.info(`Royalty rate in your offer card: ${showAmount(BigInt(card.rate), o.color)} per unit.`);
        c.logger.info(
          `Buying sends ${showAmount(o.price, o.color)} from this wallet to the breeder's wallet in the same transaction.`,
        );
        if (!(await askYes(c, 'Buy one licence from this offer?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await api.buyLicense(card, c.mainAddress);
        const out = await ask(c, 'Write your licence card for the breeder to (path): ');
        writePrivate(out, r.licenceCard);
        c.logger.info(`Bought. Transaction ${r.txHash} at block ${r.blockHeight}.`);
        c.logger.info(
          'Give the breeder your licence card with the signed terms: it lets them read your settlements, and nothing more.',
        );
        return true;
      }
      case '59': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const o = await api.offer(offer);
        const amount = await askAmount(c, 'Amount to top up (a round amount hides more)', o.color);
        c.logger.info(
          `That sends ${showAmount(amount, o.color)} to the breeder's wallet now. Paying from the wallet that bought the ` +
            'licence links the two on chain; a buyer or processor paying for you (60) does not.',
        );
        if (!(await askYes(c, 'Top up?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await api.topUpOwn(offer, amount);
        c.logger.info(
          `Topped up. Transaction ${r.txHash}. Your credit: ${showAmount(await api.credit(offer), o.color)}.`,
        );
        return true;
      }
      case '60': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const req = await api.topUpRequest(offer);
        const out = await ask(c, 'Write the top-up request to (path): ');
        const { nonce: _nonce, ...file } = req;
        void _nonce;
        writePrivate(out, file);
        c.logger.info('Give it to whoever pays for you. When they tell you the amount they paid, record it (61).');
        return true;
      }
      case '61': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const o = await api.offer(offer);
        const amount = await askAmount(c, 'Amount they paid', o.color);
        await api.claimTopUp(offer, undefined, amount);
        c.logger.info(`Recorded. Your credit: ${showAmount(await api.credit(offer), o.color)}.`);
        return true;
      }
      case '62': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const period = await askPeriod(c, 'Period, as your terms name it (e.g. 2026-Q4): ');
        const units = await askWhole(c, 'Units it covers (tonnes, plants, straws: as your terms say): ');
        c.logger.info(
          'Settling spends your prepaid credit. No money moves, and nothing on chain shows the variety, the period, the ' +
            'units or the rate. Your breeder reads them with your licence card.',
        );
        if (!(await askYes(c, 'Settle?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await linkable(c, (evenIfLinkable) => api.settle(offer, period, units, { evenIfLinkable }));
        if (r === undefined) return true;
        c.logger.info(`Settled. Transaction ${r.txHash} at block ${r.blockHeight}.`);
        return true;
      }
      case '63': {
        const api = needApi(c);
        const h = await api.held();
        const offers = [...new Set(h.licences.map((l) => l.offer))];
        if (offers.length === 0) c.logger.info('This computer holds no licence on this contract.');
        for (const o of offers) {
          const id = Uint8Array.from(Buffer.from(o, 'hex'));
          const color = (await api.offer(id).catch(() => undefined))?.color ?? NIGHT_COLOR;
          c.logger.info(`offer ${short(o)}: credit ${showAmount(await api.credit(id), color)}`);
          for (const r of await api.settlements(id)) c.logger.info(`  settled ${r.period}: ${r.units} unit(s)`);
        }
        return true;
      }
      case '64': {
        const api = needApi(c);
        const req = readRequest(await ask(c, "The verifier's request file (path): "));
        const r = await linkable(c, (evenIfLinkable) => api.prove(req, { evenIfLinkable }));
        if (r === undefined) return true;
        c.logger.info(`Answered. Give the verifier this transaction id: ${r.txId}`);
        return true;
      }
      case '65': {
        const api = needApi(c);
        const req = readKind<TopUpRequest>(
          await ask(c, 'The top-up request you were given (path): '),
          'veilcore-topup-request',
        );
        const o = await api.offer(Uint8Array.from(Buffer.from(req.card.offer, 'hex')));
        const amount = await askAmount(c, 'Amount to pay', o.color);
        if (!(await askYes(c, `Send ${showAmount(amount, o.color)} to the breeder's wallet for this licensee?`)))
          return (c.logger.info('Nothing was sent.'), true);
        const r = await api.payTopUp(req, amount);
        c.logger.info(`Paid. Transaction ${r.txHash}. Tell the licensee the exact amount, so they can record it.`);
        return true;
      }
      case '66': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id the licence must be from (hex): ');
        const period = await ask(c, 'A settled period to ask for (label, blank for none): ');
        if (period !== '') periodBytes(period);
        const minUnits = period === '' ? 0n : await askWhole(c, 'For at least how many units: ', 0n);
        const fresh = (
          await ask(c, 'Use a one-off scope that cannot be matched to your other requests? (y/N): ')
        ).toLowerCase();
        const req = fresh.startsWith('y')
          ? newPresentationRequest({ contract: api.deployedContractAddress, offer, period, minUnits })
          : await api.presentationRequest({ offer, period, minUnits });
        if (!fresh.startsWith('y'))
          c.logger.info(
            'Your usual scope for this offer: if one licence answers you for several growers, you will see the ' +
              'same holder tag each time.',
          );
        const out = await ask(c, 'Write the request to file (path): ');
        writePrivate(out, req);
        c.logger.info(
          `Request written. Give it to the grower; it is good until ${new Date(Number(req.validAt) * 1000).toISOString()}.`,
        );
        c.logger.info(`Keep the file: you check the answer against it (67). Your scope: ${req.scope}`);
        return true;
      }
      case '67': {
        const api = needApi(c);
        const req = readRequest(await ask(c, 'Your request file (path): '));
        const v = await api.verifyPresentation(req, await ask(c, "The grower's transaction id: "), c.indexerUri);
        for (const l of v.lines) c.logger.info(l);
        c.logger.info(v.accepted ? 'ACCEPTED.' : 'NOT ACCEPTED (see above).');
        return true;
      }
      case '68': {
        const api = needApi(c);
        const s = await api.seal();
        c.logger.info(
          s.sealed
            ? 'Sealed.'
            : s.waiting
              ? `Nothing sealed yet; possible from ${s.sealableAt ? new Date(s.sealableAt * 1000).toISOString() : 'soon'}.`
              : 'Nothing waiting for a seal.',
        );
        const t = await api.clearEnded();
        c.logger.info(`Cleared ${t.licences} ended licence(s) and ${t.offers} ended offer(s).`);
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    if (e instanceof RoyaltiesInputError) {
      c.logger.error(e.message);
      return true;
    }
    throw e;
  }
};

const postOffer = async (c: RoyaltiesMenuContext): Promise<void> => {
  const api = needApi(c);
  const recordSecret = await c.recordSecret();
  if (recordSecret === undefined)
    throw new RoyaltiesInputError('This run acts as no record. Anchor one (1) or use one you hold (41) first.');
  const termsPath = await ask(c, 'Licence terms file (any file: PDF, text; only its fingerprint goes on chain): ');
  let terms: Uint8Array;
  try {
    terms = Uint8Array.from(createHash('sha256').update(readFileSync(termsPath)).digest());
  } catch (e) {
    throw new RoyaltiesInputError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tokenTyped = await ask(c, 'Token (Enter for NIGHT, or the token type in 64 hex): ');
  const color = tokenTyped === '' ? NIGHT_COLOR : Uint8Array.from(Buffer.from(tokenTyped.replace(/^0x/, ''), 'hex'));
  if (color.length !== 32) throw new RoyaltiesInputError('A token type is 64 hex characters.');
  const price = await askAmount(c, 'Price of one licence', color);
  const rate = await askAmount(c, 'Royalty per unit (0 for none through the contract; kept private)', color, true);
  const count = await askWhole(c, 'How many licences for sale: ');
  const days = await askWhole(c, 'Licences end in how many days: ');
  const revocable = (await ask(c, 'May you revoke a sold licence for breach? (y/N): ')).toLowerCase().startsWith('y');
  const payTo = await askWallet(c);
  const expires = BigInt(Math.floor(Date.now() / 1000)) + days * 86400n;
  c.logger.info(
    `Offer: ${count} licence(s) at ${showAmount(price, color)}, ending ${day(expires)}, ${revocable ? 'revocable' : 'not revocable'}, ` +
      `paid to ${hex(payTo)}. All public, except the royalty rate (${rate === 0n ? 'none' : `${showAmount(rate, color)} per unit`}), ` +
      'which only the offer card holds.',
  );
  if (!(await askYes(c, 'Post it?'))) return c.logger.info('Nothing was sent.');
  const out = await ask(c, 'Write the offer card for your licensees to (path): ');
  const r = await api.postOffer(
    recordSecret,
    { terms, color, price, rate, payTo, count, expires, revocable },
    c.mainAddress,
  );
  writePrivate(out, r.card);
  c.logger.info(
    `Posted. Offer id: ${hex(r.offer)}. Offer card written to ${out}: give it to licensees with the terms.`,
  );
  showSecret(
    'OFFER ADMIN SECRET: write it on paper now. It is the only way to close this offer or revoke its licences ' +
      'from another computer, and it cannot be recovered:',
    hex(r.adminSecret),
  );
};
