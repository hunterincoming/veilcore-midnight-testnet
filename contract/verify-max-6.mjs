/**
 * Finding 6, demonstrated fixed.
 *
 * Max's V1, V2 and V3 run against the compiled artifact. Each one worked before
 * licence commitments were bound to their issuing record.
 *
 *   node contract/verify-max-6.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = await import(pathToFileURL(path.join(here, 'src/managed/veilcore/contract/index.js')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();

const BREEDER = sec('breeder');
const SNIPER = sec('sniper');
const LICENSEE = sec('licensee');

const party = (secret) => new V.Contract({
  localGeneticSecret: (c) => [c.privateState, secret],
  incomingGeneticSecret: (c) => [c.privateState, secret],
  recoverySecret: (c) => [c.privateState, secret],
  // Licence witnesses for the call about to be made. proveLicense takes no
  // arguments, so which licence is being shown — and its path in the ledger's
  // activeLicenses tree — is witness data.
  licenseSecret: (c) => [c.privateState, licPath.secret],
  licenseRecord: (c) => [c.privateState, licPath.record],
  licensePath: (c) => [c.privateState, licPath.path],
  presentationChallenge: (c) => [c.privateState, licPath.challenge ?? sec('challenge')],
});

const NO_PATH = { secret: sec('none'), record: sec('none'), path: null };
let licPath = NO_PATH;

// One shared ledger, several parties acting on it.
const base = party(BREEDER);
let ctx = rt.createCircuitContext(
  rt.sampleContractAddress(), COIN,
  base.initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
);

const run = (secret, circuit, ...args) => {
  const r = party(secret).impureCircuits[circuit](ctx, ...args);
  ctx = r.context;
  return r;
};
const refused = (secret, circuit, ...args) => {
  try { run(secret, circuit, ...args); return ''; }
  catch (e) { return String(e?.message ?? e); }
};
const state = () => V.ledger(ctx.currentQueryContext.state);

// Writers take no path: the ledger places and clears leaves itself.
const countersign = (who, secret, record) => {
  licPath = { ...NO_PATH, secret };
  try { return run(who, 'countersignLicense', record); } finally { licPath = NO_PATH; }
};
const approve = (who, lc, record, nlc) => run(who, 'approveTransfer', lc, record, nlc);

// No live leaf: a well-formed path for that leaf at slot 0 (real siblings when the tree
// has a slot 0, all-zero ones before the first activation). Passes the leaf check; the
// root check must refuse it.
const stubPath = (tree, leaf) => {
  try { return tree.pathForLeaf(0n, leaf); }
  catch { return { leaf, path: Array.from({ length: 24 }, () => ({ sibling: { field: 0n }, goes_left: true })) }; }
};
/**
 * Present a licence. NO CIRCUIT ARGUMENTS: the secret, the record and the path are
 * all witnesses, which is the whole of finding 9. The path is findPathForLeaf on the
 * ledger tree; a party with no live licence finds none, so this hands over a
 * well-formed path for that leaf at slot 0 and lets the root check refuse it.
 */
const present = (who, secret, record) => {
  const leaf = V.pureCircuits.licenseKey(V.pureCircuits.licenseCommit(secret, record), record);
  const tree = state().activeLicenses;
  licPath = { ...NO_PATH, secret, record, path: tree.findPathForLeaf(leaf) ?? stubPath(tree, leaf) };
  try { return run(who, 'proveLicense'); } finally { licPath = NO_PATH; }
};
const presentRefused = (who, secret, record) => {
  try { present(who, secret, record); return ''; }
  catch (e) { return String(e?.message ?? e); }
};

const breederRecord = V.pureCircuits.commit(BREEDER);
const K = (lc, record) => V.pureCircuits.licenseKey(lc, record);
const sniperRecord = V.pureCircuits.commit(SNIPER);

// ── V1: front-run ───────────────────────────────────────────────────────────
console.log('\n== V1. can a sniper capture a licence before the breeder issues it? ==');
{
  // The licensee generates their secret. The breeder is about to issue against it.
  const licenceSecret = sec('licence-1');
  const intended = V.pureCircuits.licenseCommit(licenceSecret, breederRecord);

  // The sniper reads the pending call and issues FIRST, under their own record.
  const sniped = V.pureCircuits.licenseCommit(licenceSecret, sniperRecord);
  note(`under the breeder's record: ${hex(intended).slice(0, 24)}…`);
  note(`under the sniper's record : ${hex(sniped).slice(0, 24)}…`);
  ok('the two commitments differ', hex(intended) !== hex(sniped),
     'an unbound commitment was the same value whoever issued it, so the sniper\n' +
     '     occupied the exact key the breeder needed');

  run(SNIPER, 'issueLicense', sniped);
  // The stronger attack: the sniper issues the breeder's OWN commitment under the
  // sniper's record. Licence entries are keyed by (licence, issuer), so it lands
  // in a different entry and blocks nothing.
  run(SNIPER, 'issueLicense', intended);

  // The breeder's call now succeeds: the sniper is not in its way.
  const breederErr = refused(BREEDER, 'issueLicense', intended);
  ok('the breeder can still issue', breederErr === '',
     `refused: ${breederErr} — the sniper blocked the breeder`);

  // The licensee countersigns naming the breeder's record.
  const csErr = (() => { try { countersign(LICENSEE, licenceSecret, breederRecord); return ''; } catch (e) { return String(e?.message ?? e); } })();
  ok('the licensee countersigns the breeder\'s licence', csErr === '', csErr);
  ok('the breeder\'s licence is the active one',
     state().licenseStatusOf.member(K(intended, breederRecord)) &&
     state().licenseStatusOf.lookup(K(intended, breederRecord)) === V.LicenseState.ACTIVE);
  ok('the sniper\'s entry never activates',
     state().licenseStatusOf.lookup(K(sniped, sniperRecord)) === V.LicenseState.PENDING &&
     state().licenseStatusOf.lookup(K(intended, sniperRecord)) === V.LicenseState.PENDING,
     'the countersignature landed on the sniper\'s entry and the licence went active\n     under a record the licensee never agreed to');

  // And a proof against the sniper's record fails.
  const proofErr = presentRefused(LICENSEE, licenceSecret, sniperRecord);
  ok('proving against the sniper\'s record fails', proofErr !== '',
     'the sniper\'s entry is PENDING and never entered the tree, so there is no leaf\n' +
     '     to open — and the commitment differs from the breeder\'s in any case');
}

// ── V3: sublicence through the shared domain tag ────────────────────────────
console.log('\n== V3. can a licence secret be anchored as a record? ==');
{
  const licenceSecret = sec('licence-1');
  const asRecord = V.pureCircuits.commit(licenceSecret);
  const asLicence = V.pureCircuits.licenseCommit(licenceSecret, breederRecord);

  note(`same secret as a record : ${hex(asRecord).slice(0, 24)}…`);
  note(`same secret as a licence: ${hex(asLicence).slice(0, 24)}…`);
  ok('a secret commits differently as a record and as a licence',
     hex(asRecord) !== hex(asLicence),
     'one domain tag served both, so a licensee could load their licence secret as a\n' +
     '     genetic secret, anchor the licence as their own record, and issue\n' +
     '     sublicences against it without the breeder being party to any of it');

  // The licensee can still anchor a record of their own — that is allowed — but it
  // is not the licence, and a licence issued against it is a different thing.
  const sub = V.pureCircuits.licenseCommit(sec('sub'), asRecord);
  const subErr = refused(licenceSecret, 'issueLicense', sub);
  note(subErr ? `sublicence refused: ${subErr}` : 'sublicence issued against their own record');
  ok('a sublicence does not touch the breeder\'s licence',
     !state().licenseStatusOf.member(K(asLicence, breederRecord)) ||
     state().licenseStatusOf.lookup(K(asLicence, breederRecord)) === V.LicenseState.ACTIVE,
     'the sublicence path altered the breeder\'s licence');
}

// ── V2: resurrection after transfer ─────────────────────────────────────────
console.log('\n== V2. can an outgoing licensee resurrect an assigned licence? ==');
{
  const outgoing = sec('outgoing');
  const incoming = sec('incoming');
  const lc = V.pureCircuits.licenseCommit(outgoing, breederRecord);
  const nlc = V.pureCircuits.licenseCommit(incoming, breederRecord);

  run(BREEDER, 'issueLicense', lc);
  countersign(LICENSEE, outgoing, breederRecord);
  licPath = { ...NO_PATH, secret: outgoing };
  try { run(LICENSEE, 'proposeTransfer', breederRecord, nlc); } finally { licPath = NO_PATH; }
  approve(BREEDER, lc, breederRecord, nlc);

  ok('the assignment removed the old licence', !state().licenseStatusOf.member(K(lc, breederRecord)));

  // The outgoing party re-issues the old commitment under a record THEY own.
  const theirRecord = V.pureCircuits.commit(sec('outgoing-record'));
  const reissued = V.pureCircuits.licenseCommit(outgoing, theirRecord);
  note(`original commitment : ${hex(lc).slice(0, 24)}…`);
  note(`re-issued under them: ${hex(reissued).slice(0, 24)}…`);
  ok('a re-issue under another record is a different licence',
     hex(reissued) !== hex(lc),
     'the outgoing party re-created the exact key that was removed, countersigned it\n' +
     '     themselves, and proveLicense with the old secret passed');

  const proofErr = presentRefused(LICENSEE, outgoing, breederRecord);
  ok('the old secret no longer proves the breeder\'s licence', proofErr !== '', proofErr);

  // And the incoming party can, from the slot the outgoing party's leaf vacated.
  const incomingErr = presentRefused(LICENSEE, incoming, breederRecord);
  ok('the incoming party proves the licence that moved to them', incomingErr === '', incomingErr);
}

console.log(`\n${bad === 0 ? 'V1, V2 and V3 no longer hold' : `${bad} check(s) failing`}`);
process.exit(bad === 0 ? 0 : 1);
