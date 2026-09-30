// SPDX-License-Identifier: Apache-2.0
/**
 * The preprod smoke test: every circuit of both contracts, with real proofs, on a
 * real network, before mainnet.
 *
 * The contract suites run circuits against a simulated ledger. This is the other
 * half, in the spirit of Midnight's Battleship example: deploy fresh contracts, drive
 * every flow through the same API the product uses, and check what the CHAIN says
 * afterwards — not what a call returned. It also tries three of the attacks the
 * security pass closed and requires the network to refuse them.
 *
 * Takes roughly 20–40 minutes: each step is a proved transaction. It stops at the
 * first failure and says which step.
 */
import { type Logger } from 'pino';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { pureCircuits as V } from '../../contract/src/managed/veilcore/contract/index.js';
import { pureCircuits as L } from '../../contract/src/managed/lineage/contract/index.js';
import { VeilcoreAPI, newPresentationChallenge } from '../../api/src/veilcore-api.js';
import { LineageAPI } from '../../api/src/lineage-api.js';
import { randomBytes } from '../../api/src/utils/index.js';
import type { VeilcoreProviders } from '../../api/src/veilcore-types.js';
import type { LineageProviders } from '../../api/src/lineage-types.js';

const same = (a: Uint8Array, b: Uint8Array): boolean => toHex(a) === toHex(b);

export const runSmoke = async (
  providers: VeilcoreProviders,
  lineageProviders: LineageProviders,
  logger: Logger,
): Promise<boolean> => {
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
    // ── provenance ────────────────────────────────────────────────────────────
    logger.info('Deploying a fresh veilcore contract (authority kept: this is preprod)...');
    const vc = await VeilcoreAPI.deploy(providers, sampleSigningKey(), logger);
    pass(`veilcore deployed at ${vc.deployedContractAddress}`);

    const breeder = randomBytes(32);
    const recovery = randomBytes(32);
    const rec = V.commit(breeder);
    await vc.actAs(breeder);
    await vc.anchor(V.recoveryCommit(recovery));
    must(same((await vc.currentLedger()).lastAnchor, rec), 'anchor: the chain holds the record');

    await vc.proveOwnership();
    must(same((await vc.currentLedger()).lastOwnershipProof, rec), 'proveOwnership names the record on chain');

    const dna = randomBytes(32);
    await vc.pairDna(dna);
    const afterPair = await vc.currentLedger();
    must(
      same(afterPair.lastPairedDna, dna) && same(afterPair.lastPairedRecord, rec),
      'pairDna binds both halves on chain',
    );

    await vc.anchorBatch(randomBytes(32));
    pass('anchorBatch');

    // A licence, issued, accepted, presented.
    const L1 = randomBytes(32);
    const lc1 = V.licenseCommit(L1, rec);
    await vc.issueLicense(lc1);
    await vc.countersignLicense(L1, rec);
    must(
      (await vc.currentLedger()).licenseStatusOf.member(V.licenseKey(lc1, rec)),
      'issue + countersign: licence active',
    );

    const ch = newPresentationChallenge();
    await vc.proveLicense(L1, rec, ch);
    must(
      same((await vc.currentLedger()).lastPresentation, V.presentationTag(rec, ch)),
      'proveLicense: the verifier can check the tag',
    );

    // Transfer to a new holder; the old secret stops working.
    const L2 = randomBytes(32);
    const lc2 = V.licenseCommit(L2, rec);
    await vc.proposeTransfer(L1, rec, lc2);
    await vc.approveTransfer(lc1, rec, lc2);
    must(
      (await vc.currentLedger()).licenseStatusOf.member(V.licenseKey(lc2, rec)),
      'transfer: the new holder holds it',
    );
    await refused('a presentation by the outgoing holder', () => vc.proveLicense(L1, rec, newPresentationChallenge()));
    await vc.proveLicense(L2, rec, newPresentationChallenge());
    pass('the incoming holder presents');

    // Rotate, then revoke as the successor.
    const next = randomBytes(32);
    await vc.rotateRecordSecret(V.commit(next), next);
    await vc.revokeLicense(lc2, rec);
    must(
      !(await vc.currentLedger()).licenseStatusOf.member(V.licenseKey(lc2, rec)),
      'the successor revokes a licence the original record issued',
    );
    await refused('a presentation of a revoked licence', () => vc.proveLicense(L2, rec, newPresentationChallenge()));

    // The retired secret can do nothing.
    await vc.actAs(breeder);
    await refused('an ownership proof from a retired secret', () => vc.proveOwnership());

    // Recovery, with the original secret treated as stolen.
    const recovered = randomBytes(32);
    await vc.recoverRecordSecret(rec, V.commit(recovered), recovery, recovered);
    await vc.proveOwnership();
    must(
      same((await vc.currentLedger()).lastOwnershipProof, V.commit(recovered)),
      'recovery: the new record proves ownership',
    );

    // A stranger cannot revoke someone else's licence.
    const current = V.commit(recovered);
    const lc3 = V.licenseCommit(randomBytes(32), current);
    await vc.issueLicense(lc3);
    must(
      (await vc.currentLedger()).licenseStatusOf.member(V.licenseKey(lc3, current)),
      'the recovered record issues a licence',
    );
    await vc.actAs(randomBytes(32));
    await refused('a stranger revoking a licence', () => vc.revokeLicense(lc3, current));

    // ── lineage ───────────────────────────────────────────────────────────────
    logger.info('Deploying a fresh lineage contract...');
    const ln = await LineageAPI.deploy(lineageProviders, sampleSigningKey(), logger);
    pass(`lineage deployed at ${ln.deployedContractAddress}`);

    const mother = randomBytes(32),
      daughter = randomBytes(32),
      stranger = randomBytes(32);
    const M = L.commit(mother),
      D = L.commit(daughter);
    const royalty = randomBytes(32);

    await ln.actAs(daughter);
    await ln.proposeParent(M);
    await ln.actAs(stranger);
    await refused("a stranger confirming someone else's parentage", () => ln.confirmParent(D));
    await ln.actAs(mother);
    await ln.confirmParent(D);
    must(same((await ln.currentLedger()).lastDescentParent, M), 'descent: both holders agreed, edge on chain');

    await ln.encumberOwnRecord(royalty);
    must(await ln.hasOpenObligation(M), 'the breeder places a royalty on their own mother');
    await ln.actAs(daughter);
    await refused('a clean proof about an encumbered ancestor', () => ln.proveAncestorClean(M));
    await refused("the descendant discharging the breeder's royalty", () => ln.discharge(M, royalty));
    await ln.actAs(stranger);
    await ln.proposeObligation(D, randomBytes(32));
    must(!(await ln.hasOpenObligation(D)), "a stranger's claim binds nobody until accepted");

    await ln.actAs(mother);
    await ln.discharge(M, royalty);
    await ln.actAs(daughter);
    await ln.proveAncestorClean(M);
    pass('released by the beneficiary; the ancestor now proves clean');

    logger.info(`\nSMOKE TEST PASSED: ${step} checks on preprod.`);
    logger.info(`veilcore ${vc.deployedContractAddress}`);
    logger.info(`lineage  ${ln.deployedContractAddress}`);
    return true;
  } catch (e) {
    logger.error(String(e instanceof Error ? e.message : e));
    logger.error('SMOKE TEST FAILED. Do not deploy to mainnet until this passes.');
    return false;
  }
};
