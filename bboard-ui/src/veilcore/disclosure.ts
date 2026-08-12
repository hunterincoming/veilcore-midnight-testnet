// Selective disclosure — a recipient-specific proof spec.
//
// The breeder picks exactly which facts a given recipient (a licensee, a lab, a buyer)
// may see. The genetics are never in this set — they are undisclosable by design.
// Encoded into the /verify link.
//
// The keys are named after what the recipient LEARNS, not after the field being
// revealed. `descent-clean` describes an outcome; `lineage` described our internal
// shape. That distinction is what lets a registry in another domain reuse this
// vocabulary without inheriting our schema, and it comes from Mako's format spec.
//
// SPDX-License-Identifier: Apache-2.0

export type DisclosureKey =
  | 'existence'         // a sealed record exists, held by this party from this date
  | 'attestation-status'// whether a second party has confirmed it
  | 'descent-clean'     // free of unmet obligations through declared ancestry
  | 'sealed-at'         // when it was sealed
  | 'parent-names'      // the parent cultivar names
  | 'breeding-method'   // how it was produced
  | 'holder-portfolio'  // the holder's other records
  | 'terms-full';       // the terms of the holder's other agreements

export type Disclosure = Record<DisclosureKey, boolean>;

/** The togglable facts, in display order, with their default on/off state. */
export const DISCLOSURE_FIELDS: { key: DisclosureKey; label: string; def: boolean }[] = [
  { key: 'existence', label: 'Prior possession (proven, not claimed)', def: true },
  { key: 'attestation-status', label: 'DNA-verified', def: true },
  { key: 'descent-clean', label: 'Lineage intact', def: true },
  { key: 'sealed-at', label: 'Sealed date', def: true },
  { key: 'parent-names', label: 'Parent cultivar names', def: false },
  { key: 'breeding-method', label: 'Breeding method', def: false },
  { key: 'holder-portfolio', label: 'My other cultivars', def: false },
  { key: 'terms-full', label: 'Terms of my other agreements', def: false },
];

/**
 * Links issued before this vocabulary existed carry the old keys. Mapping them keeps
 * every link ever shared working — a verification link that dies because we renamed
 * something is exactly the fragility this format is supposed to remove.
 */
const LEGACY: Record<string, DisclosureKey> = {
  own: 'existence',
  dna: 'attestation-status',
  lineage: 'descent-clean',
  sealed: 'sealed-at',
  parents: 'parent-names',
  method: 'breeding-method',
  others: 'holder-portfolio',
  agreementTerms: 'terms-full',
};

/** Always hidden, never togglable — shown to the recipient as a locked row. */
export const GENETICS_LABEL = 'The genetics themselves — never disclosed, by design';

export const defaultDisclosure = (): Disclosure =>
  DISCLOSURE_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: f.def }), {} as Disclosure);

/** The comma-joined keys of everything switched on — what rides in the ?show= param. */
export const encodeDisclosure = (d: Disclosure): string =>
  DISCLOSURE_FIELDS.filter((f) => d[f.key])
    .map((f) => f.key)
    .join(',');

/** null when there is no ?show= param at all (legacy links keep their original behaviour). */
export const decodeDisclosure = (s: string | null): Disclosure | null => {
  if (s === null) return null;
  const on = new Set(
    s.split(',').filter(Boolean).map((k) => LEGACY[k] ?? k),
  );
  return DISCLOSURE_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: on.has(f.key) }), {} as Disclosure);
};
