// A stand-in for the chain, the indexer and the wallet, as the CLI tests use
// (bboard-cli/src/claims.test.ts, hardening-roundD.test.ts): the compiled contracts' real
// circuits run against an in-memory state with the private state the client set, and
// each call's resulting state is served to the indexer queries the verifier helpers make.
// No proofs (they need the proving parameters, which are not here); preprod supplies them.
//
// The test file must replace findDeployedContract with `fake.find` (vi.mock), as the CLI
// tests do, before importing anything that imports midnight-js-contracts.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */
import {
  ContractMaintenanceAuthority,
  ContractState,
  createCircuitContext,
  createConstructorContext,
  sampleSigningKey,
  signatureVerifyingKey,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { NEVER } from 'rxjs';
import { vi } from 'vitest';
import { Contract as VeilcoreContract } from '../../contract/src/managed/veilcore/contract/index.js';
import { Contract as ClaimsContract } from '../../contract/src/managed/veilcore-claims/contract/index.js';
import { createVeilcorePrivateState, veilcoreWitnesses } from '../../contract/src/witnesses.js';
import { claimsWitnesses, emptyClaimsPrivateState } from '../../contract/src/claims.js';
import { veilcorePrivateStateKey } from '../../api/src/veilcore-types.js';
import { claimsPrivateStateKey } from '../../api/src/claims-types.js';
import { memoryPrivateState } from '../src/private-state.js';
import { type Connection } from '../src/connect.js';
import { type Network } from '../src/network.js';

export const VEILCORE_ADDR = 'ab'.repeat(32);
export const CLAIMS_ADDR = 'cd'.repeat(32);
const COIN = '0'.repeat(64);

type Landed = { txId: string; address: string; entryPoint: string; state: ContractState; height: number; time: number };

/** Every landed call, in order, across both contracts: what the fake indexer serves. */
export const chainLog: Landed[] = [];
let txCount = 0;
const nextTxId = (): string => (++txCount).toString(16).padStart(64, '0');

/**
 * What midnight-js 4.1.1 throws when a circuit fails while the call is built locally
 * (submitCallTx → scoped transaction → createUnprovenCallTx; test/witness-error.test.ts
 * checks this against the real code): the circuit's error inside a ContractRuntimeError
 * naming the circuit, a failed assert's message lifted into a plain Error above that, and
 * all of it inside "Unexpected error executing scoped transaction". The refusal is never
 * in the top message.
 */
export const asMidnightJsThrows = (circuit: string, e: unknown): Error => {
  const message = e instanceof Error ? e.message : String(e);
  const runtime = Object.assign(new Error(`Error executing circuit '${circuit}'`, { cause: e }), {
    name: 'ContractRuntimeError',
  });
  const inner = /^failed assert: /.test(message) ? new Error(message, { cause: runtime }) : runtime;
  return new Error(`Unexpected error executing scoped transaction '<unnamed>': ${String(inner)}`, { cause: inner });
};

type Runner = { find: (...a: unknown[]) => Promise<unknown> };

/** One contract on the fake chain: its state, and a callTx that runs the real circuits. */
const contractOnChain = (
  address: string,
  contract: { impureCircuits: object; initialState: (c: never) => { currentContractState: ContractState } },
  initialPrivate: unknown,
  stateKey: string,
  store: { get: (k: string) => Promise<unknown> },
  authority: ContractMaintenanceAuthority,
) => {
  let state = contract.initialState(createConstructorContext(initialPrivate, COIN) as never).currentContractState;
  state.maintenanceAuthority = authority;
  const callTx = new Proxy(
    {},
    {
      get:
        (_t, circuit: string) =>
        async (...args: unknown[]) => {
          const ps = await store.get(stateKey);
          const ctx: CircuitContext<unknown> = createCircuitContext(address, COIN, state, ps);
          const now = Math.floor(Date.now() / 1000);
          ctx.currentQueryContext.block = { ...ctx.currentQueryContext.block, secondsSinceEpoch: BigInt(now) };
          const fn = (
            contract.impureCircuits as Record<string, (...a: unknown[]) => { context: typeof ctx; result: unknown }>
          )[circuit];
          let r: ReturnType<typeof fn>;
          try {
            r = fn(ctx, ...args);
          } catch (e) {
            throw asMidnightJsThrows(circuit, e);
          }
          const next = new ContractState();
          next.data = r.context.currentQueryContext.state;
          for (const op of state.operations()) next.setOperation(op, state.operation(op)!);
          next.maintenanceAuthority = state.maintenanceAuthority;
          state = next;
          const txId = nextTxId();
          chainLog.push({ txId, address, entryPoint: circuit, state, height: chainLog.length + 1, time: Date.now() });
          return {
            public: { txId, txHash: `h${txId.slice(-8)}`, blockHeight: chainLog.length, nextContractState: next.data },
            private: { result: r.result },
          };
        },
    },
  );
  return { state: () => state, callTx };
};

/**
 * A connection to the fake chain, with both contracts at VEILCORE_ADDR and CLAIMS_ADDR.
 * Installs the fake indexer (global fetch) and points `fake.find` at the contracts.
 */
export const fakeChain = (fake: Runner, network: Network = 'undeployed', claimsRetired = true) => {
  chainLog.length = 0;
  const veilcoreStore = memoryPrivateState<string, unknown>();
  const claimsStore = memoryPrivateState<string, unknown>();
  const main = contractOnChain(
    VEILCORE_ADDR,
    new VeilcoreContract(veilcoreWitnesses) as never,
    createVeilcorePrivateState(new Uint8Array(32)),
    veilcorePrivateStateKey,
    veilcoreStore,
    new ContractMaintenanceAuthority([signatureVerifyingKey(sampleSigningKey())], 1, 0n),
  );
  const claims = contractOnChain(
    CLAIMS_ADDR,
    new ClaimsContract(claimsWitnesses) as never,
    emptyClaimsPrivateState(),
    claimsPrivateStateKey,
    claimsStore,
    claimsRetired
      ? new ContractMaintenanceAuthority([], 1, 1n)
      : new ContractMaintenanceAuthority([signatureVerifyingKey(sampleSigningKey())], 1, 0n),
  );
  const stateAt = (address: string): ContractState | null =>
    address === VEILCORE_ADDR ? main.state() : address === CLAIMS_ADDR ? claims.state() : null;
  const publicDataProvider = {
    queryContractState: async (address: string) => stateAt(address),
    contractStateObservable: () => NEVER,
    // The latest action led nowhere: join then checks the ledger is still the constructor's.
    watchForDeployTxData: async () => {
      const e = new Error('maintenance update');
      e.name = 'IndexerDataError';
      throw e;
    },
  };
  // As midnight-js's findDeployedContract: store the initial private state, then the contract.
  fake.find = async (...a: unknown[]) => {
    const [providers, o] = a as [
      { privateStateProvider: { set: (k: string, v: unknown) => Promise<void> } },
      { contractAddress: string; privateStateId: string; initialPrivateState: unknown },
    ];
    const c = o.contractAddress === VEILCORE_ADDR ? main : o.contractAddress === CLAIMS_ADDR ? claims : undefined;
    if (c === undefined) throw new Error('no contract at that address');
    await providers.privateStateProvider.set(o.privateStateId, o.initialPrivateState);
    return { deployTxData: { public: { contractAddress: o.contractAddress } }, callTx: c.callTx };
  };
  vi.stubGlobal('fetch', fakeIndexer(stateAt));
  const wallet = {
    balanceTx: async () => {
      throw new Error('the fake chain needs no wallet');
    },
    submitTx: async () => 'never',
    getCoinPublicKey: () => '00'.repeat(32),
    getEncryptionPublicKey: () => '00'.repeat(32),
  };
  const endpoints = {
    indexer: 'http://127.0.0.1:1/graphql',
    indexerWS: 'ws://127.0.0.1:1/graphql/ws',
    node: 'http://127.0.0.1:2',
    nodeWS: 'ws://127.0.0.1:2',
    proofServer: 'http://127.0.0.1:6300',
  };
  const conn: Connection = {
    network,
    endpoints,
    providers: {
      veilcore: {
        privateStateProvider: veilcoreStore,
        publicDataProvider,
        zkConfigProvider: undefined,
        proofProvider: undefined,
        walletProvider: wallet,
        midnightProvider: wallet,
      } as never,
      claims: {
        privateStateProvider: claimsStore,
        publicDataProvider,
        zkConfigProvider: undefined,
        proofProvider: undefined,
        walletProvider: wallet,
        midnightProvider: wallet,
      } as never,
    },
  };
  return { conn, main, claims, veilcoreStore, claimsStore, endpoints };
};

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** The two GraphQL queries the verifier helpers make, answered from chainLog. */
export const fakeIndexer =
  (stateAt: (address: string) => ContractState | null) =>
  async (_url: string, init: { body: string }): Promise<Response> => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    let data: unknown;
    if (query.includes('VEILCORE_STATE')) {
      const s = stateAt(String(variables.address));
      data = { contractAction: s === null ? null : { state: hex(s.serialize()) } };
    } else if (query.includes('VEILCORE_PRESENTATION')) {
      const id = String((variables.offset as { identifier: string }).identifier);
      const tx = chainLog.find((t) => t.txId === id);
      data = {
        transactions:
          tx === undefined
            ? []
            : [
                {
                  identifiers: [tx.txId],
                  transactionResult: { status: 'SUCCESS' },
                  block: { height: tx.height, timestamp: tx.time },
                  contractActions: [
                    { address: tx.address, state: hex(tx.state.serialize()), entryPoint: tx.entryPoint },
                  ],
                },
              ],
      };
    } else throw new Error(`unexpected query ${query.slice(0, 40)}`);
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
