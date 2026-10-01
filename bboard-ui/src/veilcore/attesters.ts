// Attestations, and what they are worth.
//
// "Lab attested" collapses three very different things: an unsigned claim the registry
// recorded, a claim signed by a key, and a claim signed by a key whose holder has named
// an external accreditor. Showing them identically overstates the weakest one, which is
// the same failure as the simulate button.
//
// SPDX-License-Identifier: Apache-2.0

import type { SignedAttestation, AttestationStrength, Retraction } from 'veilcore-records';
import { verifyAttestation } from 'veilcore-records';
import { readJson, isObject, isString } from './json';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export type ResolvedAttestation = SignedAttestation & {
  strength: AttestationStrength;
  /**
   * True only when the registry operator has checked who holds this key. Absent from
   * older registry versions, which is read as false.
   */
  vettedAttester?: boolean;
  registeredAs: {
    displayName?: string;
    /** The attester's own claim, recorded and not verified. */
    accreditation?: { scheme: string; identifier: string; accreditor: string };
    vetted?: boolean;
  } | null;
  retraction: Retraction | null;
  /** Verified in this browser, not taken from the registry's word for it. */
  signatureValid: boolean;
};

/** What arrives from the registry: everything except the locally computed flag. */
type IncomingAttestation = Omit<ResolvedAttestation, 'signatureValid'>;

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
  if (!isString(v.strength)) return false;
  if (!isObject(v.attester) || !isString(v.attester.publicKey)) return false;
  if (v.registeredAs !== null && !isObject(v.registeredAs)) return false;
  if (v.retraction !== null && !(isObject(v.retraction) && isString(v.retraction.retractedAt))) return false;
  return true;
};

/** Every attestation about a record. Verified locally before being shown. */
export const attestationsFor = async (commitment?: string): Promise<ResolvedAttestation[]> => {
  if (!commitment) return [];
  try {
    const res = await fetch(`${BASE}/attestations/subject/${encodeURIComponent(commitment)}`);
    if (!res.ok) return [];
    const body = await readJson(res);
    if (!isObject(body) || !Array.isArray(body.attestations)) return [];
    const incoming = body.attestations.filter(isIncomingAttestation);

    return await Promise.all(
      incoming.map(async (a) => ({
        ...a,
        // The registry saying a signature is valid is not evidence. Checking it here is.
        signatureValid: await verifyAttestation(a),
      })),
    );
  } catch {
    return [];
  }
};

/** What to tell a breeder about how much an attestation is worth. */
export const strengthLabel = (a: ResolvedAttestation): { label: string; why: string; ok: boolean } => {
  if (a.retraction) {
    return {
      label: 'Retracted',
      why: `The attester withdrew this on ${new Date(a.retraction.retractedAt).toLocaleDateString()}. It remains on record — retraction is not deletion.`,
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
  // Only a key the registry operator has checked is described as the party it names.
  // Anyone can register a key under a lab's name and sign their own record, and the
  // accreditation inside an attestation is whatever the signer typed — "Signed ·
  // accredited attester" used to be shown on exactly that (attack round 11).
  if (a.strength !== 'unsigned' && a.vettedAttester === true) {
    const acc = a.registeredAs?.accreditation;
    return {
      label: 'Signed · checked by VeilCore',
      why: `Signed by ${a.registeredAs?.displayName ?? 'a second party'}. VeilCore has checked that this key belongs to them.${acc ? ` They list ${acc.scheme} accreditation from ${acc.accreditor}; confirm that with ${acc.accreditor}.` : ''}`,
      ok: true,
    };
  }
  if (a.strength !== 'unsigned') {
    return {
      label: 'Signed · signer not verified',
      why: a.registeredAs?.displayName
        ? `Signed by a key self-registered as “${a.registeredAs.displayName}” — not verified by VeilCore. Anyone can register a key under any name, so this does not show who signed.`
        : 'Signed by a key nobody has registered. The signature is valid; who holds the key is not known.',
      ok: false,
    };
  }
  return {
    label: 'Unsigned',
    why: 'Recorded but not signed. This is a claim about a second party rather than a statement by one.',
    ok: false,
  };
};
