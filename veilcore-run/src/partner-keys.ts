// What a partner makes on THEIR OWN computer, so that VeilCore never sees it: one master
// secret, written on paper, from which every recovery secret (and, on leaving, every new
// licence secret) is derived. VeilCore is given only the commitments.
// SPDX-License-Identifier: Apache-2.0
//
//   recovery secret i = HMAC-SHA256(master, "veilcore-run/v1/recovery/" + i)
//   licence secret j  = HMAC-SHA256(master, "veilcore-run/v1/licence/" + j)
//   pool id           = first 16 hex of HMAC-SHA256(master, "veilcore-run/v1/pool-id")
//
// Each record gets its own recovery secret, so the chain cannot link a partner's records
// by a shared recovery commitment, and the partner keeps one sheet of paper, not one per
// record. Anyone can re-derive a secret from the master with these three lines; nothing
// here depends on VeilCore.

import { createHmac } from 'node:crypto';
import { commit, fromHex, newSecret, toHex } from '@veilcore/contracts';

export const POOL_FORMAT = 'veilcore-run/recovery-pool/1';
export const ANSWER_FORMAT = 'veilcore-run/exit-answer/1';
export const REQUEST_FORMAT = 'veilcore-run/exit-request/1';

const hmac = (master: Uint8Array, msg: string): Uint8Array => {
  if (!(master instanceof Uint8Array) || master.length !== 32) throw new Error('A master secret is 32 bytes.');
  return new Uint8Array(createHmac('sha256', master).update(msg, 'utf8').digest());
};

export const newMaster = (): Uint8Array => newSecret();
export const poolIdOf = (master: Uint8Array): string => toHex(hmac(master, 'veilcore-run/v1/pool-id')).slice(0, 16);
export const recoverySecretAt = (master: Uint8Array, i: number): Uint8Array => {
  if (!Number.isInteger(i) || i < 0) throw new Error('A recovery index is a whole number, 0 or more.');
  return hmac(master, `veilcore-run/v1/recovery/${i}`);
};
export const licenceSecretAt = (master: Uint8Array, j: number): Uint8Array => {
  if (!Number.isInteger(j) || j < 0) throw new Error('A licence index is a whole number, 0 or more.');
  return hmac(master, `veilcore-run/v1/licence/${j}`);
};

/** Public: the recovery commitments a partner gives VeilCore, one per future record. */
export type RecoveryPool = {
  readonly format: typeof POOL_FORMAT;
  readonly partner: string;
  readonly network: string;
  readonly poolId: string;
  /** Index of the first commitment (so a second pool from the same master can follow on). */
  readonly start: number;
  readonly commitments: readonly string[];
};

export const makePool = (o: {
  readonly partner: string;
  readonly network: string;
  readonly master: Uint8Array;
  readonly count: number;
  readonly start?: number;
}): RecoveryPool => {
  if (!Number.isInteger(o.count) || o.count < 1 || o.count > 10_000) throw new Error('Make 1 to 10000 at a time.');
  const start = o.start ?? 0;
  const commitments: string[] = [];
  for (let i = start; i < start + o.count; i++) commitments.push(toHex(commit.recovery(recoverySecretAt(o.master, i))));
  return {
    format: POOL_FORMAT,
    partner: o.partner,
    network: o.network,
    poolId: poolIdOf(o.master),
    start,
    commitments,
  };
};

const HEX64 = /^[0-9a-f]{64}$/;

/** Whether `x` is an object whose field `k` is a 64-hex string (and `label`, when asked, a string). */
const hasHex = (x: unknown, k: string, label = true): boolean => {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  const v = o[k];
  return typeof v === 'string' && HEX64.test(v) && (!label || typeof o.label === 'string');
};
const isIndex = (x: unknown): boolean => Number.isInteger((x as Record<string, unknown>).index);

/** Check a pool file's shape (it comes from outside). */
export const parsePool = (v: unknown): RecoveryPool => {
  const p = v as Partial<RecoveryPool>;
  if (p?.format !== POOL_FORMAT) throw new Error('That is not a recovery pool file.');
  if (typeof p.partner !== 'string' || typeof p.network !== 'string' || typeof p.poolId !== 'string')
    throw new Error('That recovery pool file is damaged.');
  if (!/^[0-9a-f]{16}$/.test(p.poolId) || !Number.isInteger(p.start) || (p.start ?? -1) < 0)
    throw new Error('That recovery pool file is damaged.');
  const cs: unknown = p.commitments;
  if (!Array.isArray(cs) || cs.length === 0 || !cs.every((c: unknown) => typeof c === 'string' && HEX64.test(c)))
    throw new Error('That recovery pool file is damaged.');
  if (new Set(cs).size !== cs.length) throw new Error('That recovery pool repeats a commitment.');
  return p as RecoveryPool;
};

/** Public: what VeilCore gives a leaving partner so they can prepare (no secrets). */
export type ExitRequest = {
  readonly format: typeof REQUEST_FORMAT;
  readonly partner: string;
  readonly network: string;
  /** Records whose recovery secret VeilCore holds: each needs a new recovery commitment. */
  readonly records: readonly { readonly label: string; readonly origin: string }[];
  /** Licences the partner holds as licensee: each can move to a licence secret only they hold. */
  readonly licences: readonly { readonly label: string; readonly issuerRecord: string }[];
};

/** Public: the partner's answer. Commitments only; the secrets stay derivable from their master. */
export type ExitAnswer = {
  readonly format: typeof ANSWER_FORMAT;
  readonly partner: string;
  readonly network: string;
  readonly poolId: string;
  readonly records: readonly { readonly label: string; readonly index: number; readonly recoveryCommitment: string }[];
  readonly licences: readonly { readonly label: string; readonly index: number; readonly licenceCommitment: string }[];
};

export const parseRequest = (v: unknown): ExitRequest => {
  const r = v as Partial<ExitRequest>;
  if (r?.format !== REQUEST_FORMAT || !Array.isArray(r.records) || !Array.isArray(r.licences))
    throw new Error('That is not an exit request file.');
  const recs: unknown[] = r.records;
  const lics: unknown[] = r.licences;
  if (!recs.every((x) => hasHex(x, 'origin')) || !lics.every((x) => hasHex(x, 'issuerRecord')))
    throw new Error('That exit request file is damaged.');
  return r as ExitRequest;
};

export const parseAnswer = (v: unknown): ExitAnswer => {
  const a = v as Partial<ExitAnswer>;
  if (a?.format !== ANSWER_FORMAT || !Array.isArray(a.records) || !Array.isArray(a.licences))
    throw new Error('That is not an exit answer file.');
  const recs: unknown[] = a.records;
  const lics: unknown[] = a.licences;
  if (
    typeof a.partner !== 'string' ||
    typeof a.network !== 'string' ||
    typeof a.poolId !== 'string' ||
    !recs.every((x) => hasHex(x, 'recoveryCommitment') && isIndex(x)) ||
    !lics.every((x) => hasHex(x, 'licenceCommitment') && isIndex(x))
  )
    throw new Error('That exit answer is damaged.');
  return a as ExitAnswer;
};

/**
 * The partner's side of leaving: new recovery commitments for the records VeilCore holds
 * recovery secrets for, and new licence commitments for the licences they hold, all
 * derived from `master` starting at `from` (use indexes no earlier pool used).
 */
export const answerExit = (request: ExitRequest, master: Uint8Array, from: number): ExitAnswer => {
  let i = from;
  const records = request.records.map((r) => {
    const index = i++;
    return { label: r.label, index, recoveryCommitment: toHex(commit.recovery(recoverySecretAt(master, index))) };
  });
  const licences = request.licences.map((l, j) => {
    const index = from + j;
    return {
      label: l.label,
      index,
      licenceCommitment: toHex(commit.license(licenceSecretAt(master, index), fromHex(l.issuerRecord))),
    };
  });
  return {
    format: ANSWER_FORMAT,
    partner: request.partner,
    network: request.network,
    poolId: poolIdOf(master),
    records,
    licences,
  };
};
