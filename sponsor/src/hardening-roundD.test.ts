// Round D hardening: regression tests for the review's findings (review-out/roundD-sponsor.md).
// Each test drives the attack the review demonstrated and asserts the service now holds.
// Same offline harness as sponsor.test.ts: a mocked wallet, real ledger transactions.
//
// Run: npx vitest run --maxWorkers=1 src/hardening-roundD.test.ts
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { NotSentError, Sponsor, type PayingWallet } from './sponsor.js';
import { ProofOfWork, solve } from './pow.js';
import { DailyBudget, DEFAULT_LIMITS, Limits, SingleFlight } from './limits.js';
import { PHASE1_PUBLIC_CIRCUITS, type SealedTx } from './policy.js';
import { sealedCall, VC } from './test-tx.js';
import { Anchorer, type AnchorChain, type Attempt, type Batch, type Landing, type RegistryClient } from './anchorer.js';
import { HttpRegistry } from './registry.js';

const TICKET = 'c'.repeat(32);
const ticket = (i: number) => i.toString(16).padStart(32, '0');

/**
 * A wallet whose fee estimate waits on a gate, so a test can put a whole burst of requests
 * in flight at once: the window in which the race used to happen. `estimate` decides each
 * call's answer (by call number) and `pay` each payment's outcome. Payments wait on their
 * own gate (`holdPayments`), and `actual` sets the fee the balanced transaction really
 * pays (by payment number; by default the same as that transaction's estimate).
 */
class GatedWallet implements PayingWallet {
  synced = true;
  paid: SealedTx[] = [];
  estimates = 0;
  payments = 0;
  gate: Promise<void> = Promise.resolve();
  payGate: Promise<void> = Promise.resolve();
  estimate: (n: number) => Promise<bigint> = () => Promise.resolve(1_000n);
  actual?: (n: number) => bigint;
  pay: (n: number) => 'ok' | 'not-sent' | 'not-sent-final' | 'maybe' = () => 'ok';
  private readonly estimated = new WeakMap<SealedTx, bigint>();
  isSynced() {
    return this.synced;
  }
  waitSynced() {
    return Promise.resolve(this.synced);
  }
  async estimateFee(tx: SealedTx) {
    const n = ++this.estimates;
    await this.gate;
    const fee = await this.estimate(n);
    this.estimated.set(tx, fee);
    return fee;
  }
  dustBalance() {
    return 10n ** 18n;
  }
  async payAndSubmit(tx: SealedTx, _ttl: Date, approveFee: (fee: bigint) => void) {
    const n = ++this.payments;
    const outcome = this.pay(n);
    await this.payGate;
    if (outcome === 'not-sent') throw new NotSentError('indexer behind', true);
    if (outcome === 'not-sent-final') throw new NotSentError('refused', false);
    const fee = this.actual?.(n) ?? this.estimated.get(tx) ?? 1_000n;
    approveFee(fee); // a refusal here means nothing is sent, as in the real wallet
    if (outcome === 'maybe') throw new Error('socket closed');
    this.paid.push(tx);
    return { txId: `id-${this.paid.length}`, fee };
  }
  /** Hold every fee estimate until the returned function is called. */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((r) => (release = r));
    return release;
  }
  /** Hold every payment (after its estimate, inside the queue) until the returned function is called. */
  holdPayments(): () => void {
    let release!: () => void;
    this.payGate = new Promise<void>((r) => (release = r));
    return release;
  }
}

const setup = (over: { budget?: bigint; maxFee?: bigint; estimateTimeoutMs?: number } = {}) => {
  const t = Date.now();
  const now = () => t; // frozen clock: no window passes during a burst, and claims share a timestamp
  const wallet = new GatedWallet();
  const pow = new ProofOfWork(new Uint8Array(32).fill(3), 6, 600_000, now);
  const limits = new Limits(DEFAULT_LIMITS, now);
  const budget = new DailyBudget(over.budget ?? 1_000_000n, now);
  const sponsor = new Sponsor(
    {
      policy: { contractAddress: VC, allowedCircuits: new Set(PHASE1_PUBLIC_CIRCUITS), maxBytes: 64_000, maxTtlMs: 30 * 60_000 },
      maxFeeSpecks: { default: over.maxFee ?? 5_000n },
      sponsorTtlMs: 30 * 60_000,
      rememberMs: 2 * 3600_000,
      syncWaitMs: 10,
      estimateTimeoutMs: over.estimateTimeoutMs,
    },
    wallet,
    pow,
    limits,
    budget,
    new SingleFlight(20),
    now,
  );
  // Each call gets its own fresh single-use challenge, as a real client would.
  const req = (bytes: Uint8Array, ip: string, tk = TICKET) => {
    const { challenge } = pow.issue();
    return sponsor.handle({ ip, body: { tx: Buffer.from(bytes).toString('base64'), ticket: tk, challenge, nonce: solve(challenge, bytes, 6) } });
  };
  return { sponsor, wallet, budget, limits, req };
};

const statuses = (rs: { status: number; body: Record<string, unknown> }[]) => rs.map((r) => `${r.status}:${String(r.body.code ?? 'ok')}`);
const calls = (n: number, circuit = 'proveOwnership') => Promise.all(Array.from({ length: n }, () => sealedCall(circuit)));

describe('Critical (CWE-362): quota, duplicate guard and budget are claimed before any await', () => {
  it('a concurrent burst from ONE network gets exactly its hourly cap (3), not more', async () => {
    const s = setup();
    const release = s.wallet.hold();
    const inFlight = (await calls(10)).map((b) => s.req(b, '203.0.113.7'));
    release();
    const results = await Promise.all(inFlight);
    expect(results.filter((r) => r.status === 200)).toHaveLength(DEFAULT_LIMITS.perIpHour);
    expect(results.filter((r) => r.status === 429 && r.body.code === 'quota')).toHaveLength(10 - DEFAULT_LIMITS.perIpHour);
    expect(s.wallet.paid).toHaveLength(3);
    // The refused ones were refused at admission: they never cost a fee estimate.
    expect(s.wallet.estimates).toBe(3);
  });

  it('rotating the ticket per request gains nothing: the per-network cap still holds', async () => {
    const s = setup();
    const release = s.wallet.hold();
    const inFlight = (await calls(8)).map((b, i) => s.req(b, '203.0.113.8', ticket(i + 1)));
    release();
    expect((await Promise.all(inFlight)).filter((r) => r.status === 200)).toHaveLength(3);
  });

  it('one network cannot drain the day’s budget in a burst; other networks are still served', async () => {
    // fee 1000 each, budget 6500: the race let one /24 take all six. Now it gets its three.
    // (Ceiling 2000: README step 9 sets MAX_FEE_DUST to about twice the real fee.)
    const s = setup({ budget: 6_500n, maxFee: 2_000n });
    const release = s.wallet.hold();
    const burst = (await calls(10)).map((b) => s.req(b, '203.0.113.20'));
    release();
    const results = await Promise.all(burst);
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.some((r) => r.body.code === 'budget')).toBe(false);
    expect(s.budget.spentToday).toBe(3_000n);
    // A real visitor on another network still gets sponsored.
    expect((await s.req(await sealedCall('anchor'), '198.51.100.1')).status).toBe(200);
  });

  it('the same sealed transaction sent twice at once is paid for once (the second is a duplicate)', async () => {
    const s = setup();
    const release = s.wallet.hold();
    const bytes = await sealedCall('anchor');
    const both = [s.req(bytes, '203.0.113.30'), s.req(bytes, '198.51.100.30')];
    release();
    expect(statuses(await Promise.all(both)).sort()).toEqual(['200:ok', '409:duplicate']);
    expect(s.wallet.paid).toHaveLength(1);
  });

  it('the budget is held before the fee is known: a burst across many networks never overshoots it', async () => {
    const s = setup({ budget: 2_000n, maxFee: 1_000n });
    const release = s.wallet.hold();
    const bytes = await calls(5);
    const inFlight = bytes.map((b, i) => s.req(b, `198.51.${100 + i}.1`));
    release();
    const results = await Promise.all(inFlight);
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    // While the first two were in flight the money was held, not yet spent: "busy", not "used up".
    expect(results.filter((r) => r.body.code === 'busy' && r.retryAfterSeconds === 60)).toHaveLength(3);
    expect(s.budget.spentToday).toBe(2_000n);
    expect(s.budget.remaining()).toBe(0n);
    // Now it really is spent, and says so.
    expect((await s.req(bytes[4], '198.51.200.1')).body.code).toBe('budget');
  });

  it('holds in flight answer "busy, try in a minute", and the retry is served once they settle', async () => {
    // Ceiling 5000, real fee 1000, budget 6500: two in-flight holds (5000 + 1500) fill the
    // budget for a moment. The third is told to retry shortly, never "come back tomorrow".
    const s = setup({ budget: 6_500n, maxFee: 5_000n });
    const release = s.wallet.hold();
    const [a, b, c] = await calls(3);
    const inFlight = [s.req(a, '198.51.100.61'), s.req(b, '198.51.101.61'), s.req(c, '198.51.102.61')];
    release();
    expect(statuses(await Promise.all(inFlight))).toEqual(['200:ok', '200:ok', '503:busy']);
    expect(s.budget.remaining()).toBe(4_500n);
    expect((await s.req(c, '198.51.102.61')).status).toBe(200);
  });

  it('the hold is lowered to the real fee, so the rest of the budget stays usable', async () => {
    const s = setup({ budget: 6_000n, maxFee: 5_000n });
    expect((await s.req(await sealedCall('anchor'), '198.51.100.40')).status).toBe(200);
    expect(s.budget.remaining()).toBe(5_000n);
  });

  it('the hold is lowered to the estimate while the request is still in flight, and others can use the rest', async () => {
    // Budget 6000, ceiling 5000. A is admitted with a 5000 hold, estimates 1000, then waits
    // to be paid. While it waits, its hold must already be 1000: B (estimate 2000) needs a
    // 5000 hold of its own, which only fits if A's was lowered (verification S4).
    const s = setup({ budget: 6_000n, maxFee: 5_000n });
    s.wallet.estimate = (n) => Promise.resolve(n === 1 ? 1_000n : 2_000n);
    const releasePay = s.wallet.holdPayments();
    const [a, b] = await calls(2, 'anchor');
    const reqA = s.req(a, '198.51.100.41');
    await until(() => s.wallet.payments === 1); // A is past its estimate and inside the wallet
    expect(s.budget.remaining()).toBe(5_000n);
    expect(s.budget.spentToday).toBe(0n); // held, not yet spent
    const reqB = s.req(b, '198.51.101.41');
    await until(() => s.wallet.estimates === 2);
    await settleTicks();
    // B is admitted and waits behind A in the queue: 1000 (A) + 5000 (B) held, then B's own
    // hold drops to its 2000 estimate.
    expect(s.budget.remaining()).toBe(3_000n);
    releasePay();
    expect(statuses(await Promise.all([reqA, reqB]))).toEqual(['200:ok', '200:ok']);
    expect(s.budget.spentToday).toBe(3_000n);
    expect(s.budget.remaining()).toBe(3_000n);
  });

  it('the budget is settled to the fee the balanced transaction really pays, not the estimate', async () => {
    const s = setup({ budget: 10_000n, maxFee: 5_000n });
    s.wallet.estimate = () => Promise.resolve(1_000n);
    s.wallet.actual = (n) => (n === 1 ? 1_200n : 900n);
    expect((await s.req(await sealedCall('anchor'), '198.51.100.42')).status).toBe(200);
    expect(s.budget.spentToday).toBe(1_200n); // raised from the 1000 hold: it fit today's budget
    expect((await s.req(await sealedCall('anchor'), '198.51.101.42')).status).toBe(200);
    expect(s.budget.spentToday).toBe(2_100n); // lowered to 900
    expect(s.budget.remaining()).toBe(7_900n);
  });

  it('a real fee above the ceiling, or that no longer fits the budget, is never sent and gives the hold back', async () => {
    // Above the ceiling: refused as fee-too-high, nothing paid, the same tx may come again.
    const s = setup({ budget: 10_000n, maxFee: 2_000n });
    s.wallet.actual = () => 2_500n;
    const bytes = await sealedCall('anchor');
    expect((await s.req(bytes, '198.51.100.43')).body.code).toBe('fee-too-high');
    expect(s.wallet.paid).toHaveLength(0);
    expect(s.budget.remaining()).toBe(10_000n);
    s.wallet.actual = undefined;
    expect((await s.req(bytes, '198.51.100.43')).status).toBe(200);

    // Over the hold and over what is unspent today: "used up", nothing paid.
    const t = setup({ budget: 1_100n, maxFee: 5_000n });
    t.wallet.actual = () => 1_500n;
    expect((await t.req(await sealedCall('anchor'), '198.51.100.44')).body.code).toBe('budget');
    expect(t.wallet.paid).toHaveLength(0);
    expect(t.budget.remaining()).toBe(1_100n);
    expect(t.budget.spentToday).toBe(0n);
  });
});

/** Wait (by yielding to the event loop) until `cond` holds; fail after a while. */
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1_000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  expect(cond()).toBe(true);
};
const settleTicks = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

describe('High (CWE-362): a request releases only what it claimed', () => {
  it('a losing concurrent duplicate cannot erase the winner’s replay guard', async () => {
    // Before: the loser reached payAndSubmit, failed, and its cleanup deleted the winner's
    // guard, so a third send was paid again. Now the loser is refused at admission.
    const s = setup();
    s.wallet.pay = (n) => (n === 2 ? 'not-sent-final' : 'ok');
    const release = s.wallet.hold();
    const bytes = await sealedCall('anchor');
    const both = [s.req(bytes, '198.51.100.10'), s.req(bytes, '198.51.100.10')];
    release();
    await Promise.all(both);
    expect((await s.req(bytes, '198.51.100.10')).status).toBe(409);
    expect(s.wallet.paid).toHaveLength(1);
    expect(s.wallet.payments).toBe(1);
  });

  it('a request that fails its fee estimate gives back its quota, its replay slot and its hold, and nobody else’s', async () => {
    const s = setup({ budget: 10_000n, maxFee: 2_000n });
    s.wallet.estimate = (n) => (n === 1 ? Promise.reject(new Error('estimate failed')) : Promise.resolve(1_000n));
    const release = s.wallet.hold();
    const [failing, ok1, ok2] = await calls(3);
    const ip = '203.0.113.50'; // same network, same frozen timestamp for every claim
    const inFlight = [s.req(failing, ip), s.req(ok1, ip), s.req(ok2, ip)];
    release();
    expect(statuses(await Promise.all(inFlight))).toEqual(['400:fee-unknown', '200:ok', '200:ok']);
    expect(s.budget.spentToday).toBe(2_000n);
    expect(s.budget.remaining()).toBe(8_000n); // the failed hold came back, the others settled
    // Its quota slot came back (exactly one): one more fits in this hour, then the cap.
    expect((await s.req(failing, ip)).status).toBe(200); // and its replay slot came back too
    expect((await s.req(await sealedCall('proveOwnership'), ip)).body.code).toBe('quota');
    // The two that were paid are still guarded.
    expect((await s.req(ok1, '198.51.100.51')).status).toBe(409);
  });

  it('a fee above the ceiling gives everything back', async () => {
    const s = setup({ budget: 10_000n, maxFee: 500n });
    const bytes = await sealedCall('anchor');
    expect((await s.req(bytes, '203.0.113.60')).body.code).toBe('fee-too-high');
    expect(s.budget.remaining()).toBe(10_000n);
    s.wallet.estimate = () => Promise.resolve(400n);
    expect((await s.req(bytes, '203.0.113.60')).status).toBe(200); // the same tx, not a "duplicate"
  });

  it('a fee estimate that never answers is refused in time and gives its claim back', async () => {
    const s = setup({ budget: 5_000n, estimateTimeoutMs: 20 });
    s.wallet.estimate = (n) => (n === 1 ? new Promise<bigint>(() => undefined) : Promise.resolve(1_000n));
    const bytes = await sealedCall('anchor');
    expect((await s.req(bytes, '203.0.113.70')).body.code).toBe('fee-unknown');
    expect(s.budget.remaining()).toBe(5_000n);
    expect((await s.req(bytes, '203.0.113.70')).status).toBe(200);
  });

  it('not sent: the budget and the replay slot come back, the quota stays spent (no retrying past it)', async () => {
    const s = setup({ budget: 10_000n });
    s.wallet.pay = () => 'not-sent';
    const ip = '203.0.113.80';
    const bytes = await sealedCall('pairDna');
    for (let i = 0; i < 3; i++) expect((await s.req(bytes, ip)).body.code).toBe('busy');
    expect(s.budget.remaining()).toBe(10_000n);
    s.wallet.pay = () => 'ok';
    expect((await s.req(bytes, ip)).body.code).toBe('quota');
    expect((await s.req(bytes, '198.51.100.80')).status).toBe(200);
  });
});

describe('Medium (CWE-209): /sponsor/status shows coarse public information only', () => {
  it('no budget figures or counters without the operator token; exact figures with it', async () => {
    const s = setup({ budget: 6_500n });
    await s.req(await sealedCall('anchor'), '198.51.100.90');
    const pub = s.sponsor.status();
    expect(Object.keys(pub).sort()).toEqual(['accepting', 'queueDepth', 'synced']);
    expect(JSON.stringify(pub)).not.toMatch(/6500|5500|1000|budget|Specks/i);
    const op = s.sponsor.status(true);
    expect(op).toMatchObject({ budgetRemainingSpecks: '5500', budgetDailySpecks: '6500', budgetSpentTodaySpecks: '1000' });
  });
});

// ---- the anchoring job ------------------------------------------------------------------

const ROOT = 'ab'.repeat(32);

class FakeRegistry implements RegistryClient {
  pending = 0;
  list: Batch[] = [];
  recorded: string[] = [];
  /** A registry that has not caught up: records the anchor but keeps listing the batch as unanchored. */
  lagging = false;
  failBatches?: Error;
  pendingCount() {
    return Promise.resolve(this.pending);
  }
  seal() {
    return Promise.resolve(undefined);
  }
  batches() {
    return this.failBatches ? Promise.reject(this.failBatches) : Promise.resolve(this.list);
  }
  recordAnchor(batchId: string) {
    this.recorded.push(batchId);
    if (!this.lagging) this.list = this.list.map((b) => (b.batchId === batchId ? { ...b, anchored: true } : b));
    return Promise.resolve();
  }
}

class FakeChain implements AnchorChain {
  seq = 5n;
  fee = 1_000n;
  prepared = 0;
  sent: string[] = [];
  abandoned = 0;
  submitFails: 'no' | 'not-sent' | 'maybe' = 'no';
  landings = new Map<string, Landing>();
  batchSeq() {
    return Promise.resolve(this.seq);
  }
  prepare(root: string) {
    const txId = `tx-${++this.prepared}`;
    return Promise.resolve({
      txId,
      ttl: new Date(Date.now() + 30 * 60_000),
      fee: this.fee,
      submit: () => {
        if (this.submitFails === 'not-sent') return Promise.reject(new NotSentError('stale', true));
        if (this.submitFails === 'maybe') return Promise.reject(new Error('timeout'));
        this.sent.push(txId);
        this.seq += 1n;
        this.landings.set(txId, { state: 'landed', txHash: 'cd'.repeat(32), blockHeight: 1, lastBatchRoot: root, batchSeq: this.seq });
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

const anchorSetup = (over: { budget?: bigint; maxFee?: bigint } = {}) => {
  const t = Date.now();
  const registry = new FakeRegistry();
  const chain = new FakeChain();
  let saved: Attempt | undefined;
  const budget = new DailyBudget(over.budget ?? 1_000_000n, () => t);
  const anchorer = new Anchorer(
    {
      network: 'preprod',
      contractAddress: 'ef'.repeat(32),
      sealEveryMs: 60 * 60_000,
      sealAtPending: 10,
      landingGraceMs: 10 * 60_000,
      waitForLandingMs: 0,
      pollMs: 1,
      maxFeeSpecks: over.maxFee ?? 5_000n,
    },
    registry,
    chain,
    { load: () => saved, save: (a) => void (saved = a), clear: () => void (saved = undefined) },
    (job) => job(),
    budget,
    () => t,
    () => Promise.resolve(),
    () => undefined,
  );
  return { anchorer, registry, chain, budget };
};

describe('Medium (CWE-770): anchoring fees come out of the same daily budget', () => {
  it('an anchor’s fee is counted, so the public endpoint sees less left', async () => {
    const s = anchorSetup({ budget: 10_000n });
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1/);
    expect(s.budget.spentToday).toBe(1_000n);
    expect(s.budget.remaining()).toBe(9_000n);
  });

  it('with the budget used up, nothing is built or sent', async () => {
    const s = anchorSetup({ budget: 1_000n });
    const h = s.budget.reserveUpTo(1_000n)!;
    s.budget.settle(h.id, 1_000n); // the public endpoint spent it all
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    expect(await s.anchorer.runOnce()).toMatch(/budget is used up/);
    expect(s.chain.prepared).toBe(0);
    expect(s.anchorer.publicStatus().lastOutcome).toBe('budget');
  });

  it('a fee above what is left, or above the ceiling, is abandoned unsent and the hold given back', async () => {
    for (const over of [{ budget: 500n }, { budget: 1_000_000n, maxFee: 999n }]) {
      const s = anchorSetup(over);
      s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
      expect(await s.anchorer.runOnce()).toMatch(/not sent/);
      expect(s.chain.sent).toHaveLength(0);
      expect(s.chain.abandoned).toBe(1);
      expect(s.budget.spentToday).toBe(0n);
      expect(s.budget.remaining()).toBe(over.budget);
    }
  });

  it('budget held by requests in flight is "busy": not a failure, no alert, and anchoring resumes once it frees', async () => {
    const s = anchorSetup({ budget: 6_000n });
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    const visitor = s.budget.reserveUpTo(6_000n)!; // a visitor's hold, fee not known yet
    for (let i = 0; i < 4; i++) expect(await s.anchorer.runOnce()).toMatch(/held by requests in flight/);
    expect(s.chain.prepared).toBe(0);
    expect(s.anchorer.status()).toMatchObject({ consecutiveFailures: 0, alert: false, lastOutcomeCode: 'busy' });
    expect(s.anchorer.publicStatus()).toMatchObject({ lastOutcome: 'busy', alert: false });
    s.budget.shrink(visitor.id, 1_000n); // its fee became known
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1/);
  });

  it('a fee that only does not fit because of holds in flight is abandoned as "busy", not a failure', async () => {
    const s = anchorSetup({ budget: 6_000n });
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    const visitor = s.budget.reserveUpTo(5_500n)!; // leaves 500; the anchor costs 1000
    expect(await s.anchorer.runOnce()).toMatch(/waits for budget held by requests in flight; not sent/);
    expect(s.chain.abandoned).toBe(1);
    expect(s.chain.sent).toHaveLength(0);
    expect(s.anchorer.status()).toMatchObject({ consecutiveFailures: 0, lastOutcomeCode: 'busy' });
    expect(s.budget.remaining()).toBe(500n); // its own hold came back
    s.budget.release(visitor.id);
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1/);
  });

  it('"busy" neither raises nor clears a run of real failures', async () => {
    const s = anchorSetup({ budget: 6_000n });
    s.registry.failBatches = new Error('down');
    await s.anchorer.runOnce();
    await s.anchorer.runOnce();
    s.registry.failBatches = undefined;
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    s.budget.reserveUpTo(6_000n);
    await s.anchorer.runOnce();
    expect(s.anchorer.status()).toMatchObject({ consecutiveFailures: 2, alert: false, lastOutcomeCode: 'busy' });
  });

  it('not sent gives the hold back; maybe sent counts the fee', async () => {
    const s = anchorSetup({ budget: 10_000n });
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    s.chain.submitFails = 'not-sent';
    await s.anchorer.runOnce();
    expect(s.budget.remaining()).toBe(10_000n);
    s.chain.submitFails = 'maybe';
    await s.anchorer.runOnce();
    expect(s.budget.spentToday).toBe(1_000n);
  });
});

describe('Medium (CWE-345): what the anchorer accepts from the registry', () => {
  const reg = (routes: Record<string, unknown>) =>
    new HttpRegistry('https://reg.example', 'op', ((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
      return Promise.resolve(new Response(JSON.stringify(routes[key] ?? { error: 'no route' }), { status: key in routes ? 200 : 404 }));
    }) as typeof fetch);
  const row = (o: Record<string, unknown> = {}) => ({ batch_id: 'B-20261004-9F3A', root: ROOT, sealed_at: 5, anchor: null, ...o });

  it('accepts the registry’s real shape, normalising the root', async () => {
    expect(await reg({ 'GET /batches': { batches: [row({ root: `0x${ROOT.toUpperCase()}` })] } }).batches()).toEqual([
      { batchId: 'B-20261004-9F3A', root: ROOT, sealedAt: 5, anchored: false },
    ]);
  });

  it('refuses a waiting batch with a bad root, a bad id, no sealing time, or listed twice', async () => {
    for (const bad of [
      [row({ root: 'ab'.repeat(31) })],
      [row({ root: '00'.repeat(32) })],
      [row({ root: 'zz'.repeat(32) })],
      [row({ batch_id: '../../batches/B-1' })],
      [row({ batch_id: 'B 1\nforged log line' })],
      [row({ sealed_at: undefined })],
      [row({ sealed_at: 'yesterday' })],
      [row(), row({ root: 'cd'.repeat(32) })],
    ]) {
      await expect(reg({ 'GET /batches': { batches: bad } }).batches()).rejects.toThrow(/registry/);
    }
  });

  it('leaves out an odd batch that is already anchored (never acted on) instead of failing', async () => {
    const out = await reg({ 'GET /batches': { batches: [row({ batch_id: '!!', anchor: { txHash: 'x' } }), row()] } }).batches();
    expect(out.map((b) => b.batchId)).toEqual(['B-20261004-9F3A']);
  });

  it('refuses a malformed seal answer and a nonsense pending count', async () => {
    await expect(reg({ 'POST /batches/seal': { batchId: 'B-1', root: '00'.repeat(32) } }).seal()).rejects.toThrow(/seal/);
    await expect(reg({ 'POST /batches/seal': { batchId: '../x', root: ROOT } }).seal()).rejects.toThrow(/seal/);
    await expect(reg({ 'GET /batches/pending': { count: -1 } }).pendingCount()).rejects.toThrow(/pending/);
    await expect(reg({ 'GET /batches/pending': { count: 1.5 } }).pendingCount()).rejects.toThrow(/pending/);
  });

  it('never anchors a root another batch already has', async () => {
    const s = anchorSetup();
    s.registry.list = [
      { batchId: 'B-old', root: ROOT, sealedAt: 1, anchored: true },
      { batchId: 'B-new', root: ROOT, sealedAt: 2, anchored: false },
    ];
    expect(await s.anchorer.runOnce()).toMatch(/same root as batch B-old/);
    expect(s.chain.prepared).toBe(0);
    expect(s.budget.spentToday).toBe(0n);
  });
});

describe('Low (CWE-367): a lagging registry cannot make the anchorer anchor a batch twice', () => {
  it('a batch this process recorded is skipped even while the registry still lists it unanchored', async () => {
    const s = anchorSetup();
    s.registry.lagging = true;
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    expect(await s.anchorer.runOnce()).toMatch(/^anchored B-1/);
    expect(await s.anchorer.runOnce()).toBe('nothing to anchor');
    expect(await s.anchorer.runOnce()).toBe('nothing to anchor');
    expect(s.chain.prepared).toBe(1);
    expect(s.registry.recorded).toEqual(['B-1']);
    expect(s.budget.spentToday).toBe(1_000n);
  });

  it('a new batch id carrying a root this process already anchored is refused', async () => {
    const s = anchorSetup();
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    await s.anchorer.runOnce();
    s.registry.list = [{ batchId: 'B-2', root: ROOT.toUpperCase(), sealedAt: 2, anchored: false }];
    expect(await s.anchorer.runOnce()).toMatch(/already anchored/);
    expect(s.chain.prepared).toBe(1);
  });
});

describe('Medium (CWE-209): the anchorer’s public status carries a code, never error text', () => {
  it('a registry error shows as "error" publicly; the words stay in the operator view', async () => {
    const s = anchorSetup();
    s.registry.failBatches = new Error('registry /batches: connect ECONNREFUSED internal-db.railway.internal:5432');
    for (let i = 0; i < 3; i++) await s.anchorer.runOnce();
    const pub = s.anchorer.publicStatus();
    expect(pub).toMatchObject({ enabled: true, lastOutcome: 'error', alert: true });
    expect(JSON.stringify(pub)).not.toMatch(/ECONNREFUSED|railway|internal|registry/);
    expect(Object.keys(pub)).not.toContain('inFlight');
    expect(s.anchorer.status().lastOutcome).toMatch(/ECONNREFUSED/);
  });

  it('a verify mismatch shows as "verify-failed" without the root', async () => {
    const s = anchorSetup();
    s.registry.list = [{ batchId: 'B-1', root: ROOT, sealedAt: 1, anchored: false }];
    const prep = s.chain.prepare.bind(s.chain);
    s.chain.prepare = async (root: string) => {
      const p = await prep(root);
      const submit = async () => {
        await p.submit();
        // The chain shows a different root after it: the check must fail.
        s.chain.landings.set(p.txId, { state: 'landed', txHash: 'cd'.repeat(32), blockHeight: 1, lastBatchRoot: '11'.repeat(32), batchSeq: 99n });
      };
      return { ...p, submit };
    };
    await s.anchorer.runOnce();
    const pub = s.anchorer.publicStatus();
    expect(pub.lastOutcome).toBe('verify-failed');
    expect(JSON.stringify(pub)).not.toContain(ROOT.slice(0, 12));
  });
});
