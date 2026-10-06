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
