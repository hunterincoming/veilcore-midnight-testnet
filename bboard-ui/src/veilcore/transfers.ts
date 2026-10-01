// Sending a cultivar to someone.
//
// This is the moment provenance is actually established. Everything before a transfer
// is the holder's own claim; a transfer is the first point a second party is involved,
// and their confirmation of receipt is what makes the record evidence rather than a
// note someone wrote about themselves.
//
// SPDX-License-Identifier: Apache-2.0

import { holderKey } from './holder';
import { readJson, isObject, isString, isNumber, optional, arrayField } from './json';

const BASE = import.meta.env.VITE_API_BASE ?? '';

/**
 * The public pending list no longer carries the source record, quantity or note
 * (attack round 11): they are optional here so either server version parses. The sent
 * list, which needs the holder key, still has the source.
 */
export type PendingTransfer = {
  readonly id: string;
  readonly source_record?: string;
  readonly to_handle: string;
  readonly created_at: number;
  readonly quantity?: string;
  readonly note?: string;
};

export type SentTransfer = PendingTransfer & { readonly claimed_at?: number };

const isPendingTransfer = (v: unknown): v is PendingTransfer =>
  isObject(v) &&
  isString(v.id) &&
  optional(v.source_record, isString) &&
  isString(v.to_handle) &&
  isNumber(v.created_at) &&
  optional(v.quantity, isString) &&
  optional(v.note, isString);

const isSentTransfer = (v: unknown): v is SentTransfer =>
  isPendingTransfer(v) && optional((v as Record<string, unknown>).claimed_at, isNumber);

const auth = () => ({ 'Content-Type': 'application/json', 'x-holder-key': holderKey() });

/**
 * A response that is either a result or a stated error.
 *
 * A body matching neither is treated as an error rather than passed on: the caller
 * has no way to tell the difference between a field that is missing and one that
 * never existed, so saying so here is the only place it can be said usefully.
 */
const unexpected = { error: 'unexpected response from the registry' } as const;

/**
 * What the sender hands the recipient: the transfer id and its secret claim code in one
 * string, so there is one thing to copy. The registry requires the code to claim (only
 * transfers made before it existed claim without one), and the app used to show and
 * send only the id, so no transfer made in the app could be claimed in the app.
 */
export const shareCodeFor = (transferId: string, claimCode?: string): string =>
  claimCode ? `${transferId}.${claimCode}` : transferId;

/** Split a pasted share code back into the id and the claim code. */
export const parseShareCode = (code: string): { transferId: string; claimCode?: string } => {
  const [id, claim] = code.trim().split('.', 2);
  return { transferId: id.toUpperCase(), ...(claim ? { claimCode: claim.toLowerCase() } : {}) };
};

/** Offer a record to a recipient. Nothing moves until they claim it. */
export const offerTransfer = async (
  sourceRecord: string,
  toHandle: string,
  opts: { quantity?: string; note?: string } = {},
): Promise<{ transferId: string; claimCode?: string } | { error: string }> => {
  try {
    const res = await fetch(`${BASE}/transfers`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ sourceRecord, toHandle, ...opts }),
    });
    const body = await readJson(res);
    if (!isObject(body)) return unexpected;
    if (isString(body.transferId)) {
      return { transferId: body.transferId, ...(isString(body.claimCode) ? { claimCode: body.claimCode } : {}) };
    }
    if (isString(body.error)) return { error: body.error };
    return unexpected;
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
  claimCode?: string,
): Promise<{ recordId: string; descendedFrom: string } | { error: string }> => {
  try {
    const res = await fetch(`${BASE}/transfers/${encodeURIComponent(transferId)}/claim`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify(claimCode ? { claimCode } : {}),
    });
    const body = await readJson(res);
    if (!isObject(body)) return unexpected;
    if (isString(body.recordId) && isString(body.descendedFrom)) {
      return { recordId: body.recordId, descendedFrom: body.descendedFrom };
    }
    if (isString(body.error)) return { error: body.error };
    return unexpected;
  } catch {
    return { error: 'could not reach the registry' };
  }
};

/** Transfers waiting for a handle. */
export const pendingFor = async (handle: string): Promise<PendingTransfer[]> => {
  try {
    const res = await fetch(`${BASE}/transfers/pending/${encodeURIComponent(handle)}`);
    if (!res.ok) return [];
    return arrayField(await readJson(res), 'transfers', isPendingTransfer);
  } catch {
    return [];
  }
};

/** Transfers this holder has sent. */
export const sentByMe = async (): Promise<SentTransfer[]> => {
  try {
    const res = await fetch(`${BASE}/transfers/sent`, { headers: auth() });
    if (!res.ok) return [];
    return arrayField(await readJson(res), 'transfers', isSentTransfer);
  } catch {
    return [];
  }
};
