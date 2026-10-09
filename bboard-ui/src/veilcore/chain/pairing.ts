// Bound DNA pairings in the browser: what goes on chain is not the report's fingerprint
// but H("veilcore:v1:dnapair", reportSha256, identity, salt) (contract/src/pairing.ts,
// design.md rule 9, SPEC 3.7). A raw fingerprint on chain can be copied by anyone watching
// and paired to their own record first; the binding says nothing about the report without
// the salt, and holds only for the identity inside it.
//
// The same function as contract/src/pairing.ts, with the browser's SHA-256 instead of
// Node's: pairing.test.ts checks the two agree, and both against the published vector.
// The evidence file is the same format (veilcore/dna-pairing/v1), so the command-line
// tool, the partner kit and the verify rule read it as they read any other.
// SPDX-License-Identifier: Apache-2.0

import { sha256 } from '@noble/hashes/sha2.js';

export const DNA_PAIR_TAG = 'veilcore:v1:dnapair';
export const PAIRING_EVIDENCE_FORMAT = 'veilcore/dna-pairing/v1';

const HEX64 = /^[0-9a-f]{64}$/;

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const bytes = (hex: string, what: string): Uint8Array => {
  if (!HEX64.test(hex)) throw new Error(`${what} must be 64 lowercase hex characters.`);
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
};

/** The tag as the contract writes it: UTF-8, right-padded with zero bytes to 32. */
const tag32 = (): Uint8Array => {
  const t = new Uint8Array(32);
  t.set(new TextEncoder().encode(DNA_PAIR_TAG));
  return t;
};

/** A salt that hides nothing: one byte value repeated. Refused wherever a pairing is made. */
export const isWeakSalt = (salt: Uint8Array): boolean => salt.length !== 32 || salt.every((b) => b === salt[0]);

/** 32 bytes from the browser's cryptographic generator, as hex. */
export const newPairingSalt = (): string => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  if (isWeakSalt(salt)) throw new Error('The random generator returned a degenerate value.');
  return toHex(salt);
};

/** The value a bound pairing publishes, as hex. Each input is 64 lowercase hex characters. */
export const dnaPairBinding = (reportSha256: string, identity: string, salt: string): string => {
  const parts = [
    tag32(),
    bytes(reportSha256, "The report's SHA-256"),
    bytes(identity, 'The identity'),
    bytes(salt, 'The salt'),
  ];
  const all = new Uint8Array(128);
  parts.forEach((p, i) => all.set(p, i * 32));
  return toHex(sha256(all));
};

export type PairingEvidence = {
  readonly format: typeof PAIRING_EVIDENCE_FORMAT;
  readonly network: string;
  readonly contractAddress: string;
  readonly txId: string;
  readonly record: string;
  readonly reportSha256: string;
  readonly salt: string;
  readonly binding: string;
  readonly reportFile?: string;
};

/** A file name an evidence file may carry: no folders, no control characters. */
const plainName = (n: string | undefined): string | undefined =>
  // eslint-disable-next-line no-control-regex
  n !== undefined && n.length > 0 && n.length <= 200 && n !== '.' && n !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(n)
    ? n
    : undefined;

/** The evidence file for a pairing that landed. Give it, with the report, to whoever checks. */
export const pairingEvidence = (p: {
  readonly network: string;
  readonly contractAddress: string;
  readonly txId: string;
  readonly identity: string;
  readonly reportSha256: string;
  readonly salt: string;
  readonly reportFile?: string;
}): PairingEvidence => {
  const reportFile = plainName(p.reportFile);
  return {
    format: PAIRING_EVIDENCE_FORMAT,
    network: p.network,
    contractAddress: p.contractAddress.toLowerCase(),
    txId: p.txId.toLowerCase().replace(/^0x/, ''),
    record: p.identity,
    reportSha256: p.reportSha256,
    salt: p.salt,
    binding: dnaPairBinding(p.reportSha256, p.identity, p.salt),
    ...(reportFile === undefined ? {} : { reportFile }),
  };
};
