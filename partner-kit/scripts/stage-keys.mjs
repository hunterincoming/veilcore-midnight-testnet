// Prepare the proving keys, verifier keys and circuits for publishing, so partners can
// fetch them (`veilcore-keys fetch`, or the package's default keys URL). Run on the
// machine that built the keys (a full `npm run compact`), from partner-kit/:
//
//   npm run keys:stage
//
// Writes partner-kit/zk-release/ (gitignored): one file per artefact, named
// <contract>.<circuit>.<prover|verifier|bzkir>, each checked against docs/fingerprints.md
// first, plus SHA256SUMS. Upload every file in it as an asset of ONE GitHub release
// tagged zk-r4 (the folder DEFAULT_KEYS_URL names). Nothing in it is secret: these are
// the public parameters of the circuits, and every client checks every file it downloads.
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowsOf, splitDoc } from '../../contract/fingerprints.mjs';

const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(pkg, '..');
const managed = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repo, 'contract', 'src', 'managed');
const out = path.join(pkg, 'zk-release');
const doc = splitDoc(readFileSync(path.join(repo, 'docs', 'fingerprints.md'), 'utf8'));
const tables = { veilcore: rowsOf(doc.main), 'veilcore-claims': rowsOf(doc.claims) };
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const sums = [];
const problems = [];
for (const [contract, table] of Object.entries(tables)) {
  for (const [rel, want] of table) {
    const m = /^(keys\/(.+)\.(prover|verifier)|zkir\/(.+)\.bzkir)$/.exec(rel);
    if (m === null) continue; // contract/index.js ships in the npm package; .zkir is not needed to prove
    const circuit = m[2] ?? m[4];
    const kind = m[3] ?? 'bzkir';
    const from = path.join(managed, contract, rel);
    if (!existsSync(from)) {
      problems.push(`${contract}/${rel} is missing (run a full npm run compact, not --skip-zk)`);
      continue;
    }
    if (sha(from) !== want) {
      problems.push(`${contract}/${rel} does not match docs/fingerprints.md`);
      continue;
    }
    const name = `${contract}.${circuit}.${kind}`;
    copyFileSync(from, path.join(out, name));
    sums.push(`${want}  ${name}`);
  }
}
if (problems.length > 0) {
  rmSync(out, { recursive: true, force: true });
  console.error(`Nothing staged:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
writeFileSync(path.join(out, 'SHA256SUMS'), `${sums.sort().join('\n')}\n`);
console.log(`Staged ${sums.length} files and SHA256SUMS in ${out}.`);
console.log('Upload every file in it as an asset of one GitHub release tagged zk-r4.');
