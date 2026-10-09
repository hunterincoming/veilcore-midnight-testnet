// Inclusion proofs.
//
// A record's commitment is anchored as part of a batch, not on its own. That is what
// lets a holder settle on chain without running a wallet, and what makes the per-record
// cost of settlement nearly nothing.
//
// The proof is the thing that matters: it carries the path from the record to the batch
// root and a reference to where that root was anchored. A holder keeps it and can prove
// their record's age years later using the published package and a chain lookup —
// whether or not this registry still exists.
//
// What this module can and cannot check (attack round D):
//   - that the proof is about THIS record: its commitment must equal the one asked for.
//     A proof for any other commitment folds to its own root just as well, and was shown
//     as this record's anchor;
//   - that the path folds to the root it names (verifyInclusion, offline);
//   - NOT that the root is on a chain. The site has no chain lookup, so the anchor in a
//     proof is the registry's report and is labelled that way. It is never shown as
//     "Anchored", never printed on a certificate as a fact, and never offered as proof
//     of a date.
//
// SPDX-License-Identifier: Apache-2.0

import type { InclusionProof } from 'veilcore-records';
import { verifyInclusion } from 'veilcore-records';
import { isObject, isString, isBoolean, isNumber } from './json';

const BASE = import.meta.env.VITE_API_BASE ?? '';

const HEX64 = /^[0-9a-f]{64}$/;
/** SPEC section 5: a verifier shall reject a path deeper than 64 rather than fold it. */
const MAX_DEPTH = 64;

export type ProofState =
  /** Not batched yet, or no proof this page could check. */
  | { status: 'none' }
  /** In a sealed batch, checked here; the registry reports no anchor. */
  | { status: 'pending'; proof: InclusionProof }
  /**
   * In a sealed batch, checked here, and the registry REPORTS the batch root was recorded
   * in a transaction. This page has not looked the transaction up, so it is not shown as
   * anchored.
   */
  | { status: 'anchor-reported'; proof: InclusionProof };

/** True when the proof was checked here: bound to the record and folding to its root. */
export const proofChecked = (s: ProofState): s is Exclude<ProofState, { status: 'none' }> => s.status !== 'none';

const isAnchorRef = (v: unknown): boolean =>
  isObject(v) &&
  isString(v.chain) &&
  isString(v.network) &&
  (v.txHash === undefined || isString(v.txHash)) &&
  (v.contractAddress === undefined || isString(v.contractAddress)) &&
  (v.anchoredAt === undefined || isString(v.anchoredAt)) &&
  (v.blockHeight === undefined || isNumber(v.blockHeight));

/** The shape the SDK's verifier reads, checked before it is handed anything. */
export const isInclusionProof = (v: unknown): v is InclusionProof =>
  isObject(v) &&
  isString(v.commitment) &&
  HEX64.test(v.commitment) &&
  isString(v.root) &&
  HEX64.test(v.root) &&
  isString(v.batchId) &&
  (v.sealedAt === undefined || isString(v.sealedAt)) &&
  Array.isArray(v.path) &&
  v.path.length <= MAX_DEPTH &&
  v.path.every((s) => isObject(s) && isString(s.sibling) && HEX64.test(s.sibling) && isBoolean(s.siblingIsLeft)) &&
  (v.anchor === undefined || v.anchor === null || isAnchorRef(v.anchor));

/**
 * Check a proof against the record it is supposed to be about. Exported so an imported
 * or downloaded proof goes through the same check as one fetched from the registry.
 */
export const checkProof = async (commitment: string, body: unknown): Promise<ProofState> => {
  if (!HEX64.test(commitment) || !isInclusionProof(body)) return { status: 'none' };
  // The binding that was missing: a proof about some other commitment says nothing
  // about this record, however well its path folds.
  if (body.commitment !== commitment) return { status: 'none' };
  // A registry claiming a record is included is not evidence; the path folding to the
  // root is.
  if (!(await verifyInclusion(body))) return { status: 'none' };
  return body.anchor?.txHash ? { status: 'anchor-reported', proof: body } : { status: 'pending', proof: body };
};

/** Fetch a record's inclusion proof, and check it here before anything is shown. */
export const proofFor = async (commitment?: string): Promise<ProofState> => {
  // Not a commitment, so there is nothing a proof could be bound to: no request.
  if (!commitment || !HEX64.test(commitment)) return { status: 'none' };
  try {
    const res = await fetch(`${BASE}/proof/${encodeURIComponent(commitment)}`);
    if (!res.ok) return { status: 'none' };
    return await checkProof(commitment, (await res.json()) as unknown);
  } catch {
    return { status: 'none' };
  }
};

/**
 * Download the proof so the holder keeps their own copy. What it shows is said in the
 * file itself: inclusion in a batch, checked; the anchor, the registry's report.
 */
export const downloadProof = (proof: InclusionProof, recordId: string): void => {
  const out = {
    ...proof,
    note:
      'Inclusion proof: the path from this commitment to the batch root was checked in the browser that saved it. ' +
      'The anchor, if present, is what the registry reported; look the transaction up on the named network to ' +
      'confirm the root is there before relying on any date.',
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${recordId}.proof.json`;
  a.click();
  URL.revokeObjectURL(url);
};
