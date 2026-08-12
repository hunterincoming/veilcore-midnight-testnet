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

const BASE = import.meta.env.VITE_API_BASE ?? '';

export type ResolvedAttestation = SignedAttestation & {
  strength: AttestationStrength;
  registeredAs: { displayName?: string; accreditation?: { scheme: string; identifier: string; accreditor: string } } | null;
  retraction: Retraction | null;
  /** Verified in this browser, not taken from the registry's word for it. */
  signatureValid: boolean;
};

/** Every attestation about a record. Verified locally before being shown. */
export const attestationsFor = async (commitment?: string): Promise<ResolvedAttestation[]> => {
  if (!commitment) return [];
  try {
    const res = await fetch(`${BASE}/attestations/subject/${encodeURIComponent(commitment)}`);
    if (!res.ok) return [];
    const { attestations } = await res.json();
    return Promise.all(
      (attestations ?? []).map(async (a: ResolvedAttestation) => ({
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
  if (a.strength === 'signed-and-accredited') {
    const acc = a.registeredAs?.accreditation;
    return {
      label: 'Signed · accredited attester',
      why: `Signed by a key registered to ${a.registeredAs?.displayName ?? 'an attester'}, who lists ${acc?.scheme} accreditation ${acc?.identifier} from ${acc?.accreditor}. We record that claim — we do not verify it, and you can check it with ${acc?.accreditor} directly.`,
      ok: true,
    };
  }
  if (a.strength === 'signed') {
    return {
      label: 'Signed',
      why: `Signed by a key${a.registeredAs?.displayName ? ` registered to ${a.registeredAs.displayName}` : ''}. The signature proves the same party issued it; it does not prove who that party is.`,
      ok: true,
    };
  }
  return {
    label: 'Unsigned',
    why: 'Recorded but not signed. This is a claim about a second party rather than a statement by one.',
    ok: false,
  };
};
