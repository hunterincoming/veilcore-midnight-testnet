// Selective disclosure — a recipient-specific proof spec. The breeder picks exactly which
// facts a given recipient (a licensee, a lab, a buyer) is allowed to see. The genetics are
// never in this set — they are undisclosable by design. Encoded into the /verify link.
// SPDX-License-Identifier: Apache-2.0

export type DisclosureKey = 'own' | 'dna' | 'lineage' | 'sealed' | 'parents' | 'method' | 'others' | 'agreementTerms';

export type Disclosure = Record<DisclosureKey, boolean>;

/** The togglable fields, in display order, with their default on/off state. */
export const DISCLOSURE_FIELDS: { key: DisclosureKey; label: string; def: boolean }[] = [
  { key: 'own', label: 'Prior possession (proven, not claimed)', def: true },
  { key: 'dna', label: 'DNA-verified', def: true },
  { key: 'lineage', label: 'Lineage intact', def: true },
  { key: 'sealed', label: 'Sealed date', def: true },
  { key: 'parents', label: 'Parent cultivar names', def: false },
  { key: 'method', label: 'Breeding method', def: false },
  { key: 'others', label: 'My other cultivars', def: false },
  { key: 'agreementTerms', label: 'Terms of my other agreements', def: false },
];

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
  const on = new Set(s.split(',').filter(Boolean));
  return DISCLOSURE_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: on.has(f.key) }), {} as Disclosure);
};
