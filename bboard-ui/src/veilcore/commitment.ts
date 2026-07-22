// Veilcore commitment core — the real, in-browser cryptography behind the demo.
//
// Two local hashing steps, mirroring the on-chain contract exactly:
//   1. genetics text  --SHA-256-->  geneticSecret (Bytes<32>)   [never leaves the browser]
//   2. geneticSecret  --pureCircuits.commit-->  commitment      [only this is anchored]
//
// Step 2 runs the compiled `commit` circuit (persistentHash(["veilcore:commit", secret]))
// via wasm, so the commitment computed here is byte-identical to what the on-chain
// `anchor` / `proveOwnership` circuits expect.
// SPDX-License-Identifier: Apache-2.0

import { pureCircuits } from '../../../contract/src/managed/veilcore/contract/index.js';

/** Hex-encode bytes (no 0x prefix). */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Derive the 32-byte genetic secret from arbitrary genetics input by hashing it
 * locally with SHA-256. The raw genetics text is never transmitted or stored.
 */
export const deriveGeneticSecret = async (genetics: string): Promise<Uint8Array> => {
  const data = new TextEncoder().encode(genetics.trim());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
};

/** Compute the on-chain commitment for a genetic secret (runs the `commit` circuit). */
export const computeCommitment = (geneticSecret: Uint8Array): Uint8Array =>
  pureCircuits.commit(geneticSecret);

/** Full local pipeline: genetics -> secret -> commitment, returning hex of each stage. */
export const commitGenetics = async (
  genetics: string,
): Promise<{ geneticSecret: Uint8Array; commitment: Uint8Array; secretHex: string; commitmentHex: string }> => {
  const geneticSecret = await deriveGeneticSecret(genetics);
  const commitment = computeCommitment(geneticSecret);
  return {
    geneticSecret,
    commitment,
    secretHex: toHex(geneticSecret),
    commitmentHex: toHex(commitment),
  };
};
