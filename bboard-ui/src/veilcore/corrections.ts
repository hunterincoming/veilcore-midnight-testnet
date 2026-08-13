// Correcting a record.
//
// Records are never edited and never voided. A correction issues a NEW record that
// supersedes the old one, and both remain. A record that can be quietly changed is not
// evidence, and voiding is rewriting under another name.
//
// The severity of a correction is classified by WHICH FIELD CHANGED, never chosen by
// the holder. If the holder picks, every correction is cosmetic - nobody flags their own
// correction as the kind that invalidates their downstream agreements.
//
// SPDX-License-Identifier: Apache-2.0

import { supersedesFor, diffRecords, classifyCorrection } from 'veilcore-records';
import { toEnvelope, sealEnvelope } from './envelope';
import { holderKey } from './holder';
import type { StrainRecord } from './records';

export type CorrectionPreview = {
  changedFields: string[];
  descentSeverity: 'cosmetic' | 'material';
  termsSeverity: 'cosmetic' | 'material';
  /** What the holder needs to understand before committing to this. */
  consequence: string;
};

const CONSEQUENCE: Record<string, string> = {
  'cosmetic|cosmetic':
    'Nothing downstream is affected. Descendants keep their clean-descent proofs and any agreements stand.',
  'cosmetic|material':
    'Descendants are unaffected — the material did not change. But anyone holding an agreement against this record needs to know, because the terms may refer to what you changed.',
  'material|cosmetic':
    'Anyone relying on descent from this record needs to re-check. Existing agreements are unaffected.',
  'material|material':
    'Both descent and existing agreements are affected. Descendants will need to re-establish clean descent, and counterparties need to be told.',
};

/**
 * What a correction would do, before it is made.
 *
 * Shown to the holder first because the consequence is not obvious from the edit. A
 * breeder fixing a spelling should be told that nothing breaks; a breeder correcting a
 * parent should be told that everything downstream re-checks.
 */
export const previewCorrection = (
  before: StrainRecord,
  after: StrainRecord,
): CorrectionPreview => {
  const id = holderKey().slice(0, 16);
  const changes = diffRecords(toEnvelope(before, id), toEnvelope(after, id));
  const sev = classifyCorrection(changes);
  return {
    changedFields: changes.map((c) => c.field),
    descentSeverity: sev.descent,
    termsSeverity: sev.terms,
    consequence: CONSEQUENCE[`${sev.descent}|${sev.terms}`] ?? '',
  };
};

/**
 * Build the correcting record.
 *
 * The original is untouched. The new record carries a supersedes block naming the
 * original, the classified severities, and WHICH fields changed - not their values, so
 * a downstream party learns the kind of change without learning contents they were
 * never granted.
 */
export const buildCorrection = async (
  before: StrainRecord,
  after: StrainRecord,
  reason: string,
): Promise<{ envelope: unknown; supersedes: unknown }> => {
  const id = holderKey().slice(0, 16);
  const beforeEnv = toEnvelope(before, id);
  const afterEnv = await sealEnvelope(after, id);
  const supersedes = supersedesFor(beforeEnv, afterEnv, reason, 'holder');
  return { envelope: { ...afterEnv, supersedes }, supersedes };
};
