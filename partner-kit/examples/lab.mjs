// A laboratory receives material, records it, and anchors it: the record format from the
// SDK (veilcore-records), the chain from @veilcore/contracts.
//
//   1. Intake: the lab seals what arrived as a VeilCore record (SDK), bound to an on-chain
//      identity for this accession (ledgerIdentity, SPEC 3.6).
//   2. Anchor: the accession's record is anchored on chain, with a recovery commitment.
//   3. The day's records go on chain as ONE batch root; each client gets an inclusion proof.
//   4. The lab signs its report (SDK) and pairs the report's fingerprint with the record.
//   5. A verifier challenges the holder; the holder proves possession; the verifier checks
//      it with no wallet at all.
//
// Run:  node examples/lab.mjs   (settings: examples/setup.mjs)
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import {
  buildBatch,
  computeCommitment,
  generateKeypair,
  newNonce,
  signAttestation,
  verifyAttestation,
  verifyCommitment,
  verifyInclusion,
} from 'veilcore-records';
import { checkBatchAnchor, checkOwnership, commit, fromHex, newChallenge, newSecret, toHex } from '@veilcore/contracts';
import { isMain, runExample } from './setup.mjs';

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export const labFlow = async ({ vc, network, endpoints }, { check, say }) => {
  const read = { network, indexer: endpoints.indexer, address: vc.address };

  // ── 1. Intake ──────────────────────────────────────────────────────────────
  // YOURS: both secrets go to your secret store BEFORE anything is sent. The record secret
  // controls the accession's identity; the recovery secret takes it back if the first is
  // lost or stolen, so it belongs offline (paper, an HSM), never on this machine in production.
  const accessionSecret = newSecret();
  const recoverySecret = newSecret();
  const record = commit.record(accessionSecret);
  const recordId = `LAB-${Date.now()}`;
  /** @type {import('veilcore-records').Envelope} */
  const intake = {
    formatVersion: '0.1',
    recordId,
    commitment: '', // computed below
    subjectType: 'plant-genetic-material',
    profile: 'veilcore/profile/plant-variety/v1',
    commitmentAlgorithm: 'sha256/canonical-json/v1',
    anchor: { chain: 'midnight', network },
    sealedAt: now(),
    holder: { id: 'lab:example', displayName: 'Example Analytical (test data)' },
    ledgerIdentity: { chain: 'midnight', contractAddress: vc.address, identity: toHex(record) },
    profileData: {
      cultivarName: 'Client submission (test data)',
      propagationType: 'vegetative',
      custodyContext: 'Received from client, 12 plantlets',
      nonce: newNonce(),
    },
  };
  intake.commitment = await computeCommitment(intake);
  check(
    (await verifyCommitment(intake)).valid,
    `intake ${recordId} sealed with the SDK, bound to its on-chain identity`,
  );

  // ── 2. Anchor the accession's record ───────────────────────────────────────
  await vc.useRecordSecret(accessionSecret);
  const anchored = await vc.anchor(commit.recovery(recoverySecret)); // the recovery COMMITMENT only
  const me = await vc.whoAmI();
  check(
    me.anchored && me.live,
    `anchor: record ${toHex(record).slice(0, 16)}… is anchored (block ${anchored.blockHeight})`,
  );

  // ── 3. The day's records, one transaction ──────────────────────────────────
  const day = [intake.commitment];
  for (let i = 1; i <= 2; i++)
    day.push(
      await computeCommitment({
        ...intake,
        recordId: `${recordId}-${i}`,
        ledgerIdentity: undefined,
        profileData: { ...intake.profileData, nonce: newNonce() },
      }),
    );
  const batch = await buildBatch(day, `${recordId}-DAY`);
  const root = fromHex(batch.root);
  const tx = await vc.anchorBatch(root);
  const proof = {
    ...batch.proofs[intake.commitment],
    anchor: { chain: 'midnight', network, contractAddress: vc.address, txHash: tx.txHash, blockHeight: tx.blockHeight },
  };
  check(await verifyInclusion(proof), `the client's inclusion proof folds to the root of ${day.length} records`);
  const onChain = await checkBatchAnchor({ ...read, txId: tx.txId, root });
  check(onChain.accepted, `a verifier with no wallet finds the root on chain: ${onChain.reason}`);

  // ── 4. Sign the report, pair its fingerprint ───────────────────────────────
  // YOURS: the lab's signing key is generated once and kept in your HSM or secret store.
  const labKey = await generateKeypair();
  const report = Buffer.from(`Certificate of analysis for ${recordId} (test data)`);
  const reportHash = createHash('sha256').update(report).digest('hex');
  const attestation = await signAttestation(
    {
      attestationId: `${recordId}-COA`,
      type: 'laboratory-report',
      subjectCommitment: intake.commitment,
      attester: { publicKey: labKey.publicKey, displayName: 'Example Analytical (test data)', role: 'laboratory' },
      documentHash: reportHash,
      hashAlgorithm: 'sha256',
      issuedAt: now(),
    },
    labKey.privateKey,
  );
  check(await verifyAttestation(attestation), 'the lab’s signed report verifies (SDK, off chain)');
  await vc.pairDna(fromHex(reportHash));
  const ledger = await vc.ledger();
  check(
    toHex(ledger.lastPairedDna) === reportHash && toHex(ledger.lastPairedRecord) === toHex(record),
    'pairDna: the chain binds the report’s fingerprint to the record',
  );

  // ── 5. Prove possession to a verifier ──────────────────────────────────────
  const challenge = newChallenge(); // the VERIFIER makes this and sends it privately
  const owned = await vc.proveOwnership(challenge);
  const verdict = await checkOwnership({ ...read, txId: owned.txId, record, challenge });
  check(verdict.accepted, `the verifier (no wallet) accepts the ownership proof: ${verdict.reason}`);
  const replay = await checkOwnership({ ...read, txId: owned.txId, record, challenge: newChallenge() });
  check(!replay.accepted, `and refuses it for anyone else’s challenge: ${replay.reason}`);
  say(`Give the client: the record, its inclusion proof (batch tx ${tx.txId}), the signed report.`);
  return { record, accessionSecret };
};

if (isMain(import.meta.url)) await runExample('VeilCore example: a laboratory', labFlow);
