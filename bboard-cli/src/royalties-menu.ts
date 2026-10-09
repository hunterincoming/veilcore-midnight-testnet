// SPDX-License-Identifier: Apache-2.0
/**
 * Main menu options 50 to 86: the royalties contract, protocol 4 (contract/src/veilcore-royalties.compact).
 * Test networks only until it is approved for mainnet (api/src/deploy-guard.ts).
 *
 * We never touch the money: no circuit of the contract moves tokens. Growers pay their
 * breeder however they already pay, in their own currency, and the breeder issues the
 * licence and the royalty credit on chain. Every offer names the unit its amounts are counted
 * in ("USD cents", "JPY"); every amount is shown in it. Five roles, and the files handed
 * between them:
 *   breeder  posts an offer       -> OFFER CARD (rate and salt) to licensees
 *   grower   asks for a licence   -> LICENCE CARD (viewing keys) to the breeder, who issues it (82)
 *   grower   asks for credit      -> TOP-UP REQUEST (no rate) to the breeder, who issues it (83)
 *   grower   lets someone answer  -> PRESENTATION CARD (proves, never spends) to a delegate
 *   verifier asks for proof       -> LICENCE REQUEST to the grower, who answers on chain
 * The offer card holds the private rate, and a presentation card lets its holder answer as
 * the licence: hand them only to the parties. A licence card and a top-up request each have
 * a fingerprint both sides read out by phone before the breeder issues.
 *
 * Every file is read without ever repeating its contents, every card is checked and
 * normalised before use, every output path is asked for and checked BEFORE anything is
 * sent, and every card this computer made can be written out again (77 to 79). While a
 * replaced credit issuer key waits for its seal, every royalties choice sends the seal as
 * soon as it is due.
 */
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import {
  AlreadyDoneError,
  CLEAR_ENDED_CAP,
  type ChartPlace,
  type LicenceCard,
  type LinkTermsCard,
  type OfferView,
  type OwedRow,
  type PresentationCard,
  type PresentationRequest,
  RoyaltiesAPI,
  WouldLinkError,
  codeFingerprint,
  licenceFingerprint,
  newPresentationRequest,
  normaliseLicenceCard,
  normaliseLinkTerms,
  normaliseOfferCard,
  normalisePresentationCard,
  normaliseTopUpRequest,
  normalised,
  owedTotal,
  periodBytes,
} from '../../api/src/royalties-api.js';
import { assertRoyaltiesDeployAllowed } from '../../api/src/deploy-guard.js';
import { type RoyaltiesProviders } from '../../api/src/royalties-types.js';
import { licenceKeyOf, royaltiesPureCircuits, unitLabel, unitOf } from '../../contract/src/royalties.js';
import { showSecret } from './secret-out.js';

export const ROYALTIES_MENU = `
 Royalties (third contract; test networks only). Growers pay their breeder off chain, in their own currency; the
 breeder issues licences and credit on chain; each period is settled in private. No money passes through it.
 50. Deploy the royalties contract         Grower
 51. Join the royalties contract           84. Ask for a licence (writes your licence card)
 52. Finish a royalties deploy             60. Ask for credit (writes a top-up request)
 Breeder                                   61. Record credit the breeder issued you
 53. Post an offer (writes an offer card)  62. Settle a period (private)
 54. List offers                           63. Show your licences, credit and settlements
 82. Issue a licence (from a licence card) 64. Answer a licence request
 83. Issue credit (from a top-up request)  Verifier
 55. Read your licensees' settlements      66. Make a licence request
 56. Close an offer                        67. Check an answer
 57. Revoke a licence
 86. Name a new credit issuer key          68. Seal and tidy up (anyone)
 Royalties on offspring (a new variety bred from a licensed one)
 Parent breeder                            Breeder of the new variety
 69. Offer terms for varieties bred from yours (writes a terms card)
 71. Confirm a new variety's link          70. Propose a link on a parent's terms card
 81. Lower a link's terms                  72. Make your variety's ancestors final
 85. What varieties bred from yours owe you 76. Withdraw an unconfirmed link
 Anyone: 73. Show a variety's pedigree chart and what it owes
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

/** STARs per NIGHT (1 NIGHT = 10^6 STAR): an offer counted in NIGHT takes up to 6 decimals. */
const STAR = 1_000_000n;

/** A unit's label for showing ("USD cents"), or its hex when it is not plain text. */
const unitName = (unit: Uint8Array | string): string => {
  const b = typeof unit === 'string' ? unhex(unit) : unit;
  return unitLabel(b) ?? `unit ${short(hex(b))}`;
};
const isNight = (unit: Uint8Array | string): boolean => unitName(unit) === 'NIGHT';

/** An amount as typed: whole numbers of the unit (NIGHT alone takes up to 6 decimals). */
const parseAmount = (a: string, unit: Uint8Array | string, allowZero = false): bigint => {
  let v: bigint;
  if (isNight(unit)) {
    const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(a);
    if (m === null) throw new RoyaltiesInputError('That is not an amount of NIGHT. Nothing was sent.');
    v = BigInt(m[1]) * STAR + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  } else {
    if (!/^\d{1,19}$/.test(a))
      throw new RoyaltiesInputError(`That is not a whole number of ${unitName(unit)}. Nothing was sent.`);
    v = BigInt(a);
  }
  if (v >= 1n << 64n) throw new RoyaltiesInputError('That amount is too large. Nothing was sent.');
  if (v === 0n && !allowZero) throw new RoyaltiesInputError('The amount must be more than zero. Nothing was sent.');
  return v;
};

const askAmount = async (
  c: RoyaltiesMenuContext,
  q: string,
  unit: Uint8Array | string,
  allowZero = false,
): Promise<bigint> =>
  parseAmount(
    await ask(c, `${q} (${isNight(unit) ? 'NIGHT, up to 6 decimals' : `whole ${unitName(unit)}`}): `),
    unit,
    allowZero,
  );

const showAmount = (amount: bigint, unit: Uint8Array | string): string =>
  isNight(unit)
    ? `${amount / STAR}.${(amount % STAR).toString().padStart(6, '0')} NIGHT`
    : `${amount} ${unitName(unit)}`;

/** The unit an offer or a link counts amounts in, as typed (any short label). */
const askUnit = async (c: RoyaltiesMenuContext, q: string): Promise<string> => {
  const t = await ask(c, q);
  try {
    unitOf(t);
  } catch (e) {
    throw new RoyaltiesInputError(`${e instanceof Error ? e.message : String(e)} Nothing was sent.`);
  }
  return t;
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
    `  amounts in ${unitName(o.unit)}; list price ${showAmount(o.price, o.unit)}; royalty ${o.rateCommit.every((x) => x === 0) ? 'none' : 'per unit of produce, rate in the offer card (private)'}`,
    '  paid off chain; the breeder issues licences and credit',
    `  ${o.remaining} left, ${o.live} issued or sold and live, ends ${day(o.expires)}, ${o.revocable ? 'revocable' : 'NOT revocable'}, ${o.open ? 'open' : 'closed'}`,
    `  breeder's record ${hex(o.record)}`,
    `  terms fingerprint ${hex(o.terms)}`,
  ].join('\n');

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

/**
 * What an amount of `total` owes each ancestor, place by place (`total` 10000 shows shares
 * as basis points). Ended links are left out. The contract records each share exactly; the
 * amounts shown here are rounded down to whole units.
 */
const showChart = (
  c: RoyaltiesMenuContext,
  places: readonly ChartPlace[],
  total: bigint,
  unit: Uint8Array | string,
  withFees = true,
): void => {
  const now = nowSeconds();
  const u = typeof unit === 'string' ? unit : hex(unit);
  const gen = ['', 'parent', 'grandparent', 'great-grandparent'];
  const running = places.filter((p) => p.until > now);
  if (running.length < places.length)
    c.logger.info(`  (${places.length - running.length} ancestor link(s) have ended and take nothing)`);
  for (const p of running) {
    const share = (total * BigInt(Math.round(p.effectiveShare * 100))) / 1_000_000n;
    const sameUnit = p.unit === u;
    c.logger.info(
      `  ${gen[p.generation]} ${short(p.parent)}: ${p.effectiveShare / 100}%` +
        (!sameUnit && p.effectiveShare > 0
          ? ` (owed in ${unitName(p.unit)}: nothing from an amount in ${unitName(u)})`
          : sameUnit && total !== 10000n
            ? ` (about ${showAmount(share, u)})`
            : '') +
        (withFees && p.fee > 0n ? ` + fee ${showAmount(p.fee, p.unit)}` : '') +
        `, until ${day(p.until)}`,
    );
  }
};

/** Owed rows, totalled exactly per group (`label`) and unit. */
const showOwed = (c: RoyaltiesMenuContext, rows: readonly OwedRow[], label: (r: OwedRow) => string): void => {
  const groups = new Map<string, OwedRow[]>();
  for (const r of rows) groups.set(label(r), [...(groups.get(label(r)) ?? []), r]);
  for (const [name, rs] of groups) {
    const totals = owedTotal(rs);
    const licences = new Set(rs.filter((r) => r.kind === 'licence').map((r) => r.key)).size;
    const credit = new Set(rs.filter((r) => r.kind === 'credit').map((r) => r.key)).size;
    c.logger.info(
      `  ${name}: ${[...totals].map(([u, a]) => showAmount(a, u)).join(' + ') || 'nothing'} ` +
        `(${licences} licence(s), ${credit} credit issuance(s))`,
    );
  }
};

/**
 * The breeder's own check of its books, per offer read: credit this computer issued
 * against royalties the licences read have settled. Settled beyond what was issued means
 * credit came from somewhere else.
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
    c.logger.info(
      `offer ${short(offer)}: the licences read settled ${units} unit(s), worth ${showAmount(settled, card.unit)}; ` +
        `this computer issued ${showAmount(issued.total, card.unit)} of credit on it (${issued.count} issuance(s)).`,
    );
    if (settled > issued.total)
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

const ROYALTY_CHOICES = new Set(Array.from({ length: 37 }, (_, i) => String(50 + i)));

/**
 * While a replaced credit issuer key waits for its seal, the old key can still issue: send
 * the seal as soon as it is due, whatever royalties choice was made. A failure only logs.
 */
const sealReplacedIssuer = async (c: RoyaltiesMenuContext): Promise<void> => {
  if (c.api === undefined) return;
  try {
    const s = await c.api.sealIfIssuerChangeDue();
    if (s !== undefined)
      c.logger.info(
        s.sealed
          ? 'Sealed: a replaced credit issuer key can no longer issue.'
          : 'A replaced credit issuer key is waiting for its seal; it was not sealed yet (68 tries again).',
      );
  } catch (e) {
    c.logger.info(`Seal for a replaced credit issuer key not sent now: ${e instanceof Error ? e.message : String(e)}`);
  }
};

/** Handle a main-menu choice 50-86. Returns false for any other choice. */
export const handleRoyaltiesChoice = async (choice: string, c: RoyaltiesMenuContext): Promise<boolean> => {
  if (ROYALTY_CHOICES.has(choice)) await sealReplacedIssuer(c);
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
      case '60': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const out = await askOutPath(c, 'Write the top-up request to (path): ');
        const { nonce: _nonce, fingerprint, ...file } = await api.topUpRequest(offer);
        void _nonce;
        if (!writeCard(c, out, file, '60 again (a new request)')) return true;
        c.logger.info(
          `Written. It names the offer and a code, not you or your royalty rate. Give it to your breeder with your ` +
            `payment, however your terms say you pay (they issue that much credit to it, 83). Tell them separately ` +
            `(by phone or in person) its code fingerprint: ${fingerprint}. Their client shows it first; a different ` +
            'one means the file was changed on the way. When they tell you the amount issued, record it (61). One ' +
            'request per payment: make a new one each time.',
        );
        return true;
      }
      case '61': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const o = await api.offer(offer);
        const amount = await askAmount(c, 'Amount the breeder issued', o.unit);
        await api.claimTopUp(offer, undefined, amount);
        c.logger.info(`Recorded. Your credit: ${showAmount(await api.credit(offer), o.unit)}.`);
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
          const unit =
            (await api.offer(id).catch(() => undefined))?.unit ??
            (h.offerCards?.[o] !== undefined ? unhex(h.offerCards[o].unit) : new Uint8Array(32));
          c.logger.info(`offer ${short(o)}: credit ${showAmount(await api.credit(id), unit)}`);
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
        const unitText = await askUnit(
          c,
          "Unit the fee and share are counted in (the new variety's offers must name the same; e.g. USD cents): ",
        );
        const unit = unitOf(unitText);
        const fee = await askAmount(c, 'Fee per licence the new variety issues (0 for none)', unit, true);
        const shareTyped = await ask(
          c,
          'Share of its licence prices and royalty credit, in percent (0 to 50, e.g. 10 or 2.5): ',
        );
        const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(shareTyped);
        if (m === null) throw new RoyaltiesInputError('That is not a percentage from 0 to 50.');
        const share = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
        if (share > 5000n) throw new RoyaltiesInputError('A share is at most 50%.');
        const generations = await askWhole(c, 'How many generations it follows (1 to 3; halves each generation): ');
        if (generations > 3n) throw new RoyaltiesInputError('A link runs for 1 to 3 generations.');
        const days = await askWhole(c, 'Ends in how many days: ');
        const childTyped = (await ask(c, "The new variety's record, if you know it (hex; Enter for any): ")).replace(
          /^0x/i,
          '',
        );
        if (childTyped !== '' && !/^[0-9a-fA-F]{64}$/.test(childTyped))
          throw new RoyaltiesInputError('A record is 64 hex characters.');
        const out = await askOutPath(c, 'Write the terms card to (path): ');
        const card = await api.linkTerms(recordSecret, {
          unit: unitText,
          fee,
          share,
          generations,
          until: nowSeconds() + days * 86400n,
          ...(childTyped !== '' ? { child: unhex(childTyped.toLowerCase()) } : {}),
        });
        if (!writeCard(c, out, card, '69 again (new terms)')) return true;
        c.logger.info(
          "Written. Give it to the new variety's breeder. Confirm their link with 71 once they propose it, and " +
            'confirm the parentage in the VeilCore contract only after that. The key that can lower the terms (81) ' +
            'is kept on this computer. What its licences and credit owe you is recorded on chain (85); payment is ' +
            'between you and its breeder, off chain.',
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
          showChart(c, inherited, 10000n, card.unit, false);
        }
        for (const w of warnings) c.logger.warn(`Warning: ${w}.`);
        c.logger.info(
          'Once the parent confirms, this link can never be removed, and every licence and credit your variety ' +
            'issues records what it owes the parent.',
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
            `${showAmount(k.fee, k.unit)}, until ${day(k.until)}, in ${unitName(k.unit)}.`,
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
        if (preview.places.length === 0) c.logger.info('Your variety will owe no ancestors through this contract.');
        else {
          c.logger.info('Your pedigree chart will be:');
          showChart(c, preview.places, 10000n, preview.places[0].unit);
        }
        c.logger.info('This can never be changed: no link can be added or dropped later.');
        if (preview.concerns.length > 0) {
          for (const w of preview.concerns) c.logger.warn(`  STOP: ${w}.`);
          c.logger.warn(
            'Every confirmed link must be in the chart, so these cannot be left out. If you would rather not owe them, ' +
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
        if (places.length === 0) c.logger.info('This record owes no ancestors (or its chart is not final yet).');
        else showChart(c, places, 10000n, places[0].unit);
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
          `Now: ${Number(k.share) / 100}%, fee ${showAmount(k.fee, k.unit)}, until ${day(k.until)}. Terms can only be ` +
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
        const fee = feeTyped === '' ? undefined : parseAmount(feeTyped, k.unit, true);
        const daysTyped = await ask(c, 'End it in how many days from now (Enter to keep the end date): ');
        if (daysTyped !== '' && !/^\d{1,6}$/.test(daysTyped))
          throw new RoyaltiesInputError('That is not a number of days.');
        const until = daysTyped === '' ? undefined : nowSeconds() + BigInt(daysTyped) * 86400n;
        if (!(await askYes(c, 'Lower this link to those terms, for good?')))
          return (c.logger.info('Nothing was sent.'), true);
        await api.relaxLink(link, { share, fee, until });
        c.logger.info('Lowered.');
        return true;
      }
      case '82': {
        const api = needApi(c);
        const card = readWith(await askPath(c, "The licensee's licence card (path): "), normaliseLicenceCard);
        const o = await api.offer(unhex(card.offer));
        c.logger.info(describeOffer(o));
        c.logger.info(`Licence ${card.licence}`);
        c.logger.info(
          `Licence card fingerprint ${licenceFingerprint(card.licence)}: ask the licensee for theirs (by phone or in ` +
            'person). If it differs, the card was changed on the way. Do not issue.',
        );
        const admin = adminTyped(
          await c.hidden('Admin secret (64 hex; Enter if this computer posted it; nothing shows): '),
        );
        const places = (await api.chart(o.record)).filter((p) => p.until > nowSeconds());
        if (places.some((p) => p.effectiveShare > 0 || p.fee > 0)) {
          c.logger.info(
            "This variety's ancestors take a share of each licence's list price, and parents a fee: issuing records " +
              'on chain that you owe them this (pay them as you agreed):',
          );
          showChart(c, places, o.price, o.unit);
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
        const o = await api.offer(unhex(req.offer));
        c.logger.info(describeOffer(o));
        c.logger.info(
          `Code fingerprint ${codeFingerprint(req.code)}: ask the licensee for theirs (by phone or in person). If it ` +
            'differs, the request was changed on the way and would credit someone else. Do not issue.',
        );
        const amount = await askAmount(c, 'Credit to issue (what they paid you for royalties)', o.unit);
        const preview = await api.issuePreview(o.id);
        if (o.split) {
          c.logger.info(
            "This variety's ancestors take a share of royalties: this issuance names the offer and the amount on " +
              'chain, and records that you owe them (pay them as you agreed):',
          );
          showChart(c, preview.places, amount, o.unit, false);
        } else {
          c.logger.info(
            'What this publishes names neither the offer, the licensee nor the amount. But it can only be from an ' +
              `offer that has issued licences and takes royalties, and there are ${preview.candidates ?? 0} of those ` +
              'on this contract. No money moves.',
          );
          if (preview.warning !== undefined) c.logger.warn(`  WARNING: ${preview.warning}.`);
        }
        if (!(await askYes(c, `Issue ${showAmount(amount, o.unit)} of credit to this request?`)))
          return (c.logger.info('Nothing was sent.'), true);
        let r;
        try {
          r = await api.issueCredit(req, amount);
        } catch (e) {
          if (!(e instanceof AlreadyDoneError)) throw e;
          c.logger.info(e.message);
          return true;
        }
        const books = await api.issuedTotal(o.id);
        c.logger.info(
          `Issued. Transaction ${r.txHash}. Tell the licensee the exact amount (${showAmount(amount, o.unit)}), so ` +
            `they record it (61). Issued on this offer from this computer so far: ${showAmount(books.total, o.unit)} ` +
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
          c.logger.info(
            `Royalty rate in your offer card: ${showAmount(BigInt(card.rate), o.unit)} per unit of produce.`,
          );
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
              'the licence from it (63 shows when it is live), and it lets them read your settlements, nothing more. ' +
              `Tell them separately (by phone or in person) its fingerprint: ${licenceFingerprint(r.licenceCard.licence)}.`,
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
        // Matched by identity through the VeilCore contract: links made from an earlier record of yours count.
        const rows = await api.owed({ parent, mainAddress: c.mainAddress });
        if (rows.length === 0) {
          c.logger.info('Nothing is recorded as owed to that record by licences or credit issued off chain.');
          return true;
        }
        showOwed(c, rows, (r) => `variety ${short(r.record)}, offer ${short(r.offer)}`);
        c.logger.info(
          'Recorded by the contract when each licence and credit was issued, at the terms you agreed, exactly (each ' +
            'record keeps the base amount and your cut; shown here added up, rounded down once). Whether it was paid ' +
            "is between you and the descendant's breeder: this is the record you both work from.",
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
          'A new credit issuer key is made and kept on this computer. The old one can still issue until a seal is ' +
            'sent, which can be at most an hour after the last one: this client sends it as soon as it is due ' +
            '(whenever you use the royalties menu), and anyone can with 68. Credit the old key already issued stays ' +
            'valid: compare what you issued with what was settled (55).',
        );
        if (!(await askYes(c, 'Name a new credit issuer for this offer?')))
          return (c.logger.info('Nothing was sent.'), true);
        const r = await api.changeCreditIssuer(offer, admin);
        c.logger.info(
          r.sealed
            ? 'Done and sealed: only the new key issues now.'
            : `Done. The old key can still issue until a seal is sent: run 68 from ${
                r.sealableAt ? new Date(r.sealableAt * 1000).toISOString() : 'now'
              } (this client also sends it then, at your next royalties choice).`,
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
    `Terms: ${Number(card.share) / 100}% of your licence list prices and royalty credit, for ${card.generations} ` +
      `generation(s); fee ${showAmount(BigInt(card.fee), card.unit)} per licence you issue; until ` +
      `${day(BigInt(card.until))}; counted in ${unitName(card.unit)}. Owed, and recorded on chain as each licence ` +
      'and credit is issued; paid off chain, as you and the parent agree.',
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
  const unitText = await askUnit(
    c,
    'Unit every amount of this offer is counted in (your currency, e.g. USD cents, EUR cents, JPY; or NIGHT): ',
  );
  const unit = unitOf(unitText);
  const price = await askAmount(c, "List price of one licence (public; ancestors' shares are worked out on it)", unit);
  const rate = await askAmount(c, 'Royalty per unit of produce (0 for none; kept private)', unit, true);
  const count = await askWhole(c, 'How many licences: ');
  const days = await askWhole(c, 'Licences end in how many days: ');
  const revocable = (await ask(c, 'May you revoke a licence for breach? (y/N): ')).toLowerCase().startsWith('y');
  const expires = nowSeconds() + days * 86400n;
  c.logger.info(
    `Offer: ${count} licence(s) at a list price of ${showAmount(price, unit)}, ending ${day(expires)}, ` +
      `${revocable ? 'revocable' : 'not revocable'}, terms fingerprint ${hex(terms)}. Growers pay you off chain, ` +
      `in ${unitText}; you issue their licences and credit. All public, except the royalty rate ` +
      `(${rate === 0n ? 'none' : `${showAmount(rate, unit)} per unit of produce`}), which only the offer card holds.`,
  );
  const out = await askOutPath(c, 'Where to write the offer card for your licensees (path): ');
  if (!(await askYes(c, 'Post it?'))) return c.logger.info('Nothing was sent.');
  const r = await unlessDone(c, 'Post another offer with the same terms?', (again) =>
    api.postOffer(recordSecret, { terms, unit: unitText, price, rate, count, expires, revocable }, c.mainAddress, {
      again,
    }),
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
