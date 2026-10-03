// SPDX-License-Identifier: Apache-2.0
/**
 * Field-set files and laboratory attestation files, for the claims options of the CLI.
 *
 * A FIELD-SET FILE is a holder's private copy of one sealed record's field set, as JSON:
 *
 *   { "schema":      { the published schema document },
 *     "values":      [ 16 entries: {"uint": "9650"}, {"text": "180/184"} or null ],
 *     "fieldSecret": "64 lowercase hex characters",
 *     "jsonDigest":  "64 lowercase hex: SHA-256 of the record's committed JSON" }
 *
 * It is sealed with exactly the SDK's rules (contract/src/field-schema.ts, checked against
 * the SDK's own vectors): types, formats, the present-marker on numbers, NFC text. Keep
 * it private: the values and the field secret are what the claims keep hidden.
 *
 * An ATTESTATION FILE is what a laboratory gives a holder: its public key and its
 * signature on each record commitment it sealed (numbers as decimal strings).
 *
 *   { "key": {"x": "...", "y": "..."},
 *     "signatures": { "<record commitment hex>": {"announcement": {"x": "...", "y": "..."}, "response": "..."} } }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { type FieldSetFile, type SealedFieldSet, sealFieldSetFile } from '../../contract/src/field-schema.js';
import { type AttestationSignature, type JubjubPoint, attesterKeyOf, signRecord } from '../../contract/src/attest.js';
import { type LabPairSignature, type LabSignature, type SealedRecord } from '../../api/src/claims-api.js';

export type LoadedFieldSet = {
  readonly file: FieldSetFile;
  readonly sealed: SealedFieldSet;
  /** SDK-shaped, for ClaimsAPI. */
  readonly record: SealedRecord;
};

/** Seal a parsed field-set file. Throws, naming the problem, on anything the SDK would refuse. */
export const loadFieldSet = (file: FieldSetFile): LoadedFieldSet => {
  const sealed = sealFieldSetFile(file);
  return {
    file,
    sealed,
    record: {
      fieldSet: { schemaId: sealed.schemaId, values: sealed.fieldSet.values, salts: sealed.fieldSet.salts },
      jsonDigest: sealed.fieldSet.jsonDigest,
    },
  };
};

/** Read and seal a field-set file from disk. The error never repeats the file's contents. */
export const readFieldSetFile = (path: string): LoadedFieldSet => {
  if (!existsSync(path)) throw new Error('No file at that path.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('That file is not JSON.');
  }
  try {
    return loadFieldSet(parsed as FieldSetFile);
  } catch (e) {
    throw new Error(`That field-set file is refused: ${e instanceof Error ? e.message : String(e)}`);
  }
};

/** Find a slot by number ("12") or by its schema path ("fields.germinationPercent"). */
export const slotByName = (f: FieldSetFile, answer: string): number => {
  const t = answer.trim();
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    if (n >= 0 && n < 16) return n;
  }
  const found = f.schema.slots.find((s) => s.path === t);
  if (found === undefined) throw new Error('No slot by that number (0 to 15) or path in this schema.');
  return found.slot;
};

/** A typed number for a slot, as the schema means it ("95.5" percent with scale 100 is 9550). */
export const scaledBound = (f: FieldSetFile, slot: number, answer: string): bigint => {
  const d = f.schema.slots.find((s) => s.slot === slot);
  if (d?.type !== 'uint') throw new Error(`Slot ${slot} is not a number slot in this schema.`);
  const scale = BigInt(d.scale ?? 1);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(answer.trim());
  if (m === null) throw new Error('A bound is a number, like 95 or 95.5.');
  const digits = String(scale).length - 1;
  const frac = m[2] ?? '';
  if (frac !== '' && (frac.length > digits || scale !== 10n ** BigInt(digits)))
    throw new Error(`That bound has more decimal places than the schema stores (scale ${scale}).`);
  const n = BigInt(m[1]) * scale + (frac === '' ? 0n : BigInt(frac.padEnd(digits, '0')));
  if (n >= 1n << 64n) throw new Error('That bound is too large.');
  return n;
};

// ───────────────────────────────────────────────────────── attestation files

type Num = string;
type AttestationFile = {
  key: { x: Num; y: Num };
  signatures: Record<string, { announcement: { x: Num; y: Num }; response: Num }>;
};

const big = (s: unknown, what: string): bigint => {
  if (typeof s !== 'string' || !/^\d+$/.test(s)) throw new Error(`${what} is a decimal string`);
  return BigInt(s);
};

export const readAttestationFile = (
  path: string,
): { key: JubjubPoint; signatures: Map<string, AttestationSignature> } => {
  if (!existsSync(path)) throw new Error('No file at that path.');
  let f: AttestationFile;
  try {
    f = JSON.parse(readFileSync(path, 'utf8')) as AttestationFile;
  } catch {
    throw new Error('That file is not JSON.');
  }
  try {
    const key = { x: big(f.key?.x, 'key.x'), y: big(f.key?.y, 'key.y') };
    const signatures = new Map<string, AttestationSignature>();
    for (const [record, s] of Object.entries(f.signatures ?? {})) {
      if (!/^[0-9a-f]{64}$/.test(record)) throw new Error('each signature is keyed by a record commitment (64 hex)');
      signatures.set(record, {
        announcement: { x: big(s.announcement?.x, 'announcement.x'), y: big(s.announcement?.y, 'announcement.y') },
        response: big(s.response, 'response'),
      });
    }
    return { key, signatures };
  } catch (e) {
    throw new Error(`That attestation file is refused: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const signatureFor = (a: ReturnType<typeof readAttestationFile>, record: SealedFieldSet): AttestationSignature => {
  const s = a.signatures.get(toHex(record.commitment));
  if (s === undefined) throw new Error(`The attestation file has no signature on record ${toHex(record.commitment)}.`);
  return s;
};

export const labSignature = (a: ReturnType<typeof readAttestationFile>, record: SealedFieldSet): LabSignature => ({
  key: a.key,
  signature: signatureFor(a, record),
});

export const labPairSignature = (
  a: ReturnType<typeof readAttestationFile>,
  first: SealedFieldSet,
  second: SealedFieldSet,
): LabPairSignature => ({ key: a.key, first: signatureFor(a, first), second: signatureFor(a, second) });

/**
 * Sign record commitments as a laboratory and write (or add to) an attestation file. For
 * testing and for laboratories trying the flow; a laboratory's real key is kept offline.
 */
export const writeAttestation = (path: string, secret: bigint, records: readonly Uint8Array[]): JubjubPoint => {
  const key = attesterKeyOf(secret);
  let file: AttestationFile = { key: { x: key.x.toString(), y: key.y.toString() }, signatures: {} };
  if (existsSync(path)) {
    const old = JSON.parse(readFileSync(path, 'utf8')) as AttestationFile;
    if (old.key?.x !== file.key.x || old.key?.y !== file.key.y)
      throw new Error('That attestation file is for another laboratory key. Nothing was written.');
    file = old;
  }
  for (const r of records) {
    const s = signRecord(secret, r);
    file.signatures[toHex(r)] = {
      announcement: { x: s.announcement.x.toString(), y: s.announcement.y.toString() },
      response: s.response.toString(),
    };
  }
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  return key;
};
