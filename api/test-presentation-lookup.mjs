// The verifier's transaction lookup (src/presentation-lookup.ts), against a fake indexer
// that tries every way a licensee could point it at the wrong thing.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../contract/src/managed/veilcore/contract/index.js';
import { presentationState } from './src/presentation-lookup.ts';

const OURS = 'aa'.repeat(32), THEIRS = 'bb'.repeat(32), TX = 'cc'.repeat(32);
const noop = (c) => [c.privateState, new Uint8Array(32)];
const witnesses = new Proxy({}, { get: () => noop });
const state = new Contract(witnesses).initialState(createConstructorContext({}, '0'.repeat(64))).currentContractState;
const STATE = Buffer.from(state.serialize()).toString('hex');

const answer = (tx) => { globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { transactions: tx ? [tx] : [] } }) }); };
const call = (over = {}) => ({ identifiers: [TX], transactionResult: { status: 'SUCCESS' }, contractActions: [{ address: OURS, state: STATE, entryPoint: 'proveLicense' }], ...over });
const refuses = async (name, tx, msg) => {
  answer(tx);
  await assert.rejects(() => presentationState('http://indexer', OURS, TX), (e) => e.message.includes(msg), name);
  console.log(`refused, as it should be: ${name}`);
};

answer(call());
const ledger = await presentationState('http://indexer', OURS, TX);
assert.equal(ledger.protocolVersion, 1n);
console.log('accepted: a successful proveLicense call on this contract');

await refuses('no such transaction', null, 'No such transaction');
await refuses('a failed transaction', call({ transactionResult: { status: 'FAILURE' } }), 'did not succeed');
await refuses('a partly failed transaction', call({ transactionResult: { status: 'PARTIAL_SUCCESS' } }), 'did not succeed');
await refuses('a look-alike contract', call({ contractActions: [{ address: THEIRS, state: STATE, entryPoint: 'proveLicense' }] }), 'not a single licence presentation');
await refuses('a later transaction (a seal)', call({ contractActions: [{ address: OURS, state: STATE, entryPoint: 'sealRevocations' }] }), 'not a single licence presentation');
await refuses('two presentations in one transaction', call({ contractActions: [{ address: OURS, state: STATE, entryPoint: 'proveLicense' }, { address: OURS, state: STATE, entryPoint: 'proveLicense' }] }), 'not a single licence presentation');
await assert.rejects(() => presentationState('http://indexer', OURS, 'not-hex'), /not a transaction id/);
console.log('refused, as it should be: a malformed id\n\nall lookup checks pass');
