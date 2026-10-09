// SPDX-License-Identifier: Apache-2.0
/**
 * Main menu options 50 to 86: the royalties contract, protocol 4 (contract/src/veilcore-royalties.compact).
 * Test networks only until it is approved for mainnet (api/src/deploy-guard.ts).
 *
 * We never touch the money: growers pay their breeder however they already pay, and the
 * breeder issues the licence and the royalty credit on chain. Five roles, and the files
 * handed between them:
 *   breeder  posts an offer       -> OFFER CARD (rate and salt) to licensees
 *   grower   asks for a licence   -> LICENCE CARD (viewing keys) to the breeder, who issues it (82)
 *   grower   asks for credit      -> TOP-UP REQUEST (no rate) to the breeder, who issues it (83)
 *   grower   lets someone answer  -> PRESENTATION CARD (proves, never spends) to a delegate
 *   verifier asks for proof       -> LICENCE REQUEST to the grower, who answers on chain
 * An offer posted to take payment on chain also lets a grower buy a licence (58) and anyone
 * pay a top-up request through the contract (59, 65). The offer card holds the private
 * rate, and a presentation card lets its holder answer as the licence: hand them only to
 * the parties. A top-up request carries the offer's public fields and a code, never the rate.
 *
 * Every file is read without ever repeating its contents, every card is checked and
 * normalised before use, every output path is asked for and checked BEFORE anything is
 * sent, and every card this computer made can be written out again (77 to 79).
 */
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk/address-format';
import {
  AlreadyDoneError,
  CLEAR_ENDED_CAP,
  type ChartPlace,
  type LicenceCard,
  type LinkTermsCard,
  NIGHT_COLOR,
  type OfferView,
  type OwedRow,
  type PaymentPreview,
  type PresentationCard,
  type PresentationRequest,
  RoyaltiesAPI,
  WouldLinkError,
  codeFingerprint,
  newPresentationRequest,
  normaliseLicenceCard,
  normaliseLinkTerms,
  normaliseOfferCard,
  normalisePresentationCard,
  normaliseTopUpRequest,
  normalised,
  periodBytes,
} from '../../api/src/royalties-api.js';
import { assertRoyaltiesDeployAllowed } from '../../api/src/deploy-guard.js';
import { type RoyaltiesProviders } from '../../api/src/royalties-types.js';
import { licenceKeyOf, royaltiesPureCircuits } from '../../contract/src/royalties.js';
import { showSecret } from './secret-out.js';

export const ROYALTIES_MENU = `
 Royalties (third contract; test networks only). Growers pay their breeder off chain; the breeder issues licences
 and credit on chain; each period is settled in private.
 50. Deploy the royalties contract         Grower
 51. Join the royalties contract           84. Ask for a licence (writes your licence card)
 52. Finish a royalties deploy             60. Ask for credit (writes a top-up request)
 Breeder                                   61. Record credit issued or paid for you
 53. Post an offer (writes an offer card)  62. Settle a period (private)
 54. List offers                           63. Show your licences, credit and settlements
 82. Issue a licence (from a licence card) 64. Answer a licence request
 83. Issue credit (from a top-up request)  Verifier
 55. Read your licensees' settlements      66. Make a licence request
 56. Close an offer                        67. Check an answer
 57. Revoke a licence
 86. Name a new credit issuer key          68. Seal and tidy up (anyone)
 Only for offers that take payment on chain: 58. Buy a licence  59. Top up your own credit  65. Pay a top-up request
 Royalties on offspring (a new variety bred from a licensed one)
 Parent breeder                            Breeder of the new variety
 69. Offer terms for varieties bred from yours (writes a terms card)
 71. Confirm a new variety's link          70. Propose a link on a parent's terms card
 74. Move where a link pays you            72. Make your variety's ancestors final
 81. Lower a link's terms                  76. Withdraw an unconfirmed link
 85. What varieties bred from yours owe you
 Anyone: 73. Show a variety's pedigree chart, who it pays and what it owes
 75. Take over your earlier record's chart (after a key change)
 Files again: 77. Offer card  78. Your licence card  79. A presentation card for someone who answers for you
 80. Answer a licence request with a presentation card you were given`;

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
const unhex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const short = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;
const ask = async (c: RoyaltiesMenuContext, q: string): Promise<string> => (await c.rli.question(q)).trim();
const askYes = async (c: RoyaltiesMenuContext, q: string): Promise<boolean> =>
  (await ask(c, `${q} Type yes to send it, anything else to stop: `)).toLowerCase() === 'yes';
const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

const needProviders = (c: RoyaltiesMenuContext): RoyaltiesProviders => {
  if (c.providers === undefined) throw new RoyaltiesInputError('The royalties contract is not set up in this run.');
  return c.providers;
};

const needApi = (c: RoyaltiesMenuContext): RoyaltiesAPI => {
  if (c.api === undefined) throw new RoyaltiesInputError('Deploy (50) or join (51) the royalties contract first.');
  return c.api;
};

const needRecord = async (c: RoyaltiesMenuContext): Promise<Uint8Array> => {
  const s = await c.recordSecret();
  if (s === undefined)
    throw new RoyaltiesInputError('This run acts as no record. Anchor one (1) or use one you hold (41) first.');
  return s;
};

const ask32 = async (c: RoyaltiesMenuContext, q: string): Promise<Uint8Array> => {
  const a = (await ask(c, q)).replace(/^0x/i, '');
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

/** An amount as typed: NIGHT with up to 6 decimals, or another token's smallest unit. */
const parseAmount = (a: string, color: Uint8Array, allowZero = false): bigint => {
  let v: bigint;
  if (hex(color) === hex(NIGHT_COLOR)) {
    const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(a);
    if (m === null) throw new RoyaltiesInputError('That is not an amount of NIGHT. Nothing was sent.');
    v = BigInt(m[1]) * STAR + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  } else {
    if (!/^\d{1,19}$/.test(a)) throw new RoyaltiesInputError('That is not a whole number. Nothing was sent.');
    v = BigInt(a);
  }
  if (v >= 1n << 64n) throw new RoyaltiesInputError('That amount is too large. Nothing was sent.');
  if (v === 0n && !allowZero) throw new RoyaltiesInputError('The amount must be more than zero. Nothing was sent.');
  return v;
};

const askAmount = async (c: RoyaltiesMenuContext, q: string, color: Uint8Array, allowZero = false): Promise<bigint> =>
  parseAmount(
    await ask(
      c,
      `${q} (${hex(color) === hex(NIGHT_COLOR) ? 'NIGHT, up to 6 decimals' : "the token's smallest unit"}): `,
    ),
    color,
    allowZero,
  );

const showAmount = (amount: bigint, color: Uint8Array | string): string => {
  const h = typeof color === 'string' ? color : hex(color);
  return h === hex(NIGHT_COLOR)
    ? `${amount / STAR}.${(amount % STAR).toString().padStart(6, '0')} NIGHT`
    : `${amount} of token ${short(h)}`;
};

const tokenName = (h: string): string => (h === hex(NIGHT_COLOR) ? 'NIGHT' : `token ${short(h)}`);

const askToken = async (c: RoyaltiesMenuContext, q: string): Promise<Uint8Array> => {
  const t = (await ask(c, q)).replace(/^0x/i, '');
  if (t === '') return NIGHT_COLOR;
  if (!/^[0-9a-fA-F]{64}$/.test(t))
    throw new RoyaltiesInputError('A token type is 64 hex characters. Nothing was sent.');
  return Uint8Array.from(Buffer.from(t, 'hex'));
};

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
    `  list price ${showAmount(o.price, o.color)}; royalty ${o.rateCommit.every((x) => x === 0) ? 'none' : 'per unit, rate in the offer card (private)'}`,
    `  payment: ${o.onChainPayment ? 'through the contract (buy, top up), or issued by the breeder' : 'off chain; the breeder issues licences and credit'}`,
    `  ${o.remaining} left, ${o.live} issued or sold and live, ends ${day(o.expires)}, ${o.revocable ? 'revocable' : 'NOT revocable'}, ${o.open ? 'open' : 'closed'}`,
    `  breeder's record ${hex(o.record)}`,
    `  ${o.payTo.bytes.every((x) => x === 0) ? 'no wallet (paid off chain)' : `paid to wallet ${hex(o.payTo.bytes)}`}`,
    `  terms fingerprint ${hex(o.terms)}`,
  ].join('\n');

/**
 * Who a payment goes to and what leaves the payer's wallet, before anyone pays, with every
 * warning the payment's own checks would give. Returns false when there were warnings and
 * the person did not agree to go on despite them.
 */
const showPreview = async (c: RoyaltiesMenuContext, p: PaymentPreview, what: string): Promise<boolean> => {
  c.logger.info(`${what} offer ${p.offer}`);
  c.logger.info(`  breeder's record ${p.record}`);
  c.logger.info(`  paid to wallet ${p.payTo}`);
  c.logger.info(`  terms fingerprint ${p.terms} (the sha256 of the signed terms file: check it matches yours)`);
  c.logger.info(
    `  in all, this sends from this wallet: ${p.totals.map((t) => showAmount(t.amount, t.color)).join(' + ')}`,
  );
  if (p.warnings.length === 0) return true;
  for (const w of p.warnings) c.logger.warn(`  WARNING: ${w}.`);
  if ((await ask(c, 'Type yes to go on despite these warnings, anything else to stop: ')).toLowerCase() === 'yes')
    return true;
  c.logger.info('Nothing was sent.');
  return false;
};

// ─────────────────────────────────────────────────────────────── files

/** A path as typed, with a leading ~ meaning the home folder (as the shell would). */
export const expandPath = (typed: string): string => {
  const t = typed.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (t === '~') return homedir();
  if (t.startsWith('~/')) return path.join(homedir(), t.slice(2));
  return t;
};

const askPath = async (c: RoyaltiesMenuContext, q: string): Promise<string> => {
  const p = expandPath(await ask(c, q));
  if (p === '') throw new RoyaltiesInputError('No path given. Nothing was sent.');
  return p;
};

/** A path to write to, checked before anything is sent: its folder exists and is writable, and it is new. */
const askOutPath = async (c: RoyaltiesMenuContext, q: string): Promise<string> => {
  const p = await askPath(c, q);
  const dir = path.dirname(path.resolve(p));
  try {
    if (!statSync(dir).isDirectory()) throw new Error('not a folder');
    accessSync(dir, constants.W_OK);
  } catch {
    throw new RoyaltiesInputError(`Cannot write in ${dir} (no such folder, or not writable). Nothing was sent.`);
  }
  if (existsSync(p)) throw new RoyaltiesInputError(`${p} already exists: choose another name. Nothing was sent.`);
  return p;
};

/** Write a card the user must keep. If that fails after a transaction, say how to write it again. */
const writeCard = (c: RoyaltiesMenuContext, file: string, value: unknown, again: string): boolean => {
  try {
    writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'error';
    c.logger.error(`Could not write ${file} (${code}). It is kept on this computer: write it again with ${again}.`);
    return false;
  }
};

/** A JSON file's contents. Refusals name the file and the reason, never what is in it. */
const readJson = (file: string): unknown => {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new RoyaltiesInputError(`Could not read ${file} (${(e as NodeJS.ErrnoException).code ?? 'error'}).`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RoyaltiesInputError(`${file} is not a card or request file (not valid JSON).`);
  }
};

const readWith = <T>(file: string, f: (v: unknown) => T): T => {
  const v = readJson(file);
  try {
    return f(v);
  } catch (e) {
    throw new RoyaltiesInputError(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const readRequest = (file: string): PresentationRequest => readWith(file, (v) => normalised(v as PresentationRequest));

/** Licence card files: a folder of them, or paths separated by commas. Other JSON files are skipped. */
const readCards = (c: RoyaltiesMenuContext, typed: string): unknown[] => {
  const paths = typed
    .split(',')
    .map((s) => expandPath(s))
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
  const cards: unknown[] = [];
  let skipped = 0;
  for (const p of paths) {
    try {
      const v = JSON.parse(readFileSync(p, 'utf8')) as { kind?: unknown } | null;
      if (v !== null && typeof v === 'object' && v.kind === 'veilcore-licence-card') cards.push(v);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) c.logger.info(`Skipped ${skipped} file(s) that are not licence cards.`);
  if (cards.length === 0) throw new RoyaltiesInputError('No licence cards found there.');
  return cards;
};

// ─────────────────────────────────────────────────────────────── showing

/** Who a payment of `total` pays, place by place (`total` 10000 shows shares as basis points). Ended links are left out. */
const showChart = (
  c: RoyaltiesMenuContext,
  places: readonly ChartPlace[],
  total: bigint,
  color: Uint8Array,
  withFees = true,
): void => {
  const now = nowSeconds();
  const gen = ['', 'parent', 'grandparent', 'great-grandparent'];
  const running = places.filter((p) => p.until > now);
  if (running.length < places.length)
    c.logger.info(`  (${places.length - running.length} ancestor link(s) have ended and take nothing)`);
  for (const p of running) {
    const share = (total * BigInt(Math.round(p.effectiveShare * 100))) / 1_000_000n;
    const sameToken = p.color === hex(color);
    c.logger.info(
      `  ${gen[p.generation]} ${short(p.parent)}: ${p.effectiveShare / 100}%` +
        (!sameToken && p.effectiveShare > 0
          ? ` (owed in ${tokenName(p.color)}: nothing from a payment in ${tokenName(hex(color))})`
          : sameToken && total !== 10000n
            ? ` (about ${showAmount(share, color)})`
            : '') +
        (withFees && p.fee > 0n ? ` + fee ${showAmount(p.fee, p.color)}` : '') +
        ` to ${short(p.payTo)}, until ${day(p.until)}`,
    );
  }
};

/** Owed rows, totalled per group (`label`) and token. */
const showOwed = (c: RoyaltiesMenuContext, rows: readonly OwedRow[], label: (r: OwedRow) => string): void => {
  const groups = new Map<string, OwedRow[]>();
  for (const r of rows) groups.set(label(r), [...(groups.get(label(r)) ?? []), r]);
  for (const [name, rs] of groups) {
    const totals = new Map<string, bigint>();
    for (const r of rs) {
      if (r.share > 0n) totals.set(r.color, (totals.get(r.color) ?? 0n) + r.share);
      if (r.fee > 0n) totals.set(r.feeColor, (totals.get(r.feeColor) ?? 0n) + r.fee);
    }
    const licences = new Set(rs.filter((r) => r.kind === 'licence').map((r) => r.key)).size;
    const credit = new Set(rs.filter((r) => r.kind === 'credit').map((r) => r.key)).size;
    c.logger.info(
      `  ${name}: ${[...totals].map(([col, a]) => showAmount(a, col)).join(' + ')} ` +
        `(${licences} licence(s), ${credit} credit issuance(s))`,
    );
  }
};

/**
 * The breeder's own check of its books, per offer read: credit this computer issued
 * against royalties the licences read have settled. Settled beyond what was issued (on an
 * offer that takes no payment on chain) means credit came from somewhere else.
 */
const showBooks = async (
  c: RoyaltiesMenuContext,
  api: RoyaltiesAPI,
  found: readonly { readonly offer: string; readonly units: bigint }[],
): Promise<void> => {
  for (const offer of new Set(found.map((f) => f.offer))) {
    const card = await api.offerCard(unhex(offer)).catch(() => undefined);
    if (card === undefined) continue;
    const units = found.filter((f) => f.offer === offer).reduce((a, f) => a + f.units, 0n);
    const settled = units * BigInt(card.rate);
    const issued = await api.issuedTotal(unhex(offer));
    const color = unhex(card.color);
    c.logger.info(
      `offer ${short(offer)}: the licences read settled ${units} unit(s), worth ${showAmount(settled, color)}; this ` +
        `computer issued ${showAmount(issued.total, color)} of credit on it (${issued.count} issuance(s)).`,
    );
    if (settled > issued.total && card.onChainPayment !== true)
      c.logger.warn(
        '  WARNING: more was settled than this computer issued. If no other computer of yours issues credit for ' +
          'this offer, its issuer key may be in other hands: name a new one (86).',
      );
  }
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
      c.logger.info(
        e.afterOwnMerge
          ? 'The settlement was not sent (your merged credit is on chain). Try again later.'
          : 'Nothing was sent. Try again later.',
      );
      return undefined;
    }
    return f(true);
  }
};

/** Run `f`; if it may repeat something already done, explain and ask before running it again with `again`. */
const unlessDone = async <T>(
  c: RoyaltiesMenuContext,
  question: string,
  f: (again: boolean) => Promise<T>,
): Promise<T | undefined> => {
  try {
    return await f(false);
  } catch (e) {
    if (!(e instanceof AlreadyDoneError)) throw e;
    c.logger.info(e.message);
    if (!(await askYes(c, question))) return (c.logger.info('Nothing was sent.'), undefined);
    return f(true);
  }
};

/** Handle a main-menu choice 50-81. Returns false for any other choice. */
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
          c,
          await ask(c, "Your licensees' licence cards (a folder, or files separated by commas): "),
        );
        const periods = (await ask(c, 'Periods to look for (labels separated by commas, e.g. 2026-Q3,2026-Q4): '))
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        for (const p of periods)
          try {
            periodBytes(p);
          } catch (e) {
            throw new RoyaltiesInputError(e instanceof Error ? e.message : String(e));
          }
        const { found, refused } = await api.readSettlements(cards, periods);
        for (const r of refused)
          c.logger.error(
            `Skipped a card${r.licence !== undefined ? ` for licence ${short(r.licence)}` : ''}: ${r.why}`,
          );
        if (found.length === 0) c.logger.info('None of those licensees has settled anything yet.');
        for (const s of found)
          c.logger.info(
            `licence ${short(s.licence)}  ${s.period === undefined ? 'a period NOT in your list' : `period ${s.period}`}` +
              `  units ${s.units}  (offer ${short(s.offer)})` +
              (s.number === undefined
                ? '  OUT OF SEQUENCE: an earlier settlement number of this licence is missing'
                : ''),
          );
        const accepted = [...new Set(found.map((f) => f.licence))];
        const read = cards.length - refused.length;
        const missing = periods.flatMap((p) =>
          accepted.filter((l) => !found.some((f) => f.licence === l && f.period === p)).map((l) => `${short(l)} ${p}`),
        );
        if (missing.length > 0) c.logger.info(`Not settled yet: ${missing.join('; ')}`);
        if (read > accepted.length)
          c.logger.info(`${read - accepted.length} licence(s) read have settled nothing at all.`);
        await showBooks(c, api, found);
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
            : `Revoked. It keeps working until it is sealed (68)${r.sealableAt ? `, possible from ${new Date(r.sealableAt * 1000).toISOString()}` : ''}. ` +
                'A revocation is sealed at most once an hour, so it can take up to an hour.',
        );
        return true;
      }
      case '58': {
        const api = needApi(c);
        const card = readWith(await askPath(c, 'The offer card the breeder gave you (path): '), normaliseOfferCard);
        const o = await api.offer(unhex(card.offer));
        c.logger.info(describeOffer(o));
        if (!o.onChainPayment)
          throw new RoyaltiesInputError(
            'That offer takes no payment through the contract: ask for a licence (84) and pay the breeder as your ' +
              'terms say; they issue it. Nothing was sent.',
          );
        if (o.rateCommit.some((x) => x !== 0))
          c.logger.info(`Royalty rate in your offer card: ${showAmount(BigInt(card.rate), o.color)} per unit.`);
        if (
          !(await showPreview(c, await api.paymentPreview(o.id, undefined, c.mainAddress), 'Buying one licence from'))
        )
          return true;
        showChart(c, await api.chart(o.record), o.price, o.color);
        const out = await askOutPath(c, 'Where to write your licence card for the breeder (path): ');
        if (!(await askYes(c, 'Buy one licence from this offer?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await unlessDone(c, 'Buy another licence from it?', (again) =>
          api.buyLicense(card, c.mainAddress, { again }),
        );
        if (r === undefined) return true;
        c.logger.info(`Bought. Transaction ${r.txHash} at block ${r.blockHeight}.`);
        if (writeCard(c, out, r.licenceCard, '78'))
          c.logger.info(
            `Licence card written to ${out}. Give it to the breeder with the signed terms: it lets them read your ` +
              'settlements, and nothing more.',
          );
        return true;
      }
      case '59': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const o = await api.offer(offer);
        if (!o.onChainPayment)
          throw new RoyaltiesInputError(
            'That offer takes no payment through the contract: make a top-up request (60), pay the breeder as your ' +
              'terms say, and they issue the credit. Nothing was sent.',
          );
        const amount = await askAmount(c, 'Amount to top up (a round amount hides more)', o.color);
        if (
          !(await showPreview(c, await api.paymentPreview(offer, amount, c.mainAddress), 'Topping up your credit on'))
        )
          return true;
        c.logger.info(
          'Paying from the wallet that bought the licence links the two on chain; a buyer or processor paying for you ' +
            '(60) does not.',
        );
        if (!(await askYes(c, 'Top up?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await api.topUpOwn(offer, amount, c.mainAddress);
        c.logger.info(
          `Topped up. Transaction ${r.txHash}. Your credit: ${showAmount(await api.credit(offer), o.color)}.`,
        );
        return true;
      }
      case '60': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const out = await askOutPath(c, 'Write the top-up request to (path): ');
        const { nonce: _nonce, fingerprint, ...file } = await api.topUpRequest(offer);
        void _nonce;
        if (!writeCard(c, out, file, '60 again (a new request)')) return true;
        c.logger.info(
          `Written. It names the offer and its wallet, not your royalty rate. Give it to your breeder with your ` +
            `payment (they issue that much credit to it, 83), or, for an offer that takes payment on chain, to ` +
            `whoever pays for you (65). Tell them separately (by phone or in person) its code fingerprint: ` +
            `${fingerprint}. Their client shows it first; a different one means the file was changed on the way. ` +
            'When they tell you the amount issued or paid, record it (61). One request per amount: use a new one ' +
            'for each payment.',
        );
        return true;
      }
      case '61': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const o = await api.offer(offer);
        const amount = await askAmount(c, 'Amount they issued or paid', o.color);
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
        const r = await unlessDone(c, 'Settle that period again (a second settlement, charged again)?', (again) =>
          linkable(c, (evenIfLinkable) => api.settle(offer, period, units, { evenIfLinkable, again })),
        );
        if (r === undefined) return true;
        c.logger.info(`Settled. Transaction ${r.txHash} at block ${r.blockHeight}.`);
        return true;
      }
      case '63': {
        const api = needApi(c);
        const h = await api.held();
        const offers = [...new Set(h.licences.map((l) => l.offer))];
        if (offers.length === 0) c.logger.info('This computer holds no licence on this contract.');
        const l = await api.currentLedger();
        for (const o of offers) {
          const id = unhex(o);
          const color =
            (await api.offer(id).catch(() => undefined))?.color ??
            (h.offerCards?.[o] !== undefined ? unhex(h.offerCards[o].color) : NIGHT_COLOR);
          c.logger.info(`offer ${short(o)}: credit ${showAmount(await api.credit(id), color)}`);
          for (const x of h.licences.filter((y) => y.offer === o)) {
            const key = licenceKeyOf(unhex(x.secret), id, BigInt(x.expires));
            c.logger.info(
              `  licence ${short(hex(key))}: ${
                l.licenseOffer.member(key)
                  ? BigInt(x.expires) > nowSeconds()
                    ? 'live'
                    : 'ended'
                  : l.everSold.member(key)
                    ? 'revoked or cleared'
                    : 'not issued yet (the breeder issues it from your licence card)'
              }`,
            );
          }
          for (const r of await api.settlements(id)) c.logger.info(`  settled ${r.period}: ${r.units} unit(s)`);
        }
        return true;
      }
      case '64':
      case '80': {
        const api = needApi(c);
        const card =
          choice === '80'
            ? readWith(await askPath(c, 'The presentation card you were given (path): '), normalisePresentationCard)
            : undefined;
        const req = readRequest(await askPath(c, "The verifier's request file (path): "));
        showRequest(c, req);
        if (!(await askYes(c, 'Answer it on chain?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await linkable(c, (evenIfLinkable) => api.prove(req, { evenIfLinkable, card }));
        if (r === undefined) return true;
        c.logger.info(`Answered. Give the verifier this transaction id: ${r.txId}`);
        return true;
      }
      case '65': {
        const api = needApi(c);
        const req = readWith(await askPath(c, 'The top-up request you were given (path): '), normaliseTopUpRequest);
        const o = await api.offer(unhex(req.card.offer));
        if (!o.onChainPayment)
          throw new RoyaltiesInputError(
            "That offer takes no payment through the contract: pay the breeder as the licensee's terms say; the " +
              'breeder issues the credit. Nothing was sent.',
          );
        const amount = await askAmount(c, 'Amount to pay', o.color);
        c.logger.info(
          `Code fingerprint ${codeFingerprint(req.code)}: ask the licensee for theirs (by phone or in person). If it ` +
            'differs, the request was changed on the way and would credit someone else. Do not pay.',
        );
        if (o.split) {
          c.logger.info('Each ancestor share is paid in the same transaction:');
          showChart(c, await api.chart(o.record), amount, o.color, false);
        }
        if (!(await showPreview(c, await api.paymentPreview(o.id, amount, c.mainAddress), 'Topping up a licensee of')))
          return true;
        if (!(await askYes(c, `Send ${showAmount(amount, o.color)} for this licensee?`)))
          return (c.logger.info('Nothing was sent.'), true);
        const r = await api.payTopUp(req, amount, c.mainAddress);
        c.logger.info(`Paid. Transaction ${r.txHash}. Tell the licensee the exact amount, so they can record it.`);
        return true;
      }
      case '66': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id the licence must be from (hex): ');
        const period = await ask(c, 'A settled period to ask for (label, blank for none): ');
        if (period !== '')
          try {
            periodBytes(period);
          } catch (e) {
            throw new RoyaltiesInputError(e instanceof Error ? e.message : String(e));
          }
        const minUnits = period === '' ? 0n : await askWhole(c, 'For at least how many units: ', 0n);
        const live =
          period === '' ||
          !(await ask(c, 'Accept a licence that has ended since, if that period was settled under it? (y/N): '))
            .toLowerCase()
            .startsWith('y');
        const fresh = (
          await ask(c, 'Use a one-off scope that cannot be matched to your other requests? (y/N): ')
        ).toLowerCase();
        const out = await askOutPath(c, 'Write the request to file (path): ');
        const req = fresh.startsWith('y')
          ? newPresentationRequest({ contract: api.deployedContractAddress, offer, period, minUnits, live })
          : await api.presentationRequest({ offer, period, minUnits, live });
        if (!fresh.startsWith('y'))
          c.logger.info(
            'Your usual scope for this offer: if one licence answers you for several growers, you will see the ' +
              'same holder tag each time.',
          );
        if (period !== '')
          c.logger.info(
            "A period label is matched exactly: if the terms charge per delivery, ask for that delivery's label, or " +
              'one settled season can vouch for any number of deliveries.',
          );
        if (!writeCard(c, out, req, '66 again')) return true;
        c.logger.info(
          `Request written. Give it to the grower; it is good until ${new Date(Number(req.validAt) * 1000).toISOString()}.`,
        );
        c.logger.info(`Keep the file: you check the answer against it (67). Your scope: ${req.scope}`);
        return true;
      }
      case '67': {
        const api = needApi(c);
        const req = readRequest(await askPath(c, 'Your request file (path): '));
        const v = await api.verifyPresentation(
          req,
          await ask(c, "The grower's transaction id: "),
          c.indexerUri,
          c.mainAddress,
        );
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
              ? `Nothing sealed yet; possible from ${s.sealableAt ? new Date(s.sealableAt * 1000).toISOString() : 'soon'} ` +
                '(a revocation is sealed at most once an hour).'
              : 'Nothing waiting for a seal.',
        );
        const n = await api.clearable();
        if (n.licences === 0 && n.offers === 0) return (c.logger.info('Nothing to clear.'), true);
        const now = Math.min(n.licences, CLEAR_ENDED_CAP);
        if (
          !(await askYes(
            c,
            `Clear ${now} of ${n.licences} ended licence(s) and remove ended offers with none left (${n.offers} ended)? ` +
              'Each is its own transaction, paid from this wallet.',
          ))
        )
          return (c.logger.info('Nothing was sent.'), true);
        const t = await api.clearEnded();
        c.logger.info(`Cleared ${t.licences} ended licence(s) and ${t.offers} ended offer(s).`);
        if (n.licences > now) c.logger.info(`${n.licences - now} more can be cleared: run 68 again.`);
        return true;
      }
      case '69': {
        const api = needApi(c);
        const recordSecret = await needRecord(c);
        c.logger.info(
          'These are the terms a new variety bred from yours owes you. Its breeder proposes them and you confirm; ' +
            'once confirmed, the child can never change them, and you can only lower them (81).',
        );
        const color = await askToken(c, 'Token the fee and share are paid in (Enter for NIGHT, or 64 hex): ');
        const fee = await askAmount(c, 'Fee per licence the new variety sells (0 for none)', color, true);
        const shareTyped = await ask(
          c,
          'Share of its licence price and royalty top-ups, in percent (0 to 50, e.g. 10 or 2.5): ',
        );
        const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(shareTyped);
        if (m === null) throw new RoyaltiesInputError('That is not a percentage from 0 to 50.');
        const share = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
        if (share > 5000n) throw new RoyaltiesInputError('A share is at most 50%.');
        const generations = await askWhole(c, 'How many generations it follows (1 to 3; halves each generation): ');
        if (generations > 3n) throw new RoyaltiesInputError('A link runs for 1 to 3 generations.');
        const days = await askWhole(c, 'Ends in how many days: ');
        const payTo = await askWallet(c);
        const childTyped = (await ask(c, "The new variety's record, if you know it (hex; Enter for any): ")).replace(
          /^0x/i,
          '',
        );
        if (childTyped !== '' && !/^[0-9a-fA-F]{64}$/.test(childTyped))
          throw new RoyaltiesInputError('A record is 64 hex characters.');
        const out = await askOutPath(c, 'Write the terms card to (path): ');
        const card = await api.linkTerms(recordSecret, {
          color,
          fee,
          share,
          generations,
          until: nowSeconds() + days * 86400n,
          payTo,
          ...(childTyped !== '' ? { child: unhex(childTyped.toLowerCase()) } : {}),
        });
        if (!writeCard(c, out, card, '69 again (new terms)')) return true;
        c.logger.info(
          "Written. Give it to the new variety's breeder. Confirm their link with 71 once they propose it, and " +
            'confirm the parentage in the VeilCore contract only after that. The key that can move where you are ' +
            'paid (74) or lower the terms (81) is kept on this computer.',
        );
        return true;
      }
      case '70': {
        const api = needApi(c);
        const recordSecret = await needRecord(c);
        const raw = readWith(await askPath(c, "The parent's terms card (path): "), normaliseLinkTerms);
        const { card, inherited, warnings } = await api.checkLinkTerms(recordSecret, raw, c.mainAddress);
        showTerms(c, card);
        if (inherited.length > 0) {
          c.logger.info("The parent's own ancestors that would pass down to your variety with it:");
          showChart(c, inherited, 10000n, unhex(card.color), false);
        }
        for (const w of warnings) c.logger.warn(`Warning: ${w}.`);
        c.logger.info(
          'Once the parent confirms, this link can never be removed, and every offer of your variety pays it.',
        );
        if (!(await askYes(c, 'Propose a link on these terms?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await api.proposeLink(recordSecret, card, c.mainAddress);
        c.logger.info(
          `Proposed. Link ${hex(r.link)}. Propose exactly record ${card.parent} as your parent in the VeilCore ` +
            'contract (16), if you have not.',
        );
        return true;
      }
      case '71': {
        const api = needApi(c);
        const recordSecret = await needRecord(c);
        const child = await ask32(c, "The new variety's record (hex): ");
        const parent = royaltiesPureCircuits.recordCommit(recordSecret);
        const l = await api.currentLedger();
        const id = royaltiesPureCircuits.linkId(child, parent);
        if (!l.links.member(id)) throw new RoyaltiesInputError('No link proposed from that record to yours.');
        const k = l.links.lookup(id);
        c.logger.info(
          `Link ${hex(id)}: ${Number(k.share) / 100}% for ${k.generations} generation(s), fee ` +
            `${showAmount(k.fee, k.color)}, until ${day(k.until)}, paid to ${short(hex(k.payTo.bytes))}.`,
        );
        if (!(await askYes(c, 'Confirm this link on your terms? The child can never change it.')))
          return (c.logger.info('Nothing was sent.'), true);
        await api.confirmLink(recordSecret, child);
        c.logger.info('Confirmed. Now confirm the parentage in the VeilCore contract too (17).');
        return true;
      }
      case '72': {
        const api = needApi(c);
        const recordSecret = await needRecord(c);
        const preview = await api.finalisePreview(recordSecret, c.mainAddress);
        for (const w of preview.warnings) c.logger.warn(w);
        if (preview.places.length === 0)
          c.logger.info('Your variety will have no ancestors paid through this contract.');
        else {
          c.logger.info('Your pedigree chart will be:');
          showChart(c, preview.places, 10000n, NIGHT_COLOR);
        }
        c.logger.info('This can never be changed: no link can be added or dropped later.');
        if (preview.concerns.length > 0) {
          for (const w of preview.concerns) c.logger.warn(`  STOP: ${w}.`);
          c.logger.warn(
            'Every confirmed link must be in the chart, so these cannot be left out. If you would rather not pay them, ' +
              'a key change in the VeilCore contract gives you a new record with no links (its offers are new offers).',
          );
          if ((await ask(c, 'Type FINAL to make this chart final anyway, anything else to stop: ')) !== 'FINAL')
            return (c.logger.info('Nothing was sent.'), true);
        } else if (!(await askYes(c, 'Make your ancestors final?'))) return (c.logger.info('Nothing was sent.'), true);
        await api.finaliseStack(recordSecret, c.mainAddress, { despite: preview.concerns.length > 0 });
        c.logger.info('Final.');
        return true;
      }
      case '73': {
        const api = needApi(c);
        const record = await ask32(c, "The variety's record (hex): ");
        const places = await api.chart(record);
        if (places.length === 0) c.logger.info('No ancestors are paid by this record (or its chart is not final yet).');
        else showChart(c, places, 10000n, NIGHT_COLOR);
        const ped = await api.pedigreeIn(c.mainAddress, record);
        c.logger.info(ped.ok ? 'Pedigree: matches the VeilCore contract.' : `Pedigree: REFUSED, ${ped.why}.`);
        if (ped.ok) for (const w of ped.warnings) c.logger.info(`Warning: ${w}`);
        const rows = await api.owed({ record });
        if (rows.length > 0) {
          c.logger.info('Recorded as owed to its ancestors by licences and credit issued off chain:');
          showOwed(
            c,
            rows,
            (r) => `${['', 'parent', 'grandparent', 'great-grandparent'][r.generation]} ${short(r.parent)}`,
          );
        }
        return true;
      }
      case '74': {
        const api = needApi(c);
        const link = await ask32(c, 'Link id (hex): ');
        const payTo = await askWallet(c);
        c.logger.info(`New wallet: ${hex(payTo)}. A link can be changed once in 30 days.`);
        if (!(await askYes(c, 'Move where this link pays?'))) return (c.logger.info('Nothing was sent.'), true);
        await api.movePayee(link, payTo);
        c.logger.info('Moved.');
        return true;
      }
      case '75': {
        const api = needApi(c);
        const recordSecret = await needRecord(c);
        const earlier = await ask32(c, 'Your earlier record (hex): ');
        if (!(await askYes(c, "Take over that record's chart, unchanged?")))
          return (c.logger.info('Nothing was sent.'), true);
        await api.adoptStack(recordSecret, earlier, c.mainAddress);
        c.logger.info('Done.');
        return true;
      }
      case '76': {
        const api = needApi(c);
        const recordSecret = await needRecord(c);
        await api.withdrawLink(recordSecret, await ask32(c, "The parent's record (hex): "));
        c.logger.info('Withdrawn.');
        return true;
      }
      case '77': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id (hex): ');
        const card = await api.offerCard(offer).catch(() => {
          throw new RoyaltiesInputError('This computer holds no offer card for that offer.');
        });
        const out = await askOutPath(c, 'Write the offer card to (path): ');
        if (writeCard(c, out, card, '77 again')) c.logger.info(`Written to ${out}. It holds the private rate.`);
        return true;
      }
      case '78': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const card: LicenceCard = await api.licenceCard(offer).catch((e: unknown) => {
          throw new RoyaltiesInputError(e instanceof Error ? e.message : String(e));
        });
        const out = await askOutPath(c, 'Write your licence card to (path): ');
        if (writeCard(c, out, card, '78 again')) c.logger.info(`Written to ${out}.`);
        return true;
      }
      case '79': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const card: PresentationCard = await api.presentationCard(offer).catch((e: unknown) => {
          throw new RoyaltiesInputError(e instanceof Error ? e.message : String(e));
        });
        c.logger.info(
          `A presentation card lets whoever holds it answer licence requests AS this licence (${short(card.licence)}), ` +
            `and READ the units of every settlement of it, the ${card.receipts.length} made so far and every one ` +
            'after. It can never spend your credit or settle. Nothing takes it back short of ending the licence: ' +
            'hand it only to someone you would let see these books and answer for you.',
        );
        if ((await ask(c, 'Type yes to write it, anything else to stop: ')).toLowerCase() !== 'yes')
          return (c.logger.info('Nothing was written.'), true);
        const out = await askOutPath(c, 'Write the presentation card to (path): ');
        if (writeCard(c, out, card, '79 again')) c.logger.info(`Written to ${out}. They answer with 80.`);
        return true;
      }
      case '81': {
        const api = needApi(c);
        const link = await ask32(c, 'Link id (hex): ');
        const l = await api.currentLedger();
        if (!l.links.member(link)) throw new RoyaltiesInputError('No such link.');
        const k = l.links.lookup(link);
        c.logger.info(
          `Now: ${Number(k.share) / 100}%, fee ${showAmount(k.fee, k.color)}, until ${day(k.until)}. Terms can only be ` +
            'lowered, once in 30 days, and lowering is final.',
        );
        const shareTyped = await ask(c, 'New share in percent (Enter to keep): ');
        let share: bigint | undefined;
        if (shareTyped !== '') {
          const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(shareTyped);
          if (m === null) throw new RoyaltiesInputError('That is not a percentage.');
          share = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
        }
        const feeTyped = await ask(c, 'New fee (Enter to keep; 0 for none): ');
        const fee = feeTyped === '' ? undefined : parseAmount(feeTyped, k.color, true);
        const daysTyped = await ask(c, 'End it in how many days from now (Enter to keep the end date): ');
        if (daysTyped !== '' && !/^\d{1,6}$/.test(daysTyped))
          throw new RoyaltiesInputError('That is not a number of days.');
        const until = daysTyped === '' ? undefined : nowSeconds() + BigInt(daysTyped) * 86400n;
        const warnings =
          share === undefined || share === k.share ? [] : await api.relaxWarnings(link, share, until ?? k.until);
        for (const w of warnings) c.logger.warn(`  WARNING: ${w}.`);
        if (
          !(await askYes(
            c,
            warnings.length > 0
              ? 'Lower this link to those terms for good, despite these warnings?'
              : 'Lower this link to those terms, for good?',
          ))
        )
          return (c.logger.info('Nothing was sent.'), true);
        await api.relaxLink(link, { share, fee, until }, { despite: warnings.length > 0 });
        c.logger.info('Lowered.');
        return true;
      }
      case '82': {
        const api = needApi(c);
        const card = readWith(await askPath(c, "The licensee's licence card (path): "), normaliseLicenceCard);
        const o = await api.offer(unhex(card.offer));
        c.logger.info(describeOffer(o));
        c.logger.info(`Licence ${card.licence}`);
        const admin = adminTyped(
          await c.hidden('Admin secret (64 hex; Enter if this computer posted it; nothing shows): '),
        );
        const places = (await api.chart(o.record)).filter((p) => p.until > nowSeconds());
        if (places.some((p) => p.effectiveShare > 0 || p.fee > 0)) {
          c.logger.info(
            "This variety's ancestors take a share of each licence's list price, and parents a fee: issuing records " +
              'on chain that you owe them this (pay them as you agreed):',
          );
          showChart(c, places, o.price, o.color);
        }
        if (!(await askYes(c, 'Issue this licence? Only once the licensee has paid you, as your terms say.')))
          return (c.logger.info('Nothing was sent.'), true);
        try {
          const r = await api.issueLicence(card, admin);
          c.logger.info(`Issued. Transaction ${r.txHash} at block ${r.blockHeight}.`);
        } catch (e) {
          if (!(e instanceof AlreadyDoneError)) throw e;
          c.logger.info(`${e.message} (If you issued it before and the wait timed out, it did land: nothing to do.)`);
          return true;
        }
        c.logger.info(
          "Keep the licence card with your licensees' cards: 55 reads its settlements with it. No money moved through " +
            'the contract.',
        );
        return true;
      }
      case '83': {
        const api = needApi(c);
        const req = readWith(await askPath(c, "The licensee's top-up request (path): "), normaliseTopUpRequest);
        const o = await api.offer(unhex(req.card.offer));
        c.logger.info(describeOffer(o));
        c.logger.info(
          `Code fingerprint ${codeFingerprint(req.code)}: ask the licensee for theirs (by phone or in person). If it ` +
            'differs, the request was changed on the way and would credit someone else. Do not issue.',
        );
        const amount = await askAmount(c, 'Credit to issue (what they paid you for royalties)', o.color);
        if (o.split) {
          c.logger.info(
            "This variety's ancestors take a share of royalties: this issuance names the offer and the amount on " +
              'chain, and records that you owe them (pay them as you agreed):',
          );
          showChart(c, await api.issuePreview(o.id), amount, o.color, false);
        } else
          c.logger.info(
            "On chain this shows only that some offer's credit issuer issued some credit: not the offer, the " +
              'licensee or the amount. No money moves.',
          );
        if (!(await askYes(c, `Issue ${showAmount(amount, o.color)} of credit to this request?`)))
          return (c.logger.info('Nothing was sent.'), true);
        let r;
        try {
          r = await linkable(c, (evenIfLinkable) => api.issueCredit(req, amount, { evenIfLinkable }));
        } catch (e) {
          if (!(e instanceof AlreadyDoneError)) throw e;
          c.logger.info(e.message);
          return true;
        }
        if (r === undefined) return true;
        const books = await api.issuedTotal(o.id);
        c.logger.info(
          `Issued. Transaction ${r.txHash}. Tell the licensee the exact amount (${showAmount(amount, o.color)}), so ` +
            `they record it (61). Issued on this offer from this computer so far: ${showAmount(books.total, o.color)} ` +
            `in ${books.count} issuance(s).`,
        );
        return true;
      }
      case '84': {
        const api = needApi(c);
        const card = readWith(await askPath(c, 'The offer card the breeder gave you (path): '), normaliseOfferCard);
        const o = await api.offer(unhex(card.offer));
        c.logger.info(describeOffer(o));
        if (o.rateCommit.some((x) => x !== 0))
          c.logger.info(`Royalty rate in your offer card: ${showAmount(BigInt(card.rate), o.color)} per unit.`);
        c.logger.info(
          `  terms fingerprint ${hex(o.terms)} (the sha256 of the signed terms file: check it matches yours)`,
        );
        const warnings = await api.licenceChecks(o.id, c.mainAddress);
        for (const w of warnings) c.logger.warn(`  WARNING: ${w}.`);
        if (
          warnings.length > 0 &&
          (await ask(c, 'Type yes to go on despite these warnings, anything else to stop: ')).toLowerCase() !== 'yes'
        )
          return (c.logger.info('Nothing was written.'), true);
        const out = await askOutPath(c, 'Where to write your licence card for the breeder (path): ');
        if (
          (
            await ask(c, 'Make a licence for this offer? No transaction: your breeder issues it. Type yes: ')
          ).toLowerCase() !== 'yes'
        )
          return (c.logger.info('Nothing was written.'), true);
        const r = await unlessDone(c, 'Make another licence for this offer?', (again) =>
          api.requestLicence(card, c.mainAddress, { again }),
        );
        if (r === undefined) return true;
        if (writeCard(c, out, r.licenceCard, '78'))
          c.logger.info(
            `Licence card written to ${out}. Give it to the breeder with your payment, as your terms say: they issue ` +
              'the licence from it (63 shows when it is live), and it lets them read your settlements, nothing more.',
          );
        return true;
      }
      case '85': {
        const api = needApi(c);
        const typed = (await ask(c, "The ancestor's record (hex; Enter for your own record): ")).replace(/^0x/i, '');
        let parent: Uint8Array;
        if (typed === '') parent = royaltiesPureCircuits.recordCommit(await needRecord(c));
        else if (/^[0-9a-fA-F]{64}$/.test(typed)) parent = unhex(typed.toLowerCase());
        else throw new RoyaltiesInputError('A record is 64 hex characters.');
        const rows = await api.owed({ parent });
        if (rows.length === 0) {
          c.logger.info('Nothing is recorded as owed to that record by licences or credit issued off chain.');
          return true;
        }
        showOwed(c, rows, (r) => `variety ${short(r.record)}, offer ${short(r.offer)}`);
        c.logger.info(
          'Recorded by the contract when each licence and credit was issued, at the terms you agreed. Whether it was ' +
            "paid is between you and the descendant's breeder: this is the record you both work from.",
        );
        return true;
      }
      case '86': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id (hex): ');
        const admin = adminTyped(
          await c.hidden('Admin secret (64 hex; Enter if this computer posted it; nothing shows): '),
        );
        c.logger.info(
          'A new credit issuer key is made and kept on this computer. The old one stops issuing at the next seal (at ' +
            'most an hour). Credit it already issued stays valid: compare what you issued with what was settled (55).',
        );
        if (!(await askYes(c, 'Name a new credit issuer for this offer?')))
          return (c.logger.info('Nothing was sent.'), true);
        const r = await api.changeCreditIssuer(offer, admin);
        c.logger.info(
          r.sealed
            ? 'Done and sealed: only the new key issues now.'
            : `Done. The old key can still issue until it is sealed (68)${r.sealableAt ? `, possible from ${new Date(r.sealableAt * 1000).toISOString()}` : ''}.`,
        );
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

const showTerms = (c: RoyaltiesMenuContext, card: LinkTermsCard): void => {
  c.logger.info(`Parent record: ${card.parent}`);
  c.logger.info(
    `Terms: ${Number(card.share) / 100}% of your licence prices and royalty top-ups, for ${card.generations} ` +
      `generation(s); fee ${showAmount(BigInt(card.fee), card.color)} per licence (paid by your buyers on top of ` +
      `your price); until ${day(BigInt(card.until))}; paid to wallet ${card.payTo}; token ` +
      `${card.color === hex(NIGHT_COLOR) ? 'NIGHT' : card.color}.`,
  );
};

const showRequest = (c: RoyaltiesMenuContext, r: PresentationRequest): void => {
  const period = unhex(r.period);
  const text = Buffer.from(period.filter((x) => x !== 0)).toString('utf8');
  // A verifier wrote this label: show it only if it is plain printable text, else as hex.
  const label = /^[\x20-\x7e]+$/.test(text) ? text : `(not plain text: ${r.period})`;
  c.logger.info(`The verifier asks about offer ${r.offer}:`);
  c.logger.info(
    r.period === '0'.repeat(64)
      ? `  a licence live on ${new Date(Number(r.validAt) * 1000).toISOString()}`
      : `  period ${label} settled for at least ${r.minUnits} unit(s), under a licence ${
          r.live === false
            ? 'from that offer (live or since ended)'
            : `live on ${new Date(Number(r.validAt) * 1000).toISOString()}`
        }`,
  );
  c.logger.info('  Answering publishes a tag only this verifier can check; it names nothing else.');
};

const postOffer = async (c: RoyaltiesMenuContext): Promise<void> => {
  const api = needApi(c);
  const recordSecret = await needRecord(c);
  const termsPath = await askPath(c, 'Licence terms file (any file: PDF, text; only its fingerprint goes on chain): ');
  let terms: Uint8Array;
  try {
    terms = Uint8Array.from(createHash('sha256').update(readFileSync(termsPath)).digest());
  } catch (e) {
    throw new RoyaltiesInputError(`Could not read that file (${(e as NodeJS.ErrnoException).code ?? 'error'}).`);
  }
  const color = await askToken(c, 'Token (Enter for NIGHT, or the token type in 64 hex): ');
  const price = await askAmount(c, "List price of one licence (public; ancestors' shares are worked out on it)", color);
  const rate = await askAmount(c, 'Royalty per unit (0 for none; kept private)', color, true);
  const count = await askWhole(c, 'How many licences: ');
  const days = await askWhole(c, 'Licences end in how many days: ');
  const revocable = (await ask(c, 'May you revoke a licence for breach? (y/N): ')).toLowerCase().startsWith('y');
  const onChainPayment = (
    await ask(
      c,
      'Also take payment THROUGH the contract (growers buy licences and top up credit on chain, in this token)? ' +
        'Most offers do not: you issue licences and credit when paid. (y/N): ',
    )
  )
    .toLowerCase()
    .startsWith('y');
  // Paid off chain, the offer names no wallet (nothing is paid to one, and none is published).
  const payTo = onChainPayment ? await askWallet(c) : new Uint8Array(32);
  const expires = nowSeconds() + days * 86400n;
  c.logger.info(
    `Offer: ${count} licence(s) at a list price of ${showAmount(price, color)}, ending ${day(expires)}, ` +
      `${revocable ? 'revocable' : 'not revocable'}, ${onChainPayment ? `wallet ${hex(payTo)}` : 'no wallet'}, ` +
      `terms fingerprint ${hex(terms)}, ` +
      `${onChainPayment ? 'payment through the contract allowed' : 'paid off chain (you issue licences and credit)'}. ` +
      `All public, except the royalty rate (${rate === 0n ? 'none' : `${showAmount(rate, color)} per unit`}), which ` +
      'only the offer card holds.',
  );
  const out = await askOutPath(c, 'Where to write the offer card for your licensees (path): ');
  if (!(await askYes(c, 'Post it?'))) return c.logger.info('Nothing was sent.');
  const r = await unlessDone(c, 'Post another offer with the same terms?', (again) =>
    api.postOffer(
      recordSecret,
      { terms, color, price, rate, payTo, count, expires, revocable, onChainPayment },
      c.mainAddress,
      { again },
    ),
  );
  if (r === undefined) return;
  c.logger.info(`Posted. Offer id: ${hex(r.offer)}.`);
  showSecret(
    'OFFER ADMIN SECRET: write it on paper now. It is the only way to issue licences, close this offer, revoke ' +
      'its licences or name a new credit issuer from another computer, and it cannot be recovered:',
    hex(r.adminSecret),
  );
  c.logger.info(
    "The key that issues this offer's credit is kept on this computer. If it is lost, or may be stolen, name a new " +
      'one with the admin secret (86).',
  );
  if (writeCard(c, out, r.card, '77'))
    c.logger.info(`Offer card written to ${out}: give it to licensees with the terms. It holds the private rate.`);
};
