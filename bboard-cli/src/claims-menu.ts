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
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type ClaimRef, ClaimsAPI, type LabSignature } from '../../api/src/claims-api.js';
import { type ClaimsProviders } from '../../api/src/claims-types.js';
import { JUBJUB_ORDER, type JubjubPoint, newAttesterKey } from '../../contract/src/attest.js';
import { type FieldSchema } from '../../contract/src/field-schema.js';
import { type ClaimVerdict, verifyClaim } from '../../contract/src/verify-claims.js';
import {
  type LoadedFieldSet,
  labSignature,
  readAttestationFile,
  readFieldSetFile,
  readJsonFile,
  readTrustedKeys,
  scaledBound,
  slotByName,
  slotLabel,
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

/** Say where a claim landed, as soon as it has: before anything else can go wrong. */
const announce = (c: ClaimsMenuContext, r: ClaimRef): void => {
  c.logger.info(`Transaction ${r.txHash} at block ${r.blockHeight}.`);
  c.logger.info(`Give the verifier this transaction id: ${r.txId}`);
};

/** The verdict a verifier would reach on the claim and the attested claims that landed. */
const landed = (c: ClaimsMenuContext, r: ClaimRef, schema: FieldSchema, attested: readonly ClaimRef[] = []): void =>
  showVerdict(
    c.logger,
    verifyClaim({
      claim: r.claim,
      schema,
      ...(attested.length > 0 ? { attestations: attested.map((a) => a.claim) } : {}),
    }),
  );

/**
 * A laboratory's signature on each record, checked off-chain (as the contract checks it)
 * BEFORE anything is sent: a wrong entry in the attestation file stops here.
 */
const checkedSignatures = (
  att: ReturnType<typeof readAttestationFile> | undefined,
  records: readonly LoadedFieldSet[],
): LabSignature[] => {
  if (att === undefined) return [];
  try {
    return records.map((r) => labSignature(att, r.sealed));
  } catch (e) {
    throw new ClaimsInputError(`${e instanceof Error ? e.message : String(e)} Nothing was sent.`);
  }
};

/**
 * A laboratory's signature is its own claim on each record (proveAttested), made after the
 * main claim, one per record. The main claim has already landed and been announced; each
 * attested claim is reported as it lands or fails, so nothing published goes unreported.
 */
const attestEach = async (
  c: ClaimsMenuContext,
  api: ClaimsAPI,
  main: ClaimRef,
  sigs: readonly LabSignature[],
  records: readonly LoadedFieldSet[],
): Promise<ClaimRef[]> => {
  const out: ClaimRef[] = [];
  for (const [i, sig] of sigs.entries()) {
    const record = toHex(records[i].sealed.commitment);
    try {
      const a = await api.proveAttested(records[i].record, sig);
      out.push(a);
      c.logger.info(`and the laboratory's attested claim on record ${record}: ${a.txId}`);
    } catch (e) {
      c.logger.error(
        `The laboratory's attested claim on record ${record} FAILED: ${e instanceof Error ? e.message : String(e)}`,
      );
      c.logger.error(
        `The claim itself IS published (transaction id ${main.txId}). ` +
          (out.length > 0
            ? `Attested claims that landed: ${out.map((o) => o.txId).join(', ')}. `
            : 'No attested claim landed. ') +
          'A verifier will read the claim without a laboratory signature on that record.',
      );
    }
  }
  return out;
};

const askDirection = async (c: ClaimsMenuContext): Promise<'at least' | 'at most'> => {
  const a = (await ask(c, 'At (L)east or at (M)ost? ')).toLowerCase().replace(/\s+/g, ' ');
  if (['l', 'least', 'at least'].includes(a)) return 'at least';
  if (['m', 'most', 'at most'].includes(a)) return 'at most';
  throw new ClaimsInputError('Answer L (at least) or M (at most). Nothing was sent.');
};

/** A JSON file named at a prompt: refusals are input errors and never repeat the contents. */
const jsonFile = (path: string): unknown => {
  try {
    return readJsonFile(path);
  } catch (e) {
    throw new ClaimsInputError(e instanceof Error ? e.message : String(e));
  }
};

const isEmptySlot = (f: LoadedFieldSet, slot: number): boolean => f.sealed.fieldSet.values[slot].every((b) => b === 0);

/**
 * A secret as typed: hex if it starts with 0x or contains a letter a-f, else decimal.
 * Anything else is 0 (refused by the caller).
 */
export const parseLabSecret = (typed: string): bigint => {
  const t = typed.trim();
  if (/^0x[0-9a-fA-F]{1,64}$/.test(t)) return BigInt(t);
  if (/^[0-9a-fA-F]{1,64}$/.test(t) && /[a-fA-F]/.test(t)) return BigInt(`0x${t}`);
  if (/^\d{1,80}$/.test(t)) return BigInt(t);
  return 0n;
};

/** Handle a main-menu choice 34-40. Returns false for any other choice. */
export const handleClaimsChoice = async (choice: string, c: ClaimsMenuContext): Promise<boolean> => {
  try {
    switch (choice) {
      case '34': {
        const p = needProviders(c);
        c.logger.info(
          'This deploys a claims contract, adds its five circuit keys, then replaces its maintenance authority ' +
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
        const schema = schemaPath === '' ? undefined : (jsonFile(schemaPath) as FieldSchema);
        const labIds = (
          await ask(
            c,
            "Transaction ids of the laboratory's attested claims on the record(s) (comma-separated, blank for none): ",
          )
        )
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        const trustedPath = await ask(
          c,
          'Laboratory keys you trust: a JSON file of [{"x": "...", "y": "..."}] (blank for none; then no key is called a laboratory\'s): ',
        );
        let trustedAttesters: JubjubPoint[] | undefined;
        if (trustedPath !== '') {
          try {
            trustedAttesters = readTrustedKeys(trustedPath);
          } catch (e) {
            throw new ClaimsInputError(e instanceof Error ? e.message : String(e));
          }
        }
        const reading = await api.readClaim(txId, c.indexerUri);
        c.logger.info(`Read from call ${reading.entryPoint ?? '(unknown)'} on ${api.deployedContractAddress}.`);
        const attestations = [];
        for (const id of labIds) attestations.push((await api.readClaim(id, c.indexerUri)).claim);
        showVerdict(
          c.logger,
          verifyClaim({
            claim: reading.cells,
            schema,
            ...(labIds.length > 0 ? { attestations } : {}),
            ...(trustedAttesters !== undefined ? { trustedAttesters } : {}),
          }),
        );
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
          'Laboratory signing secret (decimal digits, or hex starting 0x; nothing shows; blank to generate a TEST key): ',
        );
        let secret: bigint;
        if (typed === '') {
          if (getNetworkId() === 'mainnet')
            throw new ClaimsInputError('On mainnet a laboratory signs with its own offline key. Nothing was written.');
          secret = newAttesterKey().secret;
          showSecret(
            'TEST LABORATORY SECRET — for trying the flow only; a real laboratory keeps its own key offline:',
            `0x${secret.toString(16).padStart(64, '0')}`,
          );
        } else {
          secret = parseLabSecret(typed);
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
  if (att !== undefined)
    c.logger.info(
      "The laboratory's signature is published as its own claim on each record (one more transaction each), " +
        'after the claim itself. Each signature is checked here first.',
    );

  switch (kind[0]) {
    case 'v': {
      const slot = slotByName(a.file, await ask(c, 'Slot (number or path): '));
      const label = slotLabel(a.file, slot);
      c.logger.warn('A value claim PUBLISHES the value, permanently. It proves authenticity, never confidentiality.');
      if (isEmptySlot(a, slot))
        c.logger.warn(`${label} is EMPTY: no value was sealed there. This claim would publish that the slot is empty.`);
      c.logger.info(
        `Already published about this slot from here in this run: ${api.disclosedSoFar(a.record, slot, schema)}`,
      );
      if (!(await askYes(c, `Publish the sealed value of ${label}${isEmptySlot(a, slot) ? ' (EMPTY)' : ''}?`)))
        return c.logger.info('Nothing was sent.');
      const sigs = checkedSignatures(att, [a]);
      const r = await api.proveValue(a.record, slot);
      announce(c, r);
      landed(c, r, schema, await attestEach(c, api, r, sigs, [a]));
      return;
    }
    case 'b': {
      const slot = slotByName(a.file, await ask(c, 'Number slot (number or path): '));
      const label = slotLabel(a.file, slot);
      const d = schema.slots.find((s) => s.slot === slot);
      const dir = await askDirection(c);
      const raw = await ask(c, `Bound${d?.unit ? ` in ${d.unit}` : ''}: `);
      const bound = scaledBound(a.file, slot, raw);
      c.logger.info(
        `Already published about this slot from here in this run: ${api.disclosedSoFar(a.record, slot, schema)}`,
      );
      c.logger.info('Each bound you prove is public; several bounds narrow the hidden number.');
      if (!(await askYes(c, `Publish "${label} is ${dir} ${raw}${d?.unit ? ` ${d.unit}` : ''}"?`)))
        return c.logger.info('Nothing was sent.');
      const sigs = checkedSignatures(att, [a]);
      const r = await api.proveRange(a.record, schema, slot, dir, bound);
      announce(c, r);
      landed(c, r, schema, await attestEach(c, api, r, sigs, [a]));
      return;
    }
    case 'd': {
      const b = await askFieldSet(c, "The reference record's field-set file: ");
      c.logger.info(
        `This publishes that the two records differ in at least ${schema.k} comparable values: a count, not a ` +
          'determination of distinctness. Do not run it against references chosen by someone else.',
      );
      if (!(await askYes(c, 'Publish it?'))) return c.logger.info('Nothing was sent.');
      const sigs = checkedSignatures(att, [a, b]);
      const r = await api.proveDistinct(a.record, b.record, schema);
      announce(c, r);
      landed(c, r, schema, await attestEach(c, api, r, sigs, [a, b]));
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
      const labels = [...new Set(slots)].map((s) => slotLabel(a.file, s)).join(', ');
      if (!(await askYes(c, `Publish that only ${labels || 'no slot'} changed?`)))
        return c.logger.info('Nothing was sent.');
      const r = await api.proveUnchanged(a.record, b.record, mask);
      announce(c, r);
      landed(c, r, schema);
      return;
    }
  }
};
