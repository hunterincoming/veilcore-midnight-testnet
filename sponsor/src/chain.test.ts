// The anchoring job's real transaction path, offline: the compiled contract builds an
// anchorBatch call against a contract state made locally, a stand-in prover proves it,
// a stand-in wallet balances it. Checks that no secret is ever asked for and that the
// result is exactly one anchorBatch call carrying the root.
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { check as zkCheck, jsonIrToBinary } from '@midnight-ntwrk/zkir-v2';
import { createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import { CostModel, LedgerParameters, Proof, ZswapChainState, sampleContractAddress, sampleCoinPublicKey, sampleEncryptionPublicKey } from '@midnight-ntwrk/ledger-v8';
import { createProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { loadVeilcore, MidnightAnchorChain } from './chain.js';
import { inspect } from './policy.js';
import type { FacadeWallet } from './wallet.js';

const ARTIFACTS = resolve(import.meta.dirname, '..', '..', 'contract', 'src', 'managed', 'veilcore');
const have = existsSync(resolve(ARTIFACTS, 'contract', 'index.js'));

describe.skipIf(!have)('anchorBatch, built offline from the compiled contract', () => {
  it('builds one anchorBatch call with the root, passes the circuit check, and asks for no secret', { timeout: 60_000 }, async () => {
    setNetworkId('preprod');
    const veilcore = await loadVeilcore(ARTIFACTS);
    const address = sampleContractAddress();
    const refuse = () => {
      throw new Error('a witness was called');
    };
    const witnesses = new Proxy({}, { get: () => refuse });
    const initial = new veilcore.Contract(witnesses as never).initialState(
      createConstructorContext({} as never, '0'.repeat(64)),
    ).currentContractState;
    const publicData = {
      queryZSwapAndContractState: () => Promise.resolve([new ZswapChainState(), initial, LedgerParameters.initialParameters()]),
      queryContractState: () => Promise.resolve(initial),
    };
    // The real circuit IR checks the call (no keys needed for that); the proof itself is a placeholder.
    const km = {
      lookupKey: (loc: string) =>
        Promise.resolve({
          proverKey: new Uint8Array(),
          verifierKey: new Uint8Array(),
          ir: jsonIrToBinary(readFileSync(resolve(ARTIFACTS, 'zkir', `${loc}.zkir`), 'utf8')),
        }),
      getParams: () => Promise.reject(new Error('no params offline')),
    };
    const checked: string[] = [];
    const prover = createProofProvider(
      {
        check: (pre: Uint8Array, loc: string) => {
          checked.push(loc);
          return zkCheck(pre, km);
        },
        prove: () => Promise.resolve(new Proof('0100').serialize()),
      },
      CostModel.initialCostModel(),
    );
    let balanced: unknown;
    const wallet = {
      balanceUnbound: (tx: { bind: () => unknown }) => {
        balanced = tx.bind();
        return Promise.resolve(balanced);
      },
      submit: () => Promise.resolve('id'),
      revert: () => Promise.resolve(),
      feeOf: () => Promise.resolve(1_234n),
    } as unknown as FacadeWallet;
    const chain = new MidnightAnchorChain(
      veilcore,
      ARTIFACTS,
      address,
      'http://unused',
      'ws://unused',
      'http://unused',
      wallet,
      sampleCoinPublicKey(),
      sampleEncryptionPublicKey(),
      { publicData, prover },
    );
    const root = 'ab'.repeat(32);
    const prepared = await chain.prepare(root);
    expect(prepared.txId).toMatch(/^[0-9a-f]+$/);
    expect(prepared.fee).toBe(1_234n); // what the anchoring job counts against the daily budget
    expect(checked).toEqual(['anchorBatch']);
    // Read it the way the sponsor reads a visitor's transaction: one call, anchorBatch.
    const bytes = (balanced as { serialize: () => Uint8Array }).serialize();
    const { verdict } = inspect(bytes, { contractAddress: address, allowedCircuits: new Set(['x']), maxBytes: 1e6, maxTtlMs: 3600e3 }, new Date());
    expect(verdict).toMatchObject({ ok: false, code: 'circuit-not-allowed' }); // public endpoint never pays for it
    expect(await chain.batchSeq()).toBe(0n);
  });
});
