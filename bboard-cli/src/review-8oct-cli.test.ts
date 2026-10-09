// 8 October 2026 review, the CLI: one CLI per private-state store (store-lock.ts), and
// every secret the CLI shows or is given redacted from log lines whatever its case.
// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreInUseError, lockPathFor, lockStoreDir } from './store-lock';
import { redactThisSession, scrub, scrubTerminal } from './logger-utils';
import { showSecret } from './secret-out';
import { storeDirFor } from './private-store';

const homes: string[] = [];
const freshDir = (): string => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'vc-lock-'));
  homes.push(home);
  return storeDirFor('preprod', home);
};
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

/** A process that is running now (and is not this one), and a pid that is not running. */
const liveChild = () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
const deadPid = (): number => {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
};
const writeLock = (dir: string, pid: number, host = os.hostname()): void => {
  mkdirSync(path.dirname(lockPathFor(dir)), { recursive: true });
  writeFileSync(lockPathFor(dir), JSON.stringify({ pid, host, since: '2026-10-08T00:00:00.000Z' }));
};

describe('one CLI per private-state store', () => {
  it('takes the lock beside the store folder, holds it, and releases it', () => {
    const dir = freshDir();
    const release = lockStoreDir(dir);
    const lock = lockPathFor(dir);
    expect(lock.endsWith(`${path.sep}private-state.lock`)).toBe(true);
    expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({ pid: process.pid, host: os.hostname() });
    // The same process may lock again: it already holds it.
    expect(() => lockStoreDir(dir)).not.toThrow();
    release();
    expect(existsSync(lock)).toBe(false);
  });

  it('REFUSES a second CLI while the first is running, and says which process holds it', async () => {
    const dir = freshDir();
    const other = liveChild();
    try {
      writeLock(dir, other.pid!);
      expect(() => lockStoreDir(dir)).toThrow(StoreInUseError);
      expect(() => lockStoreDir(dir)).toThrow(new RegExp(`process ${other.pid}.*will not start`));
      // The other CLI's lock is left exactly as it was.
      expect((JSON.parse(readFileSync(lockPathFor(dir), 'utf8')) as { pid: number }).pid).toBe(other.pid);
    } finally {
      other.kill();
      await new Promise((r) => other.once('exit', r));
    }
  });

  it('takes over a lock whose process is gone', () => {
    const dir = freshDir();
    writeLock(dir, deadPid());
    const release = lockStoreDir(dir);
    expect((JSON.parse(readFileSync(lockPathFor(dir), 'utf8')) as { pid: number }).pid).toBe(process.pid);
    release();
  });

  it('REFUSES a lock from another computer or one it cannot read, rather than guess', () => {
    const dir = freshDir();
    writeLock(dir, deadPid(), 'some-other-mac.local');
    expect(() => lockStoreDir(dir)).toThrow(/on some-other-mac\.local/);
    writeFileSync(lockPathFor(dir), 'garbage');
    expect(() => lockStoreDir(dir)).toThrow(/cannot read/);
  });

  it('openStores and chooseStore take the lock', async () => {
    const { chooseStore, openStores } = await import('./private-store');
    const pino = (await import('pino')).default;
    const home = mkdtempSync(path.join(os.tmpdir(), 'vc-lock-'));
    homes.push(home);
    const dir = storeDirFor('preprod', home);
    const other = liveChild();
    try {
      await chooseStore({
        networkId: 'preprod',
        storeName: 's',
        password: 'x',
        ask: () => Promise.resolve(''),
        logger: pino({ level: 'silent' }),
        home,
        candidates: [],
      });
      expect((JSON.parse(readFileSync(lockPathFor(dir), 'utf8')) as { pid: number }).pid).toBe(process.pid);
      const dir2 = path.join(home, 'elsewhere', 'store');
      writeLock(dir2, other.pid!);
      await expect(
        openStores({ dir: dir2, storeName: 's', password: () => 'x', accountId: '00'.repeat(32), home }),
      ).rejects.toThrow(StoreInUseError);
    } finally {
      other.kill();
      await new Promise((r) => other.once('exit', r));
    }
  });
});

describe('secrets are redacted from log lines whatever their case', () => {
  it('a 128-hex wallet seed typed in lower case is redacted when quoted back in upper case', () => {
    const seed = 'ab12'.repeat(32);
    redactThisSession(seed);
    expect(scrub(`seed ${seed.toUpperCase()} refused`)).toBe('seed [redacted] refused');
    expect(scrub(`seed 0x${seed} refused`)).toBe('seed 0x[redacted] refused');
  });

  it('a secret the CLI generated and showed (a recovery secret, a new record secret) is redacted from then on', () => {
    const recovery = 'cd34'.repeat(16);
    const record = 'ef56'.repeat(16);
    expect(scrub(`x ${recovery} y`)).toContain(recovery); // not shown yet
    const out: string[] = [];
    const real = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c: unknown) => (out.push(String(c)), true);
    try {
      showSecret('RECOVERY SECRET', recovery);
      showSecret('YOUR NEW RECORD SECRET', record);
    } finally {
      process.stdout.write = real;
    }
    // On screen, as it must be; in every log line afterwards, redacted, in either case.
    expect(out.join('')).toContain(recovery);
    expect(scrub(`failed with ${recovery.toUpperCase()}`)).toBe('failed with [redacted]');
    expect(scrub(`{"msg":"${record}"}`)).toBe('{"msg":"[redacted]"}');
  });

  it('showSecret is not itself redacted by the terminal scrubbing', () => {
    const secret = '9a'.repeat(32);
    const seen: string[] = [];
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (c: unknown) => (seen.push(String(c)), true);
    process.stderr.write = (c: unknown) => (seen.push(String(c)), true);
    try {
      scrubTerminal([]);
      showSecret('A SECRET', secret);
      process.stdout.write(`a library prints ${secret}\n`);
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }
    expect(seen[0]).toContain(secret);
    expect(seen[1]).toBe('a library prints [redacted]\n');
  });
});

// Verification review: the CLI still said "ownership proof" where the protocol proves
// control of a record now (prior possession), not ownership.
describe('the CLI says control proof, not ownership proof', () => {
  it('in the menu and in what it prints', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(src).toContain('28. Check a control proof');
    expect(src).toContain('2. Prove control ');
    expect(src).not.toMatch(/ownership proof/i);
    expect(src).not.toMatch(/Prove ownership|Ownership proved|OWNERSHIP CHALLENGE/);
  });
});
