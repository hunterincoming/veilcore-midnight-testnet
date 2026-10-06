// Prove one fact about a sealed record without showing the rest: germination is at least
// 95%, on values a laboratory signed. A verifier reads the claim by transaction id, with
// no wallet, and judges it against the published schema and the laboratory keys it trusts.
//
//   1. The lab seals the record's fields under a published schema (sha256/fields/v1).
//      The SDK computes the same record commitment from the record's JSON.
//   2. The lab signs the record commitment with its claims key (Jubjub: the kind of
//      signature the claims contract can check inside a proof).
//   3. The holder proves "slot 4 is at least 95.00 percent", and the lab's signature.
//   4. The verifier reads both claims back and runs verifyClaim.
//
// Run:  node examples/claims.mjs   (settings: examples/setup.mjs)
// SPDX-License-Identifier: Apache-2.0
import { computeCommitment, newNonce } from 'veilcore-records';
import {
  committedJsonDigest,
  isContractRefusal,
  newLabKey,
  newSecret,
  readClaim,
  readClaimsAuthority,
  sealFields,
  signRecord,
  toHex,
  verifyClaim,
} from '@veilcore/contracts';
import { isMain, runExample } from './setup.mjs';

/** @typedef {import('@veilcore/contracts').FieldSchema} FieldSchema */

/**
 * A marker locus: an allele pair, compared for distinctness.
 * @param {number} slot
 * @returns {FieldSchema['slots'][number]}
 */
const locus = (slot) => ({
  slot,
  path: `fields.loci[${slot}]`,
  type: 'text',
  format: 'allele-pair',
  comparable: true,
});

/**
 * An example schema: four marker loci (distinct at 2), germination and yield. Test data only.
 * @type {FieldSchema}
 */
export const EXAMPLE_SCHEMA = {
  id: 'veilcore/fields/partner-kit-example/v1',
  title: 'Partner kit example schema: not for real records',
  slots: [
    locus(0),
    locus(1),
    locus(2),
    locus(3),
    { slot: 4, path: 'fields.germinationPercent', type: 'uint', scale: 100, unit: 'percent' },
    { slot: 5, path: 'fields.yieldKgPerHa', type: 'uint', unit: 'kg/ha' },
  ],
  k: 2,
};

/**
 * Seal a record's fields and its JSON together (SPEC 4.5): the field-set root does not
 * depend on the JSON, the JSON carries the root, and the field set is sealed with the
 * digest of that JSON. Returns the record JSON (shareable) and the sealed fields (private).
 */
export const sealRecord = (schema, values, base) => {
  const fieldSecret = toHex(newSecret()); // YOURS: kept with the holder's private copy, never disclosed
  const draft = sealFields({ schema, values, fieldSecret, jsonDigest: '00'.repeat(32) });
  const json = {
    ...base,
    commitmentAlgorithm: 'sha256/fields/v1',
    fieldSchema: toHex(draft.schemaId),
    fieldSetRoot: toHex(draft.setRoot),
  };
  const file = { schema, values, fieldSecret, jsonDigest: toHex(committedJsonDigest(json)) };
  const sealed = sealFields(file);
  return { json: { ...json, commitment: toHex(sealed.commitment) }, file, sealed };
};

export const claimsFlow = async ({ claims, network, endpoints }, { check, say }) => {
  const read = { network, indexer: endpoints.indexer, address: claims.address };
  const authority = await readClaimsAuthority(read);
  check(authority.retired, 'the claims contract’s maintenance authority is an empty committee: nobody can change it');

  // ── 1. Seal ────────────────────────────────────────────────────────────────
  const values = [
    { text: '180/184' },
    { text: '201/201' },
    { text: '155/159' },
    { text: '233/233' },
    { uint: '9650' }, // 96.50 percent: what the claim keeps hidden
    { uint: '6400' },
    ...Array(10).fill(null),
  ];
  const { json, sealed } = sealRecord(EXAMPLE_SCHEMA, values, {
    formatVersion: '0.1',
    recordId: `LOT-${Date.now()}`,
    subjectType: 'plant-genetic-material',
    profile: 'veilcore/profile/plant-variety/v1',
    sealedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    holder: { id: 'holder:example' },
    profileData: { lot: 'example seed lot (test data)', nonce: newNonce() },
  });
  check(
    json.commitment === (await computeCommitment(json)),
    'the SDK computes the same record commitment from the record’s JSON (sha256/fields/v1)',
  );

  // ── 2. The lab signs ───────────────────────────────────────────────────────
  // YOURS: the lab's claims key is generated once; `secret` stays in the lab's HSM, `key` is published.
  const lab = newLabKey();
  const signature = signRecord(lab.secret, sealed.commitment);

  // ── 3. The holder proves ───────────────────────────────────────────────────
  const range = await claims.proveRange(sealed.record, EXAMPLE_SCHEMA, 4, 'at least', 9500n);
  const attested = await claims.proveAttested(sealed.record, { key: lab.key, signature });
  say(`Claims made: range ${range.txId}, attested ${attested.txId}.`);
  let refused = false;
  try {
    await claims.proveRange(sealed.record, EXAMPLE_SCHEMA, 4, 'at least', 9700n);
  } catch (e) {
    refused = isContractRefusal(e); // the contract's refusal, and nothing else
  }
  check(refused, 'a bound the sealed number does not meet (at least 97.00 percent) cannot be proved');

  // ── 4. The verifier ────────────────────────────────────────────────────────
  const r = await readClaim({ ...read, txId: range.txId });
  const a = await readClaim({ ...read, txId: attested.txId });
  check(
    r.claim.kind === 'range' && r.claim.bound === 9500n && r.claim.value === undefined,
    'read back by transaction id: the chain shows the bound, never the number',
  );
  const verdict = verifyClaim({
    claim: r.cells,
    schema: EXAMPLE_SCHEMA, // from the schema's publisher, never from the prover
    attestations: [a.claim],
    trustedAttesters: [lab.key], // the laboratory keys this verifier trusts
  });
  check(
    verdict.passed && /on values a laboratory signed/.test(verdict.statement),
    `the verifier reads: "${verdict.statement}"`,
  );
  for (const t of verdict.toCheck) say(t);
  return { commitment: sealed.commitment };
};

if (isMain(import.meta.url)) await runExample('VeilCore example: a claim about a sealed record', claimsFlow);
