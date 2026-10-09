// VeilCore record store — persisted to localStorage so a breeder's proof survives a
// browser refresh. Real hashing lives in commitment.ts; this only holds records and
// their status. Simulated settlement in demo mode.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';
import { store, type SaveResult } from './store';
import { exportEnvelopeFor, toEnvelope, sealEnvelope } from './envelope';
import { holderPartyId, forgetHolderKey } from './holder';
import { proofFor } from './proofs';
import { reportSave, describeRefusals } from './save-status';
import { newNonce, fingerprintRecord } from './commitment';

/**
 * A second party confirming they received this material.
 *
 * Written by the registry when a recipient claims a transfer — never set by the holder,
 * because a confirmation you give yourself is not evidence. The identity is the
 * recipient's own handle and key, so the claim points at someone.
 */
export type Attestation = {
  /** Legacy name for addressedTo — kept so records written before the rename still render. */
  readonly attesterHandle?: string;
  /** The handle the sender addressed. Not a party this attestation confirms. */
  readonly addressedTo?: string;
  /** What the claim establishes, in words. */
  readonly confirms?: string;
  readonly attesterKey?: string;
  readonly type?: string;
  readonly transferId?: string;
  readonly attestedAt: number;
  /** Legacy, from before an attestation had to be earned. */
  readonly lab?: string;
};

/** A parent cultivar: linked to a logged record (recordId set) or free-typed (name only). */
export type ParentRef = { readonly recordId?: string; readonly name: string };

export type StrainRecord = {
  readonly id: string; // VEIL-XXXX
  /** Committed with the record and stored so the commitment can be recomputed. */
  readonly nonce?: string;
  readonly strainName: string;
  readonly bredBy: string;
  readonly dateCreated: string; // breeder's self-asserted claim (not cryptographically proven)
  readonly notes: string;
  readonly loggedAt: number; // when it was sealed, by this device's clock (not a trusted time until anchored)
  readonly recordFingerprint: string;
  readonly parents?: ParentRef[];
  readonly breedingMethod?: string;
  /**
   * The profile this record was sealed under. Absent on records sealed before
   * 3 October 2026, which keep the profile they were exported under (see envelope.ts).
   */
  readonly profile?: string;
  /** Species or other taxon, as the holder entered it. Optional. */
  readonly taxon?: string;
  readonly photoFingerprints?: string[]; // photos hashed locally, never uploaded
  readonly refId?: string; // breeder's own reference / lot ID
  readonly dnaFingerprint?: string;
  readonly dnaFileName?: string;
  readonly dnaPairedAt?: number;
  readonly attestation?: Attestation; // Phase 2.4

  // Set by the registry when a record arrives through a transfer. The recipient holds
  // material descended from the source, not a copy of the source's evidence.
  /** The source record's id. */
  /** Set on a correcting record: the record it supersedes, and how severely. */
  readonly supersedes?: {
    recordId: string;
    reason: string;
    descentSeverity: 'cosmetic' | 'material';
    termsSeverity: 'cosmetic' | 'material';
    effectiveAt: string;
    changedFields: string[];
  };
  /** Set on a superseded record: the correction that replaced it. */
  readonly supersededBy?: string;

  readonly receivedFrom?: string;
  /** The source record's commitment — what an attestation about the source points at. */
  readonly receivedFromCommitment?: string;
  readonly receivedAt?: number;
  readonly transferId?: string;
  readonly quantity?: string;
  readonly licenseIds?: string[]; // Phase 3
};

/**
 * A stored record, checked on the way in.
 *
 * Deliberately loose about which fields must be present and strict about the type
 * of any that are. A guard that demanded every field would silently drop a
 * breeder's older records from their own set, and losing someone's evidence to a
 * schema change is a worse failure than carrying a record with a missing note.
 * The id has to be there, because everything else keys off it.
 */
export const isStrainRecord = (v: unknown): v is StrainRecord => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string') return false;
  const str = (x: unknown) => x === undefined || typeof x === 'string';
  const num = (x: unknown) => x === undefined || typeof x === 'number';
  return (
    str(r.strainName) &&
    str(r.bredBy) &&
    str(r.dateCreated) &&
    str(r.notes) &&
    str(r.recordFingerprint) &&
    str(r.nonce) &&
    str(r.dnaFingerprint) &&
    str(r.profile) &&
    str(r.taxon) &&
    num(r.loggedAt) &&
    num(r.dnaPairedAt) &&
    (r.parents === undefined || Array.isArray(r.parents))
  );
};

export type NewRecordInput = {
  nonce?: string;
  strainName: string;
  bredBy: string;
  dateCreated: string;
  notes: string;
  loggedAt: number;
  recordFingerprint: string;
  parents?: ParentRef[];
  breedingMethod?: string;
  profile?: string;
  taxon?: string;
  photoFingerprints?: string[];
  refId?: string;
};

/** Records whose id is referenced as a parent by the given record (its children). */
export const childrenOf = (id: string): StrainRecord[] =>
  records.filter((r) => (r.parents ?? []).some((p) => p.recordId === id));

const KEY = 'veilcore.records.v1';

let records: StrainRecord[] = [];
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** Re-fetch from the registry. Used on start, after a claim, and by the sync below. */
export const hydrate = async (): Promise<void> => {
  try {
    records = await store.load(KEY, isStrainRecord);
  } catch {
    return; // the registry could not answer now: keep what is shown, try again at the next sync
  }
  notify();
};

// Records change on the server without this browser doing anything — an attestation
// lands when a recipient confirms receipt, which happens on someone else's machine.
// Polling is the honest simple answer; a socket would be better and is not worth the
// complexity until someone is actually waiting on it.
//
// Started by the app pages, not on import (attack round D): importing this module used
// to load and poll from every page, the landing page and a QR-scanned verify page
// included. It asks only when the tab is visible, and the store asks the registry only
// when this browser holds a key.
let syncTimer: ReturnType<typeof setInterval> | undefined;
export const SYNC_INTERVAL_MS = 30_000;
export const startRecordSync = (): void => {
  if (syncTimer !== undefined || typeof window === 'undefined') return;
  void hydrate();
  syncTimer = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') void hydrate();
  }, SYNC_INTERVAL_MS);
  // Also on tab focus — the common case is a breeder switching back to check.
  window.addEventListener('focus', () => {
    void hydrate();
  });
};

/**
 * Save the whole set and act on what the registry says. A refusal used to be ignored,
 * so a record the registry never stored stayed on screen as though it had been. On a
 * refusal the set is reloaded from the registry — the rollback — and the holder is told.
 */
const saveAll = async (): Promise<SaveResult> => {
  const result = await store.save(KEY, records);
  reportSave('records', result);
  if (!result.ok && !result.offline) await hydrate();
  return result;
};

const persist = () => {
  void saveAll();
  notify();
};

/**
 * 128 random bits. Ids were 24 bits (and corrections were the original id plus four
 * clock characters), so an attacker could store the next id first: the victim's save
 * was refused for that id and, for a correction, the original ended up pointing at the
 * attacker's record (attack round 11). Older short ids stay valid; only new ones change.
 */
const genId = (): string =>
  'VEIL-' +
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

export const createRecord = (input: NewRecordInput): StrainRecord => {
  const record: StrainRecord = { id: genId(), licenseIds: [], ...input };
  records = [record, ...records];
  persist();
  return record;
};

/**
 * Pair a DNA report's fingerprint with a record.
 *
 * The pairing is a note beside the sealed record, not part of it: the record fingerprint
 * (what the registry stores and anchors) does not cover it, and re-sealing would not
 * change that, because the registry's commitment has no field for it. So it is dated
 * with when it happened, and an export puts it under that date and says the registered
 * fingerprint does not cover it (envelope.ts exportEnvelopeFor), rather than under the
 * original sealing date.
 */
export const pairDna = (id: string, dnaFingerprint: string, dnaFileName: string): StrainRecord | undefined => {
  let updated: StrainRecord | undefined;
  records = records.map((r) => {
    if (r.id !== id) return r;
    updated = { ...r, dnaFingerprint, dnaFileName, dnaPairedAt: Date.now() };
    return updated;
  });
  if (updated) persist();
  return updated;
};

/** Phase 2.4 — record a second-party (lab) attestation. */
// attestRecord removed deliberately.
//
// An attestation is a second party confirming they received material. It is created
// when a lab claims a transfer, recorded against their key. A client-side function that
// sets one is a way to manufacture the exact evidence this system exists to produce —
// a back door whether or not anything calls it.

/**
 * Recompute a record's fingerprint from its stored fields and compare it with the one it
 * was sealed with. This is the integrity check a certificate shows: it is computed, not
 * asserted. A record with no stored nonce (very early records) cannot be recomputed.
 */
export type IntegrityCheck = 'match' | 'mismatch' | 'unsealed' | 'no-nonce';
export const checkIntegrity = async (r: StrainRecord): Promise<IntegrityCheck> => {
  if (!r.recordFingerprint) return 'unsealed';
  if (!r.nonce) return 'no-nonce';
  const recomputed = await fingerprintRecord({ ...r, nonce: r.nonce });
  return recomputed === r.recordFingerprint ? 'match' : 'mismatch';
};

export const getRecord = (id: string): StrainRecord | undefined => records.find((r) => r.id === id);

export const allRecords = (): StrainRecord[] => records;

/** Backs prove-ownership: does any record's paired DNA fingerprint match this one? */
export const findByDnaFingerprint = (dnaFingerprint: string): StrainRecord | undefined =>
  records.find((r) => r.dnaFingerprint === dnaFingerprint);

/** Conflict detection (Phase 2.3): other records already paired to this same fingerprint. */
export const conflictsFor = (dnaFingerprint: string, exceptId: string): StrainRecord[] =>
  records.filter((r) => r.id !== exceptId && r.dnaFingerprint === dnaFingerprint);

/**
 * Export a record in envelope form — the wire format other implementations read.
 *
 * The internal shape is convenient for this app; the envelope is what leaves it. Kept
 * separate on purpose: the internal model can change freely, the wire format changes
 * only by version.
 */
export const exportEnvelope = async (id: string): Promise<void> => {
  const r = getRecord(id);
  if (!r) return;
  const env = await exportEnvelopeFor(
    r,
    await holderPartyId(),
    await checkIntegrity(r),
    await proofFor(r.recordFingerprint),
  );
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.id}.veilcore.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// ---- demo data portability ----

export const exportRecords = (): void => {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `veilcore-records-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

/** The largest records file read for import. An export of the per-holder maximum is far smaller. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * The fields a holder writes. Everything else on a stored record is written by the
 * registry (the delivery confirmation, where a received record came from) or lives in
 * another store (licence ids), and an import file is not a source for any of it: a
 * "restore" carrying a typed-in lab confirmation used to be imported and uploaded as is
 * (attack round D).
 */
const IMPORTABLE = [
  'id',
  'nonce',
  'strainName',
  'bredBy',
  'dateCreated',
  'notes',
  'loggedAt',
  'recordFingerprint',
  'parents',
  'breedingMethod',
  'profile',
  'taxon',
  'photoFingerprints',
  'refId',
  'dnaFingerprint',
  'dnaFileName',
  'dnaPairedAt',
  'supersedes',
  'supersededBy',
] as const;

const importable = (r: StrainRecord): StrainRecord => {
  const src = r as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of IMPORTABLE) if (src[k] !== undefined) out[k] = src[k];
  return out as unknown as StrainRecord;
};

export type ImportResult = { added: number; alreadyHere: number };

/**
 * Restore records from an export.
 *
 * All or nothing, and additive: a file with any entry this version cannot read, or any
 * sealed entry whose fingerprint does not recompute from its fields, imports nothing.
 * Records already in this set are kept as they are, never overwritten by the file, so
 * an import cannot replace a holder's set with someone else's.
 */
export const importRecords = async (file: File): Promise<ImportResult> => {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is larger than 20 MB. Nothing was imported.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not a VeilCore records export. Nothing was imported.');
  }
  if (!Array.isArray(parsed)) throw new Error('That file is not a VeilCore records export.');
  const valid = parsed.filter(isStrainRecord);
  // Refuse a file with unreadable entries rather than importing the rest. A partial
  // import looks like a success and leaves the holder believing they restored
  // records that are not there.
  if (valid.length !== parsed.length) {
    throw new Error(
      `That file has ${String(parsed.length - valid.length)} entries this version cannot read. Nothing was imported.`,
    );
  }
  const cleaned = valid.map(importable);
  for (const r of cleaned) {
    const check = await checkIntegrity(r);
    if (check === 'mismatch') {
      throw new Error(`${r.id}: its fingerprint does not match its fields. Nothing was imported.`);
    }
    if (check === 'no-nonce') {
      throw new Error(`${r.id}: it has a fingerprint but no nonce, so it cannot be checked. Nothing was imported.`);
    }
  }
  // Compared against what the registry holds now, not whatever this page last loaded:
  // a save is an upsert per id, so an id missed here would be overwritten there.
  await hydrate();
  const have = new Set(records.map((r) => r.id));
  const fresh = cleaned.filter((r) => !have.has(r.id));
  if (fresh.length > 0) {
    records = [...fresh, ...records];
    persist();
  }
  return { added: fresh.length, alreadyHere: cleaned.length - fresh.length };
};

/**
 * Start over in this browser: stop using the current holder key and clear what is shown.
 *
 * Nothing is sent to the registry. "Clear all records on this device" used to save an
 * empty set to the registry under the holder's key, which a registry that treats a save
 * as the whole set would read as delete-all (attack round D). The records stay on the
 * registry under the old key; the caller makes sure the holder has that key first.
 */
export const startOver = (): void => {
  forgetHolderKey();
  records = [];
  notify();
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useRecords = (): StrainRecord[] => useSyncExternalStore(subscribe, () => records);

/**
 * Seal a record received through a transfer.
 *
 * The recipient did not produce the sender's evidence and cannot claim it, so a
 * received record arrives with no commitment. This creates theirs: a commitment over
 * what they actually received — the material, the quantity, the date, the source.
 */
export const sealReceived = async (id: string): Promise<StrainRecord | undefined> => {
  const r = getRecord(id);
  if (!r || r.recordFingerprint) return r;
  const nonce = newNonce();
  const recordFingerprint = await fingerprintRecord({ ...r, nonce });
  records = records.map((x) => (x.id === id ? { ...x, nonce, recordFingerprint } : x));
  persist();
  notify();
  return getRecord(id);
};

/**
 * Issue a correction.
 *
 * The original is not edited and not deleted — it is marked as superseded and stays on
 * file. A record that can be quietly changed is not evidence, and a record that can be
 * deleted is worse.
 *
 * Severity comes from the SDK, classified by which field changed. It is not a parameter
 * here, deliberately: a caller who could set it would set it to cosmetic.
 */
export const issueCorrection = async (
  originalId: string,
  edits: Partial<StrainRecord>,
  reason: string,
): Promise<StrainRecord | undefined> => {
  const before = getRecord(originalId);
  if (!before) return undefined;

  const { supersedesFor } = await import('veilcore-records');

  const nonce = newNonce();
  // The draft is not sealed yet, so it has no commitment. Typed loosely here for that
  // reason; the sealed record below has one.
  const draft = {
    ...before,
    ...edits,
    id: genId(),
    nonce,
    loggedAt: Date.now(),
    supersededBy: undefined,
  } as StrainRecord;

  const holder = await holderPartyId();
  const supersedes = supersedesFor(toEnvelope(before, holder), await sealEnvelope(draft, holder), reason, 'holder');

  const corrected: StrainRecord = {
    ...draft,
    recordFingerprint: await fingerprintRecord({ ...draft, nonce }),
    supersedes,
  };

  const previous = records;
  records = [corrected, ...records.map((r) => (r.id === originalId ? { ...r, supersededBy: corrected.id } : r))];
  notify();

  // Awaited, not fire-and-forget: a correction only exists once the registry holds both
  // halves. If it refused either, put everything back as it was — locally and on the
  // registry — and say why, rather than showing a correction nobody can verify.
  const result = await store.save(KEY, records);
  const refusedHere = result.refused.filter((x) => x.id === '*' || x.id === corrected.id || x.id === originalId);
  if (!result.offline && refusedHere.length) {
    records = previous;
    notify();
    await store.save(KEY, records);
    await hydrate();
    throw new Error(`The registry refused this correction, so nothing was changed. ${describeRefusals(refusedHere)}`);
  }
  reportSave('records', result);
  if (!result.ok && !result.offline) await hydrate();
  return corrected;
};
