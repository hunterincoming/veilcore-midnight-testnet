// The licence as an object with two faces.
//
// Charles's ask was "a public side and a private side, and a selective disclosure
// regime where we can prove properties of it." VeilCore had both halves and no object:
// a public status check, private terms in an app, and nothing a licensee could hold.
//
// This is that object. The public face is what a stranger may verify — that the licence
// exists, its state, and what it was issued against. The private face is the terms,
// disclosed only where the holder grants it.
//
// It is deliberately not a bearer token. The USDA's own plant variety licence template
// grants a nontransferable licence and permits sublicensing only with the grantor's
// prior approval, so transfer is a two-party act — proposed by the holder, approved by
// the issuer.
//
// SPDX-License-Identifier: Apache-2.0

import { fingerprintText } from './commitment';
import type { License, LicenseTerms, AgreementType, LicenseState } from './licenses';
import { createsHeritableObligation, signedByTwoParties } from './licenses';

export const CERT_VERSION = '0.1';

/** What anyone may see without the holder's permission. */
export type PublicFace = {
  readonly certVersion: string;
  readonly licenseId: string;
  readonly agreementFingerprint: string;
  readonly recordFingerprint: string;
  readonly state: LicenseState;
  readonly type: AgreementType;
  readonly issuedAt: number;
  readonly activatedAt?: number;
  readonly revokedAt?: number;
  /**
   * Whether this licence binds descendants. Public deliberately: a buyer downstream
   * needs to know an obligation exists without learning what it is.
   */
  readonly encumbersDescendants: boolean;
  /**
   * True only when the issue and the counter-signature came from two different holder
   * keys. "active" alone means only that it was marked active, which in this version is
   * done from the issuer's own browser.
   */
  readonly countersignedByOtherParty: boolean;
  readonly anchor?: { chain: string; network: string; txHash?: string };
};

/** Disclosure keys. Named after what the recipient learns, not the field revealed. */
export type LicenseGrant =
  | 'existence' // this licence exists and is active
  | 'scope' // what the licensee may do
  | 'territory' // where it applies
  | 'term' // start and end dates
  | 'royalty' // the commercial terms
  | 'offspring' // the obligation on descendants
  | 'parties' // who the counterparty is
  | 'full'; // everything

export type LicenseCertificate = {
  readonly public: PublicFace;
  /** Present only for the grants the holder chose. */
  readonly disclosed: Partial<Record<LicenseGrant, unknown>>;
  readonly grants: LicenseGrant[];
};

const publicFaceOf = (l: License): PublicFace => ({
  certVersion: CERT_VERSION,
  licenseId: l.id,
  agreementFingerprint: l.agreementFingerprint,
  recordFingerprint: l.recordFingerprint,
  state: l.state,
  type: l.type,
  issuedAt: l.createdAt,
  activatedAt: l.licenseeSignedAt,
  revokedAt: l.revokedAt,
  encumbersDescendants: createsHeritableObligation(l.type, l.terms),
  countersignedByOtherParty: signedByTwoParties(l),
});

/**
 * Build a certificate disclosing only the granted facts.
 *
 * Terms the holder did not grant are absent from the object, not hidden in it. A
 * recipient cannot open developer tools and read what they were not given, because it
 * was never assembled.
 */
export const certificateFor = (l: License, grants: LicenseGrant[]): LicenseCertificate => {
  const on = new Set(
    grants.includes('full')
      ? (['existence', 'scope', 'territory', 'term', 'royalty', 'offspring', 'parties'] as LicenseGrant[])
      : grants,
  );

  const t: LicenseTerms = l.terms;
  const disclosed: Partial<Record<LicenseGrant, unknown>> = {};

  if (on.has('existence')) disclosed.existence = { state: l.state, active: l.state === 'active' };
  if (on.has('scope')) disclosed.scope = { rights: t.rights, sublicensable: t.sublicensable, exclusive: t.exclusive };
  if (on.has('territory')) disclosed.territory = t.territory;
  if (on.has('term')) disclosed.term = { startDate: t.startDate, endDate: t.endDate };
  if (on.has('royalty')) disclosed.royalty = { type: t.royaltyType, amount: t.royaltyAmount, basis: t.unitBasis };
  if (on.has('offspring')) disclosed.offspring = { royaltyPct: t.offspringRoyaltyPct ?? null };
  if (on.has('parties')) disclosed.parties = { licensee: t.licensee };
  // What anyone needs to recompute the agreement fingerprint from the full terms. Only
  // with the full terms: with the salt and part of the terms, the rest could be guessed
  // again (attack round D).
  if (grants.includes('full')) {
    disclosed.full = {
      type: l.type,
      terms: t,
      record: l.recordFingerprint,
      ...(l.agreementSalt
        ? {
            salt: l.agreementSalt,
            fingerprintScheme: 'sha256 over canonicalise({ v: "veilcore/agreement/v2", type, terms, record, salt })',
          }
        : { fingerprintScheme: 'unsalted, made before 4 October 2026' }),
    };
  }

  return {
    public: publicFaceOf(l),
    disclosed,
    grants: [...on, ...(grants.includes('full') ? (['full'] as LicenseGrant[]) : [])],
  };
};

/**
 * A hash of a certificate's public face.
 *
 * Not a signature: anyone who edits the public face can recompute it, so it catches an
 * accidental change and nothing deliberate. The export says so. Proving the public face
 * came from the issuer needs it signed with a key the recipient can check; not built.
 */
export const certificateFingerprint = async (cert: LicenseCertificate): Promise<string> =>
  fingerprintText(JSON.stringify(cert.public));

/** Export a certificate as a file the holder can send. */
export const exportCertificate = async (l: License, grants: LicenseGrant[]): Promise<void> => {
  const cert = certificateFor(l, grants);
  const payload = {
    ...cert,
    publicFingerprint: await certificateFingerprint(cert),
    publicFingerprintNote:
      'A hash of the public face, not a signature: anyone who edits the public face can recompute it. Check the state with the issuer.',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${l.id}.license.json`;
  a.click();
  URL.revokeObjectURL(url);
};
