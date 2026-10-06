// Writes src/fingerprints.ts from docs/fingerprints.md: the SHA-256 of every compiled
// artefact of both contracts, as the deployment record carries them. The package checks
// every proving key, verifier key and circuit (.bzkir) it loads against this table, and
// the build refuses to ship contract code that is not in it.
//
// Run after docs/fingerprints.md changes (it should not: both tables are frozen):
//   npm run fingerprints -w @veilcore/contracts
// test/keys.test.ts fails if the two ever differ.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowsOf, splitDoc } from '../../contract/fingerprints.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(path.join(here, '..', '..', 'docs', 'fingerprints.md'), 'utf8');
const { main, claims } = splitDoc(doc);
const built = (part) => {
  const m = /Commit `([0-9a-f]+)`, compiler `([^`]+)`/.exec(part);
  if (m === null) throw new Error('docs/fingerprints.md: no "Commit `...`, compiler `...`" line');
  return { commit: m[1], compiler: m[2] };
};
const table = (part) => {
  const rows = [...rowsOf(part)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (rows.length === 0) throw new Error('docs/fingerprints.md: a table is empty');
  return rows.map(([f, h]) => `    '${f}': '${h}',`).join('\n');
};

const out = `// GENERATED from docs/fingerprints.md by scripts/gen-fingerprints.mjs. Do not edit.
// The SHA-256 of every compiled artefact of both VeilCore contracts, as the deployment
// record (revision 4) carries them. Every key and circuit this package loads is checked
// against it (keys.ts), and the build refuses contract code that is not in it.
// SPDX-License-Identifier: Apache-2.0

export const FINGERPRINTS = {
  veilcore: {
${table(main)}
  },
  'veilcore-claims': {
${table(claims)}
  },
} as const;

/** Where each table was built: commit and compiler (docs/fingerprints.md). */
export const FINGERPRINTS_BUILT = {
  veilcore: { commit: '${built(main).commit}', compiler: '${built(main).compiler}' },
  'veilcore-claims': { commit: '${built(claims).commit}', compiler: '${built(claims).compiler}' },
} as const;
`;
writeFileSync(path.join(here, '..', 'src', 'fingerprints.ts'), out);
console.log('Wrote src/fingerprints.ts');
