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
  Envelope,
  Anchor,
  Attestation,
  ParentRef,
  Terms,
  Supersedes,
  JurisdictionBinding,
  SubjectType,
} from 'veilcore-records';
export { FORMAT_VERSION, COMMITMENT_ALGORITHM } from 'veilcore-records';

import type { Envelope, Attestation, Anchor, InclusionProof } from 'veilcore-records';
import { computeCommitment } from 'veilcore-records';
import { FORMAT_VERSION, COMMITMENT_ALGORITHM } from 'veilcore-records';
import type { StrainRecord } from './records';
import { committedRecordFields } from './commitment';

/** The profile every new record is sealed under: plant varieties, any crop. */
export const PLANT_VARIETY_PROFILE = 'veilcore/profile/plant-variety/v1';

/**
 * What records sealed before 3 October 2026 were exported under. Those records carry no
 * `profile` field; their envelope keeps this profile and taxon so that an export made
 * today matches one made when they were sealed. Only new records change.
 */
const LEGACY_PROFILE = 'veilcore/profile/cannabis/v0.1';
const LEGACY_TAXON = 'Cannabis sativa';

/** The profile a record was sealed under. */
export const profileOf = (r: Pick<StrainRecord, 'profile'>): string => r.profile ?? LEGACY_PROFILE;

/** The taxon a record carries: what its holder entered, or none. Legacy records keep theirs. */
const taxonOf = (r: Pick<StrainRecord, 'profile' | 'taxon'>): string | undefined =>
  r.profile ? r.taxon || undefined : LEGACY_TAXON;

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
    profile: profileOf(r),
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
      taxon: taxonOf(r),
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
export const sealEnvelope = async (r: StrainRecord, holderId: string, anchor?: Partial<Anchor>): Promise<Envelope> => {
  const draft = toEnvelope(r, holderId, anchor);
  const commitment = await computeCommitment(draft);
  return { ...draft, commitment };
};

/** The extension that ties an exported envelope to what the registry stores and anchors. */
export const REGISTERED_EXTENSION = 'org.veilcore.registered-fingerprint';

type CheckedProof = { status: 'none' } | { status: 'pending' | 'anchor-reported'; proof: InclusionProof };

const LEDGER_NETWORKS: readonly Anchor['network'][] = ['mainnet', 'preview', 'preprod'];

/**
 * The envelope a holder downloads (attack round D).
 *
 * The registry stores, batches and anchors the record's own fingerprint: SHA-256 over
 * the canonical app fields (commitment.ts). The envelope's `commitment` is computed over
 * the envelope, so it is a different value, and an export used to carry only that one:
 * nothing in the file could be tied to the anchor. Now the export carries, inside the
 * committed `extensions`, the registered fingerprint and the exact fields it covers, so
 * anyone can recompute it (sha256 over canonicalise(fields)) and match it to the leaf
 * of an inclusion proof. The anchor, which is not committed, is filled from an
 * inclusion proof that was checked against that fingerprint, and says it is the
 * registry's report.
 *
 * A DNA report paired after sealing is not covered by the registered fingerprint, and
 * the export used to put it under the original sealing date. `sealedAt` is now the
 * latest time any committed content was added, and the extension names what the
 * registered fingerprint covers and what it does not.
 */
export const exportEnvelopeFor = async (
  r: StrainRecord,
  holderId: string,
  integrity: 'match' | 'mismatch' | 'unsealed' | 'no-nonce',
  proof: CheckedProof,
): Promise<Envelope> => {
  if (integrity === 'mismatch') {
    throw new Error(
      `${r.id}: its fingerprint does not match its stored fields, so an export could not be tied to what the registry holds. Nothing was exported.`,
    );
  }
  const base = toEnvelope(r, holderId);
  const pairedLater = r.dnaFingerprint && r.dnaPairedAt && r.dnaPairedAt > r.loggedAt ? r.dnaPairedAt : undefined;

  const registered =
    r.recordFingerprint && integrity === 'match' && r.nonce
      ? {
          fingerprint: r.recordFingerprint,
          algorithm: COMMITMENT_ALGORITHM,
          recompute: 'sha256 over the canonical serialisation (SPEC section 3) of `fields`',
          fields: committedRecordFields({ ...r, nonce: r.nonce }),
          sealedAt: rfc3339(r.loggedAt),
          notCovered: [
            ...(r.dnaFingerprint
              ? [`identification.reportHash (DNA report paired ${rfc3339(r.dnaPairedAt ?? r.loggedAt)}, after sealing)`]
              : []),
          ],
        }
      : r.recordFingerprint
        ? {
            fingerprint: r.recordFingerprint,
            algorithm: COMMITMENT_ALGORITHM,
            recompute: 'not possible: this record predates stored nonces',
          }
        : undefined;

  const reported = proof.status === 'anchor-reported' ? proof.proof.anchor : undefined;
  const anchor: Partial<Anchor> | undefined =
    reported && LEDGER_NETWORKS.includes(reported.network as Anchor['network'])
      ? {
          kind: 'ledger',
          chain: reported.chain,
          network: reported.network as Anchor['network'],
          ...(reported.contractAddress ? { contractAddress: reported.contractAddress } : {}),
          ...(reported.txHash ? { txHash: reported.txHash } : {}),
          ...(reported.anchoredAt ? { anchoredAt: reported.anchoredAt } : {}),
          commitmentAlgorithm: `${REGISTERED_EXTENSION}: the anchored leaf is extensions["${REGISTERED_EXTENSION}"].fingerprint, in batch ${proof.status === 'anchor-reported' ? proof.proof.batchId : ''} (SPEC section 5). Reported by the registry; not looked up on the chain by the app that exported this.`,
        }
      : undefined;

  const draft: Envelope = {
    ...base,
    anchor: { ...base.anchor, ...anchor },
    ...(pairedLater ? { sealedAt: rfc3339(pairedLater) } : {}),
    ...(registered ? { extensions: { [REGISTERED_EXTENSION]: registered } } : {}),
  };
  return { ...draft, commitment: await computeCommitment(draft) };
};
