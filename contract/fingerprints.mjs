// Records the SHA-256 of every compiled artefact a deployment uses: the proving and
// verifying keys, the circuits' ZKIR, and the contract code that builds the initial
// state. Run AFTER a full `npm run compact` (not --skip-zk, which produces no keys).
// Writes docs/fingerprints.md, the table the deployment record carries; a mainnet
// deploy from the CLI refuses unless the local build matches it as committed
// (bboard-cli/src/keys-check.ts). A reviewer reproduces it from the same commit with
// the same compiler.
//
//   npm run fingerprints
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const managed = path.join(here, 'src', 'managed', 'veilcore');
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const run = (cmd) => { try { return execSync(cmd, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const commit = run('git rev-parse --short HEAD') || 'unknown';
const compiler = run('compact compile --version') || run('compactc --version') || 'unknown';

/** The artefacts, as paths relative to managed/veilcore. Keep in step with keys-check.ts. */
const list = (dir, re) => (existsSync(path.join(managed, dir)) ? readdirSync(path.join(managed, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
const keys = list('keys', /\.(prover|verifier)$/);
const zkir = list('zkir', /\.b?zkir$/);
const circuits = zkir.filter((f) => f.endsWith('.zkir')).length;
const files = [...keys, ...zkir, 'contract/index.js'];

const out = ['# Build fingerprints', '', `Commit \`${commit}\`, compiler \`${compiler}\`, built with \`npm run compact\`.`, '', '| Artefact | SHA-256 |', '|---|---|'];
const problems = [];
if (keys.length === 0) problems.push('no keys: run a full npm run compact first');
else if (keys.length !== 2 * circuits) problems.push(`expected ${2 * circuits} keys for ${circuits} circuits, found ${keys.length}`);
if (compiler === 'unknown') problems.push('could not read the compiler version');
for (const f of files) {
  const full = path.join(managed, f);
  if (!existsSync(full) || readFileSync(full).length === 0) { problems.push(`${f} is missing or empty`); continue; }
  out.push(`| \`${f}\` | \`${sha(full)}\` |`);
}
const text = out.join('\n') + '\n';
console.log(text);
if (problems.length) { console.error(`NOT COMPLETE: ${problems.join('; ')}. Nothing written.`); process.exit(1); }
writeFileSync(path.join(here, '..', 'docs', 'fingerprints.md'), text);
console.error('Written to docs/fingerprints.md. Commit and push it: a mainnet deploy checks the build against the committed copy.');
