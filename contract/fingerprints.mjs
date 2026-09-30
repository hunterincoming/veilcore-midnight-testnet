// Prints the SHA-256 of every proving and verifying key, for the deployment record.
//
// Run AFTER a full `npm run compact` (not --skip-zk, which produces no keys). A
// reviewer reproduces these by checking out the same commit, running the same two
// commands, and comparing. Also writes docs/fingerprints.md so the table is committed
// next to the source it describes.
//
//   node contract/fingerprints.mjs
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim(); } catch {}

const out = [`# Key fingerprints`, ``, `Commit \`${commit}\`, built with \`npm run compact\`.`, ``];
let missing = false;
for (const contract of ['veilcore', 'lineage']) {
  const dir = path.join(here, 'src', 'managed', contract, 'keys');
  out.push(`## ${contract}`, '', '| Artefact | SHA-256 |', '|---|---|');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(prover|verifier)$/.test(f)).sort() : [];
  if (files.length === 0) { missing = true; out.push('| (no keys — run a full `npm run compact` first) | |'); }
  for (const f of files) {
    const full = path.join(dir, f);
    if (readFileSync(full).length === 0) { missing = true; out.push(`| \`keys/${f}\` | EMPTY — the build did not finish |`); continue; }
    out.push(`| \`keys/${f}\` | \`${sha(full)}\` |`);
  }
  out.push('');
}
const text = out.join('\n');
console.log(text);
if (missing) { console.error('\nNOT COMPLETE: some keys are missing or empty. Nothing written.'); process.exit(1); }
writeFileSync(path.join(here, '..', 'docs', 'fingerprints.md'), text + '\n');
console.error('\nWritten to docs/fingerprints.md');
