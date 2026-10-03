// The page's side of the proving worker: a ProvingProvider midnight-js can use, plus the
// sponsor's proof of work. One worker, started on first use.
// SPDX-License-Identifier: Apache-2.0

import type { ProvingProvider } from '@midnight-ntwrk/midnight-js-protocol/ledger';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | undefined;
let ready: Promise<void> | undefined;
const readyGate: { open?: () => void } = {};
let nextId = 1;
const pending = new Map<number, Pending>();
let onProgress: ((msg: string) => void) | undefined;

const start = (): Worker => {
  if (worker) return worker;
  ready = new Promise<void>((r) => {
    readyGate.open = r;
  });
  worker = new Worker(new URL('./prover.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (
    ev: MessageEvent<{
      id?: number;
      ok?: boolean;
      value?: unknown;
      error?: string;
      progress?: string;
      ready?: boolean;
    }>,
  ) => {
    const m = ev.data;
    if (m.ready) {
      readyGate.open?.();
      return;
    }
    if (m.progress !== undefined) {
      onProgress?.(m.progress);
      return;
    }
    if (m.id === undefined) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else p.reject(new Error(m.error ?? 'The prover failed.'));
  };
  worker.onerror = (e) => {
    // A crash in the prover (out of memory on a small phone, say) ends the worker; every
    // waiting call fails with that, and the next call starts a fresh worker.
    for (const p of pending.values())
      p.reject(new Error(e.message || 'The prover stopped. Try on a laptop if it repeats.'));
    pending.clear();
    worker = undefined;
    ready = undefined;
  };
  return worker;
};

const call = <T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    const w = start();
    void (ready ?? Promise.resolve()).then(() => w.postMessage({ ...msg, id }, transfer));
  });

/** Where progress messages from the worker go (the step's status line). */
export const setProverProgress = (fn: ((msg: string) => void) | undefined): void => {
  onProgress = fn;
};

/** A ProvingProvider backed by the worker. `cacheName` keys the downloaded files to one contract build. */
export const workerProvingProvider = (cacheName: string): ProvingProvider => ({
  check: (preimage, keyLocation) => call<(bigint | undefined)[]>({ op: 'check', preimage, keyLocation, cacheName }),
  prove: (preimage, keyLocation, bindingInput) =>
    call<Uint8Array>({ op: 'prove', preimage, keyLocation, bindingInput, cacheName }),
});

export const workerPow = (challenge: string, tx: Uint8Array, difficulty: number): Promise<string> =>
  call<string>({ op: 'pow', challenge, tx, difficulty });
