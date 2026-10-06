// Proof of work: a small amount of hashing the visitor's browser does before the sponsor
// spends anything on a request. It costs a phone a second or two and makes sending junk
// in bulk expensive. No third-party script, so the site's content security policy stays
// tight.
//
// The scheme (the browser implements the same; bboard-ui/src/veilcore/chain/pow.ts):
//   1. GET /sponsor/challenge gives { challenge, difficulty }. A challenge is
//      "<expiresAtMs>.<random>.<mac>", signed by this process so it needs no storage
//      until it is used, and usable once.
//   2. The browser finds a nonce so that
//        sha256("veilcore-sponsor-pow:v1:" + challenge + ":" + sha256hex(txBytes) + ":" + nonce)
//      starts with `difficulty` zero bits.
//   3. The work is bound to the exact transaction bytes, so it cannot be reused for another.
//
// SPDX-License-Identifier: Apache-2.0

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const POW_TAG = 'veilcore-sponsor-pow:v1';

export const sha256hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

/** Leading zero bits of a digest. */
export const leadingZeroBits = (digest: Uint8Array): number => {
  let n = 0;
  for (const byte of digest) {
    if (byte === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(byte) - 24;
  }
  return n;
};

export const powDigest = (challenge: string, txHashHex: string, nonce: string): Uint8Array =>
  createHash('sha256').update(`${POW_TAG}:${challenge}:${txHashHex}:${nonce}`).digest();

export type PowCheck = { ok: true } | { ok: false; reason: string };

export class ProofOfWork {
  private readonly used = new Map<string, number>(); // challenge -> expiresAt

  constructor(
    private readonly secret: Uint8Array,
    readonly difficulty: number,
    private readonly lifetimeMs: number,
    private readonly now: () => number,
  ) {
    if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 32) throw new Error('difficulty must be 0..32 bits');
  }

  static withRandomSecret(difficulty: number, lifetimeMs: number, now: () => number): ProofOfWork {
    return new ProofOfWork(randomBytes(32), difficulty, lifetimeMs, now);
  }

  private mac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex').slice(0, 32);
  }

  issue(): { challenge: string; difficulty: number; expiresAt: number } {
    const expiresAt = this.now() + this.lifetimeMs;
    const body = `${expiresAt}.${randomBytes(12).toString('hex')}`;
    return { challenge: `${body}.${this.mac(body)}`, difficulty: this.difficulty, expiresAt };
  }

  /** Check, and on success use up, a challenge for these exact transaction bytes. */
  verify(challenge: unknown, nonce: unknown, txBytes: Uint8Array): PowCheck {
    if (typeof challenge !== 'string' || typeof nonce !== 'string' || challenge.length > 200 || nonce.length > 64) {
      return { ok: false, reason: 'The proof of work is missing.' };
    }
    const parts = challenge.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'That challenge was not issued here.' };
    const [exp, rand, mac] = parts;
    const expected = this.mac(`${exp}.${rand}`);
    if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
      return { ok: false, reason: 'That challenge was not issued here.' };
    }
    const expiresAt = Number(exp);
    const t = this.now();
    if (!Number.isFinite(expiresAt) || expiresAt <= t) return { ok: false, reason: 'The challenge expired. Try again.' };
    this.sweep(t);
    if (this.used.has(challenge)) return { ok: false, reason: 'That challenge was already used.' };
    if (leadingZeroBits(powDigest(challenge, sha256hex(txBytes), nonce)) < this.difficulty) {
      return { ok: false, reason: 'The proof of work does not check out.' };
    }
    this.used.set(challenge, expiresAt);
    return { ok: true };
  }

  private sweep(t: number): void {
    for (const [c, e] of this.used) if (e <= t) this.used.delete(c);
  }
}

/** Reference solver (tests, and the operator's own checks). The browser has its own. */
export const solve = (challenge: string, txBytes: Uint8Array, difficulty: number): string => {
  const h = sha256hex(txBytes);
  for (let i = 0; ; i++) {
    const nonce = i.toString(16);
    if (leadingZeroBits(powDigest(challenge, h, nonce)) >= difficulty) return nonce;
  }
};
