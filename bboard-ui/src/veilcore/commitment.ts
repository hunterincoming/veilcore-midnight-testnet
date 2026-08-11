// Veilcore fingerprinting core — the real, in-browser cryptography behind the wizard.
//
// Everything is hashed locally: text or a file is SHA-256'd, then run through the
// compiled `commit` circuit (wasm) to produce a fingerprint that is byte-identical to
// what the on-chain contract would record. Raw inputs never leave the device.
// SPDX-License-Identifier: Apache-2.0

import { pureCircuits } from '../../../contract/src/managed/veilcore/contract/index.js';

/** Hex-encode bytes (no 0x prefix). */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));

/** Turn a 32-byte secret into its on-chain fingerprint (runs the `commit` circuit). */
const fingerprintOf = (secret: Uint8Array): string => toHex(pureCircuits.commit(secret));

/** Fingerprint arbitrary text (used for the strain record). */
export const fingerprintText = async (text: string): Promise<string> =>
  fingerprintOf(await sha256(new TextEncoder().encode(text)));

/** Fingerprint a file's bytes locally (used for the DNA lab report). */
export const fingerprintFile = async (file: File): Promise<string> =>
  fingerprintOf(await sha256(new Uint8Array(await file.arrayBuffer())));

/**
 * Canonical serialisation, so two implementations hash the same record identically.
 *
 * Object keys sorted by code point, absent optionals omitted rather than serialised as
 * null, UTF-8 NFC normalised, no insignificant whitespace. Array order is preserved —
 * parent order is meaningful in some domains, so it is never sorted.
 */
const canonicalise = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(obj[k])}`).join(',')}}`;
};

/** A 32-byte nonce, hex. Committed with the record so the commitment is hiding as well as binding. */
export const newNonce = (): string =>
  toHex(crypto.getRandomValues(new Uint8Array(32)));

/**
 * The record commitment.
 *
 * Plain SHA-256 over the canonical serialisation, with no chain dependency: any
 * implementation in any language can compute this without the Compact toolchain. That
 * is what lets a registry we do not operate issue records in this format.
 *
 * Binding the commitment to a chain is a separate step — `commit()` from the contract
 * is applied to this value at anchoring time, not here.
 *
 * The nonce matters: cultivar name, breeder and date are guessable, so without one an
 * observer could compute candidate commitments and confirm a guess against the chain.
 */
export const fingerprintRecord = async (r: {
  strainName: string;
  bredBy: string;
  dateCreated: string;
  notes: string;
  loggedAt: number;
  parents?: { recordId?: string; name: string }[];
  breedingMethod?: string;
  photoFingerprints?: string[];
  refId?: string;
  nonce: string;
}): Promise<string> => {
  const committed = {
    breedingMethod: r.breedingMethod ?? '',
    bredBy: r.bredBy,
    dateCreated: r.dateCreated,
    loggedAt: r.loggedAt,
    nonce: r.nonce,
    notes: r.notes,
    parents: r.parents ?? [],
    photoFingerprints: r.photoFingerprints ?? [],
    refId: r.refId ?? '',
    strainName: r.strainName,
  };
  return toHex(await sha256(new TextEncoder().encode(canonicalise(committed))));
};

/** Commitment algorithm identifier, named so it can change without breaking old records. */
export const COMMITMENT_ALGORITHM = 'sha256/canonical-json/v1';

/** Short display form of a fingerprint. */
export const shortFingerprint = (hex: string): string =>
  hex.length > 24 ? `${hex.slice(0, 14)}…${hex.slice(-8)}` : hex;
