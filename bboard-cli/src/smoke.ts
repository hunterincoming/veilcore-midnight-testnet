// SPDX-License-Identifier: Apache-2.0
/**
 * The preprod smoke test: the contract's flows with real proofs on a real network.
 *
 * The contract tests run circuits against a simulated ledger. This deploys a fresh
 * contract, drives every flow through the API the product uses, checks what the CHAIN
 * says afterwards, and requires the network to refuse a set of attacks. About 30 to 45
 * minutes: each step is a proved transaction. It stops at the first failure.
 */
import { type Logger } from 'pino';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { pureCircuits as C } from '../../contract/src/managed/veilcore/contract/index.js';
import { VeilcoreAPI, newPresentationChallenge } from '../../api/src/veilcore-api.js';
import { randomBytes } from '../../api/src/utils/index.js';
import type { VeilcoreProviders } from '../../api/src/veilcore-types.js';

const same = (a: Uint8Array, b: Uint8Array): boolean => toHex(a) === toHex(b);

export const runSmoke = async (providers: VeilcoreProviders, logger: Logger): Promise<boolean> => {
  let step = 0;
  const pass = (what: string): void => logger.info(`PASS ${++step}. ${what}`);
  const must = (ok: boolean, what: string): void => {
    if (!ok) throw new Error(`FAILED at step ${step + 1}: ${what}`);
    pass(what);
  };
  /** An attack: the network must refuse it. */
  const refused = async (what: string, attempt: () => Promise<unknown>): Promise<void> => {
    try {
      await attempt();
    } catch {
      pass(`refused, as it should be: ${what}`);
      return;
    }
    throw new Error(`FAILED at step ${step + 1}: the network ACCEPTED ${what}`);
  };

  try {
    logger.info('Deploying a fresh VeilCore contract (authority kept: this is preprod)...');
    const vc = await VeilcoreAPI.deploy(providers, sampleSigningKey(), logger);
    pass(`deployed at ${vc.deployedContractAddress}`);
    must((await vc.currentLedger()).protocolVersion === 1n, 'protocol version 1 is on chain');

    // ── records ──────────────────────────────────────────────────────────────
    const breeder = randomBytes(32),
      recovery = randomBytes(32);
    const B = C.commit(breeder);
    await vc.actAs(breeder);
    await vc.anchor(C.recoveryCommit(recovery));
    must(same((await vc.currentLedger()).lastAnchor, B), 'anchor: the chain holds the record');
    await vc.proveOwnership();
    must(same((await vc.currentLedger()).lastOwnershipProof, B), 'proveOwnership names the record on chain');
    const dna = randomBytes(32);
    await vc.pairDna(dna);
    const paired = await vc.currentLedger();
    must(same(paired.lastPairedDna, dna) && same(paired.lastPairedRecord, B), 'pairDna binds both halves on chain');

    // ── licences ─────────────────────────────────────────────────────────────
    const L1 = randomBytes(32);
    const lc1 = C.licenseCommit(L1, B);
    await vc.issueLicense(lc1);
    await vc.countersignLicense(L1, B);
    must(
      (await vc.currentLedger()).licenseStatusOf.member(C.licenseKey(lc1, B)),
      'issue + countersign: licence active',
    );
    const ch = newPresentationChallenge();
    const shown = await vc.proveLicense(L1, B, ch);
    must(
      same((await vc.currentLedger()).lastPresentation, C.presentationTag(B, ch)),
      'proveLicense: the tag is on chain',
    );
    must(
      (await vc.checkPresentation(shown.txId, B, ch)).accepted,
      "the verifier's check, by transaction id, accepts it",
    );
    must(
      !(await vc.checkPresentation(shown.txId, B, newPresentationChallenge())).accepted,
      'and rejects it for any other challenge',
    );

    const L2 = randomBytes(32);
    const lc2 = C.licenseCommit(L2, B);
    await vc.proposeTransfer(L1, B, lc2);
    const moved = await vc.approveTransfer(lc1, B, lc2);
    must((await vc.currentLedger()).licenseStatusOf.member(C.licenseKey(lc2, B)), 'transfer: the new holder holds it');
    must(moved.sealed, 'the first seal is made at once');
    await refused('a presentation by the outgoing holder after the seal', () =>
      vc.proveLicense(L1, B, newPresentationChallenge()),
    );
    await vc.proveLicense(L2, B, newPresentationChallenge());
    pass('the incoming holder presents');

    // ── identity: rotation keeps control, a retired secret has none ──────────
    const next = randomBytes(32);
    await vc.rotateRecordSecret(C.commit(next), next);
    await vc.revokeLicense(lc2, B);
    must(
      !(await vc.currentLedger()).licenseStatusOf.member(C.licenseKey(lc2, B)),
      'the successor revokes a licence the original record issued',
    );
    await vc.actAs(breeder);
    await refused('an ownership proof from a retired secret', () => vc.proveOwnership());

    // ── lineage, across rotation ─────────────────────────────────────────────
    const grower = randomBytes(32),
      stranger = randomBytes(32);
    const G = C.commit(grower);
    await vc.actAs(grower);
    await vc.anchor(C.recoveryCommit(randomBytes(32)));
    await vc.proposeParent(B); // names the breeder by its ORIGINAL record
    await vc.actAs(stranger);
    await refused("a stranger confirming someone else's parentage", () => vc.confirmParent(G));
    await vc.actAs(next); // the breeder's current secret
    await vc.confirmParent(G);
    must(
      (await vc.currentLedger()).parentsOf.lookup(G).member(B),
      'descent: both agreed; the edge is between identities',
    );

    const royalty = randomBytes(32);
    await vc.encumberOwnRecord(royalty);
    must(!(await vc.checkLineage(G)).clean, "the breeder's royalty shows on the grower's lineage");
    await vc.actAs(grower);
    await refused("the grower releasing the breeder's royalty", () => vc.discharge(B, royalty));

    // Recovery, with the breeder's current secret treated as stolen: the owner still releases.
    const recovered = randomBytes(32);
    await vc.recoverRecordSecret(B, C.commit(recovered), recovery, recovered);
    await vc.actAs(next);
    await refused('the stolen secret releasing the royalty after recovery', () => vc.discharge(B, royalty));
    await vc.actAs(recovered);
    await vc.discharge(B, royalty);
    must((await vc.checkLineage(G)).clean, 'the recovered breeder releases; the lineage is clean');

    logger.info(`\nSMOKE TEST PASSED: ${step} checks on preprod. Contract ${vc.deployedContractAddress}`);
    return true;
  } catch (e) {
    logger.error(String(e instanceof Error ? e.message : e));
    logger.error('SMOKE TEST FAILED. Do not deploy to mainnet until this passes.');
    return false;
  }
};
