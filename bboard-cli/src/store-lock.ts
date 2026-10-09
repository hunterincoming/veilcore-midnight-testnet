// SPDX-License-Identifier: Apache-2.0
/**
 * One CLI per private-state store (8 October 2026 review).
 *
 * midnight-js reads a contract's private state when a call starts and writes back the
 * state it read, changed, when the call ends. Two CLIs on one store therefore overwrite
 * each other's private state without a word: a record secret one of them rotated in can
 * be replaced by the other's stale copy. So the store folder is locked for the life of
 * the process: a lock file next to it (`private-state.lock`) holding this process's id.
 *
 * - A second CLI on the same store is refused, with a message saying which process holds
 *   it.
 * - A lock left by a process that is gone (killed, crashed, the computer restarted) is
 *   taken over.
 * - The same process may lock again (tests, a store opened twice): it already holds it.
 * - The lock is removed when the process exits, if it is still this process's.
 */
import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export class StoreInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreInUseError';
  }
}

/** The lock file for the store folder `dir`: beside it, so the store itself is untouched. */
export const lockPathFor = (dir: string): string => `${dir.replace(/[/\\]+$/, '')}.lock`;

type Holder = { readonly pid: number; readonly host: string; readonly since: string };

const parse = (text: string): Holder | undefined => {
  try {
    const h = JSON.parse(text) as Partial<Holder>;
    if (typeof h.pid === 'number' && Number.isInteger(h.pid) && h.pid > 0 && typeof h.host === 'string')
      return { pid: h.pid, host: h.host, since: typeof h.since === 'string' ? h.since : '' };
  } catch {
    // unreadable: treated below
  }
  return undefined;
};

/** Whether a process with this id is running on this computer (one we cannot signal counts as running). */
const running = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

const held = new Map<string, string>(); // lock path -> the text this process wrote

const tryCreate = (lock: string, text: string): boolean => {
  try {
    writeFileSync(lock, text, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
};

/**
 * Move a stale lock out of the way, unless what was moved turns out not to be the stale
 * one read a moment ago (another CLI took it over in between): then put it back.
 */
const removeStale = (lock: string, staleText: string): void => {
  const aside = `${lock}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    renameSync(lock, aside);
  } catch {
    return; // already gone: someone else removed it
  }
  const moved = readFileSync(aside, 'utf8');
  if (moved !== staleText) {
    try {
      linkSync(aside, lock); // put the live one back, unless a newer one is already there
    } catch {
      // a newer lock is in place; leave it
    }
  }
  unlinkSync(aside);
};

const refusal = (dir: string, lock: string, h: Holder | undefined): StoreInUseError =>
  new StoreInUseError(
    h === undefined
      ? `The private-state store ${dir} is locked by ${lock}, which this program cannot read. If no other ` +
          'VeilCore CLI is running, delete that file and start again.'
      : `Another VeilCore CLI (process ${h.pid}${h.host === os.hostname() ? '' : ` on ${h.host}`}, since ${h.since}) ` +
          `is using the private-state store ${dir}. Two at once overwrite each other's private state, so this one ` +
          `will not start. Close the other one first. If it is not running any more, delete ${lock}.`,
  );

/**
 * Lock the private-state store folder `dir` for the life of this process. Throws
 * StoreInUseError when another running process holds it. Returns a release function
 * (the lock is also released when the process exits).
 */
export const lockStoreDir = (dir: string): (() => void) => {
  const lock = lockPathFor(dir);
  const release = (): void => {
    const mine = held.get(lock);
    if (mine === undefined) return;
    held.delete(lock);
    try {
      if (readFileSync(lock, 'utf8') === mine) unlinkSync(lock);
    } catch {
      // already gone
    }
  };
  if (held.has(lock)) return release;
  mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const text = JSON.stringify({ pid: process.pid, host: os.hostname(), since: new Date().toISOString() });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (tryCreate(lock, text)) {
      held.set(lock, text);
      process.once('exit', release);
      return release;
    }
    let current: string;
    try {
      current = readFileSync(lock, 'utf8');
    } catch {
      continue; // removed in between: try again
    }
    const h = parse(current);
    if (h !== undefined && h.pid === process.pid && h.host === os.hostname()) {
      // Left by this very process (a lock not released before reopening): it is ours.
      held.set(lock, current);
      process.once('exit', release);
      return release;
    }
    // Only a lock from this computer can be judged stale: a pid means nothing elsewhere.
    if (h === undefined || h.host !== os.hostname() || running(h.pid)) throw refusal(dir, lock, h);
    removeStale(lock, current);
  }
  throw new StoreInUseError(
    `Could not lock the private-state store ${dir}: another VeilCore CLI keeps taking ${lock}. Close it first.`,
  );
};
