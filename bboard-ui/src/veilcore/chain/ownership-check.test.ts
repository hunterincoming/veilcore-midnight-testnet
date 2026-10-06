import './test-env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ledger, type Ledger } from '../../../../contract/src/managed/veilcore/contract/index.js';
import { checkAnchor, checkOwnership, newChallenge } from './ownership-check';
import { identityOf, recoveryCommitmentOf } from './actions';
import { contractStateAfter } from './test-chain';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});

const RECORD = new Uint8Array(32).fill(1);
const OTHER = new Uint8Array(32).fill(2);
const RCV = recoveryCommitmentOf(new Uint8Array(32).fill(3));
const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));

const afterProof = (secret: Uint8Array, challenge: string): Ledger =>
  ledger(
    contractStateAfter([
      { secret: RECORD, circuit: 'anchor', args: [RCV] },
      { secret: OTHER, circuit: 'anchor', args: [recoveryCommitmentOf(new Uint8Array(32).fill(4))] },
      { secret, circuit: 'proveOwnership', args: [hexToBytes(challenge)] },
    ]).data,
  );

describe('verifier: checking a holder’s answer', () => {
  it('accepts the answer to this tab’s challenge, from the record’s identity, once', async () => {
    const challenge = newChallenge();
    const after = afterProof(RECORD, challenge);
    const deps = { stateAfter: () => Promise.resolve(after), latest: () => Promise.resolve(after) };
    const input = { txId: 'aa'.repeat(32), identity: identityOf(RECORD), challenge };
    expect(await checkOwnership(input, deps)).toMatchObject({ accepted: true });
    const again = await checkOwnership(input, deps);
    expect(again.accepted).toBe(false);
    expect(again.reason).toMatch(/already answered/);
  });

  it('refuses a challenge this tab did not make', async () => {
    const challenge = 'ee'.repeat(32);
    const after = afterProof(RECORD, challenge);
    const v = await checkOwnership(
      { txId: 'aa', identity: identityOf(RECORD), challenge },
      { stateAfter: () => Promise.resolve(after), latest: () => Promise.resolve(after) },
    );
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/did not make/);
  });

  it('refuses a proof made by a different record', async () => {
    const challenge = newChallenge();
    const after = afterProof(OTHER, challenge);
    const v = await checkOwnership(
      { txId: 'aa', identity: identityOf(RECORD), challenge },
      { stateAfter: () => Promise.resolve(after), latest: () => Promise.resolve(after) },
    );
    expect(v.accepted).toBe(false);
  });

  it('refuses a proof that answered another challenge', async () => {
    const mine = newChallenge();
    const after = afterProof(RECORD, 'dd'.repeat(32));
    const v = await checkOwnership(
      { txId: 'aa', identity: identityOf(RECORD), challenge: mine },
      { stateAfter: () => Promise.resolve(after), latest: () => Promise.resolve(after) },
    );
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/did not answer this challenge/);
  });

  it('passes on a lookup failure as a refusal', async () => {
    const challenge = newChallenge();
    const v = await checkOwnership(
      { txId: 'aa', identity: identityOf(RECORD), challenge },
      {
        stateAfter: () => Promise.reject(new Error('No such transaction.')),
        latest: () => Promise.reject(new Error('x')),
      },
    );
    expect(v).toEqual({ accepted: false, reason: 'No such transaction.' });
  });

  it('checks an anchor transaction names the identity', async () => {
    const after = ledger(contractStateAfter([{ secret: RECORD, circuit: 'anchor', args: [RCV] }]).data);
    expect(await checkAnchor('aa', identityOf(RECORD), { stateAfter: () => Promise.resolve(after) })).toBe(true);
    expect(await checkAnchor('aa', identityOf(OTHER), { stateAfter: () => Promise.resolve(after) })).toBe(false);
  });
});

describe('verifier: the network path is the partner kit’s checkOwnership', () => {
  // A stand-in indexer answering the two queries the kit makes: the transaction (one
  // proveOwnership call on the demo contract, with the state right after it) and the
  // contract's state now.
  const indexer = (after: ReturnType<typeof contractStateAfter>, entryPoint = 'proveOwnership') => {
    const hex = Buffer.from(after.serialize()).toString('hex');
    const seen: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      seen.push(String(url));
      const q = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { query: string };
      const data = q.query.includes('transactions')
        ? {
            transactions: [
              {
                block: { height: 7, timestamp: 1_791_000_000_000 },
                identifiers: ['aa'.repeat(32)],
                transactionResult: { status: 'SUCCESS' },
                contractActions: [{ address: 'c0'.repeat(32), state: hex, entryPoint }],
              },
            ],
          }
        : { contractAction: { state: hex } };
      return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
    });
    return seen;
  };
  const stateAfterProof = (secret: Uint8Array, challenge: string) =>
    contractStateAfter([
      { secret: RECORD, circuit: 'anchor', args: [RCV] },
      { secret: OTHER, circuit: 'anchor', args: [recoveryCommitmentOf(new Uint8Array(32).fill(4))] },
      { secret, circuit: 'proveOwnership', args: [hexToBytes(challenge)] },
    ]);

  it('accepts a real answer, read from the configured indexer and contract', async () => {
    const challenge = newChallenge();
    const seen = indexer(stateAfterProof(RECORD, challenge));
    const v = await checkOwnership({ txId: 'aa'.repeat(32), identity: identityOf(RECORD), challenge });
    expect(v).toMatchObject({ accepted: true });
    expect(seen.every((u) => u === 'https://indexer.preprod.midnight.network/api/v4/graphql')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('refuses a transaction that is not a proveOwnership call', async () => {
    const challenge = newChallenge();
    indexer(stateAfterProof(RECORD, challenge), 'pairDna');
    const v = await checkOwnership({ txId: 'aa'.repeat(32), identity: identityOf(RECORD), challenge });
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/not a single proveOwnership call/);
    vi.unstubAllGlobals();
  });

  it('refuses an answer from another record', async () => {
    const challenge = newChallenge();
    indexer(stateAfterProof(OTHER, challenge));
    const v = await checkOwnership({ txId: 'aa'.repeat(32), identity: identityOf(RECORD), challenge });
    expect(v.accepted).toBe(false);
    vi.unstubAllGlobals();
  });
});
