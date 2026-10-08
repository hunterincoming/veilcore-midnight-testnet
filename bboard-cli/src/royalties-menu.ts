// SPDX-License-Identifier: Apache-2.0
/**
 * Main menu options 50 to 63: the royalties contract (contract/src/veilcore-royalties.compact).
 * Test networks only until it is approved for mainnet (api/src/deploy-guard.ts).
 *
 * Breeders post offers and run them with an admin secret shown once, to be written on
 * paper. Growers buy licences and pay royalties; a licensee can hand a payer a receipt
 * code so someone else pays for them. Verifiers write a request file, the licensee answers
 * it, and the verifier checks the answer. Secrets are never logged except when shown on
 * purpose (showSecret), as the main menu does.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk/address-format';
import {
  NIGHT_COLOR,
  type OfferView,
  type PresentationRequest,
  RoyaltiesAPI,
  newPresentationRequest,
  periodBytes,
} from '../../api/src/royalties-api.js';
import { assertRoyaltiesDeployAllowed } from '../../api/src/deploy-guard.js';
import { type RoyaltiesProviders } from '../../api/src/royalties-types.js';
import { showSecret } from './secret-out.js';

export const ROYALTIES_MENU = `
 Royalties (third contract: licences sold on chain, royalties paid through; test networks only)
 50. Deploy the royalties contract         56. Pay a royalty for your licence
 51. Join the royalties contract           57. Give a payer your receipt code (as licensee)
 52. Finish a royalties deploy             58. Pay a royalty for someone (with their code)
 53. Post an offer (as breeder)            59. Make a licence request (as verifier)
 54. List offers                           60. Answer a licence request (as licensee)
 55. Buy a licence (as grower)             61. Check an answer (as verifier)
 62. Close an offer (as breeder)           63. Revoke a licence (as breeder)
 64. Seal and tidy up (anyone)`;

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

/** STARs per NIGHT (1 NIGHT = 10^6 STAR). */
const STAR = 1_000_000n;

/** An amount: NIGHT with up to 6 decimals for NIGHT, else whole smallest units. */
const askAmount = async (c: RoyaltiesMenuContext, q: string, color: Uint8Array): Promise<bigint> => {
  const night = hex(color) === hex(NIGHT_COLOR);
  const a = await ask(c, `${q} (${night ? 'NIGHT, up to 6 decimals' : "the token's smallest unit"}): `);
  if (night) {
    const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(a);
    if (m === null) throw new RoyaltiesInputError('That is not an amount of NIGHT. Nothing was sent.');
    return BigInt(m[1]) * STAR + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  }
  if (!/^\d{1,30}$/.test(a)) throw new RoyaltiesInputError('That is not a whole number. Nothing was sent.');
  return BigInt(a);
};

const showAmount = (amount: bigint, color: Uint8Array): string =>
  hex(color) === hex(NIGHT_COLOR)
    ? `${amount / STAR}.${(amount % STAR).toString().padStart(6, '0')} NIGHT`
    : `${amount} of token ${hex(color).slice(0, 12)}...`;

/** A payout wallet: Enter for this wallet, a bech32 unshielded address, or 64 hex. */
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

/** An admin secret as typed: blank for the one held here, else 64 hex (spaces and dashes ignored). */
const adminTyped = (typed: string): Uint8Array | undefined => {
  const t = typed.replace(/[\s-]/g, '').replace(/^0x/i, '');
  if (t === '') return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(t))
    throw new RoyaltiesInputError('An admin secret is 64 hex characters. Nothing was sent.');
  return Uint8Array.from(Buffer.from(t, 'hex'));
};

const day = (unix: bigint): string => new Date(Number(unix) * 1000).toISOString().slice(0, 10);

const describeOffer = (o: OfferView): string =>
  [
    `offer ${hex(o.id)}`,
    `  record ${hex(o.record)}`,
    `  price ${showAmount(o.price, o.color)}, royalty ${o.perUnit === 0n ? 'none through the contract' : `${showAmount(o.perUnit, o.color)} per unit`}`,
    `  ${o.remaining} left, ${o.live} sold and live, ends ${day(o.expires)}, ${o.revocable ? 'revocable' : 'NOT revocable'}, ${o.open ? 'open' : 'closed'}`,
    `  terms fingerprint ${hex(o.terms)}`,
  ].join('\n');

const readRequest = (path: string): PresentationRequest => {
  let r: PresentationRequest;
  try {
    r = JSON.parse(readFileSync(path, 'utf8')) as PresentationRequest;
  } catch (e) {
    throw new RoyaltiesInputError(`Could not read that request file: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const k of ['contract', 'offer', 'period', 'minUnits', 'validAt', 'scope', 'challenge'] as const)
    if (typeof r[k] !== 'string') throw new RoyaltiesInputError(`That request file has no ${k}.`);
  return r;
};

/** Handle a main-menu choice 50-64. Returns false for any other choice. */
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
      case '51': {
        c.api = await RoyaltiesAPI.join(
          needProviders(c),
          hex(await ask32(c, 'Royalties contract address (hex): ')),
          c.logger,
        );
        c.logger.info(`Joined royalties contract at ${c.api.deployedContractAddress}.`);
        return true;
      }
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
        const o = await api.offer(await ask32(c, 'Offer id (hex): '));
        c.logger.info(describeOffer(o));
        c.logger.info(
          `Buying sends ${showAmount(o.price, o.color)} from this wallet to the breeder's wallet in the same transaction. ` +
            'The licence secret is made here and kept in your private state.',
        );
        if (!(await askYes(c, 'Buy one licence from this offer?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await api.buyLicense(o.id, c.mainAddress);
        c.logger.info(`Bought. Transaction ${r.txHash} at block ${r.blockHeight}.`);
        c.logger.info(
          `Your licence key (the breeder sees it on chain; give it to them if your terms ask): ${hex(r.license)}`,
        );
        return true;
      }
      case '56': {
        const api = needApi(c);
        const o = await api.offer(await ask32(c, 'Offer id your licence is from (hex): '));
        const period = await ask(c, 'Period label, as your terms name it (e.g. 2026-Q4, harvest-2026-1): ');
        periodBytes(period);
        const units = await askWhole(c, 'Units it covers (tonnes, plants, straws: as your terms say): ');
        c.logger.info(
          `That sends ${showAmount(units * o.perUnit, o.color)} to the breeder's wallet. The amount, units and your ` +
            'paying wallet are public; which licence paid is not.',
        );
        if (!(await askYes(c, 'Pay it?'))) return (c.logger.info('Nothing was sent.'), true);
        const r = await api.payRoyalty(o.id, period, units);
        c.logger.info(`Paid ${showAmount(r.amount, o.color)}. Transaction ${r.txHash} at block ${r.blockHeight}.`);
        return true;
      }
      case '57': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id your licence is from (hex): ');
        const period = await ask(c, 'Period label (e.g. 2026-Q4): ');
        const code = await api.receiptCommitment(offer, period);
        c.logger.info(`Receipt code for ${period}: ${hex(code)}`);
        c.logger.info(
          'Give the payer this code, the offer id and the units. It tells them nothing about your licence. When they ' +
            'have paid, you can prove it (60) with the same units.',
        );
        return true;
      }
      case '58': {
        const api = needApi(c);
        const o = await api.offer(await ask32(c, 'Offer id (hex): '));
        const code = await ask32(c, "The licensee's receipt code (hex): ");
        const units = await askWhole(c, 'Units it covers: ');
        if (!(await askYes(c, `Send ${showAmount(units * o.perUnit, o.color)} to the breeder's wallet?`)))
          return (c.logger.info('Nothing was sent.'), true);
        const r = await api.payRoyaltyFor(o.id, code, units);
        c.logger.info(`Paid. Transaction ${r.txHash} at block ${r.blockHeight}. Tell the licensee it landed.`);
        return true;
      }
      case '59': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id the licence must be from (hex): ');
        const period = await ask(c, 'Royalties must be paid for period (label, blank for none): ');
        const minUnits = period === '' ? 0n : await askWhole(c, 'For at least how many units: ', 0n);
        const scopeTyped = await ask(
          c,
          'Your scope (64 hex you reuse to spot the same licence twice; Enter for a new one): ',
        );
        const scope =
          scopeTyped === '' ? undefined : Uint8Array.from(Buffer.from(scopeTyped.replace(/^0x/, ''), 'hex'));
        if (scope !== undefined && (scope.length !== 32 || scope.every((x) => x === 0)))
          throw new RoyaltiesInputError('A scope is 64 hex characters, not all zero.');
        const req = newPresentationRequest({ contract: api.deployedContractAddress, offer, period, minUnits, scope });
        const out = await ask(c, 'Write the request to file (path): ');
        writeFileSync(out, JSON.stringify(req, null, 2), { mode: 0o600 });
        c.logger.info(
          `Request written. Give it to the licensee; it is good until ${new Date(Number(req.validAt) * 1000).toISOString()}.`,
        );
        c.logger.info(`Keep the file: you check the answer against it (61). Your scope: ${req.scope}`);
        return true;
      }
      case '60': {
        const api = needApi(c);
        const req = readRequest(await ask(c, "The verifier's request file (path): "));
        const unitsTyped =
          req.period === '0'.repeat(64)
            ? ''
            : await ask(c, 'Units your receipt for that period covers (Enter if you paid it here): ');
        if (unitsTyped !== '' && !/^\d{1,30}$/.test(unitsTyped))
          throw new RoyaltiesInputError('That is not a whole number of units. Nothing was sent.');
        const r = await api.prove(req, unitsTyped === '' ? {} : { units: BigInt(unitsTyped) });
        c.logger.info(`Answered. Give the verifier this transaction id: ${r.txId}`);
        return true;
      }
      case '61': {
        const api = needApi(c);
        const req = readRequest(await ask(c, 'Your request file (path): '));
        const v = await api.verifyPresentation(req, await ask(c, "The licensee's transaction id: "), c.indexerUri);
        for (const l of v.lines) c.logger.info(l);
        c.logger.info(v.accepted ? 'ACCEPTED.' : 'NOT ACCEPTED (see above).');
        return true;
      }
      case '62': {
        const api = needApi(c);
        const offer = await ask32(c, 'Offer id (hex): ');
        const typed = await c.hidden('Admin secret (64 hex; Enter if this computer posted it; nothing shows): ');
        if (!(await askYes(c, 'Close this offer (no new sales; sold licences carry on)?')))
          return (c.logger.info('Nothing was sent.'), true);
        await api.closeOffer(offer, adminTyped(typed));
        c.logger.info('Closed.');
        return true;
      }
      case '63': {
        const api = needApi(c);
        const key = await ask32(c, 'Licence key to revoke (hex, as the sale published it): ');
        const typed = await c.hidden('Admin secret (64 hex; Enter if this computer posted it; nothing shows): ');
        if (!(await askYes(c, 'Revoke this licence? The buyer is not refunded by the contract.')))
          return (c.logger.info('Nothing was sent.'), true);
        const r = await api.revokeLicense(key, adminTyped(typed));
        c.logger.info(
          r.sealed
            ? 'Revoked and sealed: older proofs stop working now.'
            : `Revoked. Older proofs keep working until the next seal (64)${r.sealableAt ? `, possible from ${new Date(r.sealableAt * 1000).toISOString()}` : ''}.`,
        );
        return true;
      }
      case '64': {
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
  const perUnit = await askAmount(c, 'Royalty per unit (0 for none through the contract)', color);
  const count = await askWhole(c, 'How many licences for sale: ');
  const days = await askWhole(c, 'Licences end in how many days: ');
  const revocable = (await ask(c, 'May you revoke a sold licence for breach? (y/N): ')).toLowerCase().startsWith('y');
  const payTo = await askWallet(c);
  const expires = BigInt(Math.floor(Date.now() / 1000)) + days * 86400n;
  c.logger.info(
    `Offer: ${count} licence(s) at ${showAmount(price, color)}, royalty ${perUnit === 0n ? 'none' : `${showAmount(perUnit, color)} per unit`}, ` +
      `ending ${day(expires)}, ${revocable ? 'revocable' : 'not revocable'}, paid to ${hex(payTo)}. All of this is public; the terms are not.`,
  );
  if (!(await askYes(c, 'Post it?'))) return c.logger.info('Nothing was sent.');
  const r = await api.postOffer(
    recordSecret,
    { terms, color, price, perUnit, payTo, count, expires, revocable },
    c.mainAddress,
  );
  c.logger.info(`Posted. Offer id: ${hex(r.offer)}`);
  showSecret(
    'OFFER ADMIN SECRET: write it on paper now. It is the only way to close this offer or revoke its licences ' +
      'from another computer, and it cannot be recovered:',
    hex(r.adminSecret),
  );
};
