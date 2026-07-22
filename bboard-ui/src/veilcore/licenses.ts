// Veilcore licensing store — a license is a first-class instrument with a lifecycle,
// bound to a strain record and its DNA fingerprint so the terms travel with the
// genetics. Persisted to localStorage. Records obligations; never moves money.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';

export type LicenseState = 'draft' | 'sent' | 'active' | 'expired' | 'revoked';

// An agreement is always the same instrument (same lifecycle, same hash-binding, same
// hub) — `type` only changes which terms it carries and whether money is in play.
export type AgreementType = 'license' | 'lab-transfer' | 'breeder-share';

export type Rights = 'cultivate' | 'cultivate+propagate' | 'full-transfer';
export type UnitBasis = 'per-plant' | 'per-harvest' | 'per-unit-sold';
export type LabPurpose = 'tissue-culture' | 'propagation' | 'dna-testing' | 'storage';

export type LicenseTerms = {
  // shared across every agreement type
  licensee: string; // the counterparty (licensee / receiving lab / receiving breeder)
  startDate: string;
  endDate: string;
  extraTerms: string;
  // license agreement (commercial deal)
  rights: Rights;
  territory: string;
  royaltyType: 'percent' | 'flat';
  royaltyAmount: string; // percent value or flat fee
  unitBasis: UnitBasis;
  sublicensable: boolean;
  exclusive: boolean;
  // lab transfer (custody, not commerce)
  labPurpose?: LabPurpose;
  noPropagationBeyondPurpose?: boolean;
  onCompletion?: 'return' | 'destroy';
  confidentiality?: boolean;
  // breeder share (sharing a cut)
  mayBreed?: boolean;
  mayDistribute?: boolean;
  attributionRequired?: boolean;
  offspringRoyaltyPct?: string;
};

export type RoyaltyEntry = { at: number; input: number; note: string; amountOwed: number };

export type License = {
  id: string; // LIC-XXXX
  type: AgreementType;
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
    if (!Array.isArray(parsed)) return [];
    // Back-compat: agreements saved before types existed are license agreements.
    return parsed.map((l: License) => ({ ...l, type: l.type ?? 'license' }));
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
  type: AgreementType;
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
    type: prev.type,
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

// ---- Veilcore platform fee ----
// Single source of truth — change this one constant to change the fee everywhere.
export const VEILCORE_FEE_PCT = 3;

/** Veilcore's fee for a given deal value (a calculated obligation, never a charge). */
export const veilcoreFee = (dealValue: number): number => (dealValue * VEILCORE_FEE_PCT) / 100;

/** The deal value a royalty report represents: reported sales (percent) or units × fee (flat). */
export const dealValueOf = (l: License, input: number): number =>
  l.terms.royaltyType === 'percent' ? input : input * (Number(l.terms.royaltyAmount) || 0);

export const FEE_NOTE = `Veilcore fee (${VEILCORE_FEE_PCT}% of deal value) — calculated, not collected.`;

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

// ---- agreement types ----
export const agreementType = (l: License): AgreementType => l.type ?? 'license';

/**
 * Whether the Veilcore fee applies. A license is always commercial. A breeder share is
 * commercial only when it sets an offspring royalty (> 0) — otherwise it's a free share.
 * A lab transfer is custody, never commerce.
 */
export const hasVeilcoreFee = (type: AgreementType, terms?: LicenseTerms): boolean => {
  if (type === 'license') return true;
  if (type === 'breeder-share') return (Number(terms?.offspringRoyaltyPct) || 0) > 0;
  return false;
};

export const AGREEMENT_LABEL: Record<AgreementType, string> = {
  license: 'License agreement',
  'lab-transfer': 'Lab transfer',
  'breeder-share': 'Breeder share',
};

/** The verb-y action label surfaced on the record page and dashboard card. */
export const AGREEMENT_ACTION: Record<AgreementType, string> = {
  license: 'License',
  'lab-transfer': 'Send to a lab',
  'breeder-share': 'Share with a breeder',
};

export const AGREEMENT_TAGLINE: Record<AgreementType, string> = {
  license: 'A commercial licensing deal — rights, territory, royalty, and exclusivity, bound to the genetics.',
  'lab-transfer':
    'Sending your genetics to a lab? Bind the terms to the genetics themselves — so they hold even if the material ends up with someone who never signed.',
  'breeder-share':
    "Sharing a cut with another breeder? Handshakes are how cuts get renamed and sold as someone else's work. Put terms on it.",
};

export const LAB_PURPOSE_LABEL: Record<LabPurpose, string> = {
  'tissue-culture': 'Tissue culture',
  propagation: 'Propagation',
  'dna-testing': 'DNA testing',
  storage: 'Storage',
};

/** What to call the counterparty for a given agreement type. */
export const counterpartyLabel = (type: AgreementType): string =>
  type === 'lab-transfer' ? 'Receiving lab' : type === 'breeder-share' ? 'Receiving breeder' : 'Licensee';

const yesNo = (b?: boolean): string => (b ? 'Yes' : 'No');
const money = (n: number): string => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * The plain-language term rows for an agreement, computed once and reused by the
 * breeder's detail view and the counterparty's counter-sign page so both always agree.
 */
export const agreementRows = (l: License): { k: string; v: string }[] => {
  const t = l.terms;
  const type = agreementType(l);
  const rows: { k: string; v: string }[] = [{ k: counterpartyLabel(type), v: t.licensee || '—' }];

  if (type === 'license') {
    rows.push(
      { k: 'Rights', v: RIGHTS_LABEL[t.rights] },
      { k: 'Territory', v: t.territory || '—' },
      { k: 'Term', v: `${t.startDate} → ${t.endDate}` },
      {
        k: 'Royalty',
        v:
          t.royaltyType === 'percent'
            ? `${t.royaltyAmount || '—'}% ${t.unitBasis}`
            : `${money(Number(t.royaltyAmount) || 0)} ${t.unitBasis}`,
      },
      { k: `Veilcore fee (${VEILCORE_FEE_PCT}% of deal value)`, v: 'calculated, not collected' },
      { k: 'Exclusivity', v: t.exclusive ? 'Exclusive' : 'Non-exclusive' },
      { k: 'Sublicensing', v: t.sublicensable ? 'Allowed' : 'Not allowed' },
    );
  } else if (type === 'lab-transfer') {
    rows.push(
      { k: 'Purpose', v: LAB_PURPOSE_LABEL[t.labPurpose ?? 'tissue-culture'] },
      { k: 'Propagation beyond purpose', v: t.noPropagationBeyondPurpose ? 'Not permitted' : 'Permitted' },
      { k: 'On completion', v: t.onCompletion === 'destroy' ? 'Destroy material' : 'Return material' },
      { k: 'Confidentiality', v: yesNo(t.confidentiality) },
      { k: 'Term', v: `${t.startDate} → ${t.endDate}` },
    );
  } else {
    const offspringRoyalty = Number(t.offspringRoyaltyPct) || 0;
    rows.push(
      { k: 'May breed with it', v: yesNo(t.mayBreed) },
      { k: 'May distribute or sell', v: yesNo(t.mayDistribute) },
      { k: 'Attribution / credit required', v: yesNo(t.attributionRequired) },
      { k: 'Royalty on offspring', v: offspringRoyalty > 0 ? `${t.offspringRoyaltyPct}%` : 'None' },
    );
    // An offspring royalty makes it a commercial deal — the fee applies, same as a license.
    if (offspringRoyalty > 0) {
      rows.push({ k: `Veilcore fee (${VEILCORE_FEE_PCT}% of deal value)`, v: 'calculated, not collected' });
    }
    rows.push({ k: 'Term', v: `${t.startDate} → ${t.endDate}` });
  }

  if (t.extraTerms) rows.push({ k: 'Additional terms', v: t.extraTerms });
  return rows;
};
