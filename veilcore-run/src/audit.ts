// Each partner's audit log: what VeilCore did for them, when, and the transaction ids,
// one JSON line per action, each line carrying the SHA-256 of the line before it (so a
// line removed or changed later shows). No secrets: every line is checked against the
// partner's secrets before it is written, and refused if it holds one.
// SPDX-License-Identifier: Apache-2.0
//
// It is not encrypted: an operator reads it without the partner's password, and it is
// what the partner is given on exit. It does link the partner's name to their records'
// public commitments, which the chain alone does not, so it is kept owner-only (0600)
// in the partner's folder, like the vault.

import { createHash } from 'node:crypto';
import { appendFile, chmod, open, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { exists } from './files.ts';

export const AUDIT_FILE = 'audit.jsonl';
const GENESIS = '0'.repeat(64);

export type AuditFields = {
  /** What was done: the command, e.g. 'anchor', 'licence-revoke', 'exit'. */
  readonly op: string;
  readonly ok: boolean;
  /** Labels and PUBLIC values only: commitments, transaction ids, block heights. */
  readonly label?: string;
  readonly record?: string;
  readonly licence?: string;
  readonly obligation?: string;
  readonly fields?: string;
  readonly txId?: string;
  readonly txHash?: string;
  readonly blockHeight?: number;
  readonly note?: string;
  /** 'sending': written before a transaction is sent; the line after it says how it ended. */
  readonly phase?: 'sending';
  /** audit-anchor: the hash of line `anchoredSeq`, timestamped on chain by `txId`. */
  readonly anchoredHead?: string;
  readonly anchoredSeq?: number;
};

export type AuditEntry = AuditFields & {
  readonly seq: number;
  readonly at: string;
  readonly partner: string;
  readonly network: string;
  /** SHA-256 of the previous line (64 zeros for the first). */
  readonly prev: string;
};

/** A line would have held a secret. Nothing was written. */
export class SecretInAuditError extends Error {
  constructor() {
    super('Refused to write an audit line that holds a secret. Nothing was written. This is a bug: report it.');
    this.name = 'SecretInAuditError';
  }
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

export class AuditLog {
  readonly #file: string;
  readonly #partner: string;
  readonly #network: string;
  readonly #secrets: () => Set<string>;

  /** `secrets` gives the partner's secrets (hex) at the moment of writing. */
  constructor(dir: string, partner: string, network: string, secrets: () => Set<string>) {
    this.#file = path.join(dir, AUDIT_FILE);
    this.#partner = partner;
    this.#network = network;
    this.#secrets = secrets;
  }

  get file(): string {
    return this.#file;
  }

  async write(f: AuditFields): Promise<AuditEntry> {
    const { entries, lastLine } = await readAudit(this.#file);
    const last = entries.at(-1);
    const entry: AuditEntry = {
      seq: (last?.seq ?? 0) + 1,
      at: new Date().toISOString(),
      partner: this.#partner,
      network: this.#network,
      ...f,
      prev: lastLine === undefined ? GENESIS : sha(lastLine),
    };
    const line = lineOf(entry);
    const lower = line.toLowerCase();
    for (const s of this.#secrets()) if (lower.includes(s)) throw new SecretInAuditError();
    if (!(await exists(this.#file))) {
      const fh = await open(this.#file, 'a', 0o600);
      await fh.close();
    }
    await chmod(this.#file, 0o600);
    await appendFile(this.#file, line + '\n', { encoding: 'utf8', mode: 0o600 });
    return entry;
  }
}

const lineOf = (e: AuditEntry): string => JSON.stringify(e);

/** Read a partner's audit log and check its chain of hashes. */
export const readAudit = async (
  file: string,
): Promise<{
  readonly entries: AuditEntry[];
  readonly intact: boolean;
  readonly problem?: string;
  readonly lastLine?: string;
}> => {
  if (!(await exists(file))) return { entries: [], intact: true };
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l !== '');
  const entries: AuditEntry[] = [];
  let prev = GENESIS;
  let problem: string | undefined;
  for (const [i, l] of lines.entries()) {
    let e: AuditEntry;
    try {
      e = JSON.parse(l) as AuditEntry;
    } catch {
      problem ??= `line ${i + 1} is not JSON`;
      continue;
    }
    if (problem === undefined && (e.prev !== prev || e.seq !== i + 1))
      problem = `line ${i + 1} does not follow line ${i} (a line was removed, added or changed)`;
    prev = sha(l);
    entries.push(e);
  }
  return {
    entries,
    intact: problem === undefined,
    ...(problem === undefined ? {} : { problem }),
    ...(lines.length === 0 ? {} : { lastLine: lines[lines.length - 1] }),
  };
};

/** The hash of the log's last line (what an anchor timestamps), and its line number. */
export const auditHead = async (file: string): Promise<{ readonly head: string; readonly seq: number } | null> => {
  const r = await readAudit(file);
  if (r.lastLine === undefined) return null;
  return { head: sha(r.lastLine), seq: r.entries.length };
};

/**
 * Check every anchor line: the hash it names is the hash of the line it names, and the
 * chain timestamped exactly that hash in that transaction (`onChain`, e.g. the kit's
 * checkBatchAnchor, which needs no wallet). An edit to any line up to an anchored one, or
 * a rewrite of the whole chain after it, then shows; a partner who kept the receipts
 * (head, line, transaction) also sees an anchor line that was removed.
 */
export const verifyAnchors = async (
  file: string,
  onChain: (txId: string, head: string) => Promise<boolean>,
): Promise<{ readonly anchors: number; readonly problems: readonly string[] }> => {
  if (!(await exists(file))) return { anchors: 0, problems: [] };
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l !== '');
  const problems: string[] = [];
  let anchors = 0;
  for (const l of lines) {
    let e: AuditEntry;
    try {
      e = JSON.parse(l) as AuditEntry;
    } catch {
      continue;
    }
    if (e.op !== 'audit-anchor' || !e.ok || e.anchoredHead === undefined || e.anchoredSeq === undefined) continue;
    anchors++;
    const target = lines[e.anchoredSeq - 1];
    if (target === undefined || sha(target) !== e.anchoredHead)
      problems.push(
        `the anchor at line ${e.seq} does not match line ${e.anchoredSeq}: the log was changed after it was anchored`,
      );
    else if (e.txId === undefined || !(await onChain(e.txId, e.anchoredHead).catch(() => false)))
      problems.push(`the anchor at line ${e.seq} is not on chain as stated (transaction ${e.txId ?? 'none'})`);
  }
  return { anchors, problems };
};

/**
 * Check one receipt a partner was given (audit-anchor): line `seq` of the log still hashes
 * to `head`, and the chain timestamped `head` in `txId`. A log cut short or rewritten
 * before that line fails, even if every anchor line was removed from it.
 */
export const verifyReceipt = async (
  file: string,
  receipt: { readonly seq: number; readonly head: string; readonly txId: string },
  onChain: (txId: string, head: string) => Promise<boolean>,
): Promise<boolean> => {
  if (!(await exists(file))) return false;
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l !== '');
  const line = lines[receipt.seq - 1];
  return (
    line !== undefined && sha(line) === receipt.head && (await onChain(receipt.txId, receipt.head).catch(() => false))
  );
};
