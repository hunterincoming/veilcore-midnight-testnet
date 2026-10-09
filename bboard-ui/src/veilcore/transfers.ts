// Sending a cultivar to someone.
//
// This is the moment provenance is actually established. Everything before a transfer
// is the holder's own claim; a transfer is the first point a second party is involved,
// and their confirmation of receipt is what makes the record evidence rather than a
// note someone wrote about themselves.
//
// SPDX-License-Identifier: Apache-2.0

import { holderKey, holderKeyIfAny } from './holder';
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
export type ClaimResult = {
  recordId: string;
  descendedFrom: string;
  /** The source record's commitment as the registry gave it with the claim, when it did. */
  parentCommitment?: string;
  quantity?: string;
};

export const claimTransfer = async (
  transferId: string,
  claimCode?: string,
): Promise<ClaimResult | { error: string }> => {
  try {
    const res = await fetch(`${BASE}/transfers/${encodeURIComponent(transferId)}/claim`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify(claimCode ? { claimCode } : {}),
    });
    const body = await readJson(res);
    if (!isObject(body)) return unexpected;
    if (isString(body.recordId) && isString(body.descendedFrom)) {
      return {
        recordId: body.recordId,
        descendedFrom: body.descendedFrom,
        ...(isString(body.parentCommitment) ? { parentCommitment: body.parentCommitment } : {}),
        ...(isString(body.quantity) ? { quantity: body.quantity } : {}),
      };
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
  // Nothing was ever sent from a browser with no key; do not make one to ask.
  if (!holderKeyIfAny()) return [];
  try {
    const res = await fetch(`${BASE}/transfers/sent`, { headers: auth() });
    if (!res.ok) return [];
    return arrayField(await readJson(res), 'transfers', isSentTransfer);
  } catch {
    return [];
  }
};

/**
 * The fingerprint the public verify endpoint reports for a record, or null. Used to
 * cross-check the source commitment a lab is about to sign: still the registry's word,
 * but two of its answers have to agree before a lab key signs anything.
 */
export const publicFingerprintOf = async (recordId: string): Promise<string | null> => {
  try {
    const res = await fetch(`${BASE}/verify/${encodeURIComponent(recordId)}?show=`);
    if (!res.ok) return null;
    const body = await readJson(res);
    return isObject(body) && isString(body.recordFingerprint) ? body.recordFingerprint : null;
  } catch {
    return null;
  }
};

const HEX64 = /^[0-9a-f]{64}$/;

/** What the lab is asked to sign, shown in full before it does. */
export type CustodySubject = {
  receivedRecordId: string;
  receivedRecordFingerprint: string;
  sourceRecordId: string;
  sourceCommitment: string;
  cultivar: string;
  quantity?: string;
};

/**
 * Work out what a chain-of-custody signature would be over, or why nothing should be
 * signed. Every source of the source commitment has to agree: the record the claim
 * created, the claim's own answer, and the public verify endpoint.
 */
export const custodySubject = (input: {
  receivedRecordId: string;
  sealed?: {
    recordFingerprint?: string;
    receivedFromCommitment?: string;
    receivedFrom?: string;
    strainName?: string;
    quantity?: string;
  };
  claim: { descendedFrom: string; parentCommitment?: string };
  publicFingerprint: string | null;
}): CustodySubject | { refuse: string } => {
  const { sealed, claim, publicFingerprint } = input;
  const c = sealed?.receivedFromCommitment;
  if (!sealed || !c || !HEX64.test(c))
    return { refuse: 'The registry did not say which record this came from, so there is nothing to sign.' };
  if (!sealed.recordFingerprint)
    return { refuse: 'Your received record could not be sealed, so there is nothing to sign it against.' };
  if (sealed.receivedFrom !== undefined && sealed.receivedFrom !== claim.descendedFrom) {
    return { refuse: 'The registry named two different source records for this transfer. Nothing was signed.' };
  }
  if (claim.parentCommitment !== undefined && claim.parentCommitment !== c) {
    return { refuse: 'The registry gave two different fingerprints for the source record. Nothing was signed.' };
  }
  if (publicFingerprint !== c) {
    return {
      refuse:
        publicFingerprint === null
          ? 'The source record’s fingerprint could not be confirmed from the public registry, so nothing was signed.'
          : 'The source record’s public fingerprint does not match the one given with the transfer. Nothing was signed.',
    };
  }
  return {
    receivedRecordId: input.receivedRecordId,
    receivedRecordFingerprint: sealed.recordFingerprint,
    sourceRecordId: claim.descendedFrom,
    sourceCommitment: c,
    cultivar: sealed.strainName ?? '',
    ...(sealed.quantity ? { quantity: sealed.quantity } : {}),
  };
};
