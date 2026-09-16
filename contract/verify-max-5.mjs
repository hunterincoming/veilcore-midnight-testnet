/**
 * Finding 5, demonstrated fixed.
 *
 * Each case is one of the three defects Max named, run against the compiled
 * artifact rather than argued.
 *
 *   node contract/verify-max-5.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = await import(pathToFileURL(path.join(here, 'src/managed/veilcore/contract/index.js')).href);
const { LicenseTree } = await import(pathToFileURL(path.join(here, 'src/license-tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();

const OLD = sec('breeder-old');
const NEW = sec('breeder-new');
const RECOVERY = sec('breeder-recovery');
const STRANGER = sec('stranger');

// A party: which secret it holds, which secret it is rotating into, which recovery
// secret it knows.
const party = (own, incoming = own, recovery = own) =>
  new V.Contract({
    localGeneticSecret: (c) => [c.privateState, own],
    incomingGeneticSecret: (c) => [c.privateState, incoming],
    recoverySecret: (c) => [c.privateState, recovery],
    // Licence-tree path, set before the one call in this file that moves a leaf:
    // the successor revoking a licence the old record issued.
    licenseSecret: (c) => [c.privateState, licPath.secret],
    licenseRecord: (c) => [c.privateState, licPath.record],
    licenseSiblings: (c) => [c.privateState, licPath.siblings],
    licenseDirections: (c) => [c.privateState, licPath.dirs],
  });

const licTree = new LicenseTree();
let licPath = { secret: sec('none'), record: sec('none'), siblings: [], dirs: [] };

const commit = V.pureCircuits.commit;
const licenseCommit = V.pureCircuits.licenseCommit;

const OLD_REC = commit(OLD);
const NEW_REC = commit(NEW);

const fresh = () => {
  const c = party(OLD);
  return rt.createCircuitContext(
    rt.sampleContractAddress(), COIN,
    c.initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
  );
};

let ctx = fresh();
const run = (p, circuit, ...args) => {
  const r = p.impureCircuits[circuit](ctx, ...args);
  ctx = r.context;
  return r;
};
const refused = (p, circuit, ...args) => {
  try { run(p, circuit, ...args); return ''; }
  catch (e) { return String(e?.message ?? e); }
};
const state = () => V.ledger(ctx.currentQueryContext.state);

// ── the unproven target ─────────────────────────────────────────────────────
console.log('\n== can a holder rotate into a commitment they do not hold? ==');
{
  run(party(OLD, NEW, RECOVERY), 'anchor', OLD_REC, commit(RECOVERY));

  // A stranger's commitment. The rotating party does not hold its secret.
  const strangersRecord = commit(STRANGER);
  const err = refused(party(OLD, NEW, RECOVERY), 'rotateRecordSecret', strangersRecord);
  note(err ? `refused: ${err}` : 'accepted');
  ok('rotating into someone else\'s commitment is refused', err !== '',
     'the target was an argument taken on trust, so naming a commitment was the same\n' +
     '     as holding it and a holder could rotate onto a record belonging to someone else');
}

// ── the stolen secret ───────────────────────────────────────────────────────
console.log('\n== after rotating, does the old secret still act? ==');
{
  ctx = fresh();
  const holder = party(OLD, NEW, RECOVERY);
  run(holder, 'anchor', OLD_REC, commit(RECOVERY));

  // A licence issued under the old record, before the rotation.
  const lSecret = sec('licence');
  const lc = licenseCommit(lSecret, OLD_REC);
  run(holder, 'issueLicense', OLD_REC, lc);

  run(holder, 'rotateRecordSecret', NEW_REC);
  ok('the rotation is recorded', state().rotatedTo.member(OLD_REC) &&
     hex(state().rotatedTo.lookup(OLD_REC)) === hex(NEW_REC));

  // The old secret tries to carry on.
  const issueErr = refused(party(OLD), 'issueLicense', OLD_REC, licenseCommit(sec('l2'), OLD_REC));
  note(issueErr ? `old secret issuing: ${issueErr}` : 'old secret issued a licence');
  ok('the retired secret cannot issue', issueErr !== '',
     'a secret cannot be un-known, so only the contract declining to listen ends the\n' +
     '     old identity — without that a rotation left the holder with two working keys');

  const pairErr = refused(party(OLD), 'pairDna', OLD_REC, sec('dna'));
  ok('the retired secret cannot pair DNA', pairErr !== '');

  // And the successor can revoke what the old record issued.
  const revokeErr = refused(party(NEW, NEW, RECOVERY), 'revokeLicense', lc);
  note(revokeErr ? `successor revoking: ${revokeErr}` : 'successor revoked it');
  ok('the successor can revoke a licence the old record issued', revokeErr === '',
     'the new record could not touch agreements made under the old one, so escaping a\n' +
     '     compromised secret meant giving up control of every licence already issued');
}

// ── the lost secret ─────────────────────────────────────────────────────────
console.log('\n== can a holder who lost their secret move the record? ==');
{
  ctx = fresh();
  run(party(OLD, NEW, RECOVERY), 'anchor', OLD_REC, commit(RECOVERY));

  // This party does NOT hold OLD. It holds the recovery secret and the new secret.
  const lost = party(sec('unrelated'), NEW, RECOVERY);
  const err = refused(lost, 'recoverRecordSecret', OLD_REC, NEW_REC);
  note(err ? `refused: ${err}` : 'recovered');
  ok('the recovery secret moves a record without the primary secret', err === '',
     'rotation requires the secret that was lost, so the checklist item — no role\n' +
     '     permanently lockable by a single lost secret — was not met at all');

  ok('the record is now retired', state().rotatedTo.member(OLD_REC));

  // A stranger's recovery secret does not work.
  ctx = fresh();
  run(party(OLD, NEW, RECOVERY), 'anchor', OLD_REC, commit(RECOVERY));
  const wrong = party(sec('unrelated'), NEW, sec('wrong-recovery'));
  const wrongErr = refused(wrong, 'recoverRecordSecret', OLD_REC, NEW_REC);
  ok('the wrong recovery secret is refused', wrongErr !== '', wrongErr);
}

console.log(`\n${bad === 0 ? 'finding 5 demonstrated fixed' : `${bad} still failing`}`);
process.exit(bad === 0 ? 0 : 1);
