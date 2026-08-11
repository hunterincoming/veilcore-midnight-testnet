// What needs doing, per record.
//
// A dashboard that lists cultivars by date answers "what did I create most recently",
// which nobody asks. A lab manager opens this to answer one of three questions: what
// came in that I haven't dealt with, what's out and hasn't come back, and what's
// blocked.
//
// Evidence strength is the axis that matters. A logged-only record is the breeder's
// word. DNA-paired and lab-attested is evidence. So the grouping is by what would
// strengthen a record next, not by when it was made.
// SPDX-License-Identifier: Apache-2.0

import type { StrainRecord } from './records';

export type AttentionState =
  | 'blocked'        // carries an unmet obligation
  | 'needs-dna'      // no DNA report paired
  | 'needs-attester' // DNA paired, no second party has confirmed it
  | 'in-transit'     // offered to someone, not yet claimed
  | 'complete';      // nothing outstanding

export type Group = {
  state: AttentionState;
  label: string;
  /** What doing this would actually get them. Not a description of the state. */
  why: string;
  records: StrainRecord[];
};

export const attentionOf = (r: StrainRecord, opts: { blocked?: boolean; inTransit?: boolean } = {}): AttentionState => {
  if (opts.blocked) return 'blocked';
  if (opts.inTransit) return 'in-transit';
  if (!r.dnaFingerprint) return 'needs-dna';
  if (!r.attestation) return 'needs-attester';
  return 'complete';
};

const ORDER: AttentionState[] = ['blocked', 'needs-dna', 'needs-attester', 'in-transit', 'complete'];

const META: Record<AttentionState, { label: string; why: string }> = {
  blocked: {
    label: 'Blocked',
    why: 'An unmet obligation upstream. These cannot prove clean descent until it is discharged.',
  },
  'needs-dna': {
    label: 'No DNA report',
    why: 'Without one the record is a name you typed. Pairing a report ties it to the actual genetics.',
  },
  'needs-attester': {
    label: 'Awaiting a second party',
    why: 'A record you signed alone is weaker than one a lab confirms they received.',
  },
  'in-transit': {
    label: 'Out on transfer',
    why: 'Sent but not yet claimed. The recipient holds material with no record of it.',
  },
  complete: {
    label: 'Complete',
    why: 'Nothing outstanding.',
  },
};

/** Group records by what would strengthen them next. Empty groups are dropped. */
export const groupByAttention = (
  records: StrainRecord[],
  flags: Record<string, { blocked?: boolean; inTransit?: boolean }> = {},
): Group[] =>
  ORDER.map((state) => ({
    state,
    ...META[state],
    records: records.filter((r) => attentionOf(r, flags[r.id] ?? {}) === state),
  })).filter((g) => g.records.length > 0);

/**
 * A one-line summary of what needs attention, for the top of the dashboard.
 *
 * Deliberately not a set of section headers. Grouping a four-record list into four
 * sections is worse than leaving it alone — the summary earns its place only when there
 * is enough to scan, and it filters the list rather than restructuring it.
 */
export const attentionSummary = (groups: Group[]): { state: AttentionState; label: string; count: number }[] =>
  groups
    .filter((g) => g.state !== 'complete')
    .map((g) => ({ state: g.state, label: g.label, count: g.records.length }));

/** Below this many records a flat list is easier to read than anything cleverer. */
export const GROUPING_THRESHOLD = 8;
