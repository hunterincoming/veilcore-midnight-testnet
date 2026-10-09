// The wallet-free checks (src/verify.ts) against an indexer that lies (8 October 2026
// review): a fake indexer answering with a contract state built locally, for a root that
// was never on chain (pocs/client/fake-indexer-batch-anchor.mjs). And the network name, the
// indexers and the address must agree.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fake indexer stands in for fetch */
import {
  ContractMaintenanceAuthority,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  sampleSigningKey,
  signatureVerifyingKey,
  type ContractState,
} from '@midnight-ntwrk/compact-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Contract } from '../../contract/src/managed/veilcore/contract/index.js';
import { checkBatchAnchor, checkOwnership, readAuthority, readClaimsAuthority, readLedger } from '../src/verify';
import { ContractStateMismatchError } from '../../api/src/state-check';
import { MAINNET_ADDRESSES, PREPROD_ADDRESSES } from '../src/network';

const COIN = '0'.repeat(64);
const TX = 'ab'.repeat(32);
const zero = new Uint8Array(32);
const witnesses = new Proxy({}, { get: () => (ctx: { privateState: unknown }) => [ctx.privateState, zero] });

/** The real constructor and the real anchorBatch circuit, run locally: no chain involved. */
const forgedBatchState = (root: Uint8Array): string => {
  const c = new Contract(witnesses as never);
  const init = c.initialState(createConstructorContext({}, COIN));
  const cs: ContractState = init.currentContractState;
  const ctx = c.impureCircuits.anchorBatch(
    createCircuitContext(sampleContractAddress(), COIN, cs, {}) as never,
    root,
  ).context;
  cs.data = ctx.currentQueryContext.state;
  cs.maintenanceAuthority = new ContractMaintenanceAuthority([signatureVerifyingKey(sampleSigningKey())], 1, 16n);
  return Buffer.from(cs.serialize()).toString('hex');
};

const forged = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + (i % 16));
const STATE = forgedBatchState(forged);

/** When every fake indexer says the block landed (the same for all, as for one real block). */
const LANDED = Date.now();

/**
 * Indexers by URL: each answers the transaction lookup with `state` at `address`, and the
 * contract-state query (the state now) with `now` (default: `state`).
 */
const indexers = (answers: Record<string, { address: string; state: string; height?: number; now?: string }>) => {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    asked.push(String(url));
    const a = answers[String(url)];
    if ((init?.body ?? '').includes('contractAction(address'))
      return {
        ok: true,
        json: async () => ({ data: { contractAction: a === undefined ? null : { state: a.now ?? a.state } } }),
      };
    const transactions =
      a === undefined
        ? []
        : [
            {
              identifiers: [TX],
              transactionResult: { status: 'SUCCESS' },
              block: { height: a.height ?? 2999999, timestamp: LANDED },
              contractActions: [{ address: a.address, state: a.state, entryPoint: 'anchorBatch' }],
            },
          ];
    return { ok: true, json: async () => ({ data: { transactions } }) };
  });
  return asked;
};

afterEach(() => vi.unstubAllGlobals());

describe('a fake indexer on mainnet (the review PoC)', () => {
  it('REFUSED: a locally built state at the pinned address does not carry the pinned verifier keys', async () => {
    indexers({ 'http://127.0.0.1:1/': { address: MAINNET_ADDRESSES.veilcore, state: STATE } });
    const v = await checkBatchAnchor({ network: 'mainnet', indexer: 'http://127.0.0.1:1/', txId: TX, root: forged });
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/verifier keys at that transaction are not the pinned build's/);
    // The authority the state claims is still reported.
    expect(v.authority).toEqual({ committee: 1, threshold: 1, counter: 16n, retired: false });
  });

  it('cannot turn the key check off on mainnet', async () => {
    indexers({});
    await expect(
      checkBatchAnchor({
        network: 'mainnet',
        indexer: 'http://127.0.0.1:1/',
        txId: TX,
        root: forged,
        verifierKeys: 'report',
      }),
    ).rejects.toThrow(/always checked/);
  });
});

describe('a second indexer must agree', () => {
  const ADDR = 'cd'.repeat(32);
  const base = { network: 'undeployed' as const, indexer: 'http://one/', address: ADDR, txId: TX, root: forged };

  it('one indexer alone: accepted, with the maintenance authority reported', async () => {
    indexers({ 'http://one/': { address: ADDR, state: STATE } });
    const v = await checkBatchAnchor(base);
    expect(v.accepted).toBe(true);
    expect(v.authority?.counter).toBe(16n);
  });

  it('two that agree: accepted; both were asked', async () => {
    const asked = indexers({
      'http://one/': { address: ADDR, state: STATE },
      'http://two/': { address: ADDR, state: STATE },
    });
    expect((await checkBatchAnchor({ ...base, secondIndexer: 'http://two/' })).accepted).toBe(true);
    expect(asked).toEqual(['http://one/', 'http://two/']);
  });

  it('REFUSED: the second has no such transaction, another state, or another block', async () => {
    indexers({ 'http://one/': { address: ADDR, state: STATE } });
    await expect(checkBatchAnchor({ ...base, secondIndexer: 'http://two/' })).rejects.toThrow(
      /second indexer does not confirm/,
    );
    indexers({
      'http://one/': { address: ADDR, state: STATE },
      'http://two/': { address: ADDR, state: forgedBatchState(new Uint8Array(32).fill(7)) },
    });
    await expect(checkBatchAnchor({ ...base, secondIndexer: 'http://two/' })).rejects.toThrow(
      /disagree .*contract state/,
    );
    indexers({
      'http://one/': { address: ADDR, state: STATE },
      'http://two/': { address: ADDR, state: STATE, height: 5 },
    });
    await expect(checkBatchAnchor({ ...base, secondIndexer: 'http://two/' })).rejects.toThrow(/disagree .*block/);
  });

  it('rule 8 asks both for the state now as well', async () => {
    indexers({});
    await expect(
      checkOwnership({ ...base, secondIndexer: 'http://two/', record: zero, challenge: zero }),
    ).rejects.toThrow(/No such transaction/);
  });
});

describe('the network name, the indexers and the address agree', () => {
  it('REFUSED: preprod with a mainnet indexer (the address pin would be skipped)', async () => {
    const asked = indexers({});
    await expect(
      checkBatchAnchor({
        network: 'preprod',
        indexer: 'https://midnight-mainnet.blockfrost.io/api/v0?project_id=fakefakefake',
        txId: TX,
        root: forged,
      }),
    ).rejects.toThrow(/network is preprod but the indexer midnight-mainnet\.blockfrost\.io is a mainnet one/);
    await expect(
      checkBatchAnchor({
        network: 'preprod',
        secondIndexer: 'https://indexer.mainnet.example/graphql',
        txId: TX,
        root: forged,
      }),
    ).rejects.toThrow(/is a mainnet one/);
    expect(asked).toEqual([]);
  });

  it("REFUSED: VeilCore's mainnet address under another network name", async () => {
    indexers({});
    await expect(
      checkBatchAnchor({ network: 'preprod', address: MAINNET_ADDRESSES.veilcore, txId: TX, root: forged }),
    ).rejects.toThrow(/is VeilCore's mainnet contract, but the network is preprod/);
    await expect(
      readAuthority({ network: 'undeployed', indexer: 'http://one/', address: MAINNET_ADDRESSES.veilcore }),
    ).rejects.toThrow(/mainnet contract/);
  });

  it('REFUSED: mainnet with a preprod indexer', async () => {
    indexers({});
    await expect(
      checkBatchAnchor({
        network: 'mainnet',
        indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
        txId: TX,
        root: forged,
      }),
    ).rejects.toThrow(/network is mainnet but the indexer indexer\.preprod\.midnight\.network is not/);
  });

  it('preprod checks the pinned keys by default; the preprod address is accepted', async () => {
    indexers({ 'http://one/': { address: PREPROD_ADDRESSES.veilcore, state: STATE } });
    const v = await checkBatchAnchor({ network: 'preprod', indexer: 'http://one/', txId: TX, root: forged });
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/not the pinned build's/);
    const r = await checkBatchAnchor({
      network: 'preprod',
      indexer: 'http://one/',
      txId: TX,
      root: forged,
      verifierKeys: 'report',
    });
    expect(r.accepted).toBe(true);
  });
});

// Verification review: the readers of the state now ignored secondIndexer, though the
// options said every check asks both; and readLedger (lineage) had no key check.
describe('reading the state now', () => {
  const ADDR = 'cd'.repeat(32);
  const OTHER = forgedBatchState(new Uint8Array(32).fill(9));
  const base = { network: 'undeployed' as const, indexer: 'http://one/', address: ADDR };

  it('with two indexers that agree: read', async () => {
    const asked = indexers({
      'http://one/': { address: ADDR, state: STATE },
      'http://two/': { address: ADDR, state: STATE },
    });
    expect((await readLedger({ ...base, secondIndexer: 'http://two/' })).batchSeq).toBe(1n);
    expect((await readAuthority({ ...base, secondIndexer: 'http://two/' })).counter).toBe(16n);
    expect(asked).toContain('http://two/');
  });

  it('REFUSED: readLedger, readAuthority and readClaimsAuthority when the second indexer disagrees or has nothing', async () => {
    indexers({ 'http://one/': { address: ADDR, state: STATE }, 'http://two/': { address: ADDR, state: OTHER } });
    await expect(readLedger({ ...base, secondIndexer: 'http://two/' })).rejects.toThrow(/disagree .*state now/);
    await expect(readAuthority({ ...base, secondIndexer: 'http://two/' })).rejects.toThrow(/disagree/);
    await expect(readClaimsAuthority({ ...base, secondIndexer: 'http://two/' })).rejects.toThrow(/disagree/);
    indexers({ 'http://one/': { address: ADDR, state: STATE } });
    await expect(readLedger({ ...base, secondIndexer: 'http://two/' })).rejects.toThrow(
      /second indexer does not confirm/,
    );
  }, 30_000);

  it('REFUSED: readLedger on a state that is not the pinned build (preprod checks keys by default)', async () => {
    indexers({ 'http://one/': { address: PREPROD_ADDRESSES.veilcore, state: STATE } });
    await expect(readLedger({ network: 'preprod', indexer: 'http://one/' })).rejects.toThrow(
      ContractStateMismatchError,
    );
    expect((await readLedger({ network: 'preprod', indexer: 'http://one/', verifierKeys: 'report' })).batchSeq).toBe(
      1n,
    );
  });
});
