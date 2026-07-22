// Veilcore licensing store — a license is a first-class instrument with a lifecycle,
// bound to a strain record and its DNA fingerprint so the terms travel with the
// genetics. Persisted to localStorage. Records obligations; never moves money.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';

export type LicenseState = 'draft' | 'sent' | 'active' | 'expired' | 'revoked';

export type Rights = 'cultivate' | 'cultivate+propagate' | 'full-transfer';
export type UnitBasis = 'per-plant' | 'per-harvest' | 'per-unit-sold';

export type LicenseTerms = {
  licensee: string;
  rights: Rights;
  territory: string;
  startDate: string;
  endDate: string;
  royaltyType: 'percent' | 'flat';
  royaltyAmount: string; // percent value or flat fee
  unitBasis: UnitBasis;
  sublicensable: boolean;
  exclusive: boolean;
  extraTerms: string;
};

export type RoyaltyEntry = { at: number; input: number; note: string; amountOwed: number };

export type License = {
  id: string; // LIC-XXXX
  recordId: string;
  recordFingerprint: string;
  dnaFingerprint?: string;
  terms: LicenseTerms;
  agreementFingerprint: string;
  state: LicenseState;
  createdAt: number;
  breederSignedAt?: number;
  licenseeSignedAt?: number;
  revokedAt?: number;
  revokedReason?: string;
  supersedesId?: string;
  royaltyLog: RoyaltyEntry[];
};

const KEY = 'veilcore.licenses.v1';

const load = (): License[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

let licenses: License[] = load();
const listeners = new Set<() => void>();
const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(licenses));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
};

const genId = (): string =>
  'LIC-' + Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/** The true, current status — computes expiry from the terms so state is never stale. */
export const effectiveState = (l: License): LicenseState => {
  if (l.state === 'active' && l.terms.endDate && Date.parse(l.terms.endDate) < Date.now()) return 'expired';
  return l.state;
};

export type NewLicenseInput = {
  recordId: string;
  recordFingerprint: string;
  dnaFingerprint?: string;
  terms: LicenseTerms;
  agreementFingerprint: string;
};

export const createLicense = (input: NewLicenseInput): License => {
  const lic: License = { id: genId(), state: 'draft', createdAt: Date.now(), royaltyLog: [], ...input };
  licenses = [lic, ...licenses];
  persist();
  return lic;
};

const update = (id: string, patch: (l: License) => License): License | undefined => {
  let out: License | undefined;
  licenses = licenses.map((l) => {
    if (l.id !== id) return l;
    out = patch(l);
    return out;
  });
  if (out) persist();
  return out;
};

/** Breeder signs and issues → awaiting counter-signature. */
export const issueLicense = (id: string): License | undefined =>
  update(id, (l) => ({ ...l, state: 'sent', breederSignedAt: Date.now() }));

/** Licensee counter-signs → Active only when both signatures exist. */
export const countersignLicense = (id: string): License | undefined =>
  update(id, (l) => ({
    ...l,
    licenseeSignedAt: Date.now(),
    state: l.breederSignedAt ? 'active' : l.state,
  }));

export const revokeLicense = (id: string, reason: string): License | undefined =>
  update(id, (l) => ({ ...l, state: 'revoked', revokedAt: Date.now(), revokedReason: reason }));

/** Renewal/amendment: supersede rather than mutate a signed license. */
export const renewLicense = (id: string, terms: LicenseTerms, agreementFingerprint: string): License | undefined => {
  const prev = licenses.find((l) => l.id === id);
  if (!prev) return undefined;
  const next = createLicense({
    recordId: prev.recordId,
    recordFingerprint: prev.recordFingerprint,
    dnaFingerprint: prev.dnaFingerprint,
    terms,
    agreementFingerprint,
  });
  return update(next.id, (l) => ({ ...l, supersedesId: id }));
};

export const addRoyalty = (id: string, input: number, amountOwed: number, note: string): License | undefined =>
  update(id, (l) => ({ ...l, royaltyLog: [{ at: Date.now(), input, amountOwed, note }, ...l.royaltyLog] }));

export const getLicense = (id: string): License | undefined => licenses.find((l) => l.id === id);
export const allLicenses = (): License[] => licenses;
export const licensesForRecord = (recordId: string): License[] => licenses.filter((l) => l.recordId === recordId);
export const activeLicenseCount = (recordId: string): number =>
  licenses.filter((l) => l.recordId === recordId && effectiveState(l) === 'active').length;

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useLicenses = (): License[] => useSyncExternalStore(subscribe, () => licenses);

// display helpers
export const RIGHTS_LABEL: Record<Rights, string> = {
  cultivate: 'Cultivate only',
  'cultivate+propagate': 'Cultivate + propagate',
  'full-transfer': 'Full transfer',
};
export const STATE_LABEL: Record<LicenseState, string> = {
  draft: 'Draft',
  sent: 'Sent — awaiting counter-signature',
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};
