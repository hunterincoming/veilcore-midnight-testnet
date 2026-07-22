// In-memory "simulated chain" for the Veilcore demo. Commitment hashing is real
// (see commitment.ts); only the on-chain submission is simulated here so the demo
// runs with zero external dependencies. Swapped for VeilcoreAPI calls in real mode.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';

export type AnchoredStrain = {
  readonly commitment: string; // hex
  readonly label: string;
  readonly timestamp: number; // logical anchor index
  readonly at: number; // wall-clock ms, for display
  readonly txId: string; // simulated tx id
};

let strains: AnchoredStrain[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const fakeTxId = (): string =>
  '0x' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Anchor a commitment (simulated). Returns the new record, or null if already anchored. */
export const anchorStrain = (commitment: string, label: string): AnchoredStrain | null => {
  if (strains.some((s) => s.commitment === commitment)) {
    return null; // mirrors the contract's "Strain already anchored" assert
  }
  const record: AnchoredStrain = {
    commitment,
    label: label.trim() || 'Untitled strain',
    timestamp: strains.length + 1,
    at: Date.now(),
    txId: fakeTxId(),
  };
  strains = [record, ...strains];
  emit();
  return record;
};

/** Membership check backing proveOwnership in demo mode. */
export const isAnchored = (commitment: string): boolean => strains.some((s) => s.commitment === commitment);

export const findByCommitment = (commitment: string): AnchoredStrain | undefined =>
  strains.find((s) => s.commitment === commitment);

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** React hook: the current list of anchored strains. */
export const useAnchoredStrains = (): AnchoredStrain[] => useSyncExternalStore(subscribe, () => strains);
