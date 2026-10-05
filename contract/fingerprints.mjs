// Records the SHA-256 of every compiled artefact a deployment uses: the proving and
// verifying keys, the circuits' ZKIR, and the contract code that builds the initial
// state. Run AFTER a full `npm run compact` (not --skip-zk, which produces no keys).
// Writes docs/fingerprints.md, the tables the deployment record carries; a mainnet
// deploy from the CLI refuses unless the local build matches them as committed
// (bboard-cli/src/keys-check.ts). A reviewer reproduces them from the same commit with
// the same compiler.
//
// The file holds two tables: the main contract's at the top, the claims contract's under
// the heading "## Claims contract". Each mode rewrites its own table and leaves the other
// exactly as it was.
//
//   npm run fingerprints          the main contract (managed/veilcore)
//   npm run fingerprints:claims   the claims contract (managed/veilcore-claims); refuses
//                                 unless this build of the main contract still matches
//                                 its committed table, so both come from one toolchain
//   npm run fingerprints:check    checks this build against both tables; writes nothing
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docPath = path.join(here, '..', 'docs', 'fingerprints.md');
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const run = (cmd) => { try { return execSync(cmd, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };

/** Keep in step with bboard-cli/src/keys-check.ts (CLAIMS_HEADING, parseFingerprints). */
export const CLAIMS_HEADING = '## Claims contract';
export const CLAIMS_COMMAND = 'cd contract && npm run compact && npm run fingerprints:claims';
const CLAIMS_TITLE = `${CLAIMS_HEADING} (\`veilcore-claims\`)`;
const ROW = /^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/;

/** The text before the claims heading (the main contract's part) and from it on. */
export const splitDoc = (text) => {
  const lines = text.replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => l.startsWith(CLAIMS_HEADING));
  if (at < 0) return { main: text.replace(/\r/g, '').replace(/\n+$/, ''), claims: '' };
  return { main: lines.slice(0, at).join('\n').replace(/\n+$/, ''), claims: lines.slice(at).join('\n').replace(/\n+$/, '') };
};

/** Rows of one part: path -> SHA-256 (as keys-check.ts reads them). */
export const rowsOf = (part) => {
  const out = new Map();
  for (const line of part.split('\n')) {
    const m = ROW.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
};

/** The claims part while no keys have been fingerprinted. */
export const claimsPlaceholder = () =>
  [
    CLAIMS_TITLE,
    '',
    'Not yet generated. The keys need the proving parameters, so this is run on the Mac that',
    'builds them, from the repository folder:',
    '',
    `    ${CLAIMS_COMMAND}`,
    '',
    'then this file is committed and pushed. Until then a mainnet claims deploy or join is',
    'refused.',
  ].join('\n');

/** The artefacts of one compiled contract, as paths relative to its managed folder. */
const artefactsOf = (managed) => {
  const list = (dir, re) => (existsSync(path.join(managed, dir)) ? readdirSync(path.join(managed, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
  const keys = list('keys', /\.(prover|verifier)$/);
  const zkir = list('zkir', /\.b?zkir$/);
  const circuits = zkir.filter((f) => f.endsWith('.zkir')).length;
  const problems = [];
  if (keys.length === 0) problems.push('no keys: run a full npm run compact first');
  else if (keys.length !== 2 * circuits) problems.push(`expected ${2 * circuits} keys for ${circuits} circuits, found ${keys.length}`);
  const rows = [];
  for (const f of [...keys, ...zkir, 'contract/index.js']) {
    const full = path.join(managed, f);
    if (!existsSync(full) || readFileSync(full).length === 0) { problems.push(`${f} is missing or empty`); continue; }
    rows.push([f, sha(full)]);
  }
  return { rows, problems };
};

/** Compare a build's rows with a committed table: a list of differences, empty if none. */
export const differences = (rows, table) => {
  const out = [];
  if (table.size === 0) return ['the table lists nothing'];
  const built = new Map(rows);
  for (const [f, h] of table) {
    if (!built.has(f)) out.push(`${f} is in the table but not in this build`);
    else if (built.get(f) !== h) out.push(`${f} differs`);
  }
  for (const f of built.keys()) if (!table.has(f)) out.push(`${f} is in this build but not in the table`);
  return out;
};

/** The first few problems, and how many more. */
const brief = (list, n = 4) => list.slice(0, n).join('; ') + (list.length > n ? `; and ${list.length - n} more` : '');

const table = (rows) => ['| Artefact | SHA-256 |', '|---|---|', ...rows.map(([f, h]) => `| \`${f}\` | \`${h}\` |`)];

const main = () => {
  const mode = process.argv[2] ?? '--main';
  if (!['--main', '--claims', '--check'].includes(mode)) {
    console.error(`Unknown mode ${mode}. Use --main, --claims or --check.`);
    process.exit(2);
  }
  const commit = run('git rev-parse --short HEAD') || 'unknown';
  const compiler = run('compact compile --version') || run('compactc --version') || 'unknown';
  const existing = existsSync(docPath) ? splitDoc(readFileSync(docPath, 'utf8')) : { main: '', claims: '' };
  const mainBuild = artefactsOf(path.join(here, 'src', 'managed', 'veilcore'));
  const claimsBuild = artefactsOf(path.join(here, 'src', 'managed', 'veilcore-claims'));

  if (mode === '--check') {
    let bad = 0;
    for (const [name, build, part] of [['main contract', mainBuild, existing.main], ['claims contract', claimsBuild, existing.claims]]) {
      const diff = [...build.problems, ...differences(build.rows, rowsOf(part))];
      if (diff.length === 0) console.log(`${name}: all ${build.rows.length} artefacts match docs/fingerprints.md.`);
      else { bad++; console.log(`${name}: DOES NOT MATCH docs/fingerprints.md: ${brief(diff)}.`); }
    }
    process.exit(bad === 0 ? 0 : 1);
  }

  const build = mode === '--claims' ? claimsBuild : mainBuild;
  const problems = [...build.problems];
  if (compiler === 'unknown') problems.push('could not read the compiler version');
  if (mode === '--claims') {
    // Both tables must come from one toolchain: the main contract's committed table is the
    // reference this build is checked against.
    const diff = differences(mainBuild.rows, rowsOf(existing.main));
    if (mainBuild.problems.length > 0 || diff.length > 0)
      problems.push(
        `this build of the MAIN contract does not match its committed fingerprints (${brief([...mainBuild.problems, ...diff])}), so this is not the toolchain the record names. Check the compiler is 0.31.1 (compact compile --version) and send Claude this output`,
      );
  }
  const header =
    mode === '--claims'
      ? [CLAIMS_TITLE, '', `Commit \`${commit}\`, compiler \`${compiler}\`, built with \`npm run compact\`. Paths are under \`contract/src/managed/veilcore-claims/\`.`, '']
      : ['# Build fingerprints', '', `Commit \`${commit}\`, compiler \`${compiler}\`, built with \`npm run compact\`.`, ''];
  const part = [...header, ...table(build.rows)].join('\n');
  console.log(part + '\n');
  if (problems.length) { console.error(`NOT COMPLETE: ${problems.join('; ')}. Nothing written.`); process.exit(1); }
  const text =
    mode === '--claims'
      ? `${existing.main}\n\n${part}\n`
      : `${part}\n\n${existing.claims === '' ? claimsPlaceholder() : existing.claims}\n`;
  writeFileSync(docPath, text);
  console.error(
    `Written to docs/fingerprints.md (${build.rows.length} ${mode === '--claims' ? 'claims contract' : 'main contract'} artefacts; the other table is unchanged). ` +
      'Commit and push it: a mainnet deploy checks the build against the committed copy.',
  );
};

// Run when invoked as a script (also through a symlinked folder, as macOS has for /tmp and
// an iCloud-synced Desktop); importing it only reads the exports.
const invoked = () => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (invoked()) main();
