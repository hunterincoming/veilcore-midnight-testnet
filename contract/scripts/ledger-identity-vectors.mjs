// Regenerate contract/vectors/ledger-identity-sdk.json from a built veilcore-sdk:
//   node contract/scripts/ledger-identity-vectors.mjs <path to veilcore-sdk>/dist
// SPDX-License-Identifier: Apache-2.0
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const sdk = process.argv[2];
if (!sdk) throw new Error('usage: node ledger-identity-vectors.mjs <veilcore-sdk dist directory>');
const { computeCommitment } = await import(pathToFileURL(path.resolve(sdk, 'commit.js')).href);
const OUT = fileURLToPath(new URL('../vectors/ledger-identity-sdk.json', import.meta.url));
import { writeFileSync } from 'node:fs';
const base = {
  formatVersion: '0.1', recordId: 'vc_rec_li', subjectType: 'plant-genetic-material',
  profile: 'veilcore/profile/cannabis/v0.1', commitmentAlgorithm: 'sha256/fields/v1',
  sealedAt: '2026-10-04T00:00:00Z', holder: { id: 'vc_hld_test' }, profileData: { cultivarName: 'Harbour Mist' },
  fieldSchema: '875d8a6c21137ec1aae6d2c8ad6b929c4ef53b09a247a834f39b126dc910f5f9', fieldSetRoot: '3c'.repeat(32),
};
const id = 'cd'.repeat(32);
const cases = [
  ['no ledgerIdentity', {}],
  ['chain and identity', { ledgerIdentity: { chain: 'midnight:preprod', identity: id } }],
  ['chain, identity and contractAddress', { ledgerIdentity: { chain: 'midnight:mainnet', identity: id, contractAddress: 'ab'.repeat(32) } }],
  ['another identity', { ledgerIdentity: { chain: 'midnight:preprod', identity: 'ee'.repeat(32) } }],
  ['null', { ledgerIdentity: null }],
  ['an array', { ledgerIdentity: [] }],
  ['a string', { ledgerIdentity: id }],
  ['an unknown field', { ledgerIdentity: { chain: 'midnight:preprod', identity: id, note: 'x' } }],
  ['an empty chain', { ledgerIdentity: { chain: '', identity: id } }],
  ['no chain', { ledgerIdentity: { identity: id } }],
  ['a numeric chain', { ledgerIdentity: { chain: 1, identity: id } }],
  ['no identity', { ledgerIdentity: { chain: 'midnight:preprod' } }],
  ['an uppercase identity', { ledgerIdentity: { chain: 'midnight:preprod', identity: id.toUpperCase() } }],
  ['a short identity', { ledgerIdentity: { chain: 'midnight:preprod', identity: 'cd'.repeat(31) } }],
  ['a bad contractAddress', { ledgerIdentity: { chain: 'midnight:preprod', identity: id, contractAddress: '0x' + 'ab'.repeat(31) } }],
  ['a numeric contractAddress', { ledgerIdentity: { chain: 'midnight:preprod', identity: id, contractAddress: 5 } }],
  ['a null contractAddress', { ledgerIdentity: { chain: 'midnight:preprod', identity: id, contractAddress: null } }],
  ['an empty object', { ledgerIdentity: {} }],
];
const out = [];
for (const [name, extra] of cases) {
  const record = { ...base, ...extra };
  try { out.push({ name, record, commitment: await computeCommitment(record) }); }
  catch (e) { out.push({ name, record, refused: e.message }); }
}
writeFileSync(OUT, JSON.stringify({
  source: 'veilcore-sdk src/commit.ts computeCommitment (checkLedgerIdentity), run on these records; regenerate from the SDK, never by hand',
  records: out }, null, 2) + '\n');
console.log(out.map(o => o.name + ': ' + (o.commitment ?? 'REFUSED ' + o.refused)).join('\n'));
