// Secrets on paper: each 32-byte secret as 16 groups of four hex characters and a
// four-character check, so a misread character is caught when it is typed back.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { fromHex, toHex } from '@veilcore/contracts';
import { poolIdOf } from './partner-keys.ts';
import { type VaultPayload } from './vault.ts';

const checkOf = (hex: string): string =>
  createHash('sha256').update(`veilcore-run/sheet/v1:${hex}`, 'utf8').digest('hex').slice(0, 4);

/** "a1b2 c3d4 … (check 9f3e)". */
export const forPaper = (secret: Uint8Array | string): string => {
  const hex = (typeof secret === 'string' ? secret : toHex(secret)).toLowerCase().replace(/^0x/, '');
  return `${hex.match(/.{1,4}/g)?.join(' ') ?? ''}  (check ${checkOf(hex)})`;
};

/** Read a secret typed back from paper: spaces ignored, the check must match. */
export const fromPaper = (typed: string): Uint8Array => {
  const m = /^([0-9a-fA-F\s]+?)\s*(?:\(\s*check\s+([0-9a-fA-F]{4})\s*\))?\s*$/.exec(typed.trim());
  if (m === null) throw new Error('That is not a secret as the sheet writes it (hex, then "(check xxxx)").');
  const hex = m[1].replace(/\s+/g, '').toLowerCase();
  if (hex.length !== 64) throw new Error(`That is ${hex.length} hex characters; a secret is 64.`);
  if (m[2] === undefined) throw new Error('Type the four-character check at the end too, as "(check xxxx)".');
  if (checkOf(hex) !== m[2].toLowerCase())
    throw new Error('The check does not match: a character was misread or mistyped. Compare with the sheet.');
  return fromHex(hex);
};

const rule = '-'.repeat(78);

/** The partner's master sheet (partner-keys): the only thing they must keep. */
export const masterSheet = (o: { partner: string; network: string; master: Uint8Array; madeAt: string }): string =>
  [
    'VEILCORE-RUN: YOUR MASTER RECOVERY SECRET',
    rule,
    `Partner: ${o.partner}    Network: ${o.network}    Made: ${o.madeAt}`,
    `Pool id: ${poolIdOf(o.master)}  (not secret: it says which master this is)`,
    '',
    'Master secret:',
    `  ${forPaper(o.master)}`,
    '',
    'Whoever holds this can take every record VeilCore runs for you back from anyone,',
    'VeilCore included, and open every bundle VeilCore hands you. It is never given to',
    'VeilCore, and VeilCore cannot replace it if you lose it.',
    '',
    '- Keep two copies, in two places (a safe, a deposit box). Not in email, chat, a',
    '  photo, a notes app or a cloud document.',
    '- Delete the file this was printed from once both copies are made.',
    '- Every recovery secret is derived from it: recovery secret i =',
    '  HMAC-SHA256(master, "veilcore-run/v1/recovery/" + i). See docs/MANAGED.md.',
    rule,
    '',
  ].join('\n');

/**
 * Everything in a partner's custody, on paper: the "printable recovery sheet" an exit
 * (or an export) can produce. It holds every secret in the bundle, in plain text.
 */
export const custodySheet = (p: VaultPayload, o: { title: string; madeAt: string; note?: string }): string => {
  const out: string[] = [
    `VEILCORE-RUN: ${o.title}`,
    rule,
    `Partner: ${p.partner.displayName} (${p.partner.id})    Network: ${p.partner.network}`,
    `Made: ${o.madeAt}`,
    '',
    'THIS SHEET HOLDS SECRETS. Whoever holds it can act as your records and licences.',
    'Keep it like cash. Delete the file it was printed from as soon as it is printed.',
    ...(o.note === undefined ? [] : ['', o.note]),
    '',
  ];
  if (p.records.length > 0) out.push('RECORDS', rule);
  for (const r of p.records) {
    out.push(`${r.label}   (${r.status})`);
    out.push(`  record (public):          ${r.current}`);
    out.push(`  anchored as (public):     ${r.origin}`);
    if (r.secret !== undefined) out.push(`  record secret:            ${forPaper(r.secret)}`);
    if (r.pendingSecret !== undefined)
      out.push(`  NEW record secret (a rotation was under way; check which is live): ${forPaper(r.pendingSecret)}`);
    if (r.recovery.secret !== undefined) out.push(`  recovery secret:          ${forPaper(r.recovery.secret)}`);
    else out.push(`  recovery secret:          held by you, not VeilCore (${r.recovery.heldBy})`);
    out.push('');
  }
  const held = p.licences.filter((l) => l.role === 'licensee');
  if (held.length > 0) out.push('LICENCES YOU HOLD', rule);
  for (const l of held) {
    out.push(`${l.label}   (${l.status})   from issuer record ${l.issuerRecord}`);
    if (l.secret !== undefined) out.push(`  licence secret:           ${forPaper(l.secret)}`);
    out.push('');
  }
  if (p.labKeys.length > 0) out.push('LABORATORY CLAIMS KEYS', rule);
  for (const k of p.labKeys) {
    out.push(`${k.label}   public key x=${k.key.x} y=${k.key.y}`);
    if (k.secret !== undefined) out.push(`  secret:                   ${k.secret}`);
    out.push('');
  }
  if (p.obligations.length > 0) out.push('OBLIGATIONS (terms and salt show later what each commitment means)', rule);
  for (const ob of p.obligations) {
    out.push(`${ob.label}   (${ob.status})   commitment ${ob.commitment}`);
    if (ob.terms !== undefined) out.push(`  terms: ${ob.terms}`);
    if (ob.salt !== undefined) out.push(`  salt:  ${forPaper(ob.salt)}`);
    out.push('');
  }
  if (p.fieldSets.length > 0) out.push('SEALED FIELD SETS (the hidden values behind your claims)', rule);
  for (const f of p.fieldSets) {
    out.push(`${f.label}   record commitment ${f.commitment}`);
    if (f.file !== undefined) out.push(`  field-set file: ${JSON.stringify(f.file)}`);
    out.push('');
  }
  out.push(rule, '');
  return out.join('\n');
};
