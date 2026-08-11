// The VeilCore record envelope — the wire format.
//
// The app's internal record shape is convenient for the app. This is the format that
// leaves it: domain-blind envelope, swappable profile, and a commitment any
// implementation can recompute without the Compact toolchain or a Midnight runtime.
//
// Keeping these separate is deliberate. The internal model can change freely; the wire
// format is the thing other registries build against, and it changes only by version.
// SPDX-License-Identifier: Apache-2.0

import { COMMITMENT_ALGORITHM } from './commitment';
import type { StrainRecord } from './records';

export const FORMAT_VERSION = '0.1';
export const CANNABIS_PROFILE = 'veilcore/profile/cannabis/v0.1';

/** Where a record's commitment is anchored, if anywhere. */
export type Anchor = {
  readonly chain: 'midnight';
  /** `undeployed` is the honest state for a record sealed locally and never settled. */
  readonly network: 'mainnet' | 'preview' | 'undeployed';
  readonly contractAddress?: string;
  readonly txHash?: string;
  readonly blockHeight?: number;
  readonly anchoredAt?: string;
  /** How the record commitment is bound to this chain. Chain-specific by design. */
  readonly commitmentAlgorithm?: string;
};

export type Attestation = {
  readonly attestationId: string;
  readonly type: 'genetic-fingerprint' | 'laboratory-report' | 'inspection' | 'chain-of-custody' | 'self-documentation' | 'other';
  readonly attester: { readonly id: string; readonly displayName?: string };
  readonly documentHash: string;
  readonly hashAlgorithm: 'sha256';
  readonly issuedAt: string;
  readonly retractedBy?: string;
};

export type ParentRef = {
  readonly parentRecordId?: string;
  readonly parentCommitment?: string;
  readonly role?: string;
  readonly declaredBy: 'holder' | 'attester';
  readonly verified: boolean;
  /** Free-typed parent name where no record exists yet. Profile-level, not envelope. */
  readonly name?: string;
};

export type Envelope = {
  readonly formatVersion: string;
  readonly recordId: string;
  readonly subjectType: 'plant-genetic-material' | 'animal-genetic-material' | 'plant-variety' | 'other';
  readonly profile: string;
  readonly commitment: string;
  readonly commitmentAlgorithm: string;
  readonly anchor: Anchor;
  readonly sealedAt: string;
  readonly holder: { readonly id: string; readonly displayName?: string };
  readonly attestations: Attestation[];
  readonly parents: ParentRef[];
  readonly profileData: Record<string, unknown>;
};

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
    parents: (r.parents ?? []).map((p) => ({
      parentRecordId: p.recordId,
      name: p.name,
      declaredBy: 'holder' as const,
      verified: false,
    })),
    attestations,
    profileData: {
      cultivarName: r.strainName,
      breederName: r.bredBy || undefined,
      breedingMethod: r.breedingMethod || undefined,
      // The breeder's own claim about when the cultivar came into existence, distinct
      // from sealedAt. This is the field a prior-possession argument turns on.
      claimedCreationDate: r.dateCreated || undefined,
      internalReference: r.refId || undefined,
      notes: r.notes || undefined,
      nonce: r.nonce,
    },
  };
};
