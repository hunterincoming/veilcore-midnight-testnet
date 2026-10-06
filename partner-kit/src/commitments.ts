// Secrets and commitments, computed offline. Nothing here touches a network.
// SPDX-License-Identifier: Apache-2.0
//
// Every commitment is SHA-256 over 32-byte elements (docs/design.md, Hashes), computed
// by the compiled contract's own pure circuits, so it is exactly what the chain computes.

import { createHash, randomBytes } from 'node:crypto';
import { pureCircuits } from '../../contract/src/managed/veilcore/contract/index.js';

const bytes32 = (b: Uint8Array, what: string): Uint8Array => {
  if (!(b instanceof Uint8Array) || b.length !== 32) throw new Error(`${what} is 32 bytes.`);
  return b;
};

/** 32 fresh random bytes: a record secret, recovery secret or licence secret. Store it before using it. */
export const newSecret = (): Uint8Array => new Uint8Array(randomBytes(32));

/** A verifier's challenge: 32 fresh random bytes, sent privately, used once. */
export const newChallenge = (): Uint8Array => new Uint8Array(randomBytes(32));

/**
 * The commitments the contract works with. A "record" is commit.record(record secret);
 * an identity keeps the record it was anchored with as its name through every rotation.
 */
export const commit = {
  /** The record a record secret controls. */
  record: (recordSecret: Uint8Array): Uint8Array => pureCircuits.commit(bytes32(recordSecret, 'A record secret')),
  /** What anchor() fixes: compute it OFFLINE, on the machine that keeps the recovery secret. */
  recovery: (recoverySecret: Uint8Array): Uint8Array =>
    pureCircuits.recoveryCommit(bytes32(recoverySecret, 'A recovery secret')),
  /** What a licensee sends the issuer: built from the licensee's secret and the issuer's record. */
  license: (licenseSecret: Uint8Array, issuerRecord: Uint8Array): Uint8Array =>
    pureCircuits.licenseCommit(bytes32(licenseSecret, 'A licence secret'), bytes32(issuerRecord, 'A record')),
  /** The tag a licence presentation publishes, which only the verifier who chose the challenge can recognise. */
  presentationTag: (issuerRecord: Uint8Array, challenge: Uint8Array): Uint8Array =>
    pureCircuits.presentationTag(bytes32(issuerRecord, 'A record'), bytes32(challenge, 'A challenge')),
  /**
   * An obligation's commitment: SHA-256(salt || UTF-8 terms), as the VeilCore CLI makes it.
   * Keep the terms and the salt: both are needed to show later what was agreed. Without a
   * salt, short terms ("7% royalty") could be guessed back from the chain.
   */
  obligation: (terms: string, salt: Uint8Array): Uint8Array => {
    if (terms.trim() === '') throw new Error('An obligation needs terms.');
    return new Uint8Array(
      createHash('sha256').update(bytes32(salt, 'An obligation salt')).update(terms, 'utf8').digest(),
    );
  },
} as const;

/** Hex of bytes (lowercase), and back. */
export const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
export const fromHex = (h: string): Uint8Array => {
  const s = h.trim().replace(/^0x/i, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error('That is not hex.');
  return new Uint8Array(Buffer.from(s, 'hex'));
};
