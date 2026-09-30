// SPDX-License-Identifier: Apache-2.0
/**
 * Before a mainnet deploy: are these the keys the deployment record describes?
 *
 * The deploy guard (api/src/deploy-guard.ts) only knows that a revision was declared.
 * This checks the build itself: every proving and verifying key in the local build
 * must match docs/fingerprints.md as COMMITTED, and that file must be unmodified. The
 * same table goes into the deployment record, so a deploy can only use the keys the
 * record names.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Fingerprints listed in the committed table: key file name -> SHA-256. */
export const parseFingerprints = (text: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\| `keys\/([^`]+)` \| `([0-9a-f]{64})` \|$/gm)) out.set(m[1], m[2]);
  return out;
};

/** Throws, naming the problem, unless the local keys are exactly the committed ones. */
export const assertKeysMatchRecord = (zkConfigPath: string, repoRoot: string): number => {
  const table = path.join(repoRoot, 'docs', 'fingerprints.md');
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  let committed: string;
  try {
    committed = git('show', 'HEAD:docs/fingerprints.md');
  } catch {
    throw new Error(
      'docs/fingerprints.md is not committed. Run npm run fingerprints in contract/, commit and push it first.',
    );
  }
  if (!existsSync(table) || git('status', '--porcelain', '--', 'docs/fingerprints.md').trim() !== '') {
    throw new Error('docs/fingerprints.md differs from the committed copy. Commit it, or rebuild to match it.');
  }
  const expected = parseFingerprints(committed);
  const dir = path.join(zkConfigPath, 'keys');
  const local = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(prover|verifier)$/.test(f)) : [];
  if (expected.size === 0) throw new Error('docs/fingerprints.md lists no keys.');
  if (local.length !== expected.size) {
    throw new Error(
      `The build has ${local.length} key files; the record lists ${expected.size}. Run a full npm run compact.`,
    );
  }
  for (const f of local) {
    const want = expected.get(f);
    if (want === undefined) throw new Error(`keys/${f} is not in the record.`);
    if (sha256(path.join(dir, f)) !== want)
      throw new Error(`keys/${f} does not match the record. Rebuild with the recorded compiler version.`);
  }
  return local.length;
};
