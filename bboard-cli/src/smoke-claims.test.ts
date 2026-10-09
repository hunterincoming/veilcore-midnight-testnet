// The smoke test's claims phase (smoke.ts, claimsPhase), run end to end against a local
// stand-in for the chain: the compiled claims contract's real circuits, a deploy that
// lands, a retirement that the "chain" applies, and an indexer that serves each call's
// state. Proofs are the one thing missing; preprod supplies them. This checks the phase
// itself: that it drives every claim through ClaimsAPI, counts exactly CLAIMS_CHECKS
// checks, and fails when the chain does not show what it should.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContractMaintenanceAuthority,
  ContractState,
  createCircuitContext,
  createConstructorContext,
  signatureVerifyingKey,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract } from '../../contract/src/managed/veilcore-claims/contract/index.js';
import { type ClaimsPrivateState, claimsWitnesses, emptyClaimsPrivateState } from '../../contract/src/claims.js';

const fake = vi.hoisted(() => ({
  createUnprovenDeployTx: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
  submitTxAsync: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
  submitTx: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
  findDeployedContract: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
}));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    createUnprovenDeployTx: (...a: unknown[]) => fake.createUnprovenDeployTx!(...a),
    submitTxAsync: (...a: unknown[]) => fake.submitTxAsync!(...a),
    submitTx: (...a: unknown[]) => fake.submitTx!(...a),
    findDeployedContract: (...a: unknown[]) => fake.findDeployedContract!(...a),
  };
});

const { claimsPhase, CLAIMS_CHECKS, MAIN_CHECKS, isContractRefusal } = await import('./smoke');
const { claimsPrivateStateKey } = await import('../../api/src/claims-types');

const ADDR = 'cd'.repeat(32);
const OTHER = 'ef'.repeat(32);

/** The claims contract on a stand-in chain, with an indexer serving each call's state. */
const standIn = (opts: { retireLands?: boolean; lieAboutBound?: boolean } = {}) => {
  const c = new Contract<ClaimsPrivateState>(claimsWitnesses);
  let state = c.initialState(createConstructorContext(emptyClaimsPrivateState(), '0'.repeat(64))).currentContractState;
  const store = new Map<string, unknown>();
  const keys = new Map<string, string>();
  const txs = new Map<string, { address: string; state: string; entryPoint: string }>();
  let n = 0;
  const providers = {
    privateStateProvider: {
      setContractAddress: () => undefined,
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => void store.set(k, v),
      setSigningKey: async (a: string, k: string) => void keys.set(a, k),
      getSigningKey: async (a: string) => keys.get(a),
      removeSigningKey: async (a: string) => void keys.delete(a),
    },
    publicDataProvider: {
      queryContractState: async () => state,
      watchForTxData: async (txId: string) => ({ txId, txHash: txId, blockHeight: 1, status: 'SucceedEntirely' }),
    },
    zkConfigProvider: { getVerifierKey: async () => new Uint8Array(0) },
  };
  fake.createUnprovenDeployTx = async (_p, o) => {
    const { signingKey, initialPrivateState } = o as { signingKey: string; initialPrivateState: unknown };
    state.maintenanceAuthority = new ContractMaintenanceAuthority([signatureVerifyingKey(signingKey)], 1, 0n);
    return { public: { contractAddress: ADDR }, private: { unprovenTx: {}, signingKey, initialPrivateState } };
  };
  fake.submitTxAsync = async () => 'deploy';
  fake.submitTx = async () => {
    if (opts.retireLands !== false) {
      const a = state.maintenanceAuthority;
      state.maintenanceAuthority = new ContractMaintenanceAuthority([], 1, a.counter + 1n);
    }
    return { txId: 'retire', txHash: 'retire', blockHeight: 2, status: 'SucceedEntirely' };
  };
  const callTx = new Proxy(
    {},
    {
      get:
        (_t, circuit: string) =>
        async (...args: unknown[]) => {
          const ps = store.get(claimsPrivateStateKey) as ClaimsPrivateState;
          const ctx: CircuitContext<ClaimsPrivateState> = createCircuitContext(ADDR, '0'.repeat(64), state, ps);
          const fn = (c.impureCircuits as unknown as Record<string, (...a: unknown[]) => { context: typeof ctx }>)[
            circuit
          ];
          if (opts.lieAboutBound && circuit === 'proveRange') args[4] = 1n; // the "chain" records another bound
          const r = fn(ctx, ...args);
          const next = new ContractState();
          next.data = r.context.currentQueryContext.state;
          next.maintenanceAuthority = state.maintenanceAuthority;
          state = next;
          const txId = (++n).toString(16).padStart(64, '0');
          txs.set(txId, { address: ADDR, state: Buffer.from(state.serialize()).toString('hex'), entryPoint: circuit });
          return {
            public: { txId, txHash: txId, blockHeight: n, nextContractState: r.context.currentQueryContext.state },
          };
        },
    },
  );
  fake.findDeployedContract = async () => ({ deployTxData: { public: { contractAddress: ADDR } }, callTx });
  txs.set('aa'.repeat(32), { address: OTHER, state: '00', entryPoint: 'proveOwnership' });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
    const id = (JSON.parse(init?.body as string) as { variables: { offset: { identifier: string } } }).variables.offset
      .identifier;
    const t = txs.get(id);
    return Response.json({
      data: {
        transactions: t ? [{ identifiers: [id], transactionResult: { status: 'SUCCESS' }, contractActions: [t] }] : [],
      },
    });
  });
  return { providers, keys };
};

const steps = () => {
  let step = 0;
  const log: string[] = [];
  const pass = (what: string): void => void log.push(`PASS ${++step}. ${what}`);
  const must = (ok: boolean, what: string): void => {
    if (!ok) throw new Error(`FAILED at step ${step + 1}: ${what}`);
    pass(what);
  };
  const refused = async (what: string, attempt: () => Promise<unknown>, expected?: RegExp): Promise<void> => {
    try {
      await attempt();
    } catch (e) {
      const ok =
        expected === undefined ? isContractRefusal(e) : expected.test(e instanceof Error ? e.message : String(e));
      if (ok) return pass(`refused, as it should be: ${what}`);
      throw new Error(`FAILED at step ${step + 1}: ${what} failed, but not as a refusal`, { cause: e });
    }
    throw new Error(`FAILED at step ${step + 1}: the network ACCEPTED ${what}`);
  };
  return { s: { pass, must, refused }, log, count: () => step };
};

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

describe("the smoke test's claims phase", () => {
  beforeEach(() => {
    setNetworkId('undeployed');
    vi.restoreAllMocks();
  });

  it(`runs every claim and adds exactly ${11} checks, for ${26 + 11} in all`, async () => {
    const chain = standIn();
    const st = steps();
    const address = await claimsPhase(chain.providers as never, 'http://indexer', quiet, st.s, 'aa'.repeat(32));
    expect(address).toBe(ADDR);
    expect(st.count()).toBe(CLAIMS_CHECKS);
    expect(MAIN_CHECKS + CLAIMS_CHECKS).toBe(37);
    expect(st.log.join('\n')).toMatch(/empty committee/);
    expect(st.log.join('\n')).toMatch(/refused, as it should be: a bound the sealed number does not meet/);
    expect(chain.keys.size).toBe(0); // the deploy key is gone once the authority is retired
  });

  it('fails if the retirement never shows on chain', async () => {
    const chain = standIn({ retireLands: false });
    const st = steps();
    const { ClaimsAPI } = await import('../../api/src/claims-api');
    ClaimsAPI.confirmIntervalMs = 1;
    try {
      await expect(
        claimsPhase(chain.providers as never, 'http://indexer', quiet, st.s, 'aa'.repeat(32)),
      ).rejects.toThrow(/does not show it after a minute/);
    } finally {
      ClaimsAPI.confirmIntervalMs = 2_000;
    }
    expect(st.count()).toBe(0);
  });

  it('fails if the chain shows a different bound from the one proved', async () => {
    const chain = standIn({ lieAboutBound: true });
    const st = steps();
    await expect(claimsPhase(chain.providers as never, 'http://indexer', quiet, st.s, 'aa'.repeat(32))).rejects.toThrow(
      /FAILED at step 4: proveRange/,
    );
  });
});
