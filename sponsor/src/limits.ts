// Limits on a public endpoint that pays: per-address buckets, per-ticket quotas, a global
// daily budget, and a queue with a maximum depth. Every clock read goes through `now`,
// so the tests run on a fake clock.
//
// The sponsor ticket is a random token the visitor's browser makes for this purpose only.
// It is NOT the holder key: sending the holder key here would let one log join "this
// holder's records" to "this on-chain identity". Logs keep counters, never request
// bodies, and addresses are dropped when their window passes.
//
// SPDX-License-Identifier: Apache-2.0

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * The bucket an address falls in: /24 for IPv4, /64 for IPv6. One household or one
 * cloud host gets one bucket, so rotating through neighbouring addresses gains nothing.
 */
export const clientBucket = (ip: string): string => {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip.trim());
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const s = ip.trim().toLowerCase();
  if (s.includes(':')) {
    // Expand :: so the first four groups are the /64.
    const [head, tail = ''] = s.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return `${groups
      .slice(0, 4)
      .map((g) => g.replace(/^0+(?=.)/, ''))
      .join(':')}::/64`;
  }
  return 'unknown';
};

/** Timestamps per key, kept only as long as the longest window that reads them. */
class EventLog {
  private readonly events = new Map<string, number[]>();
  constructor(private readonly keepMs: number) {}

  count(key: string, windowMs: number, now: number): number {
    const list = this.events.get(key);
    if (!list) return 0;
    return list.filter((t) => t > now - windowMs).length;
  }

  add(key: string, now: number): void {
    const list = (this.events.get(key) ?? []).filter((t) => t > now - this.keepMs);
    list.push(now);
    this.events.set(key, list);
  }

  sweep(now: number): void {
    for (const [k, list] of this.events) {
      const kept = list.filter((t) => t > now - this.keepMs);
      if (kept.length === 0) this.events.delete(k);
      else this.events.set(k, kept);
    }
  }

  get size(): number {
    return this.events.size;
  }
}

export type LimitConfig = {
  /** Requests of any kind per address bucket per minute (the cheap first line). */
  readonly requestsPerMinute: number;
  /** Sponsored transactions per address bucket. */
  readonly perIpHour: number;
  readonly perIpDay: number;
  /** Sponsored transactions per ticket per day, by circuit. */
  readonly perTicketDay: Readonly<Record<string, number>>;
};

export const DEFAULT_LIMITS: LimitConfig = {
  requestsPerMinute: 30,
  perIpHour: 3,
  perIpDay: 10,
  perTicketDay: { anchor: 3, pairDna: 5, proveOwnership: 20 },
};

export type LimitCheck = { ok: true } | { ok: false; reason: string; retryAfterSeconds: number };

export const isTicket = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{32,64}$/.test(t);

export class Limits {
  private readonly requests = new EventLog(MINUTE);
  private readonly sponsoredByIp = new EventLog(DAY);
  private readonly sponsoredByTicket = new EventLog(DAY);

  constructor(
    private readonly config: LimitConfig,
    private readonly now: () => number,
  ) {}

  /** Every request counts here, before anything is parsed. */
  request(bucket: string): LimitCheck {
    const t = this.now();
    if (this.requests.count(bucket, MINUTE, t) >= this.config.requestsPerMinute) {
      return { ok: false, reason: 'Too many requests from your network. Wait a minute.', retryAfterSeconds: 60 };
    }
    this.requests.add(bucket, t);
    return { ok: true };
  }

  /** Whether this sponsorship would fit every quota. Consumes nothing. */
  canSponsor(bucket: string, ticket: string, circuit: string): LimitCheck {
    const t = this.now();
    if (this.sponsoredByIp.count(bucket, HOUR, t) >= this.config.perIpHour) {
      return { ok: false, reason: 'Your network has used this hour’s free transactions. Try later.', retryAfterSeconds: 3600 };
    }
    if (this.sponsoredByIp.count(bucket, DAY, t) >= this.config.perIpDay) {
      return { ok: false, reason: 'Your network has used today’s free transactions. Try tomorrow.', retryAfterSeconds: 86400 };
    }
    const cap = this.config.perTicketDay[circuit] ?? 0;
    if (this.sponsoredByTicket.count(`${ticket}:${circuit}`, DAY, t) >= cap) {
      return { ok: false, reason: `This browser has used today’s free ${circuit} calls. Try tomorrow.`, retryAfterSeconds: 86400 };
    }
    return { ok: true };
  }

  /** Count a sponsorship that is going ahead. */
  commit(bucket: string, ticket: string, circuit: string): void {
    const t = this.now();
    this.sponsoredByIp.add(bucket, t);
    this.sponsoredByTicket.add(`${ticket}:${circuit}`, t);
  }

  /** Forget everything older than its window (addresses are not kept past it). */
  sweep(): void {
    const t = this.now();
    this.requests.sweep(t);
    this.sponsoredByIp.sweep(t);
    this.sponsoredByTicket.sweep(t);
  }

  /** For tests: how many address buckets are remembered. */
  get trackedBuckets(): number {
    return this.requests.size + this.sponsoredByIp.size;
  }
}

/** Saved budget state, so a restart does not reset the day's spending. */
export type BudgetState = { readonly day: string; readonly spent: string };

/**
 * A hard ceiling on DUST spent per UTC day, in SPECKs. Fees are reserved before paying
 * and settled after, so concurrent requests cannot together overshoot it.
 */
export class DailyBudget {
  private day: string;
  private spent: bigint;
  private reserved = 0n;
  private readonly holds = new Map<number, bigint>();
  private nextHold = 1;

  constructor(
    readonly limit: bigint,
    private readonly now: () => number,
    saved?: BudgetState,
    private readonly onChange?: (s: BudgetState) => void,
  ) {
    this.day = DailyBudget.dayOf(now());
    this.spent = saved && saved.day === this.day ? BigInt(saved.spent) : 0n;
  }

  static dayOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  private roll(): void {
    const d = DailyBudget.dayOf(this.now());
    if (d !== this.day) {
      this.day = d;
      this.spent = 0n;
    }
  }

  /** Left today, after what is spent and what is reserved. */
  remaining(): bigint {
    this.roll();
    const left = this.limit - this.spent - this.reserved;
    return left > 0n ? left : 0n;
  }

  /** Reserve `amount`; returns a hold id, or undefined when it does not fit. */
  reserve(amount: bigint): number | undefined {
    if (amount < 0n) throw new Error('negative amount');
    if (amount > this.remaining()) return undefined;
    const id = this.nextHold++;
    this.holds.set(id, amount);
    this.reserved += amount;
    return id;
  }

  /** The payment went out: count `actual` (defaults to what was reserved). */
  settle(id: number, actual?: bigint): void {
    const held = this.holds.get(id);
    if (held === undefined) return;
    this.holds.delete(id);
    this.reserved -= held;
    this.roll();
    this.spent += actual ?? held;
    this.onChange?.({ day: this.day, spent: this.spent.toString() });
  }

  /** Nothing was paid: give the reservation back. */
  release(id: number): void {
    const held = this.holds.get(id);
    if (held === undefined) return;
    this.holds.delete(id);
    this.reserved -= held;
  }

  get spentToday(): bigint {
    this.roll();
    return this.spent;
  }
}

export class QueueFullError extends Error {
  constructor() {
    super('The network is busy. Try again in a few minutes.');
    this.name = 'QueueFullError';
  }
}

/**
 * One job at a time, in arrival order, with a maximum number waiting. One wallet pays
 * one fee at a time (its DUST is spent one payment at a time), and the anchoring job
 * shares this queue with visitors.
 */
export class SingleFlight {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  constructor(private readonly maxDepth: number) {}

  get waiting(): number {
    return this.depth;
  }

  run<T>(job: () => Promise<T>, opts: { bypassLimit?: boolean } = {}): Promise<T> {
    if (!opts.bypassLimit && this.depth >= this.maxDepth) return Promise.reject(new QueueFullError());
    this.depth++;
    const result = this.tail.then(job, job);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.depth--;
    });
  }
}
