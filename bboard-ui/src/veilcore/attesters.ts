// Attestations, and what they are worth.
//
// "Lab attested" collapses three very different things: an unsigned claim the registry
// recorded, a claim signed by a key, and a claim signed by a key whose holder has named
// an external accreditor. Showing them identically overstates the weakest one, which is
// the same failure as the simulate button.
//
// Two checks are made here rather than taken from the registry (attack round D):
//   - an attestation counts for a record only if it names that record's commitment.
//     A genuine signature is about whatever it names; one about record X was shown on
//     record Y because nothing compared the two;
//   - a retraction counts only if the attester signed it. An unsigned "retraction" in
//     the registry's answer used to make a genuine attestation read as withdrawn.
//
// What is still the registry's word: whether VeilCore has checked who holds a key
// (`vettedAttester`). That is a statement by the operator, labelled as one.
//
// SPDX-License-Identifier: Apache-2.0

import type { SignedAttestation, AttestationStrength, Retraction } from 'veilcore-records';
import { verifyAttestation, verifyRetraction } from 'veilcore-records';
import { readJson, isObject, isString } from './json';

const BASE = import.meta.env.VITE_API_BASE ?? '';

const HEX64 = /^[0-9a-f]{64}$/;

export type ResolvedAttestation = SignedAttestation & {
  strength: AttestationStrength;
  /**
   * True only when the registry operator has checked who holds this key. Absent from
   * older registry versions, which is read as false. The registry's word.
   */
  vettedAttester?: boolean;
  registeredAs: {
    displayName?: string;
    /** The attester's own claim, recorded and not verified. */
    accreditation?: { scheme: string; identifier: string; accreditor: string } | null;
    vetted?: boolean;
  } | null;
  /** A retraction, present only when its signature verified against this attestation. */
  retraction: Retraction | null;
  /**
   * The registry reported a retraction that does not verify (unsigned, or signed by a
   * key other than the attester's). It is not honoured, and is reported as what it is.
   */
  retractionUnverified?: boolean;
  /** Verified in this browser, not taken from the registry's word for it. */
  signatureValid: boolean;
};

/** What arrives from the registry, before anything is checked. */
type IncomingAttestation = Omit<ResolvedAttestation, 'signatureValid' | 'retractionUnverified' | 'retraction'> & {
  retraction: unknown;
};

/**
 * The fields the display and the signature check actually read.
 *
 * A malformed member is dropped rather than rendered. Showing an attestation whose
 * shape we could not confirm would put a row on screen that says something about a
 * record without anything behind it, which is the failure this module exists to
 * avoid in the first place.
 */
const isIncomingAttestation = (v: unknown): v is IncomingAttestation => {
  if (!isObject(v)) return false;
  if (!isString(v.attestationId) || !isString(v.subjectCommitment)) return false;
  if (!isString(v.strength) || !isString(v.issuedAt)) return false;
  if (!isObject(v.attester) || !isString(v.attester.publicKey)) return false;
  if (v.registeredAs !== null && v.registeredAs !== undefined && !isObject(v.registeredAs)) return false;
  return true;
};

const isRetractionShape = (v: unknown): v is Retraction =>
  isObject(v) &&
  isString(v.attestationId) &&
  isString(v.attesterPublicKey) &&
  isString(v.reason) &&
  isString(v.retractedAt) &&
  isString(v.signature);

/** A retraction counts only if the attester's own key signed it, for this attestation. */
const checkRetraction = async (r: unknown, a: SignedAttestation): Promise<Retraction | null> => {
  if (!isRetractionShape(r)) return null;
  if (r.attestationId !== a.attestationId) return null;
  try {
    return (await verifyRetraction(r, a)) ? r : null;
  } catch {
    return null;
  }
};

/**
 * Every attestation about a record, checked here before being shown. Attestations about
 * any other commitment are dropped: they are not about this record.
 */
export const attestationsFor = async (commitment?: string): Promise<ResolvedAttestation[]> => {
  if (!commitment || !HEX64.test(commitment)) return [];
  try {
    const res = await fetch(`${BASE}/attestations/subject/${encodeURIComponent(commitment)}`);
    if (!res.ok) return [];
    const body = await readJson(res);
    if (!isObject(body) || !Array.isArray(body.attestations)) return [];
    const incoming = body.attestations
      .filter(isIncomingAttestation)
      // Bound to the record on screen. A valid signature about another record is a
      // valid signature about another record.
      .filter((a) => a.subjectCommitment === commitment);

    return await Promise.all(
      incoming.map(async (a): Promise<ResolvedAttestation> => {
        const { retraction: reported, ...rest } = a;
        let signatureValid = false;
        try {
          // The registry saying a signature is valid is not evidence. Checking it here is.
          signatureValid = await verifyAttestation(rest);
        } catch {
          signatureValid = false;
        }
        const retraction = reported === null || reported === undefined ? null : await checkRetraction(reported, rest);
        return {
          ...rest,
          signatureValid,
          retraction,
          retractionUnverified: reported !== null && reported !== undefined && retraction === null,
        };
      }),
    );
  } catch {
    return [];
  }
};

/** Signed, verified here, bound to the record, and not withdrawn by its signer. */
export const countsAsSigned = (a: ResolvedAttestation): boolean => a.signatureValid && a.retraction === null;

/** What to tell a breeder about how much an attestation is worth. */
export const strengthLabel = (a: ResolvedAttestation): { label: string; why: string; ok: boolean } => {
  if (!a.signature) {
    return {
      label: 'Unsigned',
      why: 'Recorded but not signed. This is a claim about a second party rather than a statement by one.',
      ok: false,
    };
  }
  if (!a.signatureValid) {
    return {
      label: 'Signature does not verify',
      why: 'This attestation cannot be shown to have come from the key it names. Treat it as unattested.',
      ok: false,
    };
  }
  if (a.retraction) {
    return {
      label: 'Retracted',
      why: `The attester withdrew this on ${new Date(a.retraction.retractedAt).toLocaleDateString()}, with a retraction signed by their key. It remains on record — retraction is not deletion.`,
      ok: false,
    };
  }
  const unverifiedRetraction = a.retractionUnverified
    ? ' The registry also reports a retraction that is not signed by the attester, so it is ignored here.'
    : '';
  // Only a key the registry operator has checked is described as the party it names.
  // Anyone can register a key under a lab's name and sign their own record, and the
  // accreditation inside an attestation is whatever the signer typed — "Signed ·
  // accredited attester" used to be shown on exactly that (attack round 11).
  if (a.vettedAttester === true) {
    const acc = a.registeredAs?.accreditation;
    return {
      label: 'Signed · checked by VeilCore',
      why: `Signed by ${a.registeredAs?.displayName ?? 'a second party'}; the signature was verified in this browser. VeilCore says it has checked that this key belongs to them.${acc ? ` They list ${acc.scheme} accreditation from ${acc.accreditor}; confirm that with ${acc.accreditor}.` : ''}${unverifiedRetraction}`,
      ok: true,
    };
  }
  return {
    label: 'Signed · signer not verified',
    why:
      (a.registeredAs?.displayName
        ? `Signed by a key self-registered as “${a.registeredAs.displayName}” — not verified by VeilCore. Anyone can register a key under any name, so this does not show who signed.`
        : 'Signed by a key nobody has registered. The signature is valid; who holds the key is not known.') +
      unverifiedRetraction,
    ok: false,
  };
};
