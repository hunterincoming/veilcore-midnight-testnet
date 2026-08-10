// Lineage client — heritable rights over records.
//
// The obligation tree and descent graph live on the server because they are shared
// state: one holder's obligation has to be visible to everyone checking descent, so
// a per-browser copy would disagree with everyone else's.
//
// SPDX-License-Identifier: Apache-2.0

import { holderKey } from './holder';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export type DescentVerdict = {
  readonly ok: boolean;
  readonly reason?: string;
  readonly generationsChecked?: number;
};

export type ObligationResult = {
  readonly oldRoot: string;
  readonly newRoot: string;
};

const post = async (path: string, body: unknown, auth = true): Promise<any> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers['x-holder-key'] = holderKey();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
};

/** Current root of the obligation tree. Reveals nothing on its own. */
export const lineageRoot = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${BASE}/lineage/root`);
    if (!res.ok) return null;
    return (await res.json()).root;
  } catch {
    return null;
  }
};

/** Declare that a record descends from a parent. Public — this is what makes claims checkable. */
export const declareParent = async (child: string, parent: string): Promise<{ edge: string } | null> => {
  try {
    return await post('/lineage/descent', { child, parent });
  } catch {
    return null;
  }
};

/** Attach an obligation to a record you hold. */
export const encumber = async (record: string, obligation: string): Promise<ObligationResult | null> => {
  try {
    return await post('/lineage/obligations', { record, obligation });
  } catch {
    return null;
  }
};

/** Clear an obligation. */
export const discharge = async (record: string, obligation: string): Promise<ObligationResult | null> => {
  try {
    const res = await fetch(`${BASE}/lineage/obligations/${encodeURIComponent(record)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-holder-key': holderKey() },
      body: JSON.stringify({ obligation }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

/**
 * Ask whether a record is clean through its declared ancestry.
 *
 * No authentication — a buyer checks this without an account, and learns only
 * accepted or rejected.
 */
export const verifyDescent = async (record: string, chain: string[]): Promise<DescentVerdict> => {
  try {
    return await post('/lineage/verify', { record, chain }, false);
  } catch {
    return { ok: false, reason: 'could not reach the registry' };
  }
};

/** Declared ancestry of a record, per the public graph. */
export const ancestorsOf = async (record: string): Promise<string[]> => {
  try {
    const res = await fetch(`${BASE}/lineage/ancestors/${encodeURIComponent(record)}`);
    if (!res.ok) return [];
    return (await res.json()).ancestors ?? [];
  } catch {
    return [];
  }
};
