// Preprod smoke run of 2 Oct 2026: the network refused the deploy with "1010: Invalid
// Transaction: Custom error: 171" (OutOfDustValidityWindow: the indexer the wallet reads
// the chain's time from was behind the chain). The tool took any 1010 for "over the block
// limit" and retried smaller at three new addresses. And two saves of wallet progress ran
// at once on stop, sharing the temporary file. Each test asserts the fix.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Logger } from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const chain = vi.hoisted(() => ({
  createUnprovenDeployTx: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
  submitTxAsync: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
}));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    createUnprovenDeployTx: (...a: unknown[]) => chain.createUnprovenDeployTx!(...a),
    submitTxAsync: (...a: unknown[]) => chain.submitTxAsync!(...a),
  };
});

const { VeilcoreAPI, isBlockLimit, isStaleDustTime } = await import('../../api/src/veilcore-api');
const { WalletStateFile } = await import('./wallet-state');

// The exact error text the preprod node returned, wrapped as midnight-js wraps it.
const err171 = new Error('Transaction submission error', {
  cause: new Error('1010: Invalid Transaction: Custom error: 171'),
});

describe('a refusal is only taken for size when it says so', () => {
  it('171 (stale DUST time) is not a block limit; 154 and the fee computation message are', () => {
    expect(isBlockLimit(err171)).toBe(false);
    expect(isStaleDustTime(err171)).toBe(true);
    expect(isBlockLimit(new Error('1010: Invalid Transaction: Custom error: 154'))).toBe(true);
    expect(isBlockLimit(new Error('exceeded block limit in transaction fee computation'))).toBe(true);
    expect(isBlockLimit(new Error('1010: Invalid Transaction: Custom error: 170'))).toBe(false);
    expect(isBlockLimit(new Error('1010: Invalid Transaction: Custom error: 1540'))).toBe(false);
  });

  it('a deploy refused with 171 is tried once, its key dropped, and the reason given', async () => {
    setNetworkId('preview');
    const ADDR = 'cd'.repeat(32);
    const keys = new Map<string, string>();
    const lines: string[] = [];
    const push = (m: unknown) => void lines.push(typeof m === 'string' ? m : JSON.stringify(m));
    const logger = { info: push, warn: push, error: push } as unknown as Logger;
    let built = 0;
    chain.createUnprovenDeployTx = async () => {
      built++;
      return {
        public: { contractAddress: ADDR },
        private: { signingKey: 'ef'.repeat(32), initialPrivateState: {}, unprovenTx: {} },
      };
    };
    chain.submitTxAsync = async () => {
      throw err171;
    };
    const providers = {
      privateStateProvider: {
        setContractAddress: () => undefined,
        set: async () => undefined,
        setSigningKey: async (a: string, k: string) => void keys.set(a, k),
        removeSigningKey: async (a: string) => void keys.delete(a),
      },
    };
    await expect(VeilcoreAPI.deploy(providers as never, 'ef'.repeat(32), logger)).rejects.toThrow();
    expect(built).toBe(1); // no smaller retries at new addresses
    expect(keys.size).toBe(0); // nothing was created, so no key is kept for it
    const out = lines.join('\n');
    expect(out).toMatch(/custom error 171, OutOfDustValidityWindow/);
    expect(out).not.toMatch(/over the block limit/);
    expect(out).not.toMatch(/may still have landed/);
  });
});

describe('saves of wallet progress run one at a time', () => {
  it('two saves at once both finish, leaving one readable file and no temporary file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ws2-'));
    const silent = { warn: () => undefined, info: () => undefined } as unknown as Logger;
    const file = new WalletStateFile(silent, 'preprod', 'ab'.repeat(32), dir, 'Correct-Horse-Battery-9!');
    const w = (tag: string) => ({
      shielded: { serializeState: async () => `s-${tag}` },
      unshielded: { serializeState: async () => `u-${tag}` },
      dust: { serializeState: async () => `d-${tag}` },
    });
    await Promise.all([file.save(w('a')), file.save(w('b')), file.save(w('c'))]);
    expect(readdirSync(dir)).toEqual([path.basename(file.path)]);
    const read = await file.read();
    expect(read.kind).toBe('ok');
    expect(JSON.stringify(read)).toContain('s-c'); // the last save is the one kept
  });
});
