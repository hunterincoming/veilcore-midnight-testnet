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

/** Stable fingerprint of a strain record's logged fields (all of it is sealed). */
export const fingerprintRecord = (r: {
  strainName: string;
  bredBy: string;
  dateCreated: string;
  notes: string;
  loggedAt: number;
  parents?: { recordId?: string; name: string }[];
  breedingMethod?: string;
  photoFingerprints?: string[];
  refId?: string;
}): Promise<string> =>
  fingerprintText(
    JSON.stringify({
      strainName: r.strainName,
      bredBy: r.bredBy,
      dateCreated: r.dateCreated,
      notes: r.notes,
      loggedAt: r.loggedAt,
      parents: r.parents ?? [],
      breedingMethod: r.breedingMethod ?? '',
      photoFingerprints: r.photoFingerprints ?? [],
      refId: r.refId ?? '',
    }),
  );

/** Short display form of a fingerprint. */
export const shortFingerprint = (hex: string): string =>
  hex.length > 24 ? `${hex.slice(0, 14)}…${hex.slice(-8)}` : hex;
