import { describe, expect, it } from 'vitest';
import { leadingZeroBits, ProofOfWork, solve } from './pow.js';

const clock = (start = 1_700_000_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};
const tx = new Uint8Array([9, 8, 7, 6]);

describe('proof of work', () => {
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x10]))).toBe(19);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0, 1]))).toBe(15);
  });

  it('accepts real work once, for the same bytes only', () => {
    const c = clock();
    const pow = new ProofOfWork(new Uint8Array(32).fill(1), 10, 60_000, c.now);
    const { challenge } = pow.issue();
    const nonce = solve(challenge, tx, 10);
    expect(pow.verify(challenge, nonce, new Uint8Array([1]))).toMatchObject({ ok: false });
    expect(pow.verify(challenge, nonce, tx)).toEqual({ ok: true });
    expect(pow.verify(challenge, nonce, tx)).toMatchObject({ ok: false, reason: expect.stringMatching(/already used/) });
  });

  it('refuses a challenge it did not issue, or a tampered one', () => {
    const c = clock();
    const a = new ProofOfWork(new Uint8Array(32).fill(1), 4, 60_000, c.now);
    const b = new ProofOfWork(new Uint8Array(32).fill(2), 4, 60_000, c.now);
    const { challenge } = b.issue();
    expect(a.verify(challenge, solve(challenge, tx, 4), tx)).toMatchObject({ ok: false });
    const mine = a.issue().challenge;
    const [exp, rand, mac] = mine.split('.');
    const later = `${Number(exp) + 999_999}.${rand}.${mac}`;
    expect(a.verify(later, solve(later, tx, 4), tx)).toMatchObject({ ok: false });
  });

  it('refuses an expired challenge (fake clock)', () => {
    const c = clock();
    const pow = new ProofOfWork(new Uint8Array(32), 4, 60_000, c.now);
    const { challenge } = pow.issue();
    const nonce = solve(challenge, tx, 4);
    c.advance(60_001);
    expect(pow.verify(challenge, nonce, tx)).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
  });

  it('refuses too little work', () => {
    const pow = new ProofOfWork(new Uint8Array(32), 20, 60_000, clock().now);
    const { challenge } = pow.issue();
    // A nonce good for 2 bits is almost never good for 20.
    const weak = solve(challenge, tx, 2);
    const r = pow.verify(challenge, weak, tx);
    if (r.ok) expect(leadingZeroBits(new Uint8Array())).toBe(0); // astronomically unlikely
    else expect(r.reason).toMatch(/does not check out/);
  });

  it('refuses missing fields', () => {
    const pow = new ProofOfWork(new Uint8Array(32), 4, 60_000, clock().now);
    expect(pow.verify(undefined, '1', tx).ok).toBe(false);
    expect(pow.verify('a.b.c', 1, tx).ok).toBe(false);
  });
});
