// The public endpoint: take a visitor's sealed VeilCore call, decide whether to pay its
// fee, and if so pay and submit it. The wallet sits behind an interface so all of this
// is tested without a network (sponsor.test.ts uses a mock).
//
// Order matters: the cheap checks come first, so junk costs the least. Nothing is
// proved, balanced or sent until the request has passed every check.
//
// SPDX-License-Identifier: Apache-2.0

import { inspect, type PolicyConfig, type SealedTx } from './policy.js';
import { ProofOfWork } from './pow.js';
import { clientBucket, DailyBudget, isTicket, Limits, QueueFullError, SingleFlight } from './limits.js';

/** What the sponsor needs from a wallet. The real one is wallet.ts. */
export interface PayingWallet {
  /** Synced with the chain recently enough to build a fee payment. */
  isSynced(): boolean;
  /** Wait up to `ms` for a genuine sync. */
  waitSynced(ms: number): Promise<boolean>;
  /** Fee for the visitor's transaction plus the sponsor's own fee part, in SPECKs. */
  estimateFee(tx: SealedTx): Promise<bigint>;
  /**
   * Add the sponsor's fee payment and submit. Returns the identifier the network gave.
   * Throws NotSentError when nothing reached the network (any coins it set aside are
   * released), and any other error when it may have.
   */
  payAndSubmit(tx: SealedTx, ttl: Date): Promise<string>;
  /** DUST available now, if known. */
  dustBalance(): bigint | undefined;
}

/** Nothing reached the network; trying again later is safe. */
export class NotSentError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'NotSentError';
  }
}

export type SponsorRequest = {
  readonly ip: string;
  readonly body: unknown;
};

export type SponsorResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly retryAfterSeconds?: number;
};

export type SponsorConfig = {
  readonly policy: PolicyConfig;
  /** Highest fee paid for one call, per circuit, in SPECKs. A circuit not listed gets `default`. */
  readonly maxFeeSpecks: { readonly default: bigint; readonly [circuit: string]: bigint };
  /** How far ahead the sponsor's own fee part may expire. */
  readonly sponsorTtlMs: number;
  /** How long a sealed call's identifiers are remembered, to refuse paying twice. */
  readonly rememberMs: number;
  /** How long to wait for the wallet to sync before answering "busy". */
  readonly syncWaitMs: number;
};

type Counters = Record<string, number>;

export class Sponsor {
  private readonly seen = new Map<string, number>(); // identifier -> forget after (ms)
  readonly counters: Counters = {};

  constructor(
    private readonly config: SponsorConfig,
    private readonly wallet: PayingWallet,
    private readonly pow: ProofOfWork,
    private readonly limits: Limits,
    private readonly budget: DailyBudget,
    readonly queue: SingleFlight,
    private readonly now: () => number,
  ) {}

  private count(k: string): void {
    this.counters[k] = (this.counters[k] ?? 0) + 1;
  }

  private refuse(status: number, code: string, reason: string, retryAfterSeconds?: number): SponsorResponse {
    this.count(`refused:${code}`);
    return { status, body: { ok: false, code, reason }, retryAfterSeconds };
  }

  private forgetOld(t: number): void {
    for (const [id, until] of this.seen) if (until <= t) this.seen.delete(id);
  }

  async handle(req: SponsorRequest): Promise<SponsorResponse> {
    const bucket = clientBucket(req.ip);
    const rate = this.limits.request(bucket);
    if (!rate.ok) return this.refuse(429, 'rate', rate.reason, rate.retryAfterSeconds);

    const body = req.body as { tx?: unknown; ticket?: unknown; challenge?: unknown; nonce?: unknown } | null;
    if (typeof body !== 'object' || body === null || typeof body.tx !== 'string') {
      return this.refuse(400, 'bad-request', 'Send { tx, ticket, challenge, nonce }.');
    }
    // A base64 string longer than the byte cap can ever decode to is refused unread.
    if (body.tx.length > Math.ceil((this.config.policy.maxBytes * 4) / 3) + 8) {
      return this.refuse(413, 'too-large', `The transaction is larger than ${this.config.policy.maxBytes} bytes.`);
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.tx)) return this.refuse(400, 'bad-request', 'tx must be base64.');
    if (!isTicket(body.ticket)) return this.refuse(400, 'bad-request', 'A sponsor ticket is required.');
    const ticket = body.ticket;
    const bytes = new Uint8Array(Buffer.from(body.tx, 'base64'));

    const work = this.pow.verify(body.challenge, body.nonce, bytes);
    if (!work.ok) return this.refuse(403, 'pow', work.reason);

    const t = this.now();
    const { verdict, tx } = inspect(bytes, this.config.policy, new Date(t));
    if (!verdict.ok || tx === undefined) return this.refuse(400, verdict.ok ? 'unreadable' : verdict.code, verdict.ok ? '' : verdict.reason);

    this.forgetOld(t);
    if (verdict.identifiers.some((id) => this.seen.has(id))) {
      return this.refuse(409, 'duplicate', 'That transaction was already sent.');
    }

    const quota = this.limits.canSponsor(bucket, ticket, verdict.circuit);
    if (!quota.ok) return this.refuse(429, 'quota', quota.reason, quota.retryAfterSeconds);

    if (!this.wallet.isSynced()) {
      return this.refuse(503, 'syncing', 'The sponsor is catching up with the network. Try again in a minute.', 60);
    }

    let fee: bigint;
    try {
      fee = await this.wallet.estimateFee(tx);
    } catch {
      return this.refuse(400, 'fee-unknown', 'The fee for this transaction could not be worked out.');
    }
    const ceiling = this.config.maxFeeSpecks[verdict.circuit] ?? this.config.maxFeeSpecks.default;
    if (fee > ceiling) return this.refuse(400, 'fee-too-high', 'This transaction costs more than the sponsor pays for one call.');

    const hold = this.budget.reserve(fee);
    if (hold === undefined) {
      return this.refuse(503, 'budget', 'Today’s free transactions are used up. Try again tomorrow.', 3600);
    }

    // Committed from here: quotas are spent and the identifiers are remembered, so a
    // flood cannot queue the same transaction, or more than its quota, while it waits.
    this.limits.commit(bucket, ticket, verdict.circuit);
    const forgetAt = t + this.config.rememberMs;
    for (const id of verdict.identifiers) this.seen.set(id, forgetAt);

    const ttl = new Date(Math.min(verdict.ttl.getTime(), this.now() + this.config.sponsorTtlMs));
    try {
      const txId = await this.queue.run(async () => {
        if (!this.wallet.isSynced() && !(await this.wallet.waitSynced(this.config.syncWaitMs))) {
          throw new NotSentError('The sponsor is catching up with the network. Try again in a minute.', true);
        }
        return this.wallet.payAndSubmit(tx, ttl);
      });
      this.budget.settle(hold, fee);
      this.count(`sponsored:${verdict.circuit}`);
      return { status: 200, body: { ok: true, txId, identifiers: verdict.identifiers, circuit: verdict.circuit } };
    } catch (e) {
      if (e instanceof QueueFullError || e instanceof NotSentError) {
        // Nothing went out: give the budget back and allow the same transaction again.
        this.budget.release(hold);
        for (const id of verdict.identifiers) this.seen.delete(id);
        return e instanceof QueueFullError
          ? this.refuse(503, 'busy', e.message, 120)
          : this.refuse(e.retryable ? 503 : 400, e.retryable ? 'busy' : 'refused-by-network', e.message, e.retryable ? 60 : undefined);
      }
      // It may have reached the network. Count the fee and never pay for it again.
      this.budget.settle(hold, fee);
      this.count('maybe-sent');
      return this.refuse(
        502,
        'unknown',
        'The transaction may or may not have been sent. Check the network before trying again; sending it again is refused.',
      );
    }
  }

  status(): Record<string, unknown> {
    const synced = this.wallet.isSynced();
    const remaining = this.budget.remaining();
    return {
      synced,
      queueDepth: this.queue.waiting,
      budgetRemainingSpecks: remaining.toString(),
      budgetDailySpecks: this.budget.limit.toString(),
      accepting: synced && remaining > 0n,
    };
  }
}
