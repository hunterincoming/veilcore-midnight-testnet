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
   * Add the sponsor's fee payment and submit. Once the transaction is balanced, the fee it
   * actually pays is passed to `approveFee` BEFORE anything is sent; if that throws, the
   * coins are released and the error is rethrown (a NotSentError: nothing was sent).
   * Returns the identifier the network gave and the fee it paid.
   * Throws NotSentError when nothing reached the network (any coins it set aside are
   * released), and any other error when it may have.
   */
  payAndSubmit(tx: SealedTx, ttl: Date, approveFee: (fee: bigint) => void): Promise<{ txId: string; fee: bigint }>;
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

/** The balanced transaction's real fee was refused before sending; `refusal` is the answer to give. */
export class FeeRefusedError extends NotSentError {
  constructor(readonly refusal: SponsorResponse) {
    super(String(refusal.body.reason ?? 'fee refused'), refusal.status === 503);
    this.name = 'FeeRefusedError';
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
  /** How long a fee estimate may take before the request is refused (default 30 s). */
  readonly estimateTimeoutMs?: number;
};

type Counters = Record<string, number>;

export class Sponsor {
  /** Identifier -> when to forget it, and which request put it there. */
  private readonly seen = new Map<string, { until: number; owner: symbol }>();
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
    for (const [id, e] of this.seen) if (e.until <= t) this.seen.delete(id);
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

    // Admission. Everything from the duplicate check to the claim below runs in ONE
    // synchronous step, with no await in between: the quota, the replay slot and the
    // budget are claimed before any slow work, so a burst of concurrent requests cannot
    // all pass the checks before any of them is counted (round D, CWE-362).
    this.forgetOld(t);
    if (verdict.identifiers.some((id) => this.seen.has(id))) {
      return this.refuse(409, 'duplicate', 'That transaction was already sent.');
    }
    const quota = this.limits.canSponsor(bucket, ticket, verdict.circuit);
    if (!quota.ok) return this.refuse(429, 'quota', quota.reason, quota.retryAfterSeconds);
    if (!this.wallet.isSynced()) {
      return this.refuse(503, 'syncing', 'The sponsor is catching up with the network. Try again in a minute.', 60);
    }
    const ceiling = this.config.maxFeeSpecks[verdict.circuit] ?? this.config.maxFeeSpecks.default;
    // Hold the most this call may cost (or what is left of today's budget, if less);
    // it is lowered to the real fee once that is known.
    const hold = this.budget.reserveUpTo(ceiling);
    if (hold === undefined) return this.budgetRefusal(1n);
    const claim = this.limits.commit(bucket, ticket, verdict.circuit);
    const owner = Symbol('sponsor-request');
    const forgetAt = t + this.config.rememberMs;
    for (const id of verdict.identifiers) this.seen.set(id, { until: forgetAt, owner });
    // A refusal gives back only what THIS request claimed, never another request's slot.
    const releaseSeen = () => {
      for (const id of verdict.identifiers) if (this.seen.get(id)?.owner === owner) this.seen.delete(id);
    };
    const giveBackAll = () => {
      this.budget.release(hold.id);
      this.limits.uncommit(claim);
      releaseSeen();
    };

    let fee: bigint;
    try {
      // Bounded: the claim above is held while this runs, so a hang must not pin it.
      fee = await withTimeout(this.wallet.estimateFee(tx), this.config.estimateTimeoutMs ?? 30_000);
    } catch {
      giveBackAll();
      return this.refuse(400, 'fee-unknown', 'The fee for this transaction could not be worked out.');
    }
    if (fee < 0n || fee > ceiling) {
      giveBackAll();
      return this.refuse(400, 'fee-too-high', 'This transaction costs more than the sponsor pays for one call.');
    }
    if (fee > hold.amount) {
      // Less than this call costs was free when it was admitted.
      giveBackAll();
      return this.budgetRefusal(fee);
    }
    // Lower the hold to the estimate now, so other requests can use the rest while this one
    // waits in the queue.
    this.budget.shrink(hold.id, fee);

    // Once balanced, the wallet reports the fee the transaction really pays, before sending.
    // The hold is moved to exactly that: raised if it fits today's budget (else nothing is
    // sent), lowered otherwise. That figure, not the estimate, is what gets counted.
    let paid: bigint | undefined;
    const approveFee = (actual: bigint): void => {
      if (actual < 0n || actual > ceiling) {
        throw new FeeRefusedError(this.refuse(400, 'fee-too-high', 'This transaction costs more than the sponsor pays for one call.'));
      }
      if (!this.budget.grow(hold.id, actual)) throw new FeeRefusedError(this.budgetRefusal(actual));
      this.budget.shrink(hold.id, actual);
      paid = actual;
    };

    // Committed from here: the quota stays spent even if nothing is sent, so a flood
    // cannot retry its way past it; the budget and the replay slot are given back then.
    const ttl = new Date(Math.min(verdict.ttl.getTime(), this.now() + this.config.sponsorTtlMs));
    let txId: string;
    try {
      const sent = await this.queue.run(async () => {
        if (!this.wallet.isSynced() && !(await this.wallet.waitSynced(this.config.syncWaitMs))) {
          throw new NotSentError('The sponsor is catching up with the network. Try again in a minute.', true);
        }
        return this.wallet.payAndSubmit(tx, ttl, approveFee);
      });
      txId = sent.txId;
      paid = sent.fee;
    } catch (e) {
      if (e instanceof FeeRefusedError) {
        this.budget.release(hold.id);
        releaseSeen();
        return e.refusal;
      }
      if (e instanceof QueueFullError || e instanceof NotSentError) {
        // Nothing went out: give the budget back and allow the same transaction again.
        this.budget.release(hold.id);
        releaseSeen();
        return e instanceof QueueFullError
          ? this.refuse(503, 'busy', e.message, 120)
          : this.refuse(e.retryable ? 503 : 400, e.retryable ? 'busy' : 'refused-by-network', e.message, e.retryable ? 60 : undefined);
      }
      // It may have reached the network. Count the fee (the real one if the wallet got that
      // far, else the estimate) and never pay for it again.
      this.budget.settle(hold.id, paid ?? fee);
      this.count('maybe-sent');
      return this.refuse(
        502,
        'unknown',
        'The transaction may or may not have been sent. Check the network before trying again; sending it again is refused.',
      );
    }
    // Sent. Outside the try above, so nothing here can turn a sent transaction into "maybe".
    this.budget.settle(hold.id, paid);
    this.count(`sponsored:${verdict.circuit}`);
    return { status: 200, body: { ok: true, txId, identifiers: verdict.identifiers, circuit: verdict.circuit } };
  }

  /**
   * No room in the budget for a call costing `need`. If what is actually spent today leaves
   * room for it, only other requests' holds are in the way (each is the ceiling until its
   * fee is known, then shrinks within seconds): answer busy, not "come back tomorrow".
   */
  private budgetRefusal(need: bigint): SponsorResponse {
    if (this.budget.unspent() >= need) {
      return this.refuse(503, 'busy', 'Many people are using the demo right now. Try again in a minute.', 60);
    }
    return this.refuse(503, 'budget', 'Today’s free transactions are used up. Try again tomorrow.', 3600);
  }

  /**
   * What the status route shows. The public view is what the site needs and nothing more:
   * no budget figures (they would tell an attacker exactly how close a drain is) and no
   * counters. `detail` (operator token only) adds the exact figures.
   */
  status(detail = false): Record<string, unknown> {
    const synced = this.wallet.isSynced();
    // Accepting = the day's budget is not spent. Holds in flight only mean "busy for a moment".
    const pub = { synced, queueDepth: this.queue.waiting, accepting: synced && this.budget.unspent() > 0n };
    if (!detail) return pub;
    let dust: string | undefined;
    try {
      dust = this.wallet.dustBalance()?.toString();
    } catch {
      dust = undefined;
    }
    return {
      ...pub,
      budgetRemainingSpecks: this.budget.remaining().toString(),
      budgetDailySpecks: this.budget.limit.toString(),
      budgetSpentTodaySpecks: this.budget.spentToday.toString(),
      dustBalanceSpecks: dust,
      counters: { ...this.counters },
    };
  }
}

/** Reject if `p` has not settled within `ms`. */
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
