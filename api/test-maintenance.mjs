// Provable retirement (src/maintenance.ts), against a real ledger: Midnight's own ledger
// code (ledger-v8, the WebAssembly build the node is made from) holding a contract in a
// local LedgerState. No proofs are involved: maintenance updates are signed, not proved.
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import * as L from '@midnight-ntwrk/ledger-v8';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { isProvablyRetired, provableRetirementUpdate, retireMaintenanceAuthorityProvably } from './src/maintenance.ts';

const NET = 'undeployed';
setNetworkId(NET);

/** A one-contract chain whose transactions are checked by the real ledger rules. */
const chain = () => {
  let state = L.LedgerState.blank(NET);
  const strict = new L.WellFormedStrictness();
  strict.enforceBalancing = false; // no fees here: nothing else in the transaction to pay them
  strict.verifyContractProofs = false;
  strict.verifyNativeProofs = false;
  // Signatures and limits ARE checked: that is what this test is about.
  assert.equal(strict.verifySignatures, true);
  const apply = (unproven) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const v = unproven.eraseProofs().wellFormed(state, strict, new Date());
    const ctx = new L.TransactionContext(state, {
      secondsSinceEpoch: now,
      secondsSinceEpochErr: 30,
      parentBlockHash: '00'.repeat(32),
      lastBlockTime: now - 6n,
    });
    const [next, result] = state.apply(v, ctx);
    if (result.type !== 'success') throw new Error(`refused by the ledger: ${result.error ?? result.type}`);
    state = next;
  };
  const ttl = () => new Date(Date.now() + 3_600_000);
  const key = L.sampleSigningKey();
  const cs = new L.ContractState();
  cs.maintenanceAuthority = new L.ContractMaintenanceAuthority([L.signatureVerifyingKey(key)], 1, 0n);
  const deploy = new L.ContractDeploy(cs);
  apply(L.Transaction.fromParts(NET, undefined, undefined, L.Intent.new(ttl()).addDeploy(deploy)));
  const address = deploy.address;
  const update = (u) =>
    apply(L.Transaction.fromParts(NET, undefined, undefined, L.Intent.new(ttl()).addMaintenanceUpdate(u)));
  const authority = () => state.index(address).maintenanceAuthority;
  return { key, address, apply, update, authority, state: () => state };
};

// ── the update's shape ─────────────────────────────────────────────────────────
{
  const c = chain();
  const before = c.authority();
  assert.equal(isProvablyRetired(before), false);
  const u = provableRetirementUpdate(c.address, before, c.key);
  assert.equal(u.address, c.address);
  assert.equal(u.counter, 0n, 'valid against the current counter');
  assert.equal(u.updates.length, 1, 'one instruction, nothing else');
  assert.ok(u.updates[0] instanceof L.ReplaceAuthority, 'it replaces the authority');
  const next = u.updates[0].authority;
  assert.deepEqual(next.committee, [], 'the new committee is empty');
  assert.equal(next.threshold, 1, 'and needs one signature');
  assert.equal(next.counter, 1n, 'counter + 1');
  assert.equal(u.signatures.length, 1);
  assert.equal(u.signatures[0][0], 0n, 'signed by committee member 0');
  assert.ok(L.verifySignature(L.signatureVerifyingKey(c.key), u.dataToSign, u.signatures[0][1]), 'by the current key');
  console.log('shape: ReplaceAuthority(committee [], threshold 1, counter + 1), signed by the current key');
}

// ── applied by the ledger ──────────────────────────────────────────────────────
{
  const c = chain();
  c.update(provableRetirementUpdate(c.address, c.authority(), c.key));
  const after = c.authority();
  assert.equal(after.committee.length, 0);
  assert.equal(after.threshold, 1);
  assert.equal(after.counter, 1n);
  assert.equal(isProvablyRetired(after), true);
  console.log('accepted by the ledger: the contract state now shows committee [], threshold 1');

  // Nobody can change it any more: not the old key, not an unsigned update, not to add a key.
  const back = new L.MaintenanceUpdate(
    c.address,
    [new L.ReplaceAuthority(new L.ContractMaintenanceAuthority([L.signatureVerifyingKey(c.key)], 1, 2n))],
    1n,
  );
  assert.throws(() => c.update(back.addSignature(0n, L.signData(c.key, back.dataToSign))), /committee member/);
  console.log('refused, as it should be: the old key putting itself back');
  assert.throws(() => c.update(back), /threshold/);
  console.log('refused, as it should be: an update with no signature at all');
  // (No verifier key can be built here without the proving parameters; removing one is
  // checked by the same signature rule.)
  const remove = new L.MaintenanceUpdate(
    c.address,
    [new L.VerifierKeyRemove('proveValue', new L.ContractOperationVersion('v3'))],
    1n,
  );
  assert.throws(() => c.update(remove.addSignature(0n, L.signData(c.key, remove.dataToSign))), /committee member/);
  assert.throws(() => c.update(remove), /threshold/);
  console.log('refused, as it should be: changing a verifier key, signed or not');
  const other = L.sampleSigningKey();
  assert.throws(() => c.update(back.addSignature(0n, L.signData(other, back.dataToSign))), /committee member/);
  console.log('refused, as it should be: any other key');
}

// ── the API function, end to end against the same ledger ──────────────────────
{
  const c = chain();
  const store = new Map([[c.address, c.key]]);
  let submitted = 0;
  const providers = {
    publicDataProvider: {
      queryContractState: async (a) => c.state().index(a),
      watchForTxData: async (txId) => ({ txId, txHash: txId, blockHeight: 1, status: 'SucceedEntirely' }),
    },
    proofProvider: { proveTx: async (tx) => tx },
    walletProvider: { balanceTx: async (tx) => tx },
    midnightProvider: {
      submitTx: async (tx) => {
        submitted++;
        c.apply(tx);
        return `tx${submitted}`;
      },
    },
    privateStateProvider: {
      getSigningKey: async (a) => store.get(a),
      removeSigningKey: async (a) => void store.delete(a),
    },
  };
  await retireMaintenanceAuthorityProvably(providers, c.address, undefined, 1);
  assert.equal(isProvablyRetired(c.authority()), true);
  assert.equal(store.has(c.address), false, 'the key is deleted once the chain shows the retirement');
  console.log('retireMaintenanceAuthorityProvably: sent once, confirmed on the ledger, key deleted');

  await retireMaintenanceAuthorityProvably(providers, c.address, undefined, 1);
  assert.equal(submitted, 1, 'a second run sends nothing');
  console.log('run again: already retired, nothing sent');

  const d = chain();
  await assert.rejects(
    () =>
      retireMaintenanceAuthorityProvably(
        {
          ...providers,
          publicDataProvider: { ...providers.publicDataProvider, queryContractState: async (a) => d.state().index(a) },
        },
        d.address,
        undefined,
        1,
      ),
    /not on this computer/,
  );
  console.log('refused, as it should be: no key on this computer, nothing sent');
}

console.log('\nall provable-retirement checks pass');
