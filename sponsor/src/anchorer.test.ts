import { describe, expect, it } from 'vitest';
import { Anchorer, type AnchorChain, type Attempt, type Batch, type Landing, type RegistryClient, type AnchorRecord } from './anchorer.js';
import { NotSentError } from './sponsor.js';

const ROOT = 'ab'.repeat(32);

class Registry implements RegistryClient {
  pending = 0;
  list: Batch[] = [];
  recorded: { batchId: string; anchor: AnchorRecord }[] = [];
  failRecord = false;
  seals = 0;
  pendingCount() {
    return Promise.resolve(this.pending);
  }
  seal() {
    if (this.pending === 0) return Promise.resolve(undefined);
    this.seals++;
    const b = { batchId: `B-${this.seals}`, root: ROOT, sealedAt: Date.now(), anchored: false };
    this.list.push(b);
    this.pending = 0;
    return Promise.resolve({ batchId: b.batchId, root: b.root });
  }
  batches() {
    return Promise.resolve(this.list);
  }
  recordAnchor(batchId: string, anchor: AnchorRecord) {
    if (this.failRecord) return Promise.reject(new Error('registry down'));
    this.recorded.push({ batchId, anchor });
    this.list = this.list.map((b) => (b.batchId === batchId ? { ...b, anchored: true } : b));
    return Promise.resolve();
  }
}

class Chain implements AnchorChain {
  seq = 5n;
  prepared = 0;
  sent: string[] = [];
  abandoned = 0;
  landings = new Map<string, Landing>();
  submitFails: 'no' | 'not-sent' | 'maybe' = 'no';
  /** What the chain will show after our tx lands. */
  afterRoot: string = ROOT;
  batchSeq() {
    return Promise.resolve(this.seq);
  }
  prepare(root: string) {
    this.prepared++;
    const txId = `tx-${this.prepared}`;
    return Promise.resolve({
      txId,
      ttl: new Date(Date.now() + 30 * 60_000),
      submit: () => {
        if (this.submitFails === 'not-sent') return Promise.reject(new NotSentError('stale', true));
        if (this.submitFails === 'maybe') return Promise.reject(new Error('timeout'));
        this.sent.push(txId);
        this.landings.set(txId, {
          state: 'landed',
          txHash: 'cd'.repeat(32),
          blockHeight: 100,
          blockTime: Date.parse('2026-10-03T12:00:00Z'),
          lastBatchRoot: this.afterRoot === ROOT ? root : this.afterRoot,
          batchSeq: this.seq + 1n,
        });
        return Promise.resolve();
      },
      abandon: () => {
        this.abandoned++;
        return Promise.resolve();
      },
    });
  }
  lookup(txId: string) {
    return Promise.resolve(this.landings.get(txId) ?? ({ state: 'unknown' } as const));
  }
}

const memoryStore = () => {
  let a: Attempt | undefined;
  return { load: () => a, save: (x: Attempt) => void (a = x), clear: () => void (a = undefined), peek: () => a };
};

const setup = () => {
  let t = Date.now();
  const registry = new Registry();
  const chain = new Chain();
  const store = memoryStore();
  const logs: string[] = [];
  const anchorer = new Anchorer(
    {
      network: 'preprod',
      contractAddress: 'ef'.repeat(32),
      sealEveryMs: 60 * 60_000,
      sealAtPending: 10,
      landingGraceMs: 10 * 60_000,
      waitForLandingMs: 0,
      pollMs: 1,
    },
    registry,
    chain,
    store,
    (job) => job(),
    () => t,
    () => Promise.resolve(),
    (_l, m) => logs.push(m),
  );
  return { anchorer, registry, chain, store, logs, advance: (ms: number) => (t += ms) };
};

describe('anchoring job (mocked registry and chain)', () => {
  it('does nothing when nothing is pending', async () => {
    const s = setup();
    expect(await s.anchorer.runOnce()).toBe('nothing to anchor');
    expect(s.chain.prepared).toBe(0);
  });

  it('waits to seal until enough are pending or the interval has passed', async () => {
    const s = setup();
    s.registry.pending = 3;
    expect(await s.anchorer.runOnce()).toBe('nothing to anchor');
    expect(s.registry.seals).toBe(0);
    s.advance(60 * 60_000);
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1/);
    expect(s.registry.seals).toBe(1);
  });

  it('seals, anchors, verifies on chain, then records on the registry', async () => {
    const s = setup();
    s.registry.pending = 12;
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1 in c/);
    expect(s.registry.recorded).toEqual([
      {
        batchId: 'B-1',
        anchor: {
          chain: 'midnight',
          network: 'preprod',
          contractAddress: 'ef'.repeat(32),
          txHash: 'cd'.repeat(32),
          blockHeight: 100,
          anchoredAt: '2026-10-03T12:00:00.000Z',
        },
      },
    ]);
    expect(s.store.peek()).toBeUndefined();
  });

  it('anchors an older sealed-but-unanchored batch first, without sealing a new one', async () => {
    const s = setup();
    s.registry.list = [{ batchId: 'B-old', root: ROOT, sealedAt: 1, anchored: false }];
    s.registry.pending = 50;
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-old/);
    expect(s.registry.seals).toBe(0);
  });

  it('does NOT record when the chain shows a different root', async () => {
    const s = setup();
    s.registry.pending = 12;
    s.chain.afterRoot = '11'.repeat(32);
    expect(await s.anchorer.runOnce()).toMatch(/NOT recorded/);
    expect(s.registry.recorded).toHaveLength(0);
    // And it never builds a second transaction for that batch.
    await s.anchorer.runOnce();
    await s.anchorer.runOnce();
    expect(s.chain.prepared).toBe(1);
    expect(s.anchorer.status().alert).toBe(true);
  });

  it('does NOT record when batchSeq did not advance', async () => {
    const s = setup();
    s.registry.pending = 12;
    const prep = s.chain.prepare.bind(s.chain);
    s.chain.prepare = async (root: string) => {
      const p = await prep(root);
      const submit = p.submit;
      return {
        ...p,
        submit: async () => {
          await submit();
          const l = s.chain.landings.get(p.txId) as Extract<Landing, { state: 'landed' }>;
          s.chain.landings.set(p.txId, { ...l, batchSeq: s.chain.seq });
        },
      };
    };
    expect(await s.anchorer.runOnce()).toMatch(/batchSeq did not advance/);
    expect(s.registry.recorded).toHaveLength(0);
  });

  it('after a restart, looks the saved attempt up instead of sending again', async () => {
    const s = setup();
    s.store.save({ batchId: 'B-9', root: ROOT, txId: 'tx-old', ttl: new Date(Date.now() + 60_000).toISOString(), seqBefore: '5', stage: 'sending' });
    s.registry.list = [{ batchId: 'B-9', root: ROOT, sealedAt: 1, anchored: false }];
    expect(await s.anchorer.runOnce()).toMatch(/waiting for tx-old/);
    expect(s.chain.prepared).toBe(0);
    s.chain.landings.set('tx-old', { state: 'landed', txHash: 'ee'.repeat(32), blockHeight: 7, lastBatchRoot: ROOT, batchSeq: 6n });
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-9/);
    expect(s.chain.prepared).toBe(0);
  });

  it('builds a fresh transaction only after the old one has expired unseen', async () => {
    const s = setup();
    s.store.save({ batchId: 'B-9', root: ROOT, txId: 'tx-old', ttl: new Date(Date.now() + 60_000).toISOString(), seqBefore: '5', stage: 'sent' });
    s.registry.list = [{ batchId: 'B-9', root: ROOT, sealedAt: 1, anchored: false }];
    await s.anchorer.runOnce();
    expect(s.chain.prepared).toBe(0);
    s.advance(60_000 + 10 * 60_000 + 1);
    expect(await s.anchorer.runOnce()).toMatch(/expired/);
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-9/);
    expect(s.chain.prepared).toBe(1);
  });

  it('a transaction that failed on chain is rebuilt', async () => {
    const s = setup();
    s.store.save({ batchId: 'B-9', root: ROOT, txId: 'tx-bad', ttl: new Date(Date.now() + 60_000).toISOString(), seqBefore: '5', stage: 'sent' });
    s.registry.list = [{ batchId: 'B-9', root: ROOT, sealedAt: 1, anchored: false }];
    s.chain.landings.set('tx-bad', { state: 'failed' });
    expect(await s.anchorer.runOnce()).toMatch(/failed on chain/);
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-9/);
  });

  it('not sent: clears the attempt, releases the coins, tries again next time', async () => {
    const s = setup();
    s.registry.pending = 12;
    s.chain.submitFails = 'not-sent';
    expect(await s.anchorer.runOnce()).toMatch(/not sent/);
    expect(s.store.peek()).toBeUndefined();
    expect(s.chain.abandoned).toBe(1);
    s.chain.submitFails = 'no';
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1/);
  });

  it('maybe sent: keeps the attempt and never sends a second one while it may land', async () => {
    const s = setup();
    s.registry.pending = 12;
    s.chain.submitFails = 'maybe';
    expect(await s.anchorer.runOnce()).toMatch(/may have failed/);
    expect(s.store.peek()?.stage).toBe('sent');
    s.chain.submitFails = 'no';
    await s.anchorer.runOnce();
    await s.anchorer.runOnce();
    expect(s.chain.prepared).toBe(1);
  });

  it('when recording fails, records later without touching the chain again', async () => {
    const s = setup();
    s.registry.pending = 12;
    s.registry.failRecord = true;
    expect(await s.anchorer.runOnce()).toMatch(/registry down/);
    expect(s.store.peek()?.stage).toBe('verified');
    s.registry.failRecord = false;
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1/);
    expect(s.chain.prepared).toBe(1);
  });

  it('refuses an all-zero root', async () => {
    const s = setup();
    s.registry.list = [{ batchId: 'B-0', root: '00'.repeat(32), sealedAt: 1, anchored: false }];
    expect(await s.anchorer.runOnce()).toMatch(/unusable root/);
    expect(s.chain.prepared).toBe(0);
  });

  it('raises the alert after three failures in a row, and clears it on success', async () => {
    const s = setup();
    s.registry.pending = 12;
    s.chain.submitFails = 'not-sent';
    for (let i = 0; i < 3; i++) await s.anchorer.runOnce();
    expect(s.anchorer.status()).toMatchObject({ alert: true, consecutiveFailures: 3 });
    s.chain.submitFails = 'no';
    await s.anchorer.runOnce();
    expect(s.anchorer.status()).toMatchObject({ alert: false, consecutiveFailures: 0, lastAnchoredBatch: 'B-1' });
  });
});
