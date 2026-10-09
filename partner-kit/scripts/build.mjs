// Builds the package: dist/index.js (one ES module), dist/veilcore-keys.js (the bin),
// the compiled contract code byte for byte as fingerprinted, and type declarations.
//
// The contract code is not bundled: it is copied unchanged to dist/managed/<contract>/contract/
// and imported from there, so anyone can check the shipped file against the deployment
// record (its SHA-256 is FINGERPRINTS[...]['contract/index.js']). The build refuses to run
// on a compiled contract that does not match. Keys and circuits are never shipped (keys.ts).
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..');
const repo = path.join(pkg, '..');
const dist = path.join(pkg, 'dist');
const managed = path.join(repo, 'contract', 'src', 'managed');
const CONTRACTS = ['veilcore', 'veilcore-claims'];

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const fingerprints = readFileSync(path.join(pkg, 'src', 'fingerprints.ts'), 'utf8');
const recorded = (contract) => {
  const part = fingerprints.split(`${contract === 'veilcore' ? '  veilcore: {' : "  'veilcore-claims': {"}`)[1] ?? '';
  return /'contract\/index\.js': '([0-9a-f]{64})'/.exec(part)?.[1];
};

for (const c of CONTRACTS) {
  const f = path.join(managed, c, 'contract', 'index.js');
  if (!existsSync(f)) {
    console.error(`${f} is missing. Compile the contracts first: cd contract && npm run compact`);
    process.exit(1);
  }
  if (sha(f) !== recorded(c)) {
    console.error(
      `${path.relative(repo, f)} is not the contract code the deployment record names. ` +
        'Rebuild with compiler 0.31.1 (cd contract && npm run compact). Nothing was built.',
    );
    process.exit(1);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// The compiled contracts, unchanged, imported by path from the bundle.
for (const c of CONTRACTS) {
  const to = path.join(dist, 'managed', c, 'contract');
  mkdirSync(to, { recursive: true });
  // The map is the compiler's, with relative paths and no source text; index.js names it.
  for (const f of ['index.js', 'index.js.map', 'index.d.ts'])
    cpSync(path.join(managed, c, 'contract', f), path.join(to, f));
}
const managedExternal = {
  name: 'managed-external',
  setup(b) {
    b.onResolve({ filter: /managed\/(veilcore|veilcore-claims)\/contract\/index(\.js)?$/ }, (args) => {
      const c = /managed\/(veilcore|veilcore-claims)\/contract/.exec(args.path)?.[1];
      return { path: `./managed/${c}/contract/index.js`, external: true };
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  legalComments: 'inline',
  logLevel: 'warning',
  plugins: [managedExternal],
  metafile: true,
};
const main = await build({
  ...common,
  entryPoints: [path.join(pkg, 'src', 'index.ts')],
  outfile: path.join(dist, 'index.js'),
});
await build({
  ...common,
  entryPoints: [path.join(pkg, 'src', 'bin', 'veilcore-keys.ts')],
  outfile: path.join(dist, 'veilcore-keys.js'),
  banner: { js: '#!/usr/bin/env node' },
});

// Every package the bundle imports must be a declared dependency.
const declared = new Set(
  Object.keys(JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).dependencies ?? {}),
);
const imported = new Set();
for (const out of Object.values(main.metafile?.outputs ?? {}))
  for (const i of out.imports ?? [])
    if (i.external && !i.path.startsWith('.') && !i.path.startsWith('node:')) {
      const p = i.path.startsWith('@') ? i.path.split('/').slice(0, 2).join('/') : i.path.split('/')[0];
      imported.add(p);
    }
const missing = [...imported].filter((p) => !declared.has(p));
if (missing.length > 0) {
  console.error(`The bundle imports packages package.json does not declare: ${missing.join(', ')}`);
  process.exit(1);
}

// Declarations: tsc over the sources, then relative imports given the .js Node needs.
execFileSync(
  process.execPath,
  [path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(pkg, 'tsconfig.types.json')],
  {
    stdio: 'inherit',
  },
);
const types = path.join(dist, 'types');
for (const c of CONTRACTS)
  cpSync(
    path.join(managed, c, 'contract', 'index.d.ts'),
    path.join(types, 'contract', 'src', 'managed', c, 'contract', 'index.d.ts'),
  );
const walk = (d) =>
  readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));
for (const f of walk(types).filter((f) => f.endsWith('.d.ts'))) {
  const text = readFileSync(f, 'utf8').replace(/(from\s+|import\()(['"])(\.{1,2}\/[^'"]+)\2/g, (m, pre, q, spec) => {
    if (/\.js$/.test(spec)) return m;
    const base = path.resolve(path.dirname(f), spec);
    if (existsSync(`${base}.d.ts`)) return `${pre}${q}${spec}.js${q}`;
    if (existsSync(path.join(base, 'index.d.ts'))) return `${pre}${q}${spec}/index.js${q}`;
    return m;
  });
  writeFileSync(f, text);
}
console.log(
  `Built ${path.relative(repo, dist)}: index.js, veilcore-keys.js, managed/ (contract code as fingerprinted), types/`,
);
