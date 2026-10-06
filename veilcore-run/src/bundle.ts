// The bundle a partner is handed: every secret VeilCore holds for them (or, after an
// assisted exit, the secrets they now hold), encrypted to a passphrase THEY choose, with
// the plain-English procedure and a copy of their audit log.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { passwordProblem } from '@veilcore/contracts';
import { type AuditEntry } from './audit.ts';
import { BoxKey, openBox, parseBox, sealBox } from './box.ts';
import { writePrivate } from './files.ts';
import { type ExitMode, type VaultPayload } from './vault.ts';

export const BUNDLE_FORMAT = 'veilcore-run/exit-bundle/1';

/** What happened to one record when VeilCore handed it over (assisted exit). */
export type RecordHandover = {
  readonly label: string;
  readonly origin: string;
  /** The record secret the partner now holds (made for the hand-over, never stored in VeilCore's vault). */
  readonly newSecret: string;
  readonly newRecord: string;
  /** The recovery commitment the partner made, installed in place of VeilCore's (custody records). */
  readonly newRecoveryCommitment?: string;
  status: 'pending' | 'done' | 'failed';
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
  /** What to do next, in plain English, with the partner kit calls for a developer. */
  readonly procedure: string;
  readonly audit: readonly AuditEntry[];
};

/** A passphrase the partner chose for their bundle: the same rule as every VeilCore password. */
export const checkPassphrase = (passphrase: string): void => {
  const problem = passwordProblem(passphrase);
  if (problem !== null) throw new Error(`That passphrase will not be accepted: ${problem}.`);
};

/**
 * Encrypt `bundle` to `passphrase` and write it to `file` (0600). `replace`: overwrite a
 * bundle this command wrote earlier; otherwise an existing file is never overwritten.
 * Reads it back and opens it before returning, so a bundle that would not open is
 * never reported as written. Returns the file's SHA-256.
 */
export const writeBundle = async (
  file: string,
  passphrase: string,
  bundle: ExitBundle,
  { replace = false } = {},
): Promise<string> => {
  checkPassphrase(passphrase);
  const key = await BoxKey.fresh(passphrase);
  try {
    const box = sealBox(
      key,
      { kind: 'exit-bundle', partner: bundle.partner.id, network: bundle.partner.network },
      bundle,
    );
    const text = JSON.stringify(box);
    await writePrivate(file, text, { exclusive: !replace });
    const back = await readBundle(file, passphrase);
    if (JSON.stringify(back) !== JSON.stringify(bundle))
      throw new Error(`The bundle written to ${file} does not read back the same. Do not hand it over.`);
    return createHash('sha256').update(text, 'utf8').digest('hex');
  } finally {
    key.destroy();
  }
};

/** Open a bundle with the partner's passphrase. */
export const readBundle = async (file: string, passphrase: string): Promise<ExitBundle> => {
  const box = parseBox(await readFile(file, 'utf8'), { kind: 'exit-bundle' });
  const key = await BoxKey.forHeader(passphrase, box);
  try {
    const b = openBox(key, box) as ExitBundle;
    if (b.format !== BUNDLE_FORMAT || b.partner.id !== box.partner || b.partner.network !== box.network)
      throw new Error('That bundle does not match its header. Refused.');
    return b;
  } finally {
    key.destroy();
  }
};
