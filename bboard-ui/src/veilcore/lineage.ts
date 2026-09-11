// Lineage client — heritable rights over records.
//
// The obligation tree and descent graph live on the server because they are shared
// state: one holder's obligation has to be visible to everyone checking descent, so
// a per-browser copy would disagree with everyone else's.
//
// SPDX-License-Identifier: Apache-2.0

import { holderKey } from './holder';
import { readJson, isObject, isString, isNumber, isBoolean, optional } from './json';

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

const isDescentVerdict = (v: unknown): v is DescentVerdict =>
  isObject(v) && isBoolean(v.ok) && optional(v.reason, isString) && optional(v.generationsChecked, isNumber);

const isObligationResult = (v: unknown): v is ObligationResult =>
  isObject(v) && isString(v.oldRoot) && isString(v.newRoot);

/**
 * POST and hand back the body unnarrowed.
 *
 * Typed `unknown` rather than `any` on purpose: every caller here has a different
 * expected shape, so the narrowing belongs at the call site where that shape is
 * known. Returning `any` would let each caller silently skip it.
 */
const post = async (path: string, body: unknown, auth = true): Promise<unknown> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers['x-holder-key'] = holderKey();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return readJson(res);
};

/** Current root of the obligation tree. Reveals nothing on its own. */
export const lineageRoot = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${BASE}/lineage/root`);
    if (!res.ok) return null;
    const body = await readJson(res);
    return isObject(body) && isString(body.root) ? body.root : null;
  } catch {
    return null;
  }
};

/** Declare that a record descends from a parent. Public — this is what makes claims checkable. */
export const declareParent = async (child: string, parent: string): Promise<{ edge: string } | null> => {
  try {
    const body = await post('/lineage/descent', { child, parent });
    return isObject(body) && isString(body.edge) ? { edge: body.edge } : null;
  } catch {
    return null;
  }
};

/** Attach an obligation to a record you hold. */
export const encumber = async (record: string, obligation: string): Promise<ObligationResult | null> => {
  try {
    const body = await post('/lineage/obligations', { record, obligation });
    return isObligationResult(body) ? body : null;
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
    if (!res.ok) return null;
    const body = await readJson(res);
    return isObligationResult(body) ? body : null;
  } catch {
    return null;
  }
};

/**
 * Ask whether a record is clean through its declared ancestry.
 *
 * No authentication — a buyer checks this without an account, and learns only
 * accepted or rejected.
 *
 * A body that is not a verdict is reported as not clean. This is the one place in
 * the client where an unreadable answer must not become a permissive one: a buyer
 * asking whether material carries an upstream claim is owed a no when the registry
 * said something we cannot parse.
 */
export const verifyDescent = async (record: string, chain: string[]): Promise<DescentVerdict> => {
  try {
    const body = await post('/lineage/verify', { record, chain }, false);
    if (isDescentVerdict(body)) return body;
    return { ok: false, reason: 'the registry returned an answer this client could not read' };
  } catch {
    return { ok: false, reason: 'could not reach the registry' };
  }
};

/** Declared ancestry of a record, per the public graph. */
export const ancestorsOf = async (record: string): Promise<string[]> => {
  try {
    const res = await fetch(`${BASE}/lineage/ancestors/${encodeURIComponent(record)}`);
    if (!res.ok) return [];
    const body = await readJson(res);
    if (!isObject(body)) return [];
    // Every ancestor must be a string. A partial list here would understate an
    // ancestry, and understating one is how a record looks cleaner than it is.
    return Array.isArray(body.ancestors) && body.ancestors.every(isString) ? body.ancestors : [];
  } catch {
    return [];
  }
};
