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
 * Canonicalisation and the commitment algorithm come from @veilcore/records.
 *
 * Deliberately not reimplemented here. Two implementations that must agree are two
 * implementations that will eventually disagree — and a commitment computed differently
 * by the app and by an outside verifier is the one failure the format cannot survive.
 */
export { canonicalise, newNonce, COMMITMENT_ALGORITHM } from 'veilcore-records';

/**
 * The record commitment.
 *
 * Plain SHA-256 over the canonical serialisation, no chain dependency: any
 * implementation in any language can reproduce this without the Compact toolchain.
 * Binding it to a chain happens at anchoring time, not here.
 *
 * The nonce matters — cultivar name, breeder and date are guessable, so without one an
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
  const { canonicalise: canon } = await import('veilcore-records');
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
  return toHex(await sha256(new TextEncoder().encode(canon(committed))));
};


/** Short display form of a fingerprint. */
/**
 * A received record has no commitment until its holder seals it — they did not produce
 * the sender's evidence and cannot claim it. So this has to handle an unsealed record
 * rather than assuming every record has been committed.
 */
export const shortFingerprint = (hex?: string): string =>
  !hex ? 'not sealed yet' : hex.length > 24 ? `${hex.slice(0, 14)}…${hex.slice(-8)}` : hex;
