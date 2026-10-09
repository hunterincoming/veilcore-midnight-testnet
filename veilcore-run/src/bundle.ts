// The bundle a partner is handed: the secrets VeilCore holds for them (or, from an
// assisted exit, the new record secrets it made for them), the plain-English procedure,
// and a copy of their audit log, SEALED TO THE PARTNER'S PUBLIC KEY (box.ts, sealTo). The
// matching private key is derived from the partner's master on their own computer:
// nothing on VeilCore's side can open a bundle, and no passphrase is typed there.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type AuditEntry } from './audit.ts';
import { openSealed, parseSealed, sealTo } from './box.ts';
import { writePrivate } from './files.ts';
import { bundleKeyOf } from './partner-keys.ts';
import { type ExitMode, type VaultPayload } from './vault.ts';

export const BUNDLE_FORMAT = 'veilcore-run/exit-bundle/2';

/** What happened to one record in an assisted exit. Public except `newSecret`. */
export type RecordHandover = {
  readonly label: string;
  readonly origin: string;
  /** The record secret the partner now holds; made in the exit run, written only into this bundle. */
  readonly newSecret?: string;
  readonly newRecord?: string;
  /** The recovery commitment the partner made, installed in place of VeilCore's (custody records). */
  readonly newRecoveryCommitment?: string;
  status: 'sent' | 'done' | 'failed' | 'taken-back' | 'not-rotatable';
  txIds: string[];
  note?: string;
};

export type ExitBundle = {
  readonly format: typeof BUNDLE_FORMAT;
  /** 'export': a copy while still in VeilCore-run; 'exit-*': leaving. */
  readonly kind: 'export' | `exit-${ExitMode}`;
  readonly madeAt: string;
  readonly partner: { readonly id: string; readonly displayName: string; readonly network: string };
  readonly contracts?: { readonly veilcore?: string; readonly claims?: string };
  /** The partner's secrets and public data, in the vault's own shape. */
  readonly vault: VaultPayload;
  readonly handover?: RecordHandover[];
  /** Assisted exits that took more than one run: which earlier bundle holds which record's secret. */
  readonly earlierBundles?: readonly { readonly sha256: string; readonly labels: readonly string[] }[];
  /** What to do next, in plain English, with the partner kit calls for a developer. */
  readonly procedure: string;
  readonly audit: readonly AuditEntry[];
  /** The audit log's lines exactly as written: what the partner's receipts are checked against. */
  readonly auditLines?: readonly string[];
};

/**
 * Seal `bundle` to the partner's public key and write it to `file` (0600; never over an
 * existing file). VeilCore cannot read it back; it checks the file parses and names the
 * right key. Returns the file's SHA-256.
 */
export const writeBundle = async (file: string, recipient: string, bundle: ExitBundle): Promise<string> => {
  const box = sealTo(recipient, { partner: bundle.partner.id, network: bundle.partner.network }, bundle);
  const text = JSON.stringify(box);
  await writePrivate(file, text, { exclusive: true });
  const back = parseSealed(await readFile(file, 'utf8'));
  if (back.recipient !== recipient || back.ciphertext !== box.ciphertext)
    throw new Error(`The bundle written to ${file} does not read back the same. Do not hand it over.`);
  return createHash('sha256').update(text, 'utf8').digest('hex');
};

/** Open a bundle on the partner's computer, with their master secret. */
export const readBundle = async (file: string, master: Uint8Array): Promise<ExitBundle> => {
  const box = parseSealed(await readFile(file, 'utf8'));
  const key = bundleKeyOf(master);
  if (key.publicHex !== box.recipient)
    throw new Error('That bundle was sealed to a different master secret (check which sheet). Nothing was opened.');
  const b = openSealed(key.privateKey, box) as ExitBundle;
  if (b.format !== BUNDLE_FORMAT || b.partner.id !== box.partner || b.partner.network !== box.network)
    throw new Error('That bundle does not match its header. Refused.');
  return b;
};

/** Which key a bundle is sealed to, without opening it. */
export const bundleRecipient = async (file: string): Promise<string> =>
  parseSealed(await readFile(file, 'utf8')).recipient;
