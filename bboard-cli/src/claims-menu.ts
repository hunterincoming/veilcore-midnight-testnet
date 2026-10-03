// SPDX-License-Identifier: Apache-2.0
/**
 * Main menu options 34 to 40: the claims contract (contract/src/veilcore-claims.compact).
 *
 * A holder proves one fact about a record sealed with sha256/fields/v1, from the record's
 * field-set file (fields.ts). Field-set files and attestation files are read from disk;
 * their contents are never logged or echoed, only the public values a claim publishes
 * (commitments, schema ids, a bound, a mask, a value the holder agreed to publish).
 */
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { readFileSync } from 'node:fs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ClaimsAPI, type ClaimRef } from '../../api/src/claims-api.js';
import { type ClaimsProviders } from '../../api/src/claims-types.js';
import { JUBJUB_ORDER, newAttesterKey } from '../../contract/src/attest.js';
import { type FieldSchema } from '../../contract/src/field-schema.js';
import { type ClaimVerdict, verifyClaim } from '../../contract/src/verify-claims.js';
import {
  type LoadedFieldSet,
  labPairSignature,
  labSignature,
  readAttestationFile,
  readFieldSetFile,
  scaledBound,
  slotByName,
  writeAttestation,
} from './fields.js';
import { showSecret } from './secret-out.js';

export const CLAIMS_MENU = `
 Claims (second contract: prove one fact about a sealed record)
 34. Deploy the claims contract (test networks; no maintenance authority)
 35. Join the claims contract
 36. Finish a claims deploy that stopped partway
 37. Make a claim from a field-set file
 38. Read a claim (by transaction id)
 39. Sign records as a laboratory (writes an attestation file)
 40. Show a field-set file's schema id and record commitment`;

export type ClaimsMenuContext = {
  readonly rli: Interface;
  readonly logger: Logger;
  readonly providers: ClaimsProviders | undefined;
  readonly indexerUri: string;
  readonly hidden: (question: string) => Promise<string>;
  /** Run a deploy or maintenance transaction, so Ctrl+C says to wait (index.ts). */
  readonly during: <T>(f: () => Promise<T>) => Promise<T>;
  /** The joined claims contract, if any. */
  api: ClaimsAPI | undefined;
};

class ClaimsInputError extends Error {}

const ask = async (c: ClaimsMenuContext, q: string): Promise<string> => (await c.rli.question(q)).trim();

const needProviders = (c: ClaimsMenuContext): ClaimsProviders => {
  if (c.providers === undefined) throw new ClaimsInputError('The claims contract is not set up in this run.');
  return c.providers;
};

const needApi = (c: ClaimsMenuContext): ClaimsAPI => {
  if (c.api === undefined) throw new ClaimsInputError('Deploy (34) or join (35) the claims contract first.');
  return c.api;
};

const askAddress = async (c: ClaimsMenuContext): Promise<string> => {
  for (;;) {
    const a = await ask(c, 'Claims contract address (hex): ');
    if (/^[0-9a-fA-F]{64}$/.test(a)) return a.toLowerCase();
    c.logger.error('That is not a contract address (64 characters, each 0-9 or a-f, no 0x). Nothing was sent.');
  }
};

const askFieldSet = async (c: ClaimsMenuContext, q: string): Promise<LoadedFieldSet> =>
  readFieldSetFile(await ask(c, q));

const askYes = async (c: ClaimsMenuContext, q: string): Promise<boolean> =>
  (await ask(c, `${q} Type yes to send it, anything else to stop: `)).toLowerCase() === 'yes';

const showVerdict = (logger: Logger, v: ClaimVerdict): void => {
  logger.info(`CLAIM: ${v.statement}`);
  for (const k of v.checks) logger.info(`  ${k.ok ? 'ok    ' : 'FAILED'} (SPEC 4.5 check ${k.spec}) ${k.detail}`);
  for (const t of v.toCheck) logger.info(`  ${t}`);
  logger.info(
    v.passed
      ? 'Every check that could be made here passed. The "to check" lines still stand.'
      : 'NOT ACCEPTED: a check failed (above).',
  );
};

const landed = (c: ClaimsMenuContext, r: ClaimRef, schema: FieldSchema): void => {
  c.logger.info(`Transaction ${r.txHash} at block ${r.blockHeight}.`);
  c.logger.info(`Give the verifier this transaction id: ${r.txId}`);
  showVerdict(c.logger, verifyClaim({ claim: r.claim, schema }));
};

/** Handle a main-menu choice 34-40. Returns false for any other choice. */
export const handleClaimsChoice = async (choice: string, c: ClaimsMenuContext): Promise<boolean> => {
  try {
    switch (choice) {
      case '34': {
        const p = needProviders(c);
        c.logger.info(
          'This deploys a claims contract, adds its seven circuit keys, then replaces its maintenance authority ' +
            'with an empty committee, so nobody, including us, can ever change it. Test networks only.',
        );
        if (!(await askYes(c, 'Deploy a claims contract now?'))) {
          c.logger.info('Nothing was sent.');
          return true;
        }
        c.api = await c.during(() => ClaimsAPI.deploy(p, c.logger));
        c.logger.info(`Claims contract address: ${c.api.deployedContractAddress}`);
        return true;
      }
      case '35': {
        c.api = await ClaimsAPI.join(needProviders(c), await askAddress(c), c.logger);
        const a = await c.api.authority();
        c.logger.info(`Joined claims contract at ${c.api.deployedContractAddress}.`);
        c.logger.info(
          a.retired
            ? 'Its maintenance authority is an empty committee: nobody can change it.'
            : 'WARNING: it still has a maintenance authority. Do not rely on its claims.',
        );
        return true;
      }
      case '36': {
        const p = needProviders(c);
        const address = await askAddress(c);
        c.api = await c.during(() => ClaimsAPI.finishDeploy(p, address, c.logger));
        c.logger.info(`Claims deploy finished: ${address}`);
        return true;
      }
      case '37':
        await makeClaim(c);
        return true;
      case '38': {
        const api = needApi(c);
        const txId = await ask(c, "The claim's transaction id: ");
        const schemaPath = await ask(c, 'Schema document file, from its publisher (blank to skip): ');
        const schema = schemaPath === '' ? undefined : (JSON.parse(readFileSync(schemaPath, 'utf8')) as FieldSchema);
        const reading = await api.readClaim(txId, c.indexerUri);
        c.logger.info(`Read from call ${reading.entryPoint ?? '(unknown)'} on ${api.deployedContractAddress}.`);
        showVerdict(c.logger, verifyClaim({ claim: reading.cells, schema }));
        return true;
      }
      case '39': {
        const out = await ask(c, 'Attestation file to write or add to (path): ');
        const paths = (await ask(c, 'Field-set files of the records to sign (paths, comma-separated): '))
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        if (paths.length === 0) throw new ClaimsInputError('No records named. Nothing was written.');
        const records = paths.map((p) => readFieldSetFile(p).sealed.commitment);
        const typed = await c.hidden(
          'Laboratory signing secret (decimal or 64 hex; nothing shows; blank to generate a TEST key): ',
        );
        let secret: bigint;
        if (typed === '') {
          if (getNetworkId() === 'mainnet')
            throw new ClaimsInputError('On mainnet a laboratory signs with its own offline key. Nothing was written.');
          secret = newAttesterKey().secret;
          showSecret(
            'TEST LABORATORY SECRET — for trying the flow only; a real laboratory keeps its own key offline:',
            secret.toString(16).padStart(64, '0'),
          );
        } else {
          const t = typed.trim();
          secret = /^[0-9a-fA-F]{64}$/.test(t) ? BigInt(`0x${t}`) : /^\d+$/.test(t) ? BigInt(t) : 0n;
          if (secret <= 0n || secret >= JUBJUB_ORDER)
            throw new ClaimsInputError('That is not a laboratory signing secret. Nothing was written.');
        }
        const key = writeAttestation(out, secret, records);
        c.logger.info(`Signed ${records.length} record(s). Laboratory public key: x=${key.x} y=${key.y}`);
        c.logger.info("Publish that key as the laboratory's; give the holder the attestation file.");
        return true;
      }
      case '40': {
        const f = await askFieldSet(c, 'Field-set file (path): ');
        c.logger.info(`Schema "${f.file.schema.id}", id ${toHex(f.sealed.schemaId)}`);
        c.logger.info(`fieldSetRoot (the record JSON carries it): ${toHex(f.sealed.setRoot)}`);
        c.logger.info(`Record commitment (what claims name and laboratories sign): ${toHex(f.sealed.commitment)}`);
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    if (e instanceof ClaimsInputError) {
      c.logger.error(e.message);
      return true;
    }
    throw e;
  }
};

const makeClaim = async (c: ClaimsMenuContext): Promise<void> => {
  const api = needApi(c);
  const kind = (await ask(c, 'Which claim: (V)alue, (B)ound on a number, (D)istinct, (U)nchanged? ')).toLowerCase();
  if (!['v', 'b', 'd', 'u'].includes(kind[0] ?? '')) throw new ClaimsInputError('Not a claim kind. Nothing was sent.');
  const a = await askFieldSet(c, kind[0] === 'u' ? "The ORIGINAL record's field-set file: " : 'Field-set file: ');
  const schema = a.file.schema;
  const labPath =
    kind[0] === 'u' ? '' : await ask(c, 'Laboratory attestation file (blank for a claim no laboratory signed): ');
  const att = labPath === '' ? undefined : readAttestationFile(labPath);

  switch (kind[0]) {
    case 'v': {
      const slot = slotByName(a.file, await ask(c, 'Slot (number or path): '));
      c.logger.warn('A value claim PUBLISHES the value, permanently. It proves authenticity, never confidentiality.');
      c.logger.info(
        `Already published about this slot from here in this run: ${api.disclosedSoFar(a.record, slot, schema)}`,
      );
      if (!(await askYes(c, `Publish the sealed value of slot ${slot}?`))) return c.logger.info('Nothing was sent.');
      landed(
        c,
        att === undefined
          ? await api.proveValue(a.record, slot)
          : await api.proveAttestedValue(a.record, slot, labSignature(att, a.sealed)),
        schema,
      );
      return;
    }
    case 'b': {
      const slot = slotByName(a.file, await ask(c, 'Number slot (number or path): '));
      const d = schema.slots.find((s) => s.slot === slot);
      const dir = (await ask(c, 'At (L)east or at (M)ost? ')).toLowerCase().startsWith('m') ? 'at most' : 'at least';
      const raw = await ask(c, `Bound${d?.unit ? ` in ${d.unit}` : ''}: `);
      const bound = scaledBound(a.file, slot, raw);
      c.logger.info(
        `Already published about this slot from here in this run: ${api.disclosedSoFar(a.record, slot, schema)}`,
      );
      c.logger.info('Each bound you prove is public; several bounds narrow the hidden number.');
      if (!(await askYes(c, `Publish "slot ${slot} is ${dir} ${raw}${d?.unit ? ` ${d.unit}` : ''}"?`)))
        return c.logger.info('Nothing was sent.');
      landed(
        c,
        att === undefined
          ? await api.proveRange(a.record, schema, slot, dir, bound)
          : await api.proveAttestedRange(a.record, schema, slot, dir, bound, labSignature(att, a.sealed)),
        schema,
      );
      return;
    }
    case 'd': {
      const b = await askFieldSet(c, "The reference record's field-set file: ");
      c.logger.info(
        `This publishes that the two records differ in at least ${schema.k} comparable values: a count, not a ` +
          'determination of distinctness. Do not run it against references chosen by someone else.',
      );
      if (!(await askYes(c, 'Publish it?'))) return c.logger.info('Nothing was sent.');
      landed(
        c,
        att === undefined
          ? await api.proveDistinct(a.record, b.record, schema)
          : await api.proveAttestedDistinct(a.record, b.record, schema, labPairSignature(att, a.sealed, b.sealed)),
        schema,
      );
      return;
    }
    case 'u': {
      const b = await askFieldSet(c, "The CORRECTION's field-set file: ");
      const slots = (await ask(c, 'Slots the correction may change (numbers or paths, comma-separated): '))
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map((s) => slotByName(a.file, s));
      const mask = Array.from({ length: 16 }, (_, i) => slots.includes(i));
      if (mask.every(Boolean)) throw new ClaimsInputError('A mask of every slot says nothing. Nothing was sent.');
      if (!(await askYes(c, `Publish that only slot(s) ${slots.join(', ') || 'none'} changed?`)))
        return c.logger.info('Nothing was sent.');
      landed(c, await api.proveUnchanged(a.record, b.record, mask), schema);
      return;
    }
  }
};
