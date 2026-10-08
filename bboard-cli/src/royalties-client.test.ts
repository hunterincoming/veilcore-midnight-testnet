// The royalties client's off-chain rules (api/src/royalties-api.ts), against the live
// contract's simulator: which records may stand behind an offer, period labels, requests.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import {
  newPresentationRequest,
  periodBytes,
  recordStanding,
  roundedValidUntil,
  standingVerdict,
} from '../../api/src/royalties-api.js';
import { assertRoyaltiesDeployAllowed, assertRoyaltiesJoinAllowed } from '../../api/src/deploy-guard.js';
import { VeilcoreSimulator, as, secret } from '../../contract/src/test/veilcore-simulator.js';

describe('which records may stand behind an offer', () => {
  it("an anchored record that is its identity's head: yes; an unanchored one: no", () => {
    const sim = new VeilcoreSimulator();
    const A = secret('rs-a');
    expect(recordStanding(sim.state, C.commit(A))).toEqual({
      ok: false,
      why: 'not-anchored',
    });
    sim.call(as(A), 'anchor', C.recoveryCommit(secret('rs-a-rcv')));
    expect(recordStanding(sim.state, C.commit(A))).toEqual({ ok: true });
  });

  it('after a rotation the old record no longer stands; the new one does', () => {
    const sim = new VeilcoreSimulator();
    const A = secret('rs-b');
    const B = secret('rs-b-next');
    sim.call(as(A), 'anchor', C.recoveryCommit(secret('rs-b-rcv')));
    sim.call(as(A, { incoming: B }), 'rotateRecordSecret', C.commit(B));
    expect(recordStanding(sim.state, C.commit(A))).toEqual({
      ok: false,
      why: 'moved',
      recovered: false,
    });
    // An offer already sold carries on (its licensees cannot move): top-ups only warn.
    expect(standingVerdict(recordStanding(sim.state, C.commit(A))).refuse).toBeUndefined();
    expect(recordStanding(sim.state, C.commit(B))).toEqual({ ok: true });
  });

  it('after a recovery (a stolen secret), offers from the old record are refused', () => {
    const sim = new VeilcoreSimulator();
    const A = secret('rs-c');
    const RCV = secret('rs-c-rcv');
    const NEW = secret('rs-c-new');
    sim.call(as(A), 'anchor', C.recoveryCommit(RCV));
    sim.call(
      as(secret('rs-nobody'), { incoming: NEW, recovery: RCV }),
      'recoverRecordSecret',
      C.commit(A),
      C.commit(NEW),
      C.recoveryCommit(secret('rs-c-rcv2')),
    );
    expect(recordStanding(sim.state, C.commit(A))).toEqual({
      ok: false,
      why: 'moved',
      recovered: true,
    });
    // The offer may be the thief's: top-ups and verifiers refuse it too.
    expect(standingVerdict(recordStanding(sim.state, C.commit(A))).refuse).toMatch(/recovered from theft/);
    expect(recordStanding(sim.state, C.commit(NEW))).toEqual({ ok: true });
  });
});

describe('period labels and verifier requests', () => {
  it('a period label is its UTF-8 text, zero-padded to 32 bytes; empty or too long is refused', () => {
    const p = periodBytes('2026-Q4');
    expect(Buffer.from(p.slice(0, 7)).toString()).toBe('2026-Q4');
    expect(p.slice(7).every((x) => x === 0)).toBe(true);
    expect(Buffer.from(periodBytes(' 2026-Q4 ')).equals(Buffer.from(p))).toBe(true);
    expect(() => periodBytes('')).toThrow(/1 to 32/);
    expect(() => periodBytes('x'.repeat(33))).toThrow(/1 to 32/);
  });

  it('a request has a fresh challenge and scope, a future time, and no period unless asked', () => {
    const offer = new Uint8Array(32).fill(7);
    const a = newPresentationRequest({ contract: 'ab', offer });
    const b = newPresentationRequest({
      contract: 'ab',
      offer,
      period: '2026-Q4',
      minUnits: 30n,
    });
    expect(a.challenge).not.toBe(b.challenge);
    expect(a.scope).not.toBe(b.scope);
    expect(BigInt(a.validAt)).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
    expect(a.period).toBe('0'.repeat(64));
    expect(b.minUnits).toBe('30');
    expect(b.period.startsWith(Buffer.from('2026-Q4').toString('hex'))).toBe(true);
  });
});

describe('mainnet guards', () => {
  const withNetwork = <T>(n: string, f: () => T): T => {
    setNetworkId(n);
    try {
      return f();
    } finally {
      setNetworkId('undeployed');
    }
  };

  it('deploying and joining are allowed on preprod, refused on mainnet until filed and pinned', () => {
    expect(withNetwork('preprod', () => assertRoyaltiesDeployAllowed())).toBe('development');
    expect(withNetwork('preprod', () => assertRoyaltiesJoinAllowed('ab'.repeat(32)))).toBe('development');
    expect(() => withNetwork('mainnet', () => assertRoyaltiesDeployAllowed())).toThrow(/test networks only/);
    expect(() => withNetwork('mainnet', () => assertRoyaltiesJoinAllowed('ab'.repeat(32)))).toThrow(/pins no address/);
  });
});

describe('the time a top-up says its offer is open until', () => {
  const DAY = 86400n;
  const now = 1_800_000_000n + 12345n;
  const start = (now / DAY) * DAY;
  it('is the start of the day after tomorrow for every offer that lasts past it', () => {
    expect(roundedValidUntil(now + 400n * DAY, now)).toBe(start + 2n * DAY);
    expect(roundedValidUntil(start + 2n * DAY + 1n, now)).toBe(start + 2n * DAY);
    expect(roundedValidUntil(start + 2n * DAY, now)).toBe(start + 2n * DAY);
  });
  it('runs until 30 days after the offer ends, so its last season can be paid for', () => {
    expect(roundedValidUntil(now + 3600n, now)).toBe(start + 2n * DAY);
    expect(roundedValidUntil(start + 2n * DAY - 30n * DAY, now)).toBe(start + 2n * DAY);
  });
  it('is nothing (top-ups closed) when those 30 days end before then, so no top-up names an end date', () => {
    expect(roundedValidUntil(start + 2n * DAY - 30n * DAY - 1n, now)).toBeUndefined();
    expect(roundedValidUntil(now - 30n * DAY, now)).toBeUndefined();
  });
});
