// What a leaving partner runs on THEIR OWN computer to finish leaving: take every record
// back with their own recovery secret (partner-recover), and check on chain that nothing
// VeilCore's software made or held controls any record any more (partner-check).
// SPDX-License-Identifier: Apache-2.0
//
// Each record is moved to a record secret and a recovery secret derived from the
// partner's master and the record's origin (partner-keys.ts, ownRecordSecret and
// ownRecoverySecret, generation n): nothing to remember, and partner-check re-derives them.

import { type Ledger, type VeilCore, commit, fromHex, toHex } from '@veilcore/contracts';
import { type ExitBundle } from './bundle.ts';
import { ownRecordSecret, ownRecoverySecret, poolIdOf, recoverySecretAt } from './partner-keys.ts';
import { type RecordEntry } from './vault.ts';

const GENERATIONS = 16;

/** The records in a partner's bundles, the latest bundle's view of each winning. */
export const recordsIn = (bundles: readonly ExitBundle[]): RecordEntry[] => {
  const by = new Map<string, { at: string; r: RecordEntry }>();
  for (const b of bundles)
    for (const r of b.vault.records) {
      if (r.status === 'new') continue;
      const had = by.get(r.label);
      if (had === undefined || had.at < b.madeAt) by.set(r.label, { at: b.madeAt, r });
    }
  return [...by.values()].map((x) => x.r);
};

const headOf = (ledger: Ledger, origin: Uint8Array): string =>
  toHex(ledger.headOf.member(origin) ? ledger.headOf.lookup(origin) : origin);

/** The generation n at which the record is the partner's own (record and recovery), or undefined. */
export const ownGeneration = (ledger: Ledger, r: RecordEntry, own: Uint8Array): number | undefined => {
  const origin = fromHex(r.origin);
  if (!ledger.recoveryOf.member(origin)) return undefined;
  const head = headOf(ledger, origin);
  const rc = toHex(ledger.recoveryOf.lookup(origin));
  for (let n = 0; n < GENERATIONS; n++)
    if (
      head === toHex(commit.record(ownRecordSecret(own, r.origin, n))) &&
      rc === toHex(commit.recovery(ownRecoverySecret(own, r.origin, n)))
    )
      return n;
  return undefined;
};

export type RecordCheck = {
  readonly label: string;
  readonly origin: string;
  readonly yours: boolean;
  readonly generation?: number;
};

/** partner-check: for each record, whether its head AND its recovery commitment are the partner's own. */
export const checkRecords = (ledger: Ledger, records: readonly RecordEntry[], own: Uint8Array): RecordCheck[] =>
  records.map((r) => {
    const n = ownGeneration(ledger, r, own);
    return { label: r.label, origin: r.origin, yours: n !== undefined, ...(n === undefined ? {} : { generation: n }) };
  });

/**
 * partner-recover: one recovery per record not yet the partner's own. `own` is the master
 * the own secrets derive from; `masters` are every master the partner typed (a record's
 * current recovery secret may come from an earlier one, by its pool id).
 */
export const recoverRecords = async (
  vc: VeilCore,
  records: readonly RecordEntry[],
  own: Uint8Array,
  masters: readonly Uint8Array[],
): Promise<{ readonly label: string; readonly outcome: string; readonly txId?: string }[]> => {
  const out: { label: string; outcome: string; txId?: string }[] = [];
  for (const r of records) {
    let ledger = await vc.ledger();
    if (ownGeneration(ledger, r, own) !== undefined) {
      out.push({ label: r.label, outcome: 'already yours' });
      continue;
    }
    let recoverySecret: Uint8Array;
    if (r.recovery.secret !== undefined) recoverySecret = fromHex(r.recovery.secret);
    else if (r.recovery.pool !== undefined) {
      const pool = r.recovery.pool;
      const m = masters.find((x) => poolIdOf(x) === pool.id);
      if (m === undefined)
        throw new Error(`Record "${r.label}" recovers with a secret from pool ${pool.id}: type that master too.`);
      recoverySecret = recoverySecretAt(m, pool.index);
    } else throw new Error(`Record "${r.label}": this bundle does not say where its recovery secret comes from.`);
    const origin = fromHex(r.origin);
    if (!(await vc.recoverySecretIsCurrent(origin, recoverySecret)))
      throw new Error(
        `Record "${r.label}": the chain's recovery commitment is not the one this bundle names. If you already took it ` +
          'back another way, check with partner-check; otherwise stop and contact VeilCore. Nothing was sent for it.',
      );
    ledger = await vc.ledger();
    let n = 0;
    for (; n < GENERATIONS; n++) {
      const c = commit.record(ownRecordSecret(own, r.origin, n));
      if (!ledger.originOf.member(c) && !ledger.recoveryOf.member(c) && !ledger.headOf.member(c)) break;
    }
    if (n === GENERATIONS) throw new Error(`Record "${r.label}": no unused generation left. Contact VeilCore.`);
    const tx = await vc.recoverRecordSecret({
      originalRecord: origin,
      recoverySecret,
      newRecordSecret: ownRecordSecret(own, r.origin, n),
      newRecoveryCommitment: commit.recovery(ownRecoverySecret(own, r.origin, n)),
    });
    out.push({ label: r.label, outcome: `recovered to your own secrets (generation ${n})`, txId: tx.txId });
  }
  return out;
};
