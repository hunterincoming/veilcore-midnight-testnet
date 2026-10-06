// Check that this tree, built WITHOUT VITE_REAL_CHAIN, makes exactly the site another
// commit makes (main by default): preprod mode and mainnet mode, every file, byte for byte.
//
//   node bboard-ui/real-chain/compare-with-main.mjs [git ref, default origin/main]
//
// The other commit is checked out in a temporary worktree NEXT TO this one, with its own
// `npm ci`: the bundler's chunk names depend on where the tree sits (a symlinked
// node_modules, or a tree nested deeper, gives other names for the same content), so the
// two trees must sit at the same depth with real node_modules each. The
// compiled contracts are not in git; both builds use this tree's contract/src/managed.
// Mainnet mode is built with a stand-in deploy guard (two made-up addresses), the same
// way src/site-mainnet.test.ts does, because the real pins are empty until deploy day.
// Takes a few minutes. Exits 1 on any difference.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ref = process.argv[2] ?? 'origin/main';
const ui = fileURLToPath(new URL('..', import.meta.url));
const repo = path.resolve(ui, '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'vc-compare-'));
const other = path.join(path.dirname(repo), `.vc-compare-${process.pid}`);
const guard = path.join(tmp, 'guard.ts');
writeFileSync(
  guard,
  `export const MAINNET_VEILCORE_ADDRESS = '${'ab'.repeat(32)}';\nexport const MAINNET_CLAIMS_ADDRESS = '${'cd'.repeat(32)}';\n`,
);

const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(VITE_|VITEST|NODE_ENV$|MODE$|VEILCORE_TEST_DEPLOY_GUARD$)/.test(k)),
);
const run = (cmd, args, cwd, extra = {}) => {
  const r = spawnSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: 'pipe' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} (in ${cwd}) failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
};
const builds = [
  { name: 'preprod', mode: 'preprod', extra: {} },
  { name: 'mainnet', mode: 'mainnet', extra: { VEILCORE_TEST_DEPLOY_GUARD: guard } },
];
const buildIn = (root, b) =>
  run(
    'npx',
    [
      'vite',
      'build',
      '--mode',
      b.mode,
      '--outDir',
      path.join(tmp, `${path.basename(root)}-${b.name}`),
      '--emptyOutDir',
      '--logLevel',
      'error',
    ],
    path.join(root, 'bboard-ui'),
    {
      NODE_ENV: 'production',
      VITE_API_BASE: 'https://veilcore-api-production.up.railway.app',
      ...b.extra,
    },
  );

let same = true;
try {
  execFileSync('git', ['worktree', 'add', '--detach', other, ref], { cwd: repo, stdio: 'pipe' });
  cpSync(path.join(repo, 'contract/src/managed'), path.join(other, 'contract/src/managed'), { recursive: true });
  console.log(`Installing ${ref} (npm ci)…`);
  run('npx', ['-y', 'npm@11.6.2', 'ci', '--no-audit', '--no-fund'], other);
  for (const b of builds) {
    console.log(`Building ${b.name}: this tree and ${ref}…`);
    buildIn(repo, b);
    buildIn(other, b);
    const a = path.join(tmp, `${path.basename(repo)}-${b.name}`);
    const o = path.join(tmp, `${path.basename(other)}-${b.name}`);
    const d = spawnSync('diff', ['-r', o, a], { encoding: 'utf8' });
    if (d.status === 0) console.log(`${b.name}: byte for byte the same as ${ref}.`);
    else {
      same = false;
      console.log(`${b.name}: DIFFERS from ${ref}:\n${d.stdout.slice(0, 4000)}`);
    }
  }
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', other], { cwd: repo });
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(same ? 0 : 1);
