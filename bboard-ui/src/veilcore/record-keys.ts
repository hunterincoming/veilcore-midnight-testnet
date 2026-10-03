// A record's two on-chain secrets, made and kept in this browser only.
//
//   record secret    proves you hold the record (its on-chain identity is commit(secret))
//   recovery secret  moves the record to a new secret if the first is lost or stolen
//
// They are stored under their own localStorage key, which nothing else reads or sends.
// They are NEVER fields of a StrainRecord: the app saves whole records to VeilCore's
// registry (api-store.ts), so anything on a record leaves the browser. A test checks
// that no secret ever appears in a registry request (record-keys.test.ts).
//
// The record's on-chain identity and its anchor are kept here too, not on the record.
// They are public on chain, but the registry knows which holder key holds which record;
// with the identity on the record it could join a holder to their on-chain activity.
// The holder shares the identity only with the people they send a verify link to.
//
// Lose them (clear the browser, private window, new device without the backup) and
// nobody, VeilCore included, can prove the record again. So the app makes the backup
// file first and asks for it before anchoring, and warns before anything clears them.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';

const KEY = 'veilcore.record-keys.v1';

/** Where the record's identity was anchored. Public on chain; kept local (see above). */
export type ChainAnchor = {
  /** commit(record secret), hex. */
  readonly identity: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly txId: string;
  readonly txHash: string;
  readonly blockHeight: number;
  /** Block time (ms): the chain's clock, not this device's. */
  readonly anchoredAt?: number;
};

/** A report fingerprint published with pairDna, and which fingerprint it was. */
export type DnaOnChain = {
  readonly fingerprint: string;
  readonly txId: string;
  readonly txHash: string;
  readonly blockHeight: number;
  readonly at?: number;
};

export type RecordKeys = {
  readonly recordId: string;
  /** 32 bytes, hex. Secret. */
  readonly recordSecret: string;
  /** 32 bytes, hex. Secret. */
  readonly recoverySecret: string;
  readonly createdAt: number;
  /** When the backup file was last downloaded (or the keys were restored from one). */
  readonly backedUpAt?: number;
  readonly anchor?: ChainAnchor;
  readonly dnaOnChain?: DnaOnChain;
};

const HEX64 = /^[0-9a-f]{64}$/;

const isKeys = (v: unknown): v is RecordKeys => {
  if (typeof v !== 'object' || v === null) return false;
  const k = v as Record<string, unknown>;
  return (
    typeof k.recordId === 'string' &&
    typeof k.recordSecret === 'string' &&
    HEX64.test(k.recordSecret) &&
    typeof k.recoverySecret === 'string' &&
    HEX64.test(k.recoverySecret) &&
    typeof k.createdAt === 'number'
  );
};

const randomHex = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

export const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** In memory when the browser will not store anything (private window, blocked storage). */
let sessionOnly: Record<string, RecordKeys> = {};
const listeners = new Set<() => void>();

const readAll = (): Record<string, RecordKeys> => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...sessionOnly };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, RecordKeys> = { ...sessionOnly };
    for (const [id, v] of Object.entries(parsed)) if (isKeys(v)) out[id] = v;
    return out;
  } catch {
    return { ...sessionOnly };
  }
};

const writeAll = (all: Record<string, RecordKeys>): boolean => {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
};

let snapshot: Record<string, RecordKeys> = readAll();

const changed = (): void => {
  snapshot = readAll();
  listeners.forEach((l) => l());
};

/**
 * Whether this browser keeps what it is given. False in some private windows and when
 * site data is blocked; keys made then last only until the tab closes.
 */
export const storageKeeps = (): boolean => {
  try {
    const probe = `${KEY}.probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

export const keysFor = (recordId: string): RecordKeys | undefined => readAll()[recordId];

/** The record's keys, made now if it has none. Never replaces existing keys. */
export const ensureKeys = (recordId: string, now = Date.now()): RecordKeys => {
  const all = readAll();
  const existing = all[recordId];
  if (existing) return existing;
  const keys: RecordKeys = { recordId, recordSecret: randomHex(), recoverySecret: randomHex(), createdAt: now };
  const next = { ...all, [recordId]: keys };
  if (!writeAll(next)) sessionOnly = { ...sessionOnly, [recordId]: keys };
  changed();
  return keys;
};

const update = (recordId: string, f: (k: RecordKeys) => RecordKeys): void => {
  const all = readAll();
  const k = all[recordId];
  if (!k) return;
  const next = { ...all, [recordId]: f(k) };
  if (!writeAll(next)) sessionOnly = { ...sessionOnly, [recordId]: f(k) };
  changed();
};

/** The backup file's contents. Secret: it is for the holder only. */
export const backupFile = (
  keys: RecordKeys,
  extra: { cultivar?: string; network?: string; contract?: string; identity?: string },
) =>
  JSON.stringify(
    {
      format: 'veilcore-record-keys',
      version: 1,
      warning:
        'SECRET. Anyone with this file can act as the holder of this record on chain. VeilCore has no copy and cannot recover it. Keep it offline.',
      recordId: keys.recordId,
      cultivar: extra.cultivar,
      network: extra.network,
      contract: extra.contract,
      identity: keys.anchor?.identity ?? extra.identity,
      anchor: keys.anchor,
      recordSecret: keys.recordSecret,
      recoverySecret: keys.recoverySecret,
      createdAt: new Date(keys.createdAt).toISOString(),
    },
    null,
    2,
  );

/** Download the backup file, and remember that it was made. */
export const downloadBackup = (keys: RecordKeys, extra: Parameters<typeof backupFile>[1]): void => {
  const blob = new Blob([backupFile(keys, extra)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${keys.recordId}.record-keys.SECRET.json`;
  a.click();
  URL.revokeObjectURL(url);
  update(keys.recordId, (k) => ({ ...k, backedUpAt: Date.now() }));
};

/** Restore keys from a backup file (another device, or after clearing the browser). */
export const restoreBackup = async (file: File): Promise<RecordKeys> => {
  const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
  if (parsed.format !== 'veilcore-record-keys') throw new Error('That is not a VeilCore record-keys file.');
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const keys = {
    recordId: str(parsed.recordId),
    recordSecret: str(parsed.recordSecret).toLowerCase(),
    recoverySecret: str(parsed.recoverySecret).toLowerCase(),
    createdAt: Date.parse(str(parsed.createdAt)) || Date.now(),
    backedUpAt: Date.now(),
    ...(typeof parsed.anchor === 'object' && parsed.anchor !== null ? { anchor: parsed.anchor as ChainAnchor } : {}),
  };
  if (!isKeys(keys)) throw new Error('That file is damaged: the keys in it are not readable.');
  const existing = keysFor(keys.recordId);
  if (existing && existing.recordSecret !== keys.recordSecret) {
    throw new Error('This browser already holds different keys for that record. Nothing was changed.');
  }
  const all = readAll();
  if (!writeAll({ ...all, [keys.recordId]: keys })) sessionOnly = { ...sessionOnly, [keys.recordId]: keys };
  changed();
  return keys;
};

/** Record where the identity was anchored (after the anchor lands). */
export const setAnchor = (recordId: string, anchor: ChainAnchor): void => update(recordId, (k) => ({ ...k, anchor }));

/** Record that a report fingerprint was published on chain. */
export const setDnaOnChain = (recordId: string, dnaOnChain: DnaOnChain): void =>
  update(recordId, (k) => ({ ...k, dnaOnChain }));

/** Keys that exist only in this browser, with no backup made. */
export const keysWithoutBackup = (): RecordKeys[] => Object.values(readAll()).filter((k) => k.backedUpAt === undefined);

/** Delete a record's keys from this browser. The UI asks first, and says what is lost. */
export const forgetKeys = (recordId: string): void => {
  const all = readAll();
  delete all[recordId];
  const { [recordId]: _dropped, ...rest } = sessionOnly;
  void _dropped;
  sessionOnly = rest;
  writeAll(all);
  changed();
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** React: the keys this browser holds, by record id. */
export const useRecordKeys = (): Record<string, RecordKeys> => useSyncExternalStore(subscribe, () => snapshot);

/** Tests only. */
export const __resetRecordKeysForTests = (): void => {
  sessionOnly = {};
  snapshot = {};
};
