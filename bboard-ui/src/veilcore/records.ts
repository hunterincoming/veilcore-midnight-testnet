// Veilcore record store — persisted to localStorage so a breeder's proof survives a
// browser refresh. Real hashing lives in commitment.ts; this only holds records and
// their status. Simulated settlement in demo mode.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';

export type Attestation = { readonly lab: string; readonly attestedAt: number };

/** A parent strain: linked to a logged record (recordId set) or free-typed (name only). */
export type ParentRef = { readonly recordId?: string; readonly name: string };

export type StrainRecord = {
  readonly id: string; // VEIL-XXXX
  readonly strainName: string;
  readonly bredBy: string;
  readonly dateCreated: string; // breeder's self-asserted claim (not cryptographically proven)
  readonly notes: string;
  readonly loggedAt: number; // sealed timestamp — the un-forgeable moment of logging
  readonly recordFingerprint: string;
  readonly parents?: ParentRef[];
  readonly breedingMethod?: string;
  readonly photoFingerprints?: string[]; // photos hashed locally, never uploaded
  readonly refId?: string; // breeder's own reference / lot ID
  readonly dnaFingerprint?: string;
  readonly dnaFileName?: string;
  readonly dnaPairedAt?: number;
  readonly attestation?: Attestation; // Phase 2.4
  readonly licenseIds?: string[]; // Phase 3
};

export type NewRecordInput = {
  strainName: string;
  bredBy: string;
  dateCreated: string;
  notes: string;
  loggedAt: number;
  recordFingerprint: string;
  parents?: ParentRef[];
  breedingMethod?: string;
  photoFingerprints?: string[];
  refId?: string;
};

/** Records whose id is referenced as a parent by the given record (its children). */
export const childrenOf = (id: string): StrainRecord[] =>
  records.filter((r) => (r.parents ?? []).some((p) => p.recordId === id));

const KEY = 'veilcore.records.v1';

const load = (): StrainRecord[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

let records: StrainRecord[] = load();
const listeners = new Set<() => void>();

const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* ignore quota/availability errors — demo still works in-memory */
  }
  listeners.forEach((l) => l());
};

const genId = (): string =>
  'VEIL-' + Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

export const createRecord = (input: NewRecordInput): StrainRecord => {
  const record: StrainRecord = { id: genId(), licenseIds: [], ...input };
  records = [record, ...records];
  persist();
  return record;
};

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
export const attestRecord = (id: string, lab: string): StrainRecord | undefined => {
  let updated: StrainRecord | undefined;
  records = records.map((r) => {
    if (r.id !== id) return r;
    updated = { ...r, attestation: { lab, attestedAt: Date.now() } };
    return updated;
  });
  if (updated) persist();
  return updated;
};

export const getRecord = (id: string): StrainRecord | undefined => records.find((r) => r.id === id);

export const allRecords = (): StrainRecord[] => records;

/** Backs prove-ownership: does any record's paired DNA fingerprint match this one? */
export const findByDnaFingerprint = (dnaFingerprint: string): StrainRecord | undefined =>
  records.find((r) => r.dnaFingerprint === dnaFingerprint);

/** Conflict detection (Phase 2.3): other records already paired to this same fingerprint. */
export const conflictsFor = (dnaFingerprint: string, exceptId: string): StrainRecord[] =>
  records.filter((r) => r.id !== exceptId && r.dnaFingerprint === dnaFingerprint);

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

export const importRecords = async (file: File): Promise<number> => {
  const parsed = JSON.parse(await file.text());
  if (!Array.isArray(parsed)) throw new Error('That file is not a Veilcore records export.');
  records = parsed;
  persist();
  return records.length;
};

export const resetDemo = (): void => {
  records = [];
  persist();
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useRecords = (): StrainRecord[] => useSyncExternalStore(subscribe, () => records);
