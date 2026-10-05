import { describe, expect, it } from 'vitest';
import { NotSentError, Sponsor, type PayingWallet } from './sponsor.js';
import { ProofOfWork, solve } from './pow.js';
import { DailyBudget, DEFAULT_LIMITS, Limits, SingleFlight } from './limits.js';
import { PHASE1_PUBLIC_CIRCUITS, type SealedTx } from './policy.js';
import { hostile, sealedCall, VC } from './test-tx.js';

const TICKET = 'c'.repeat(32);

class MockWallet implements PayingWallet {
  synced = true;
  fee = 1_000n;
  paid: SealedTx[] = [];
  next: 'ok' | 'not-sent' | 'not-sent-final' | 'maybe' = 'ok';
  isSynced() {
    return this.synced;
  }
  waitSynced() {
    return Promise.resolve(this.synced);
  }
  estimateFee() {
    return Promise.resolve(this.fee);
  }
  dustBalance() {
    return 10n ** 18n;
  }
  async payAndSubmit(tx: SealedTx, _ttl: Date, approveFee: (fee: bigint) => void) {
    if (this.next === 'not-sent') throw new NotSentError('indexer behind', true);
    if (this.next === 'not-sent-final') throw new NotSentError('refused', false);
    approveFee(this.fee);
    if (this.next === 'maybe') throw new Error('socket closed');
    this.paid.push(tx);
    return { txId: `id-${this.paid.length}`, fee: this.fee };
  }
}

const setup = (over: { budget?: bigint; maxFee?: bigint; depth?: number } = {}) => {
  let t = Date.now();
  const now = () => t;
  const wallet = new MockWallet();
  const pow = new ProofOfWork(new Uint8Array(32).fill(3), 6, 600_000, now);
  const limits = new Limits(DEFAULT_LIMITS, now);
  const budget = new DailyBudget(over.budget ?? 10_000n, now);
  const sponsor = new Sponsor(
    {
      policy: { contractAddress: VC, allowedCircuits: new Set(PHASE1_PUBLIC_CIRCUITS), maxBytes: 64_000, maxTtlMs: 30 * 60_000 },
      maxFeeSpecks: { default: over.maxFee ?? 5_000n },
      sponsorTtlMs: 30 * 60_000,
      rememberMs: 2 * 3600_000,
      syncWaitMs: 10,
    },
    wallet,
    pow,
    limits,
    budget,
    new SingleFlight(over.depth ?? 20),
    now,
  );
  const request = (bytes: Uint8Array, ip = '198.51.100.4', ticket = TICKET) => {
    const { challenge } = pow.issue();
    return sponsor.handle({
      ip,
      body: { tx: Buffer.from(bytes).toString('base64'), ticket, challenge, nonce: solve(challenge, bytes, 6) },
    });
  };
  return { sponsor, wallet, budget, request, advance: (ms: number) => (t += ms) };
};

describe('sponsor service with a mocked wallet', () => {
  it('pays for an allowed call and returns the transaction id', async () => {
    const s = setup();
    const out = await s.request(await sealedCall('anchor'));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, txId: 'id-1', circuit: 'anchor' });
    expect(s.wallet.paid).toHaveLength(1);
    expect(s.budget.spentToday).toBe(1_000n);
  });

  it('never pays twice for the same transaction', async () => {
    const s = setup();
    const bytes = await sealedCall('proveOwnership');
    expect((await s.request(bytes)).status).toBe(200);
    const again = await s.request(bytes);
    expect(again.status).toBe(409);
    expect(s.wallet.paid).toHaveLength(1);
  });

  it('refuses a hostile transaction without touching the wallet', async () => {
    const s = setup();
    for (const bytes of [hostile.deploy(), hostile.maintenance(), await hostile.dustActions(), await sealedCall('anchorBatch')]) {
      const out = await s.request(bytes);
      expect(out.status).toBe(400);
    }
    expect(s.wallet.paid).toHaveLength(0);
    expect(s.budget.spentToday).toBe(0n);
  });

  it('refuses without proof of work', async () => {
    const s = setup();
    const bytes = await sealedCall();
    const out = await s.sponsor.handle({
      ip: '1.2.3.4',
      body: { tx: Buffer.from(bytes).toString('base64'), ticket: TICKET, challenge: 'x.y.z', nonce: '0' },
    });
    expect(out.status).toBe(403);
    expect(s.wallet.paid).toHaveLength(0);
  });

  it('refuses a missing or malformed ticket (and never accepts a holder-key-length secret as one)', async () => {
    const s = setup();
    const bytes = await sealedCall();
    expect((await s.request(bytes, '1.2.3.4', 'short')).status).toBe(400);
    expect((await s.request(bytes, '1.2.3.4', 'G'.repeat(32))).status).toBe(400);
  });

  it('answers busy while the wallet is not synced', async () => {
    const s = setup();
    s.wallet.synced = false;
    const out = await s.request(await sealedCall());
    expect(out.status).toBe(503);
    expect(out.body.code).toBe('syncing');
  });

  it('refuses a fee above the ceiling', async () => {
    const s = setup({ maxFee: 500n });
    const out = await s.request(await sealedCall());
    expect(out.body.code).toBe('fee-too-high');
    expect(s.wallet.paid).toHaveLength(0);
  });

  it('stops when the day’s budget is spent', async () => {
    const s = setup({ budget: 1_500n });
    expect((await s.request(await sealedCall('proveOwnership'))).status).toBe(200);
    const out = await s.request(await sealedCall('proveOwnership'));
    expect(out.status).toBe(503);
    expect(out.body.code).toBe('budget');
  });

  it('applies the per-ticket quota (anchor: 3 a day)', async () => {
    const s = setup();
    const ips = ['10.0.1.1', '10.0.2.1', '10.0.3.1', '10.0.4.1'];
    for (let i = 0; i < 3; i++) expect((await s.request(await sealedCall('anchor'), ips[i])).status).toBe(200);
    const out = await s.request(await sealedCall('anchor'), ips[3]);
    expect(out.status).toBe(429);
    expect(out.body.code).toBe('quota');
  });

  it('gives the budget back and allows a retry when nothing was sent', async () => {
    const s = setup();
    const bytes = await sealedCall('pairDna');
    s.wallet.next = 'not-sent';
    const out = await s.request(bytes);
    expect(out.status).toBe(503);
    expect(s.budget.spentToday).toBe(0n);
    s.wallet.next = 'ok';
    expect((await s.request(bytes)).status).toBe(200);
  });

  it('a node refusal is final, not "busy"', async () => {
    const s = setup();
    s.wallet.next = 'not-sent-final';
    const out = await s.request(await sealedCall('pairDna'));
    expect(out.status).toBe(400);
    expect(out.body.code).toBe('refused-by-network');
  });

  it('counts the fee and refuses a resend when it may have been sent', async () => {
    const s = setup();
    const bytes = await sealedCall('pairDna');
    s.wallet.next = 'maybe';
    const out = await s.request(bytes);
    expect(out.status).toBe(502);
    expect(s.budget.spentToday).toBe(1_000n);
    s.wallet.next = 'ok';
    expect((await s.request(bytes)).status).toBe(409);
  });

  it('reports status without secrets', () => {
    const s = setup();
    const st = s.sponsor.status();
    expect(st).toMatchObject({ synced: true, accepting: true, queueDepth: 0 });
    expect(JSON.stringify(st)).not.toMatch(/seed|ticket/i);
  });
});
