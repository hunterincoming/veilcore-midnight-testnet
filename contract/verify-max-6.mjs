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
const { LicenseTree } = await import(pathToFileURL(path.join(here, 'src/license-tree.mjs')).href);
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
  // Licence-tree path for the call about to be made. proveLicense takes no
  // arguments now, so which licence is being shown is witness data.
  licenseSecret: (c) => [c.privateState, licPath.secret],
  licenseRecord: (c) => [c.privateState, licPath.record],
  licenseSiblings: (c) => [c.privateState, licPath.siblings],
  licenseDirections: (c) => [c.privateState, licPath.dirs],
});

const licTree = new LicenseTree();
const NO_PATH = { secret: sec('none'), record: sec('none'), siblings: [], dirs: [] };
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

/**
 * Run a licence circuit with the tree path it needs, advancing the local tree only
 * when the chain accepted the call. A refused call must leave the tree where it
 * was, or every path built after it is against a root the chain never held.
 */
const licensed = (plan, apply, secret, name, ...args) => {
  let p;
  try { p = plan(); } catch { p = { index: 0, siblings: [], dirs: [] }; }
  licPath = { ...licPath, siblings: p.siblings, dirs: p.dirs };
  try {
    const out = run(secret, name, ...args);
    apply(p.index);
    return out;
  } finally { licPath = NO_PATH; }
};
const countersign = (who, secret, record) => {
  const lc = V.pureCircuits.licenseCommit(secret, record);
  return licensed(() => licTree.planInsert(lc), (i) => licTree.applyInsert(lc, i),
                  who, 'countersignLicense', secret, record);
};
const approve = (who, lc, record, nlc) =>
  licensed(() => licTree.planReplace(lc), (i) => licTree.applyReplace(lc, nlc, i),
           who, 'approveTransfer', lc, record, nlc);

/**
 * Present a licence. NO CIRCUIT ARGUMENTS: the secret, the record and the position
 * are all witnesses, which is the whole of finding 9. A party with no live licence
 * cannot build a real path, so this hands over a null one and lets the fold refuse.
 */
const present = (who, secret, record) => {
  const lc = V.pureCircuits.licenseCommit(secret, record);
  let p;
  try { p = licTree.pathFor(lc); }
  catch {
    p = { siblings: Array.from({ length: 16 }, () => new Uint8Array(32)),
          dirs: Array.from({ length: 16 }, () => false) };
  }
  licPath = { secret, record, siblings: p.siblings, dirs: p.dirs };
  try { return run(who, 'proveLicense'); } finally { licPath = NO_PATH; }
};
const presentRefused = (who, secret, record) => {
  try { present(who, secret, record); return ''; }
  catch (e) { return String(e?.message ?? e); }
};

const breederRecord = V.pureCircuits.commit(BREEDER);
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

  run(SNIPER, 'issueLicense', sniperRecord, sniped);

  // The breeder's call now succeeds: the sniper is not in its way.
  const breederErr = refused(BREEDER, 'issueLicense', breederRecord, intended);
  ok('the breeder can still issue', breederErr === '',
     `refused: ${breederErr} — the sniper blocked the breeder`);

  // The licensee countersigns naming the breeder's record.
  const csErr = (() => { try { countersign(LICENSEE, licenceSecret, breederRecord); return ''; } catch (e) { return String(e?.message ?? e); } })();
  ok('the licensee countersigns the breeder\'s licence', csErr === '', csErr);
  ok('the breeder\'s licence is the active one',
     state().licenseStatusOf.member(intended) &&
     state().licenseStatusOf.lookup(intended) === V.LicenseState.ACTIVE);
  ok('the sniper\'s entry never activates',
     state().licenseStatusOf.lookup(sniped) === V.LicenseState.PENDING,
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
  const subErr = refused(licenceSecret, 'issueLicense', asRecord, sub);
  note(subErr ? `sublicence refused: ${subErr}` : 'sublicence issued against their own record');
  ok('a sublicence does not touch the breeder\'s licence',
     !state().licenseStatusOf.member(asLicence) ||
     state().licenseStatusOf.lookup(asLicence) === V.LicenseState.ACTIVE,
     'the sublicence path altered the breeder\'s licence');
}

// ── V2: resurrection after transfer ─────────────────────────────────────────
console.log('\n== V2. can an outgoing licensee resurrect an assigned licence? ==');
{
  const outgoing = sec('outgoing');
  const incoming = sec('incoming');
  const lc = V.pureCircuits.licenseCommit(outgoing, breederRecord);
  const nlc = V.pureCircuits.licenseCommit(incoming, breederRecord);

  run(BREEDER, 'issueLicense', breederRecord, lc);
  countersign(LICENSEE, outgoing, breederRecord);
  run(LICENSEE, 'proposeTransfer', outgoing, breederRecord, nlc);
  approve(BREEDER, lc, breederRecord, nlc);

  ok('the assignment removed the old licence', !state().licenseStatusOf.member(lc));

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
