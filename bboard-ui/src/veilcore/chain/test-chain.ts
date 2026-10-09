// Test helpers: a stand-in network for the browser's chain calls. The contract's real
// circuits run (compiled contract and circuit IR, checked with Midnight's own checker);
// only the proof bytes are placeholders and the "network" is in memory. The sponsor is
// the real sponsor policy and proof-of-work code, so a call that passes here is one the
// sponsor would pay for.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check as zkCheck, jsonIrToBinary } from '@midnight-ntwrk/zkir-v2';
import { Proof } from '@midnight-ntwrk/ledger-v8';
import {
  ChargedState,
  ContractState,
  createCircuitContext,
  createConstructorContext,
} from '@midnight-ntwrk/compact-runtime';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { Contract } from '../../../../contract/src/managed/veilcore/contract/index.js';
import { createVeilcorePrivateState, veilcoreWitnesses } from '../../../../contract/src/witnesses';
import { inspect, PHASE1_PUBLIC_CIRCUITS } from '../../../../sponsor/src/policy';
import { ProofOfWork } from '../../../../sponsor/src/pow';
import { solvePow } from './pow';
import type { CallDeps } from './prover-choice';

const ZKIR = resolve(import.meta.dirname, '..', '..', '..', '..', 'contract', 'src', 'managed', 'veilcore', 'zkir');
const COIN = '0'.repeat(64);
export const ADDRESS = 'c0'.repeat(32);

/**
 * A fixed placeholder verifier key per circuit. A deployed contract carries each circuit's
 * real key; unit tests do not build keys, so the stand-in network reports these and the
 * stand-in site serves the same bytes as its /keys (or different ones, to test a mismatch).
 */
export const standInVerifierKey = (circuit: string): Uint8Array =>
  new Uint8Array(Buffer.from(`stand-in verifier key ${circuit}`.padEnd(64, '.')));

/** The contract's state after `steps` run locally (e.g. an anchor). */
export const contractStateAfter = (
  steps: { secret: Uint8Array; circuit: 'anchor' | 'proveOwnership' | 'pairDna'; args: Uint8Array[] }[] = [],
): ContractState => {
  const initial = new Contract(veilcoreWitnesses).initialState(
    createConstructorContext(createVeilcorePrivateState(new Uint8Array(32).fill(9)), COIN),
  ).currentContractState;
  let data = initial.data;
  for (const s of steps) {
    const c = new Contract(veilcoreWitnesses);
    const ctx = createCircuitContext(
      ADDRESS,
      COIN,
      Object.assign(new ContractState(), { data }),
      createVeilcorePrivateState(s.secret),
    );
    const out = (c.impureCircuits[s.circuit] as (x: unknown, ...a: Uint8Array[]) => { context: typeof ctx })(
      ctx,
      ...s.args,
    );
    data = new ChargedState(out.context.currentQueryContext.state.state);
  }
  const cs = new ContractState();
  for (const op of initial.operations()) cs.setOperation(op, initial.operation(op)!);
  cs.data = data;
  return cs;
};

export type Recorded = { url: string; body?: string; headers?: Record<string, string> };

/** `servedKeys: 'wrong'` serves verifier keys that are not the contract's. */
export const standIns = (state: ContractState, opts: { servedKeys?: 'contract' | 'wrong' } = {}) => {
  const requests: Recorded[] = [];
  const sealed: Uint8Array[] = [];
  const checkedCircuits: string[] = [];
  const pow = new ProofOfWork(new Uint8Array(32).fill(7), 4, 600_000, () => Date.now());

  const km = {
    lookupKey: (loc: string) =>
      Promise.resolve({
        proverKey: new Uint8Array(),
        verifierKey: new Uint8Array(),
        ir: jsonIrToBinary(readFileSync(resolve(ZKIR, `${loc}.zkir`), 'utf8')),
      }),
    getParams: () => Promise.reject(new Error('offline')),
  };

  const fakeFetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({
      url,
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: init?.headers as Record<string, string>,
    });
    if (url.endsWith('/sponsor/challenge')) return Promise.resolve(new Response(JSON.stringify(pow.issue())));
    if (url.endsWith('/sponsor')) {
      const b = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        tx: string;
        challenge: string;
        nonce: string;
      };
      const bytes = new Uint8Array(Buffer.from(b.tx, 'base64'));
      const work = pow.verify(b.challenge, b.nonce, bytes);
      if (!work.ok)
        return Promise.resolve(new Response(JSON.stringify({ ok: false, reason: work.reason }), { status: 403 }));
      const { verdict } = inspect(
        bytes,
        {
          contractAddress: ADDRESS,
          allowedCircuits: new Set(PHASE1_PUBLIC_CIRCUITS),
          maxBytes: 64_000,
          maxTtlMs: 3_600_000,
        },
        new Date(),
      );
      if (!verdict.ok)
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, reason: verdict.reason, code: verdict.code }), { status: 400 }),
        );
      sealed.push(bytes);
      return Promise.resolve(new Response(JSON.stringify({ ok: true, txId: verdict.identifiers[0] })));
    }
    // This site's /keys: by default exactly the stand-in contract's verifier keys.
    const key = /\/keys\/([A-Za-z]+)\.verifier$/.exec(url);
    if (key) {
      if (!state.operation(key[1])) return Promise.resolve(new Response('not found', { status: 404 }));
      const vk = standInVerifierKey(key[1]);
      const body = opts.servedKeys === 'wrong' ? new Uint8Array([...vk].map((b) => b ^ 1)) : vk;
      return Promise.resolve(new Response(new Uint8Array(body)));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  }) as typeof fetch;

  const deps: CallDeps = {
    proving: () => ({
      check: (pre: Uint8Array, loc: string) => {
        checkedCircuits.push(loc);
        return zkCheck(pre, km);
      },
      prove: () => Promise.resolve(new Proof('0100').serialize()),
    }),
    pow: (challenge, tx, difficulty) => Promise.resolve(solvePow(challenge, tx, difficulty)),
    origin: 'https://veilcore.test',
    fetch: fakeFetch,
    publicData: {
      // The state the call reads first, with each operation's verifier key as a deployed
      // contract would have it; everything else is the real stand-in state.
      queryContractState: () =>
        Promise.resolve(
          new Proxy(state, {
            get: (t, prop): unknown => {
              if (prop === 'operation')
                return (name: string) => (t.operation(name) ? { verifierKey: standInVerifierKey(name) } : undefined);
              const v: unknown = Reflect.get(t, prop, t);
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
            },
          }),
        ),
      queryZSwapAndContractState: async () => {
        const { ZswapChainState, LedgerParameters } = await import('@midnight-ntwrk/ledger-v8');
        return [new ZswapChainState(), state, LedgerParameters.initialParameters()];
      },
      watchForTxData: (txId: string) =>
        Promise.resolve({
          status: SucceedEntirely,
          txId,
          txHash: 'ab'.repeat(32),
          blockHeight: 42,
          blockTimestamp: 1_790_000_000_000,
        }),
    } as never,
  };
  return { deps, requests, sealed, checkedCircuits };
};
