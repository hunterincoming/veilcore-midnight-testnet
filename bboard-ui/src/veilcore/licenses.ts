// VeilCore licensing store — a license is a first-class instrument with a lifecycle,
// attached to a cultivar record and its report fingerprint. Saved to the registry.
// Records obligations; never moves money. Signing here records a time, not a
// cryptographic signature, and in the demo settlement is simulated.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react';
import { encumber as encumberRecord, discharge as dischargeRecord } from './lineage';
import { getRecord } from './records';
import { store } from './store';
import { reportSave } from './save-status';
import { holderPartyId } from './holder';
import { canonicalise, newNonce } from './commitment';

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
  // breeder share (sharing material with another breeder)
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
  /**
   * The random salt in the agreement fingerprint (AGREEMENT_FINGERPRINT_V2). Absent on
   * agreements made before it existed, whose fingerprint is unsalted and stays as made.
   */
  agreementSalt?: string;
  state: LicenseState;
  createdAt: number;
  breederSignedAt?: number;
  licenseeSignedAt?: number;
  /** Party id (one-way hash of the holder key) of the browser that issued it. */
  issuedByParty?: string;
  /** Party id of the browser that marked it counter-signed. */
  countersignedByParty?: string;
  revokedAt?: number;
  revokedReason?: string;
  supersedesId?: string;
  royaltyLog: RoyaltyEntry[];
};

/**
 * A stored agreement, checked on the way in.
 *
 * `type` is not required: agreements saved before the field existed are treated as
 * licence agreements a few lines below, and demanding it here would delete them.
 */
const isLicense = (v: unknown): v is License => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const l = v as Record<string, unknown>;
  if (typeof l.id !== 'string') return false;
  const str = (x: unknown) => x === undefined || typeof x === 'string';
  const num = (x: unknown) => x === undefined || typeof x === 'number';
  return (
    str(l.type) &&
    str(l.recordId) &&
    str(l.recordFingerprint) &&
    str(l.agreementFingerprint) &&
    str(l.state) &&
    str(l.dnaFingerprint) &&
    num(l.createdAt) &&
    (l.terms === undefined || (typeof l.terms === 'object' && l.terms !== null)) &&
    (l.royaltyLog === undefined || Array.isArray(l.royaltyLog))
  );
};

const KEY = 'veilcore.licenses.v1';

let licenses: License[] = [];
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

const hydrate = async (): Promise<void> => {
  const loaded = await store.load(KEY, isLicense);
  // Back-compat: agreements saved before types existed are license agreements.
  licenses = loaded.map((l: License) => ({ ...l, type: l.type ?? 'license' }));
  notify();
};

/**
 * Load from the registry. Started by the pages that show agreements, not on import:
 * every page used to load agreements, with a holder key minted for the purpose
 * (attack round D).
 */
let started = false;
/** Forget the agreements shown, after this browser stops using a holder key. Saves nothing. */
export const clearLoadedLicenses = (): void => {
  licenses = [];
  notify();
};

export const startLicenseSync = (): void => {
  if (started) return;
  started = true;
  void hydrate();
};

const persist = () => {
  // A refusal is reported and the set reloaded from the registry, rather than left
  // looking saved (attack round 11).
  void store.save(KEY, licenses).then((result) => {
    reportSave('agreements', result);
    if (!result.ok && !result.offline) void hydrate();
  });
  notify();
};

// 128 random bits: a guessable id could be stored first by someone else, and the
// holder's save of it would then be refused.
const genId = (): string =>
  'LIC-' +
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

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
  agreementSalt?: string;
};

export const AGREEMENT_FINGERPRINT_V2 = 'veilcore/agreement/v2';

/**
 * The agreement fingerprint: SHA-256 over the canonical form of the type, the terms, the
 * record's fingerprint and a random salt (attack round D).
 *
 * It used to be the commit circuit over JSON.stringify of the same three things, with no
 * salt. The public face of a licence shows the fingerprint, the record and the type, and
 * the remaining terms are few and guessable (licensee, territory, a royalty percentage),
 * so the private terms came back from about 700 guesses. JSON.stringify also follows key
 * order, so the same terms could fingerprint differently. The salt is kept with the
 * licence and disclosed only with the full terms, which is what anyone recomputing it
 * needs.
 *
 * Checked before changing it: this value does not reach the Midnight contract (the
 * contract's licence commitment is licenseCommit(secret, record), made from the
 * licensee's own secret) nor the record format (an envelope's Terms.termsHash is not
 * filled from it). The registry stores it as an opaque obligation id. Agreements made
 * before keep the fingerprint they were made with.
 */
export const sealAgreement = async (
  type: AgreementType,
  terms: LicenseTerms,
  recordFingerprint: string,
  salt: string = newNonce(),
): Promise<{ agreementFingerprint: string; agreementSalt: string }> => {
  // Unset optional terms are omitted, which is what canonicalisation requires of an
  // absent value (it refuses undefined rather than guess between absent and null).
  const definedTerms = JSON.parse(JSON.stringify(terms)) as Record<string, unknown>;
  const payload = canonicalise({
    v: AGREEMENT_FINGERPRINT_V2,
    type,
    terms: definedTerms,
    record: recordFingerprint,
    salt,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const agreementFingerprint = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { agreementFingerprint, agreementSalt: salt };
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
export const issueLicense = async (id: string): Promise<License | undefined> => {
  const party = await holderPartyId();
  return update(id, (l) => ({ ...l, state: 'sent', breederSignedAt: Date.now(), issuedByParty: party }));
};

/**
 * Whether two different parties are on record as having acted on this agreement.
 *
 * Nothing here is a cryptographic signature, and the counter-sign page can only load an
 * agreement from the issuer's own registry set, so in this app it is always the issuer
 * who presses "counter-sign" (attack round D). "Both parties have signed" is shown only
 * when the issue and the counter-signature came from two different holder keys, which
 * this version cannot produce; until counter-signing goes through the registry with the
 * other party's own key, an active agreement says it was marked active by the issuer.
 */
export const signedByTwoParties = (l: License): boolean =>
  Boolean(l.issuedByParty && l.countersignedByParty && l.issuedByParty !== l.countersignedByParty);

/** Whether this browser is the one that issued the agreement. */
export const isIssuer = async (l: License): Promise<boolean> =>
  !l.issuedByParty || l.issuedByParty === (await holderPartyId());

/**
 * Licensee counter-signs → Active only when both signatures exist.
 *
 * An agreement carrying an offspring royalty creates a heritable obligation at this
 * moment, using the agreement fingerprint as the commitment. The obligation is a
 * consequence of the agreement rather than a separate thing to remember — nobody
 * should have to attach one by hand.
 */
export const countersignLicense = async (id: string): Promise<License | undefined> => {
  const party = await holderPartyId();
  const out = update(id, (l) => ({
    ...l,
    licenseeSignedAt: Date.now(),
    countersignedByParty: party,
    state: l.breederSignedAt ? 'active' : l.state,
  }));
  if (out && out.state === 'active' && createsHeritableObligation(out.type, out.terms)) {
    const rec = getRecord(out.recordId);
    if (rec) void encumberRecord(rec.recordFingerprint, out.agreementFingerprint);
  }
  return out;
};

/** Revoking an agreement discharges the obligation it created. */
export const revokeLicense = (id: string, reason: string): License | undefined => {
  const before = licenses.find((l) => l.id === id);
  const out = update(id, (l) => ({ ...l, state: 'revoked', revokedAt: Date.now(), revokedReason: reason }));
  if (before && createsHeritableObligation(before.type, before.terms)) {
    const rec = getRecord(before.recordId);
    if (rec) void dischargeRecord(rec.recordFingerprint, before.agreementFingerprint);
  }
  return out;
};

/** Renewal/amendment: supersede rather than mutate a signed license. */
export const renewLicense = (
  id: string,
  terms: LicenseTerms,
  agreementFingerprint: string,
  agreementSalt?: string,
): License | undefined => {
  const prev = licenses.find((l) => l.id === id);
  if (!prev) return undefined;
  const next = createLicense({
    type: prev.type,
    recordId: prev.recordId,
    recordFingerprint: prev.recordFingerprint,
    dnaFingerprint: prev.dnaFingerprint,
    terms,
    agreementFingerprint,
    ...(agreementSalt ? { agreementSalt } : {}),
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

// ---- VeilCore platform fee ----
// Single source of truth — change this one constant to change the fee everywhere.
export const VEILCORE_FEE_PCT = 3;

/** Whether to surface VeilCore's fee in the UI. Off — the revenue model is a
 flat fee and lives in the investor deck, not the product. */
export const SHOW_VEILCORE_FEE = false;

/** VeilCore's fee for a given deal value (a calculated obligation, never a charge). */
export const veilcoreFee = (dealValue: number): number => (dealValue * VEILCORE_FEE_PCT) / 100;

/** The deal value a royalty report represents: reported sales (percent) or units × fee (flat). */
export const dealValueOf = (l: License, input: number): number =>
  l.terms.royaltyType === 'percent' ? input : input * (Number(l.terms.royaltyAmount) || 0);

export const FEE_NOTE = `VeilCore fee (${VEILCORE_FEE_PCT}% of deal value) — calculated, not collected.`;

// display helpers
export const RIGHTS_LABEL: Record<Rights, string> = {
  cultivate: 'Cultivate only',
  'cultivate+propagate': 'Cultivate + propagate',
  'full-transfer': 'Full transfer',
};
export const STATE_LABEL: Record<LicenseState, string> = {
  draft: 'Draft',
  sent: 'Sent — awaiting counter-signature',
  active: 'Marked active',
  expired: 'Expired',
  revoked: 'Revoked',
};

// ---- agreement types ----
export const agreementType = (l: License): AgreementType => l.type ?? 'license';

/**
 * Whether the VeilCore fee applies. A license is always commercial. A breeder share is
 * commercial only when it sets an offspring royalty (> 0) — otherwise it's a free share.
 * A lab transfer is custody, never commerce.
 */
/**
 * Whether an agreement creates an obligation that descendants inherit.
 *
 * Not the same question as hasVeilcoreFee. A licence with no offspring royalty is
 * commercial but binds only the signatories — nothing rides down the lineage. An
 * obligation is heritable exactly when it attaches to offspring, whatever the
 * agreement is called.
 */
export const createsHeritableObligation = (type: AgreementType, terms?: LicenseTerms): boolean =>
  (Number(terms?.offspringRoyaltyPct) || 0) > 0;

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
  license: 'A commercial licensing deal — rights, territory, royalty, and exclusivity, attached to the record.',
  'lab-transfer':
    'Sending your genetics to a lab? Attach the terms to the record and its report fingerprint before it leaves your hands.',
  'breeder-share':
    "Sharing material with another breeder? Handshakes are how varieties get renamed and sold as someone else's work. Put terms on it.",
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
      ...(SHOW_VEILCORE_FEE
        ? [{ k: `VeilCore fee (${VEILCORE_FEE_PCT}% of deal value)`, v: 'calculated, not collected' }]
        : []),
      // Shown explicitly because it is the one term that binds beyond the signatories:
      // it carries to descendants declared from the record, so a counter-signer has to see it.
      {
        k: 'Royalty on offspring',
        v:
          (Number(t.offspringRoyaltyPct) || 0) > 0
            ? `${t.offspringRoyaltyPct}% — on descendants declared from this cultivar`
            : 'None',
      },
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
    if (offspringRoyalty > 0 && SHOW_VEILCORE_FEE) {
      rows.push({ k: `VeilCore fee (${VEILCORE_FEE_PCT}% of deal value)`, v: 'calculated, not collected' });
    }
    rows.push({ k: 'Term', v: `${t.startDate} → ${t.endDate}` });
  }

  if (t.extraTerms) rows.push({ k: 'Additional terms', v: t.extraTerms });
  return rows;
};
