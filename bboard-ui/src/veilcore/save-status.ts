// What the last save to the registry refused, for the whole app to show.
//
// Saves happen in the background on every change. When the registry refuses part of
// one, the holder has to be told, or they go on believing a record exists that the
// registry never kept (attack round 11).
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';
import type { SaveRefusal, SaveResult } from './store';

export type SaveProblem = { readonly what: string; readonly refused: readonly SaveRefusal[] };

let problem: SaveProblem | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Record the outcome of a save. Offline is not a refusal: local state stands. */
export const reportSave = (what: string, result: SaveResult): void => {
  if (result.offline) return;
  problem = result.refused.length ? { what, refused: result.refused } : problem?.what === what ? null : problem;
  notify();
};

export const clearSaveProblem = (): void => {
  problem = null;
  notify();
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useSaveProblem = (): SaveProblem | null => useSyncExternalStore(subscribe, () => problem);

/** A readable sentence for a refusal list. */
export const describeRefusals = (refused: readonly SaveRefusal[]): string =>
  refused
    .slice(0, 3)
    .map((r) => (r.id === '*' ? r.reason : `${r.id}: ${r.reason}`))
    .join(' · ') + (refused.length > 3 ? ` · and ${String(refused.length - 3)} more` : '');
