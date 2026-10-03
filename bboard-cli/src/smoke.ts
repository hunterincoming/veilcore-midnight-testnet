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
import { ClaimsAPI } from '../../api/src/claims-api.js';
import type { ClaimsProviders } from '../../api/src/claims-types.js';
import { type FieldSchema, type TypedSlotValue } from '../../contract/src/field-schema.js';
import { newAttesterKey, signRecord } from '../../contract/src/attest.js';
import { numberFrom } from '../../contract/src/fields.js';
import { verifyClaim } from '../../contract/src/verify-claims.js';
import { loadFieldSet } from './fields.js';

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

/** Checks in the main contract's phase. The claims phase, when run, adds CLAIMS_CHECKS. */
export const MAIN_CHECKS = 26;
export const CLAIMS_CHECKS = 11;

export const runSmoke = async (
  providers: VeilcoreProviders,
  logger: Logger,
  indexerUri: string,
  claimsProviders?: ClaimsProviders,
): Promise<boolean> => {
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

    if (claimsProviders !== undefined) {
      logger.info(`\nMain contract phase passed (${step} checks). Now the claims contract.`);
      const claimsAddress = await claimsPhase(claimsProviders, indexerUri, logger, { pass, must, refused }, owned.txId);
      logger.info(
        `\nSMOKE TEST PASSED: ${step} checks passed. Contract ${vc.deployedContractAddress}, claims contract ${claimsAddress}`,
      );
      return true;
    }
    logger.info(`\nSMOKE TEST PASSED: ${step} checks passed. Contract ${vc.deployedContractAddress}`);
    return true;
  } catch (e) {
    logger.error(String(e instanceof Error ? e.message : e));
    if (e instanceof Error && e.cause instanceof Error) logger.error(`cause: ${e.cause.message}`);
    logger.error('SMOKE TEST FAILED. Do not deploy to mainnet until this passes.');
    return false;
  }
};

// ── the claims contract ───────────────────────────────────────────────────────

/** A schema for the smoke test only: four marker loci (distinct at 2), germination, yield. */
const SMOKE_SCHEMA: FieldSchema = {
  id: 'veilcore/fields/smoke-test/v1',
  title: 'Smoke test schema: not for real records',
  slots: [
    ...[0, 1, 2, 3].map((slot) => ({
      slot,
      path: `fields.loci[${slot}]`,
      type: 'text' as const,
      format: 'allele-pair' as const,
      comparable: true,
    })),
    { slot: 4, path: 'fields.germinationPercent', type: 'uint', scale: 100, unit: 'percent' },
    { slot: 5, path: 'fields.yieldKgPerHa', type: 'uint', unit: 'kg/ha' },
  ],
  k: 2,
};

const smokeRecord = (loci: string[], germination: string, yieldKg: string) => {
  const values: TypedSlotValue[] = Array.from({ length: 16 }, () => null);
  loci.forEach((l, i) => (values[i] = { text: l }));
  values[4] = { uint: germination };
  values[5] = { uint: yieldKg };
  return loadFieldSet({
    schema: SMOKE_SCHEMA,
    values,
    fieldSecret: toHex(randomBytes(32)),
    jsonDigest: toHex(randomBytes(32)),
  });
};

export type Steps = {
  pass: (what: string) => void;
  must: (ok: boolean, what: string) => void;
  refused: (what: string, attempt: () => Promise<unknown>, expected?: RegExp) => Promise<void>;
};

/**
 * Deploy a claims contract, check its authority is provably retired, then make every
 * kind of claim and read each back by transaction id, as a verifier would. Adds
 * CLAIMS_CHECKS checks. `notAClaim` is a transaction with no call on the claims contract.
 */
export const claimsPhase = async (
  providers: ClaimsProviders,
  indexerUri: string,
  logger: Logger,
  { pass, must, refused }: Steps,
  notAClaim: string,
): Promise<string> => {
  const cl = await ClaimsAPI.deploy(providers, logger);
  pass(`claims contract deployed at ${cl.deployedContractAddress}, all seven circuit keys on chain`);
  const auth = await cl.authority();
  must(
    auth.retired && auth.committee.length === 0 && auth.threshold === 1,
    "the claims contract's maintenance authority is an empty committee: the chain shows nobody can change it",
  );

  const A = smokeRecord(['180/184', '201/201', '155/159', '233/233'], '9650', '6400');
  const B = smokeRecord(['180/188', '199/201', '155/159', '233/233'], '9100', '5900');
  const same = (a: Uint8Array, b: Uint8Array): boolean => toHex(a) === toHex(b);
  const read = async (txId: string) => (await cl.readClaim(txId, indexerUri)).claim;

  const v = await cl.proveValue(A.record, 5);
  const vr = await read(v.txId);
  must(
    vr.kind === 'value' && same(vr.record, A.sealed.commitment) && vr.slot === 5 && numberFrom(vr.value!) === 6400n,
    'proveValue: read back by transaction id, the chain shows slot 5 holds 6400',
  );

  const r = await cl.proveRange(A.record, SMOKE_SCHEMA, 4, 'at least', 9500n);
  const rr = await read(r.txId);
  must(
    rr.kind === 'range' && same(rr.record, A.sealed.commitment) && rr.op === 'at least' && rr.bound === 9500n,
    'proveRange: the chain shows "at least 95.00 percent" and not the number',
  );
  await refused('a bound the sealed number does not meet (at least 97.00 percent)', () =>
    cl.proveRange(A.record, SMOKE_SCHEMA, 4, 'at least', 9700n),
  );

  const d = await cl.proveDistinct(A.record, B.record, SMOKE_SCHEMA);
  const dr = await read(d.txId);
  must(
    dr.kind === 'distinct' && same(dr.record, A.sealed.commitment) && same(dr.other!, B.sealed.commitment),
    'proveDistinct: the chain shows the two records differ in at least k comparable values',
  );

  const C = loadFieldSet({
    ...A.file,
    values: A.file.values.map((x, i) => (i === 5 ? { uint: '6550' } : x)),
    fieldSecret: toHex(randomBytes(32)),
    jsonDigest: toHex(randomBytes(32)),
  });
  const mask = Array.from({ length: 16 }, (_, i) => i === 5);
  const u = await cl.proveUnchanged(A.record, C.record, mask);
  const ur = await read(u.txId);
  must(
    ur.kind === 'unchanged' && same(ur.other!, C.sealed.commitment) && ur.mayChange!.every((b, i) => b === mask[i]),
    'proveUnchanged: the chain shows the correction changed only slot 5',
  );
  await refused('an unchanged claim whose mask leaves out the slot that changed', () =>
    cl.proveUnchanged(
      A.record,
      C.record,
      Array.from({ length: 16 }, () => false),
    ),
  );

  const lab = newAttesterKey();
  const ar = await cl.proveAttestedRange(A.record, SMOKE_SCHEMA, 4, 'at most', 9700n, {
    key: lab.key,
    signature: signRecord(lab.secret, A.sealed.commitment),
  });
  const reading = await cl.readClaim(ar.txId, indexerUri);
  must(
    reading.entryPoint === 'proveAttestedRange' &&
      reading.claim.attester?.x === lab.key.x &&
      reading.claim.attester?.y === lab.key.y,
    "proveAttestedRange: the chain shows the laboratory's key with the bound",
  );
  const verdict = verifyClaim({ claim: reading.cells, schema: SMOKE_SCHEMA, trustedAttesters: [lab.key] });
  must(
    verdict.passed && verdict.statement.includes('at most 97.00 percent'),
    'the claims verifier accepts it against the schema document and the trusted key',
  );
  await refused(
    'reading a claim from a transaction that made no claim on this contract',
    () => cl.readClaim(notAClaim, indexerUri),
    /^That transaction is not a single claim on this claims contract\.$/,
  );
  return cl.deployedContractAddress;
};
