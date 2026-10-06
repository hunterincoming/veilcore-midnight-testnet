import { describe, expect, it } from 'vitest';
import { allowList, inspect, PHASE1_PUBLIC_CIRCUITS, type PolicyConfig } from './policy.js';
import { hostile, OTHER, sealedCall, ttlIn, VC } from './test-tx.js';

const config: PolicyConfig = {
  contractAddress: VC,
  allowedCircuits: new Set(PHASE1_PUBLIC_CIRCUITS),
  maxBytes: 64_000,
  maxTtlMs: 30 * 60_000,
};
const now = () => new Date();
const code = (b: Uint8Array, c: PolicyConfig = config, at: Date = now()) => {
  const { verdict } = inspect(b, c, at);
  return verdict.ok ? 'ok' : verdict.code;
};

describe('sponsor policy: what is paid for', () => {
  it.each(PHASE1_PUBLIC_CIRCUITS)('accepts a sealed %s call on the VeilCore contract', async (circuit) => {
    const bytes = await sealedCall(circuit);
    const { verdict, tx } = inspect(bytes, config, now());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.circuit).toBe(circuit);
    expect(verdict.identifiers.length).toBeGreaterThan(0);
    expect(tx).toBeDefined();
  });

  it('accepts the address with a 0x prefix or in capitals in the configuration', async () => {
    expect(code(await sealedCall(), { ...config, contractAddress: `0x${VC.toUpperCase()}` })).toBe('ok');
  });
});

describe('sponsor policy: hostile transactions are refused', () => {
  it('another contract', async () => expect(code(await sealedCall('anchor', ttlIn(600_000), OTHER))).toBe('wrong-contract'));
  it('a circuit not on the allow-list', async () => expect(code(await sealedCall('rotateRecordSecret'))).toBe('circuit-not-allowed'));
  it('anchorBatch, which only the job may call', async () => expect(code(await sealedCall('anchorBatch'))).toBe('circuit-not-allowed'));
  it('sealRevocations, even if configured', async () => {
    const loose = { ...config, allowedCircuits: new Set(['sealRevocations', 'anchor']) };
    expect(code(await sealedCall('sealRevocations'), loose)).toBe('circuit-not-allowed');
  });
  it('a deploy', async () => expect(code(hostile.deploy())).toBe('deploy'));
  it('a maintenance update', async () => expect(code(hostile.maintenance())).toBe('maintenance'));
  it('two calls in one intent', async () => expect(code(await hostile.twoCalls())).toBe('action-count'));
  it('two intents', async () => expect(code(await hostile.twoIntents())).toBe('intent-count'));
  it('a shielded token offer', async () => expect(code(await hostile.shieldedOffer())).toBe('shielded-offer'));
  it('an unshielded token offer', async () => expect(code(await hostile.unshieldedOffer())).toBe('unshielded-offer'));
  it('the caller’s own dust actions', async () => expect(code(await hostile.dustActions())).toBe('dust-actions'));
  it('an unproven transaction', async () => expect(code(hostile.unproven())).toBe('unreadable'));
  it('a proven but unsealed (unbound) transaction', async () => expect(code(await hostile.provenNotBound())).toBe('unreadable'));
  it('garbage bytes', async () => expect(code(new Uint8Array([1, 2, 3, 4]))).toBe('unreadable'));
  it('nothing', async () => expect(code(new Uint8Array())).toBe('empty'));
  it('oversize', async () => expect(code(await sealedCall(), { ...config, maxBytes: 100 })).toBe('too-large'));
  it('an expired transaction', async () => {
    const bytes = await sealedCall('anchor', ttlIn(60_000));
    expect(code(bytes, config, new Date(Date.now() + 120_000))).toBe('expired');
  });
  it('a transaction that expires too far ahead', async () => {
    expect(code(await sealedCall('anchor', ttlIn(3 * 60 * 60_000)))).toBe('ttl-too-far');
  });
});

describe('allow-list configuration', () => {
  it('never lets the job-only circuits be public', () => {
    expect(() => allowList(['anchor', 'anchorBatch'])).toThrow(/anchoring job/);
    expect(() => allowList(['sealRevocations'])).toThrow();
  });
  it('refuses something that is not a circuit name', () => expect(() => allowList(['anchor; drop'])).toThrow());
});
