import { describe, expect, it } from 'vitest';
import { clientBucket, DailyBudget, DAY, DEFAULT_LIMITS, HOUR, Limits, MINUTE, QueueFullError, SingleFlight } from './limits.js';

const clock = (start = Date.parse('2026-10-03T10:00:00Z')) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};
const T1 = 'a'.repeat(32);
const T2 = 'b'.repeat(32);

describe('address buckets', () => {
  it('groups IPv4 by /24 and IPv6 by /64', () => {
    expect(clientBucket('203.0.113.7')).toBe('203.0.113.0/24');
    expect(clientBucket('::ffff:203.0.113.200')).toBe('203.0.113.0/24');
    expect(clientBucket('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(clientBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientBucket('2001:db8:0:0:ffff::9')).toBe(clientBucket('2001:db8::1'));
  });
});

describe('per-network and per-ticket quotas (fake clock)', () => {
  it('caps requests per minute and frees them after the minute', () => {
    const c = clock();
    const l = new Limits({ ...DEFAULT_LIMITS, requestsPerMinute: 3 }, c.now);
    for (let i = 0; i < 3; i++) expect(l.request('n').ok).toBe(true);
    expect(l.request('n').ok).toBe(false);
    expect(l.request('other').ok).toBe(true);
    c.advance(MINUTE + 1);
    expect(l.request('n').ok).toBe(true);
  });

  it('caps sponsored calls per network per hour and per day', () => {
    const c = clock();
    const l = new Limits(DEFAULT_LIMITS, c.now); // 3/hour, 10/day
    for (let i = 0; i < 3; i++) {
      expect(l.canSponsor('n', `${i}`.padStart(32, '0'), 'proveOwnership').ok).toBe(true);
      l.commit('n', `${i}`.padStart(32, '0'), 'proveOwnership');
    }
    expect(l.canSponsor('n', T1, 'proveOwnership')).toMatchObject({ ok: false, retryAfterSeconds: 3600 });
    let used = 3;
    while (used < 10) {
      c.advance(HOUR + 1);
      for (let i = 0; i < 3 && used < 10; i++, used++) {
        expect(l.canSponsor('n', `${used}`.padStart(32, '0'), 'proveOwnership').ok).toBe(true);
        l.commit('n', `${used}`.padStart(32, '0'), 'proveOwnership');
      }
    }
    c.advance(HOUR + 1);
    expect(l.canSponsor('n', T1, 'proveOwnership')).toMatchObject({ ok: false, retryAfterSeconds: 86400 });
    c.advance(DAY);
    expect(l.canSponsor('n', T1, 'proveOwnership').ok).toBe(true);
  });

  it('caps each ticket per circuit per day (anchor 3)', () => {
    const c = clock();
    const l = new Limits({ ...DEFAULT_LIMITS, perIpHour: 100, perIpDay: 100 }, c.now);
    for (let i = 0; i < 3; i++) {
      expect(l.canSponsor('n', T1, 'anchor').ok).toBe(true);
      l.commit('n', T1, 'anchor');
    }
    expect(l.canSponsor('n', T1, 'anchor').ok).toBe(false);
    expect(l.canSponsor('n', T1, 'pairDna').ok).toBe(true);
    expect(l.canSponsor('n', T2, 'anchor').ok).toBe(true);
    c.advance(DAY + 1);
    expect(l.canSponsor('n', T1, 'anchor').ok).toBe(true);
  });

  it('a circuit with no quota gets none', () => {
    const l = new Limits(DEFAULT_LIMITS, clock().now);
    expect(l.canSponsor('n', T1, 'issueLicense').ok).toBe(false);
  });

  it('forgets addresses once their window has passed', () => {
    const c = clock();
    const l = new Limits(DEFAULT_LIMITS, c.now);
    l.request('n');
    l.commit('n', T1, 'anchor');
    expect(l.trackedBuckets).toBeGreaterThan(0);
    c.advance(DAY + 1);
    l.sweep();
    expect(l.trackedBuckets).toBe(0);
  });
});

describe('daily budget (fake clock)', () => {
  it('reserves, settles, releases, and never overshoots', () => {
    const c = clock();
    const saved: unknown[] = [];
    const b = new DailyBudget(100n, c.now, undefined, (s) => saved.push(s));
    const h1 = b.reserve(60n)!;
    expect(b.reserve(50n)).toBeUndefined(); // 60 reserved, 40 left
    const h2 = b.reserve(40n)!;
    b.release(h2);
    expect(b.remaining()).toBe(40n);
    b.settle(h1, 55n);
    expect(b.spentToday).toBe(55n);
    expect(b.remaining()).toBe(45n);
    expect(saved).toEqual([{ day: '2026-10-03', spent: '55' }]);
  });

  it('starts again at midnight UTC and survives a restart the same day', () => {
    const c = clock(Date.parse('2026-10-03T23:59:00Z'));
    const b = new DailyBudget(100n, c.now, { day: '2026-10-03', spent: '90' });
    expect(b.remaining()).toBe(10n);
    c.advance(2 * MINUTE);
    expect(b.remaining()).toBe(100n);
    const old = new DailyBudget(100n, c.now, { day: '2026-10-03', spent: '90' });
    expect(old.remaining()).toBe(100n);
  });
});

describe('queue', () => {
  it('runs one job at a time, in order, and refuses past its depth', async () => {
    const q = new SingleFlight(2);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = q.run(async () => {
      order.push('a-start');
      await gate;
      order.push('a-end');
      return 'a';
    });
    const b = q.run(async () => {
      order.push('b');
      return 'b';
    });
    await expect(q.run(async () => 'c')).rejects.toBeInstanceOf(QueueFullError);
    expect(q.waiting).toBe(2);
    const job = q.run(async () => 'job', { bypassLimit: true });
    release();
    expect(await Promise.all([a, b, job])).toEqual(['a', 'b', 'job']);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
    expect(q.waiting).toBe(0);
  });

  it('keeps going after a job fails', async () => {
    const q = new SingleFlight(5);
    await expect(q.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await q.run(async () => 1)).toBe(1);
  });
});
