// Selective disclosure — what a stranger with a record's id is shown.
//
// The holder picks which facts about a record anyone holding its id may see. The
// genetics are never in this set — they are undisclosable by design.
//
// The choice is a GRANT stored by the registry against the record (PUT
// /api/records/:id/disclosure, holder key required), not a list in the link. It used to
// ride in ?show=, which whoever had the link could edit to read parent names and
// breeding method (attack round D). The registry now answers only what the holder
// granted; a ?show= in a link can narrow that, never widen it. One grant per record:
// it applies to everyone who has the id, from any link or certificate QR code.
//
// The keys are named after what the recipient LEARNS, not after the field being
// revealed. `descent-clean` describes an outcome; `lineage` described our internal
// shape. That distinction is what lets a registry in another domain reuse this
// vocabulary without inheriting our schema, and it comes from Mako's format spec.
//
// SPDX-License-Identifier: Apache-2.0

import { holderKey, holderKeyIfAny } from './holder';
import { readJson, isObject, isString } from './json';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export type DisclosureKey =
  | 'existence' // a sealed record exists, held by this party from this date
  | 'attestation-status' // whether the holder paired a DNA report
  | 'descent-clean' // free of unmet obligations through declared ancestry
  | 'sealed-at' // when the holder says it was sealed
  | 'parent-names' // the parent cultivar names
  | 'breeding-method'; // how it was produced

export type Disclosure = Record<DisclosureKey, boolean>;

/**
 * The facts a holder can grant, in display order, with their default for a record that
 * has no grant yet. "My other cultivars" and "Terms of my other agreements" are gone:
 * they were facts about the holder rather than this record, and the registry never
 * answers them.
 */
export const DISCLOSURE_FIELDS: { key: DisclosureKey; label: string; def: boolean }[] = [
  // Labels say what the recipient is actually shown, not the best case. They are read by
  // the holder choosing and by the stranger on the verify page, so they say neither "you"
  // nor "the holder".
  { key: 'existence', label: 'Prior possession (shown only once anchored)', def: true },
  { key: 'attestation-status', label: 'Whether a DNA report is paired', def: true },
  { key: 'descent-clean', label: 'Lineage status, as the registry reports it', def: true },
  { key: 'sealed-at', label: 'When it was sealed (the holder’s device clock)', def: true },
  { key: 'parent-names', label: 'Parent cultivar names', def: false },
  { key: 'breeding-method', label: 'Breeding method', def: false },
];

/** The registry's older names, which /verify answers in `disclosed`. */
export const LEGACY_NAME: Record<DisclosureKey, string> = {
  existence: 'own',
  'attestation-status': 'dna',
  'descent-clean': 'lineage',
  'sealed-at': 'sealed',
  'parent-names': 'parents',
  'breeding-method': 'method',
};

const FROM_LEGACY: Record<string, DisclosureKey> = Object.fromEntries(
  Object.entries(LEGACY_NAME).map(([k, v]) => [v, k as DisclosureKey]),
);

/** A key in either spelling, or undefined for anything else. */
export const toDisclosureKey = (k: string): DisclosureKey | undefined =>
  DISCLOSURE_FIELDS.some((f) => f.key === k) ? (k as DisclosureKey) : FROM_LEGACY[k];

/** What the recipient is told about a key, by name. */
export const labelOf = (k: DisclosureKey): string => DISCLOSURE_FIELDS.find((f) => f.key === k)?.label ?? k;

/** Always hidden, never togglable — shown to the recipient as a locked row. */
export const GENETICS_LABEL = 'The genetics themselves — never disclosed, by design';

export const defaultDisclosure = (): Disclosure =>
  DISCLOSURE_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: f.def }), {} as Disclosure);

export const noDisclosure = (): Disclosure =>
  DISCLOSURE_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: false }), {} as Disclosure);

/** The keys switched on, in display order. */
export const keysOn = (d: Disclosure): DisclosureKey[] => DISCLOSURE_FIELDS.filter((f) => d[f.key]).map((f) => f.key);

export const disclosureFrom = (keys: readonly string[]): Disclosure => {
  const on = new Set(keys.map(toDisclosureKey).filter((k): k is DisclosureKey => k !== undefined));
  return DISCLOSURE_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: on.has(f.key) }), {} as Disclosure);
};

export type Grant = { show: DisclosureKey[]; updatedAt: string | null };

const isGrantBody = (v: unknown): v is { show: string[]; updatedAt?: string | null } =>
  isObject(v) &&
  Array.isArray(v.show) &&
  v.show.every(isString) &&
  (v.updatedAt === undefined || v.updatedAt === null || isString(v.updatedAt));

const errorOf = async (res: Response): Promise<string> => {
  try {
    const body = await readJson(res);
    if (isObject(body) && isString(body.error)) return body.error;
  } catch {
    /* not JSON */
  }
  return `the registry answered ${String(res.status)}`;
};

/**
 * What the holder has granted for a record, as the registry holds it. null when there is
 * no holder key in this browser or the registry could not be asked.
 */
export const loadGrant = async (recordId: string): Promise<Grant | { error: string } | null> => {
  const key = holderKeyIfAny();
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}/api/records/${encodeURIComponent(recordId)}/disclosure`, {
      headers: { 'x-holder-key': key },
    });
    if (!res.ok) return { error: await errorOf(res) };
    const body = await readJson(res);
    if (!isGrantBody(body)) return { error: 'unexpected response from the registry' };
    return { show: keysOn(disclosureFrom(body.show)), updatedAt: body.updatedAt ?? null };
  } catch {
    return null;
  }
};

/**
 * Store the holder's choice as the record's grant. Replaces the previous one; [] withdraws
 * everything. Success only on the registry's positive answer echoing what it stored, so
 * the page never shows a link whose view the registry did not agree to.
 */
export const saveGrant = async (recordId: string, d: Disclosure): Promise<Grant | { error: string }> => {
  const show = keysOn(d);
  try {
    const res = await fetch(`${BASE}/api/records/${encodeURIComponent(recordId)}/disclosure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-holder-key': holderKey() },
      body: JSON.stringify({ show }),
    });
    if (!res.ok) return { error: await errorOf(res) };
    const body = await readJson(res);
    if (!isGrantBody(body)) return { error: 'unexpected response from the registry' };
    const stored = keysOn(disclosureFrom(body.show));
    // The registry stored something other than what was asked: say so rather than show
    // a preview that does not match what a stranger will see.
    if (stored.join(',') !== show.join(',')) {
      return { error: `the registry stored a different set (${stored.join(', ') || 'nothing'}) from the one chosen` };
    }
    return { show: stored, updatedAt: body.updatedAt ?? null };
  } catch {
    return { error: 'could not reach the registry' };
  }
};
