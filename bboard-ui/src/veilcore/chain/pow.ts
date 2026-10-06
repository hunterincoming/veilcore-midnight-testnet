// The proof-of-work the sponsor asks for (sponsor/src/pow.ts has the server side and the
// scheme). A plain synchronous SHA-256 so it can run in a loop inside the proving worker.
// SPDX-License-Identifier: Apache-2.0

import { sha256 } from '@noble/hashes/sha2.js';

export const POW_TAG = 'veilcore-sponsor-pow:v1';

const enc = new TextEncoder();
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const leadingZeroBits = (d: Uint8Array): number => {
  let n = 0;
  for (const byte of d) {
    if (byte === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(byte) - 24;
  }
  return n;
};

/** Find a nonce for these exact transaction bytes. */
export const solvePow = (challenge: string, txBytes: Uint8Array, difficulty: number, maxTries = 1 << 28): string => {
  const txHash = hex(sha256(txBytes));
  const prefix = `${POW_TAG}:${challenge}:${txHash}:`;
  for (let i = 0; i < maxTries; i++) {
    const nonce = i.toString(16);
    if (leadingZeroBits(sha256(enc.encode(prefix + nonce))) >= difficulty) return nonce;
  }
  throw new Error('Could not finish the proof of work.');
};
