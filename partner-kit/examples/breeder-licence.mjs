// A breeder licenses a grower, the grower proves it to a buyer, and the buyer checks it
// with no wallet. Then the breeder revokes it.
//
//   1. The breeder's record is anchored (an identity that can issue licences).
//   2. The grower makes a licence secret and sends the breeder only its commitment.
//   3. The breeder issues; the grower countersigns (the licence is now live).
//   4. A buyer (the verifier) sends the grower a fresh challenge; the grower proves the
//      licence against it; the buyer checks the transaction: accepted once, for that
//      challenge only. The chain names neither the grower nor the licence.
//   5. The breeder revokes; the licence can no longer be presented.
//
// In this example one process plays all three parties. In practice each runs its own
// client, and only commitments, challenges and transaction ids pass between them.
//
// Run:  node examples/breeder-licence.mjs   (settings: examples/setup.mjs)
// SPDX-License-Identifier: Apache-2.0
import {
  ChallengeBook,
  checkPresentation,
  commit,
  isContractRefusal,
  newChallenge,
  newSecret,
  toHex,
} from '@veilcore/contracts';
import { isMain, runExample } from './setup.mjs';

export const licenceFlow = async ({ vc, network, endpoints }, { check, say }) => {
  const read = { network, indexer: endpoints.indexer, address: vc.address };

  // ── 1. The breeder ─────────────────────────────────────────────────────────
  // YOURS: stored before use; the recovery secret offline.
  const breederSecret = newSecret();
  const breederRecovery = newSecret();
  const breeder = commit.record(breederSecret);
  await vc.useRecordSecret(breederSecret);
  await vc.anchor(commit.recovery(breederRecovery));
  check((await vc.whoAmI()).anchored, `the breeder’s record ${toHex(breeder).slice(0, 16)}… is anchored`);

  // ── 2-3. Issue and countersign ─────────────────────────────────────────────
  // The GROWER makes this and keeps it: whoever holds it holds the licence.
  const licenceSecret = newSecret();
  const licence = commit.license(licenceSecret, breeder); // all the breeder is ever sent
  await vc.issueLicense(licence);
  check(toHex((await vc.ledger()).lastIssuedLicense) === toHex(licence), 'the breeder issued the licence (pending)');
  await vc.countersignLicense(licenceSecret, breeder);
  check(
    toHex((await vc.ledger()).lastActivatedLicense) === toHex(licence),
    'the grower countersigned: the licence is live',
  );

  // ── 4. The buyer checks it ─────────────────────────────────────────────────
  // YOURS (the verifier): keep the book across runs (entries()), so a challenge is used once.
  const book = new ChallengeBook();
  const { challenge, issuedAt } = book.issue('licence');
  const shown = await vc.proveLicense(licenceSecret, breeder, challenge); // the grower, answering the buyer
  const verdict = await checkPresentation({ ...read, txId: shown.txId, issuer: breeder, challenge, issuedAt });
  check(verdict.accepted && book.consume(challenge, 'licence').ok, `the buyer (no wallet) accepts: ${verdict.reason}`);
  check(!book.consume(challenge, 'licence').ok, 'the buyer’s book refuses the same challenge a second time');
  const other = book.issue('licence');
  const wrong = await checkPresentation({ ...read, txId: shown.txId, issuer: breeder, challenge: other.challenge });
  check(!wrong.accepted, `another buyer’s challenge is refused: ${wrong.reason}`);

  // ── 5. Revoke ──────────────────────────────────────────────────────────────
  const revoked = await vc.revokeLicense(licence, breeder);
  say(
    revoked.sealed
      ? 'Revoked and sealed: earlier presentations stop verifying now.'
      : revoked.waiting
        ? `Revoked; earlier presentations stop verifying at the next seal (possible from ${new Date((revoked.sealableAt ?? 0) * 1000).toISOString()}).`
        : 'Revoked.',
  );
  let refused = false;
  try {
    await vc.proveLicense(licenceSecret, breeder, newChallenge());
  } catch (e) {
    // Only the contract refusing counts: midnight-js wraps it two causes deep, and any other
    // failure (proof server, indexer, network) must not pass as a refusal.
    refused = isContractRefusal(e);
  }
  check(refused, 'after revocation the grower cannot present the licence');
  return { breeder, licence };
};

if (isMain(import.meta.url)) await runExample('VeilCore example: a breeder licenses a grower', licenceFlow);
