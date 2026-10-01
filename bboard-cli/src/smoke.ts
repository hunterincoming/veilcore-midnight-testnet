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

/** Every message and name in an error and its causes (midnight-js wraps compact-js errors). */
const errorTexts = (e: unknown): string[] => {
  const out: string[] = [];
  const seen = new Set<unknown>();
  for (let cur: unknown = e; cur !== undefined && cur !== null && !seen.has(cur); ) {
    seen.add(cur);
    if (typeof cur === 'object') {
      const o = cur as { name?: unknown; message?: unknown; _tag?: unknown; cause?: unknown };
      for (const v of [o.name, o.message, o._tag]) if (typeof v === 'string') out.push(v);
      cur = o.cause;
    } else {
      out.push(typeof cur === 'string' ? cur : typeof cur);
      break;
    }
  }
  return out;
};

/**
 * Whether an error is the CONTRACT refusing a call, as opposed to anything else going
 * wrong (the proof server down, the indexer unreachable, a timeout, a bug).
 *
 * - A Compact `assert` that fails throws compact-runtime's CompactError
 *   "failed assert: <message>"; midnight-js rethrows it as `new Error(<that message>)`
 *   (midnight-js-contracts, createUnprovenCallTx). This is how every refusal here shows
 *   up, since midnight-js runs the circuit locally before proving.
 * - The licensePath witness throws "No live licence for that secret and record" when the
 *   licence is not in the tree: the call cannot even be built, which is the refusal.
 * - A call the chain itself rejected after landing is a CallTxFailedError.
 */
export const isContractRefusal = (e: unknown): boolean =>
  errorTexts(e).some(
    (t) =>
      /^failed assert: /.test(t) ||
      t.includes('No live licence for that secret and record') ||
      t === 'CallTxFailedError',
  );

export const runSmoke = async (providers: VeilcoreProviders, logger: Logger, indexerUri: string): Promise<boolean> => {
  let step = 0;
  const pass = (what: string): void => logger.info(`PASS ${++step}. ${what}`);
  const must = (ok: boolean, what: string): void => {
    if (!ok) throw new Error(`FAILED at step ${step + 1}: ${what}`);
    pass(what);
  };
  /**
   * An attack: the contract must refuse it. Only a refusal counts (isContractRefusal, or
   * `expected` for a refusal that is not the contract's): a network outage, a proof server
   * that is down or any other error fails the smoke test instead of passing it.
   */
  const refused = async (what: string, attempt: () => Promise<unknown>, expected?: RegExp): Promise<void> => {
    try {
      await attempt();
    } catch (e) {
      const ok = expected === undefined ? isContractRefusal(e) : errorTexts(e).some((t) => expected.test(t));
      if (ok) {
        pass(`refused, as it should be: ${what}`);
        return;
      }
      throw new Error(`FAILED at step ${step + 1}: ${what} failed, but not as a refusal`, { cause: e });
    }
    throw new Error(`FAILED at step ${step + 1}: the network ACCEPTED ${what}`);
  };

  try {
    logger.info('Deploying a fresh VeilCore contract (authority kept: this is a test network)...');
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
    const ownCh = newPresentationChallenge();
    const owned = await vc.proveOwnership(ownCh);
    must(same((await vc.currentLedger()).lastOwnershipProof, B), 'proveOwnership names the record on chain');
    must(
      (await vc.checkOwnership(indexerUri, owned.txId, B, ownCh)).accepted,
      "a verifier accepts the holder's proof for its own challenge, found by transaction id",
    );
    must(
      !(await vc.checkOwnership(indexerUri, owned.txId, B, newPresentationChallenge())).accepted,
      "the same proof is refused for another verifier's challenge",
    );
    const dna = randomBytes(32);
    await vc.pairDna(dna);
    const paired = await vc.currentLedger();
    must(same(paired.lastPairedDna, dna) && same(paired.lastPairedRecord, B), 'pairDna binds both halves on chain');

    // ── licences ─────────────────────────────────────────────────────────────
    const L1 = randomBytes(32);
    const lc1 = C.licenseCommit(L1, B);
    await vc.issueLicense(lc1);
    const activation = await vc.countersignLicense(L1, B);
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
      (await vc.checkPresentation(indexerUri, shown.txId, B, ch)).accepted,
      "the verifier's check, by transaction id, accepts it",
    );
    must(
      !(await vc.checkPresentation(indexerUri, shown.txId, B, newPresentationChallenge())).accepted,
      'and rejects it for any other challenge',
    );
    await refused(
      'a verifier check pointed at a transaction that is not a presentation',
      () => vc.checkPresentation(indexerUri, activation.txId, B, ch),
      /^That transaction is not a single licence presentation on this contract\.$/,
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
    await refused('an ownership proof from a retired secret', () => vc.proveOwnership(newPresentationChallenge()));

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
    await refused('the breeder changing its own parents once it has offspring', () => vc.proposeParent(G));

    const royalty = randomBytes(32);
    await vc.encumberOwnRecord(royalty);
    must(!(await vc.checkLineage(G)).clean, "the breeder's royalty shows on the grower's lineage");
    await vc.actAs(grower);
    await refused("the grower releasing the breeder's royalty", () => vc.discharge(B, royalty));

    // Recovery, with the breeder's current secret treated as stolen: the owner still releases.
    const recovered = randomBytes(32);
    await vc.recoverRecordSecret(B, C.commit(recovered), C.recoveryCommit(randomBytes(32)), recovery, recovered);
    await refused('the used-up recovery secret recovering again', () =>
      vc.recoverRecordSecret(B, C.commit(stranger), C.recoveryCommit(randomBytes(32)), recovery, stranger),
    );
    await vc.actAs(next);
    await refused('the stolen secret releasing the royalty after recovery', () => vc.discharge(B, royalty));
    await vc.actAs(recovered);
    await vc.discharge(B, royalty);
    must((await vc.checkLineage(G)).clean, 'the recovered breeder releases; the lineage is clean');

    logger.info(`\nSMOKE TEST PASSED: ${step} checks passed. Contract ${vc.deployedContractAddress}`);
    return true;
  } catch (e) {
    logger.error(String(e instanceof Error ? e.message : e));
    if (e instanceof Error && e.cause instanceof Error) logger.error(`cause: ${e.cause.message}`);
    logger.error('SMOKE TEST FAILED. Do not deploy to mainnet until this passes.');
    return false;
  }
};
