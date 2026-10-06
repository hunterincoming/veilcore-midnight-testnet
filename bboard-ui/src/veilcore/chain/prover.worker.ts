// The proving worker. Proofs are made here, on the visitor's device, with Midnight's own
// WebAssembly prover; the record secret is part of the proof's input and never leaves
// this browser. Runs in a worker so the page stays responsive while it works.
//
// Messages in:  { id, op: 'check' | 'prove', preimage, keyLocation, bindingInput? }
//               { id, op: 'pow', challenge, tx, difficulty }
// Messages out: { ready } once listening, then { id, ok: true, value } | { id, ok: false, error } | { progress }
//
// The WebAssembly prover loads before this script can listen, and a message that arrives
// before then is lost, so the page waits for { ready } before sending anything.
// SPDX-License-Identifier: Apache-2.0

import { check, prove } from '@midnight-ntwrk/zkir-v2';
import { makeKeyMaterialProvider } from './zk-material';
import { solvePow } from './pow';

type In =
  | { id: number; op: 'check'; preimage: Uint8Array; keyLocation: string; cacheName: string }
  | { id: number; op: 'prove'; preimage: Uint8Array; keyLocation: string; bindingInput?: bigint; cacheName: string }
  | { id: number; op: 'pow'; challenge: string; tx: Uint8Array; difficulty: number };

const progress = (msg: string): void => postMessage({ progress: msg });
const providers = new Map<string, ReturnType<typeof makeKeyMaterialProvider>>();
const kmFor = (cacheName: string) => {
  let km = providers.get(cacheName);
  if (!km) {
    km = makeKeyMaterialProvider(self.location.origin, cacheName, progress);
    providers.set(cacheName, km);
  }
  return km;
};

self.onmessage = async (ev: MessageEvent<In>) => {
  const m = ev.data;
  try {
    let value: unknown;
    if (m.op === 'check') value = await check(m.preimage, kmFor(m.cacheName));
    else if (m.op === 'prove') {
      progress('Proving on your device…');
      value = await prove(m.preimage, kmFor(m.cacheName), m.bindingInput);
    } else if (m.op === 'pow') {
      progress('Doing a little work to show this is a person, not a script…');
      value = solvePow(m.challenge, m.tx, m.difficulty);
    } else throw new Error('unknown request');
    postMessage({ id: m.id, ok: true, value });
  } catch (e) {
    postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

postMessage({ ready: true });
