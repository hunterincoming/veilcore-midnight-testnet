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
// SPDX-License-Identifier: Apache-2.0

import type { InclusionProof } from 'veilcore-records';
import { verifyInclusion } from 'veilcore-records';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export type ProofState =
  | { status: 'none' }                                  // not yet batched
  | { status: 'pending'; proof: InclusionProof }        // batched, root not yet anchored
  | { status: 'anchored'; proof: InclusionProof };      // root is on chain

/** Fetch a record's inclusion proof, and verify it locally before trusting it. */
export const proofFor = async (commitment?: string): Promise<ProofState> => {
  if (!commitment) return { status: 'none' };
  try {
    const res = await fetch(`${BASE}/proof/${encodeURIComponent(commitment)}`);
    if (!res.ok) return { status: 'none' };
    const proof: InclusionProof = await res.json();

    // Verify before displaying. A registry claiming a record is included is not
    // evidence; the path folding to the root is.
    if (!(await verifyInclusion(proof))) return { status: 'none' };

    return proof.anchor?.txHash ? { status: 'anchored', proof } : { status: 'pending', proof };
  } catch {
    return { status: 'none' };
  }
};

/** Download the proof so the holder keeps their own copy. */
export const downloadProof = (proof: InclusionProof, recordId: string): void => {
  const blob = new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${recordId}.proof.json`;
  a.click();
  URL.revokeObjectURL(url);
};
