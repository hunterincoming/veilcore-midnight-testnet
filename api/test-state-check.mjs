// What a verifier checks about the state it judges besides its data (src/state-check.ts),
// and the second-indexer agreement in the lookup (src/presentation-lookup.ts). 8 October
// 2026 review: a maintenance-key holder could swap a circuit's verifier key, act, and put
// it back; and one indexer could report a root that was never on chain.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ContractMaintenanceAuthority, createConstructorContext, sampleSigningKey, signatureVerifyingKey } from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../contract/src/managed/veilcore/contract/index.js';
import {
  ContractStateMismatchError,
  authorityReport,
  checkContractState,
  pinnedVerifierKeys,
  verifierKeyMismatches,
  withMainnetPins,
} from './src/state-check.ts';
import { singleCallState } from './src/presentation-lookup.ts';

const witnesses = new Proxy({}, { get: () => (c) => [c.privateState, new Uint8Array(32)] });
const PROVABLE_CIRCUITS = Object.keys(new Contract(witnesses).provableCircuits);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const vk = (n) => new TextEncoder().encode(`vk:${n}`);

// ── the pins are the deployment record's
const pins = pinnedVerifierKeys('veilcore');
assert.deepEqual(Object.keys(pins).sort(), [...PROVABLE_CIRCUITS].sort());
assert.equal(pins.proveLicense, 'b338dda3501ae2dec26b241b353495580debcb359455b0671b6619197f29d59b');
assert.equal(Object.keys(pinnedVerifierKeys('veilcore-claims')).length, 5);
console.log('pins: 24 main-contract circuits and 5 claims circuits, from docs/fingerprints.md');

// ── a state stands in through the same interface ContractState has
const standIn = (keys, authority = { committee: [1], threshold: 1, counter: 16n }) => ({
  operations: () => Object.keys(keys),
  operation: (n) => (n in keys ? { verifierKey: keys[n] } : undefined),
  maintenanceAuthority: authority,
});
const names = ['anchor', 'proveLicense', 'revokeLicense'];
const testPins = Object.fromEntries(names.map((n) => [n, sha(vk(n))]));
const genuine = Object.fromEntries(names.map((n) => [n, vk(n)]));

assert.deepEqual(verifierKeyMismatches(standIn(genuine), testPins), []);
assert.deepEqual(verifierKeyMismatches(standIn({ ...genuine, proveLicense: vk('forged') }), testPins), ['proveLicense']);
assert.deepEqual(verifierKeyMismatches(standIn({ ...genuine, extra: vk('extra') }), testPins), ['extra']);
const { revokeLicense: _gone, ...missing } = genuine;
assert.deepEqual(verifierKeyMismatches(standIn(missing), testPins), ['revokeLicense']);
assert.deepEqual(verifierKeyMismatches(standIn({ ...genuine, anchor: undefined }), testPins), ['anchor']);
console.log('verifier keys: exact build matches; a swapped, extra, missing or empty key is named');

// ── refusal carries the authority, so the change is visible
assert.throws(
  () => checkContractState(standIn({ ...genuine, proveLicense: vk('forged') }), { verifierKeys: testPins }),
  (e) => e instanceof ContractStateMismatchError && e.circuits.includes('proveLicense') && e.authority.counter === 16n && /live: 1 key/.test(e.message),
);
assert.deepEqual(checkContractState(standIn(genuine), { verifierKeys: testPins }), {
  authority: { committee: 1, threshold: 1, counter: 16n, retired: false },
  keys: 'pinned',
});
assert.equal(checkContractState(standIn({ x: vk('anything') }), {}).keys, 'unchecked');
// Swap, act, restore: both states carry the pinned keys; the counter shows the change.
assert.throws(
  () => checkContractState(standIn(genuine, { committee: [1], threshold: 1, counter: 18n }), { verifierKeys: testPins, authorityCounter: 16n }),
  (e) => e instanceof ContractStateMismatchError && /counter .* is 18, not 16/.test(e.message),
);
assert.deepEqual(authorityReport(standIn(genuine, { committee: [], threshold: 1, counter: 1n })), {
  committee: 0, threshold: 1, counter: 1n, retired: true,
});
console.log('refused: a swapped key (authority reported); refused: a counter other than the one required');

// ── through the lookup, on a real contract state
const OURS = 'aa'.repeat(32), TX = 'cc'.repeat(32);
const real = new Contract(witnesses).initialState(createConstructorContext({}, '0'.repeat(64))).currentContractState;
real.maintenanceAuthority = new ContractMaintenanceAuthority([signatureVerifyingKey(sampleSigningKey())], 1, 16n);
const STATE = Buffer.from(real.serialize()).toString('hex');
const tx = (state, over = {}) => ({
  identifiers: [TX], transactionResult: { status: 'SUCCESS' }, block: { height: 7, timestamp: 1_790_000_000_000 },
  contractActions: [{ address: OURS, state, entryPoint: 'anchorBatch' }], ...over,
});
const serve = (byUrl) => {
  globalThis.fetch = async (url) => {
    const t = byUrl[String(url)];
    return { ok: true, json: async () => ({ data: { transactions: t ? [t] : [] } }) };
  };
};
const look = (check) => singleCallState('http://one', OURS, TX, ['anchorBatch'], 'not a batch', undefined, check);

serve({ 'http://one': tx(STATE) });
const found = await look({});
assert.equal(found.keys, 'unchecked');
assert.deepEqual(found.authority, { committee: 1, threshold: 1, counter: 16n, retired: false });
console.log('reported: the maintenance authority at the transaction (1 key, threshold 1, counter 16)');
// The constructor's operations carry no verifier key at all: not the pinned build.
await assert.rejects(() => look({ verifierKeys: pins }), (e) => e instanceof ContractStateMismatchError && e.circuits.length === 24);
console.log('refused: a state whose verifier keys are not the pinned build');

// ── a second indexer must agree
const other = new Contract(witnesses).initialState(createConstructorContext({}, '0'.repeat(64))).currentContractState;
const OTHER = Buffer.from(other.serialize()).toString('hex');
serve({ 'http://one': tx(STATE), 'http://two': tx(STATE) });
assert.equal((await look({ secondIndexer: 'http://two' })).blockHeight, 7);
console.log('accepted: two indexers report the same transaction, block and state');
serve({ 'http://one': tx(STATE), 'http://two': tx(OTHER) });
await assert.rejects(() => look({ secondIndexer: 'http://two' }), /disagree .*contract state/);
serve({ 'http://one': tx(STATE), 'http://two': tx(STATE, { block: { height: 8, timestamp: 1_790_000_000_000 } }) });
await assert.rejects(() => look({ secondIndexer: 'http://two' }), /disagree .*block/);
// Verification review: the block time was not compared, so a first indexer could make an
// old presentation look fresh for rule 5's one-hour limit.
serve({ 'http://one': tx(STATE), 'http://two': tx(STATE, { block: { height: 7, timestamp: 1_790_000_000_000 - 5 * 3_600_000 } }) });
await assert.rejects(() => look({ secondIndexer: 'http://two' }), /disagree .*block time/);
serve({ 'http://one': tx(STATE) });
await assert.rejects(() => look({ secondIndexer: 'http://two' }), /second indexer does not confirm .*No such transaction/);
serve({ 'http://one': tx(STATE), 'http://two': tx(STATE, { transactionResult: { status: 'FAILURE' } }) });
await assert.rejects(() => look({ secondIndexer: 'http://two' }), /second indexer does not confirm/);
console.log('refused: a second indexer with another state, block, block time, no such transaction, or a failure');
// Verification review: on mainnet a caller's own verifierKeys table replaced the pins.
// Now the pins always apply there; a caller adds checks, never replaces them.
const weaker = { verifierKeys: { anchor: 'ab'.repeat(32) }, authorityCounter: 16n, secondIndexer: 'http://two' };
assert.deepEqual(withMainnetPins(weaker, 'veilcore', 'mainnet'), { ...weaker, verifierKeys: pins });
assert.deepEqual(withMainnetPins({}, 'veilcore-claims', 'mainnet').verifierKeys, pinnedVerifierKeys('veilcore-claims'));
assert.equal(withMainnetPins(weaker, 'veilcore', 'preprod'), weaker);
assert.equal(withMainnetPins({}, 'veilcore', null).verifierKeys, undefined);
console.log('mainnet: the pinned keys always apply; a caller adds a counter or a second indexer, never its own pins');
console.log('\nall state checks pass');
