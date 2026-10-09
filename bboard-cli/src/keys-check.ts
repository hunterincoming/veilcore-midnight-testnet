// SPDX-License-Identifier: Apache-2.0
/**
 * Before a mainnet deploy: are these the keys the deployment record describes?
 *
 * The deploy guard (api/src/deploy-guard.ts) only knows that a revision was declared.
 * This checks the build itself: every key, every circuit's ZKIR and the contract code
 * must match docs/fingerprints.md as COMMITTED, and that file must be unmodified. The
 * same table goes into the deployment record, so a deploy can only use what it names.
 *
 * The file has two tables. The first, at the top, is the main contract's
 * (managed/veilcore). The second, under the heading "## Claims contract", is the claims
 * contract's (managed/veilcore-claims), written by `npm run fingerprints:claims`. Each
 * build is checked against its own table only.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Which contract's table: the main contract (the top of the file) or the claims contract. */
export type FingerprintSection = 'main' | 'claims';

/** The heading the claims contract's table sits under (contract/fingerprints.mjs writes it). */
export const CLAIMS_HEADING = '## Claims contract';

/**
 * Rows of one table: path under managed/<contract> -> SHA-256. The main contract's rows
 * are those before the first `## ` heading; the claims contract's, those under the
 * CLAIMS_HEADING heading. Rows under any other heading belong to neither.
 */
export const parseFingerprints = (text: string, section: FingerprintSection = 'main'): Map<string, string> => {
  const out = new Map<string, string>();
  let current: FingerprintSection | 'other' = 'main';
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('## ')) {
      current = line.startsWith(CLAIMS_HEADING) ? 'claims' : 'other';
      continue;
    }
    if (current !== section) continue;
    const m = /^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/.exec(line);
    if (m !== null) out.set(m[1], m[2]);
  }
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

/**
 * The only environment git gets: enough to find itself and the user's git config, and
 * nothing else. Not the private-state password, the Blockfrost project id, or anything
 * else this process holds (round D, D-6): git runs helpers on its own behalf
 * (core.fsmonitor, hooks, a wrapper on PATH), and they would inherit it.
 */
export const gitEnvironment = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' };
  if (process.env.HOME !== undefined) env.HOME = process.env.HOME;
  return env;
};

/**
 * Throws, naming the problem, unless the local build is exactly the committed one.
 * `zkConfigPath` is managed/veilcore for the main contract, managed/veilcore-claims for
 * the claims contract, with `section` naming which table to check it against.
 */
export const assertKeysMatchRecord = (
  zkConfigPath: string,
  repoRoot: string,
  section: FingerprintSection = 'main',
): number => {
  const table = path.join(repoRoot, 'docs', 'fingerprints.md');
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: gitEnvironment(),
    });
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
  const expected = parseFingerprints(committed, section);
  const local = artefacts(zkConfigPath);
  if (expected.size === 0)
    throw new Error(
      section === 'claims'
        ? 'docs/fingerprints.md has no claims contract fingerprints yet. On the Mac that builds the keys: ' +
            'cd contract && npm run compact && npm run fingerprints:claims, then commit and push docs/fingerprints.md.'
        : 'docs/fingerprints.md lists nothing.',
    );
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
