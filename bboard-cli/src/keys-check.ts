// SPDX-License-Identifier: Apache-2.0
/**
 * Before a mainnet deploy: are these the keys the deployment record describes?
 *
 * The deploy guard (api/src/deploy-guard.ts) only knows that a revision was declared.
 * This checks the build itself: every key, every circuit's ZKIR and the contract code
 * must match docs/fingerprints.md as COMMITTED, and that file must be unmodified. The
 * same table goes into the deployment record, so a deploy can only use what it names.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Rows of the committed table: path under managed/veilcore -> SHA-256. */
export const parseFingerprints = (text: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of text.replace(/\r/g, '').matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)) out.set(m[1], m[2]);
  return out;
};

/** The artefacts a deployment uses, as fingerprints.mjs lists them. */
const artefacts = (zkConfigPath: string): string[] => {
  const list = (dir: string, re: RegExp): string[] =>
    existsSync(path.join(zkConfigPath, dir))
      ? readdirSync(path.join(zkConfigPath, dir))
          .filter((f) => re.test(f))
          .map((f) => `${dir}/${f}`)
      : [];
  return [...list('keys', /\.(prover|verifier)$/), ...list('zkir', /\.b?zkir$/), 'contract/index.js'];
};

/** Throws, naming the problem, unless the local build is exactly the committed one. */
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
  const local = artefacts(zkConfigPath);
  if (expected.size === 0) throw new Error('docs/fingerprints.md lists nothing.');
  if (local.length !== expected.size) {
    throw new Error(
      `The build has ${local.length} artefacts; the record lists ${expected.size}. Run a full npm run compact.`,
    );
  }
  for (const f of local) {
    const want = expected.get(f);
    if (want === undefined) throw new Error(`${f} is not in the record.`);
    if (!existsSync(path.join(zkConfigPath, f)) || sha256(path.join(zkConfigPath, f)) !== want) {
      throw new Error(`${f} does not match the record. Rebuild with the recorded compiler version.`);
    }
  }
  return local.length;
};
