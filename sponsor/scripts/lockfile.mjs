// The staged sponsor installs exactly the package versions the repository's lockfile
// pins, the ones the tests ran against and the audit reviewed. Nothing newer.
//
// stageLockfile() starts the staged lockfile FROM the committed root package-lock.json,
// lets npm drop what the sponsor does not need, then fails if any package in the result
// is not in the reviewed lock (same name, version and integrity hash, from the public npm
// registry), and finally checks npm agrees the lockfile matches package.json. Any failure
// throws; the caller stops.
//
// CLI (the same check on two existing lockfiles):
//   node sponsor/scripts/lockfile.mjs <staged package-lock.json> <repo package-lock.json>
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://registry.npmjs.org/';
const nameOf = (key) => key.split('node_modules/').pop();
const readLock = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Every package in `staged` that the reviewed `repo` lock does not vouch for, with why.
 * Empty means no drift. Both arguments are parsed package-lock.json objects (v2/v3).
 */
export const lockDrift = (staged, repo) => {
  const known = new Map(); // name@version -> integrity hashes the repo lock has for it
  for (const [k, v] of Object.entries(repo.packages ?? {})) {
    if (!k || v.link || !v.version) continue;
    const id = `${nameOf(k)}@${v.version}`;
    if (!known.has(id)) known.set(id, new Set());
    if (v.integrity) known.get(id).add(v.integrity);
  }
  const drift = [];
  for (const [k, v] of Object.entries(staged.packages ?? {})) {
    if (!k) continue;
    if (v.link || !k.startsWith('node_modules/')) {
      drift.push(`${k}: a local folder or link, not a registry package`);
      continue;
    }
    const id = `${nameOf(k)}@${v.version}`;
    const hashes = known.get(id);
    if (!hashes) drift.push(`${id}: not in the reviewed lock`);
    else if (!v.integrity) drift.push(`${id}: no integrity hash`);
    else if (!hashes.has(v.integrity)) drift.push(`${id}: integrity hash differs from the reviewed lock`);
    else if (typeof v.resolved !== 'string' || !v.resolved.startsWith(REGISTRY)) drift.push(`${id}: not from ${REGISTRY}`);
  }
  return drift;
};

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

/**
 * The repo lock without the workspace folders (api, bboard-ui, …, their nested installs and
 * the links to them): the staged folder is one standalone package, and npm would otherwise
 * carry those entries over unchanged. Every registry package entry is kept as reviewed.
 */
export const seedFromRepoLock = (repo) => ({
  ...repo,
  packages: Object.fromEntries(
    Object.entries(repo.packages ?? {}).filter(([k, v]) => k === '' || (k.startsWith('node_modules/') && !v.link)),
  ),
});

/** Write `<target>/package-lock.json` from the repo lock, check it, and throw on any problem. */
export const stageLockfile = (target, repoLockFile) => {
  writeFileSync(join(target, 'package-lock.json'), `${JSON.stringify(seedFromRepoLock(readLock(repoLockFile)), null, 2)}\n`);
  // Starts from the reviewed lock, so npm only removes what the sponsor does not use.
  // --ignore-scripts: nothing runs while the lockfile is worked out.
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], target);
  const drift = lockDrift(readLock(join(target, 'package-lock.json')), readLock(repoLockFile));
  if (drift.length > 0) {
    throw new Error(
      `The staged lockfile has ${drift.length} package(s) the reviewed repo lockfile does not:\n  ${drift.join('\n  ')}\n` +
        'Update and review the root package-lock.json first (npm install at the repo root), then stage again.',
    );
  }
  // The deploy runs `npm ci`, which installs the lockfile exactly or refuses; check now that it would.
  run('npm', ['ci', '--dry-run', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], target);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [staged, repo] = process.argv.slice(2);
  if (!staged || !repo) {
    console.error('Usage: node lockfile.mjs <staged package-lock.json> <repo package-lock.json>');
    process.exit(2);
  }
  const drift = lockDrift(readLock(staged), readLock(repo));
  if (drift.length > 0) {
    console.error(`Staged lock has ${drift.length} package(s) the reviewed repo lock does not:\n  ${drift.join('\n  ')}`);
    process.exit(1);
  }
  console.log('No drift: every staged package is in the reviewed repo lock, with the same integrity hash.');
}
