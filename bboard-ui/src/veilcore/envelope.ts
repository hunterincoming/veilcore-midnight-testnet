// The VeilCore record envelope — the wire format.
//
// The app's internal record shape is convenient for the app. This is the format that
// leaves it: domain-blind envelope, swappable profile, and a commitment any
// implementation can recompute without the Compact toolchain or a Midnight runtime.
//
// Keeping these separate is deliberate. The internal model can change freely; the wire
// format is the thing other registries build against, and it changes only by version.
// SPDX-License-Identifier: Apache-2.0

/**
 * Types come from the published package, not from here.
 *
 * The app is the reference implementation of this format, which means it has to conform
 * to the published spec rather than to its own idea of it. Redefining the types locally
 * is how a reference implementation quietly stops being one.
 */
export type {
  Envelope, Anchor, Attestation, ParentRef, Terms, Supersedes, JurisdictionBinding, SubjectType,
} from 'veilcore-records';
export { FORMAT_VERSION, COMMITMENT_ALGORITHM } from 'veilcore-records';

import type { Envelope, Attestation, ParentRef, Anchor } from 'veilcore-records';
import { computeCommitment } from 'veilcore-records';
import { FORMAT_VERSION, COMMITMENT_ALGORITHM } from 'veilcore-records';
import type { StrainRecord } from './records';

export const CANNABIS_PROFILE = 'veilcore/profile/cannabis/v0.1';

const rfc3339 = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Emit a record in envelope form.
 *
 * Photo hashes become a `self-documentation` attestation rather than a profile field:
 * committing the hash of a photo discloses nothing and is useful evidence, but the
 * image itself is a disclosure risk and never belongs in the record.
 */
export const toEnvelope = (r: StrainRecord, holderId: string, anchor?: Partial<Anchor>): Envelope => {
  const attestations: Attestation[] = [];

  if (r.dnaFingerprint) {
    attestations.push({
      attestationId: `${r.id}-dna`,
      type: 'genetic-fingerprint',
      attester: { id: r.attestation?.lab ? `lab:${r.attestation.lab}` : 'unattested', displayName: r.attestation?.lab },
      documentHash: r.dnaFingerprint,
      hashAlgorithm: 'sha256',
      issuedAt: rfc3339(r.dnaPairedAt ?? r.loggedAt),
    });
  }

  for (const [i, hash] of (r.photoFingerprints ?? []).entries()) {
    attestations.push({
      attestationId: `${r.id}-photo-${i}`,
      type: 'self-documentation',
      attester: { id: holderId },
      documentHash: hash,
      hashAlgorithm: 'sha256',
      issuedAt: rfc3339(r.loggedAt),
    });
  }

  return {
    formatVersion: FORMAT_VERSION,
    recordId: r.id,
    subjectType: 'plant-genetic-material',
    profile: CANNABIS_PROFILE,
    commitment: r.recordFingerprint,
    commitmentAlgorithm: COMMITMENT_ALGORITHM,
    anchor: {
      chain: 'midnight',
      network: 'undeployed',
      ...anchor,
    },
    sealedAt: rfc3339(r.loggedAt),
    holder: { id: holderId },

    // What every subject has, whatever domain it comes from. These moved out of
    // profileData and into the envelope so that a herd book or a culture collection
    // adopting this format does not have to redefine them.
    subject: {
      name: r.strainName,
      originator: r.bredBy || undefined,
      taxon: 'Cannabis sativa',
      internalDesignation: r.refId || undefined,
      // The holder's own claim about when it came into existence, distinct from
      // sealedAt. The field a prior-possession argument turns on.
      claimedCreationDate: r.dateCreated || undefined,
    },

    // Committed, never published. This is what lets a holder show identification data
    // to one recipient and prove afterwards that it is what was sealed.
    identification: r.dnaFingerprint
      ? {
          method: 'molecular-marker' as const,
          reportHash: r.dnaFingerprint,
          performedOn: r.dnaPairedAt ? rfc3339(r.dnaPairedAt) : undefined,
        }
      : undefined,
    parents: (r.parents ?? []).map((p) => ({
      parentRecordId: p.recordId,
      name: p.name,
      declaredBy: 'holder' as const,
      verified: false,
    })),
    attestations,
    // What is specific to this domain, and nothing more. Everything universal moved
    // to the envelope above.
    profileData: {
      breedingMethod: r.breedingMethod || undefined,
      notes: r.notes || undefined,
      nonce: r.nonce,
    },
  };
};

/**
 * Build an envelope and compute its commitment over the envelope itself.
 *
 * The commitment must cover what is published, not what happens to be in local state.
 * Committing over internal field names would mean an outside verifier could only check
 * a record if it knew our private schema — and the internal shape could never change
 * without invalidating every record ever issued.
 */
export const sealEnvelope = async (
  r: StrainRecord,
  holderId: string,
  anchor?: Partial<Anchor>,
): Promise<Envelope> => {
  const draft = toEnvelope(r, holderId, anchor);
  const commitment = await computeCommitment(draft);
  return { ...draft, commitment };
};
