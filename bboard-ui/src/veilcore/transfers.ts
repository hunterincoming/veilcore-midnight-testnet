// Sending a cultivar to someone.
//
// This is the moment provenance is actually established. Everything before a transfer
// is the holder's own claim; a transfer is the first point a second party is involved,
// and their confirmation of receipt is what makes the record evidence rather than a
// note someone wrote about themselves.
//
// SPDX-License-Identifier: Apache-2.0

import { holderKey } from './holder';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export type PendingTransfer = {
  readonly id: string;
  readonly source_record: string;
  readonly to_handle: string;
  readonly created_at: number;
  readonly quantity?: string;
  readonly note?: string;
};

export type SentTransfer = PendingTransfer & { readonly claimed_at?: number };

const auth = () => ({ 'Content-Type': 'application/json', 'x-holder-key': holderKey() });

/** Offer a record to a recipient. Nothing moves until they claim it. */
export const offerTransfer = async (
  sourceRecord: string,
  toHandle: string,
  opts: { quantity?: string; note?: string } = {},
): Promise<{ transferId: string } | { error: string }> => {
  try {
    const res = await fetch(`${BASE}/transfers`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ sourceRecord, toHandle, ...opts }),
    });
    return await res.json();
  } catch {
    return { error: 'could not reach the registry' };
  }
};

/**
 * Claim a transfer offered to you.
 *
 * Claiming is also the attestation: a second party, holding their own key, confirming
 * receipt of a specific record on a specific date.
 */
export const claimTransfer = async (
  transferId: string,
): Promise<{ recordId: string; descendedFrom: string } | { error: string }> => {
  try {
    const res = await fetch(`${BASE}/transfers/${encodeURIComponent(transferId)}/claim`, {
      method: 'POST',
      headers: auth(),
    });
    return await res.json();
  } catch {
    return { error: 'could not reach the registry' };
  }
};

/** Transfers waiting for a handle. */
export const pendingFor = async (handle: string): Promise<PendingTransfer[]> => {
  try {
    const res = await fetch(`${BASE}/transfers/pending/${encodeURIComponent(handle)}`);
    if (!res.ok) return [];
    return (await res.json()).transfers ?? [];
  } catch {
    return [];
  }
};

/** Transfers this holder has sent. */
export const sentByMe = async (): Promise<SentTransfer[]> => {
  try {
    const res = await fetch(`${BASE}/transfers/sent`, { headers: auth() });
    if (!res.ok) return [];
    return (await res.json()).transfers ?? [];
  } catch {
    return [];
  }
};
