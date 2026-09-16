/**
 * Finding 9, demonstrated fixed.
 *
 * "countersignLicense and proveLicense put the licence commitment into the
 * transcript (map lookup key). licenseRecordOf maps it to the issuing record, so
 * each presentation names the breeder's record and repeated presentations link.
 * The comment on proveLicense says it does not reveal the counterparty."
 *
 * The test is not that a comment was corrected. It is that an observer reading
 * everything the chain carries cannot tell two presentations of the same licence
 * from two presentations of different ones, and cannot name the breeder behind
 * either. So this runs presentations and then reads the transcript back.
 *
 * COUNTERSIGNING STILL NAMES THE RECORD, deliberately: it is an agreement between
 * two parties who both know who they are dealing with, and the licence has to enter
 * the maps under a key. Presentation is the act that repeats, to strangers, and
 * that is the one this closes.
 *
 *   node contract/verify-max-9.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = await import(pathToFileURL(path.join(here, 'src/managed/veilcore/contract/index.js')).href);
const { LicenseTree, DEPTH, CAPACITY, EMPTY_ROOT } =
  await import(pathToFileURL(path.join(here, 'src/license-tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const sec = (s) => createHash('sha256').update(s).digest();
const C = V.pureCircuits;
const COIN = '0'.repeat(64);

const NO_PATH = { secret: sec('none'), record: sec('none'), siblings: [], dirs: [] };
let licPath = NO_PATH;
const party = (secret) => new V.Contract({
  localGeneticSecret: (c) => [c.privateState, secret],
  incomingGeneticSecret: (c) => [c.privateState, secret],
  recoverySecret: (c) => [c.privateState, secret],
  licenseSecret: (c) => [c.privateState, licPath.secret],
  licenseRecord: (c) => [c.privateState, licPath.record],
  licenseSiblings: (c) => [c.privateState, licPath.siblings],
  licenseDirections: (c) => [c.privateState, licPath.dirs],
});

let ctx = rt.createCircuitContext(
  rt.sampleContractAddress(), COIN,
  party(sec('x')).initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
);
const state = () => V.ledger(ctx.currentQueryContext.state);

/**
 * Every 32-byte value anywhere in a structure, as hex.
 *
 * The runtime serialises byte strings as {"0":84,"1":91,…}, so searching the JSON
 * text for a hex commitment finds nothing WHATEVER the transcript contains — an
 * earlier version of this file did exactly that and reported a clean transcript for
 * a circuit that was publishing the commitment. The values are extracted and
 * compared as bytes instead.
 */
const bytes32 = (node, out = new Set()) => {
  if (node == null) return out;
  if (node instanceof Uint8Array) { if (node.length === 32) out.add(hex(node)); return out; }
  if (Array.isArray(node)) { for (const v of node) bytes32(v, out); return out; }
  if (typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.length === 32 && keys.every((k, i) => k === String(i))) {
      out.add(hex(Uint8Array.from(keys.map((k) => node[k]))));
      return out;
    }
    for (const v of Object.values(node)) bytes32(v, out);
  }
  return out;
};

/**
 * Run a circuit and keep what the chain would carry.
 *
 * `publicTranscript` is the part a third party reads; `input`/`output` travel in
 * the blinded communication commitment and reach the caller's own DApp only, which
 * is finding 2. A map lookup puts its key in the public transcript, so that is
 * where a presentation would name the licence.
 */
const calls = [];
const run = (secret, circuit, ...args) => {
  const r = party(secret).impureCircuits[circuit](ctx, ...args);
  ctx = r.context;
  calls.push({
    circuit,
    public: bytes32(r.proofData?.publicTranscript),
    shape: JSON.stringify(r.proofData?.publicTranscript ?? null),
  });
  return r;
};
const refused = (secret, circuit, ...args) => {
  try { run(secret, circuit, ...args); return ''; }
  catch (e) { return String(e?.message ?? e); }
};

const licTree = new LicenseTree();
const licensed = (plan, apply, secret, name, ...args) => {
  let p;
  try { p = plan(); } catch { p = { index: 0, siblings: [], dirs: [] }; }
  licPath = { ...licPath, siblings: p.siblings, dirs: p.dirs };
  try { const out = run(secret, name, ...args); apply(p.index); return out; }
  finally { licPath = NO_PATH; }
};
const countersign = (who, secret, record) => {
  const lc = C.licenseCommit(secret, record);
  return licensed(() => licTree.planInsert(lc), (i) => licTree.applyInsert(lc, i),
                  who, 'countersignLicense', secret, record);
};
const present = (who, secret, record) => {
  const lc = C.licenseCommit(secret, record);
  let p;
  try { p = licTree.pathFor(lc); }
  catch {
    p = { siblings: Array.from({ length: DEPTH }, () => new Uint8Array(32)),
          dirs: Array.from({ length: DEPTH }, () => false) };
  }
  licPath = { secret, record, siblings: p.siblings, dirs: p.dirs };
  try { return run(who, 'proveLicense'); } finally { licPath = NO_PATH; }
};
const presentRefused = (who, secret, record) => {
  try { present(who, secret, record); return ''; } catch (e) { return String(e?.message ?? e); }
};

// ── the setup: one breeder, two licensees ───────────────────────────────────
const BREEDER = sec('breeder');
const BREEDER_REC = C.commit(BREEDER);
const OTHER_BREEDER = sec('other-breeder');
const OTHER_REC = C.commit(OTHER_BREEDER);

console.log('\n== 0. the tree deploys usable ==');
{
  note(`licence tree depth ${DEPTH}, ${CAPACITY} concurrent active licences`);
  ok('activeLicenseRoot starts at the empty tree root',
     hex(state().activeLicenseRoot) === hex(EMPTY_ROOT),
     'a root left at the default Bytes<32> is an unset cell no fold can reproduce,\n' +
     '     so every countersignature and every licence proof would fail — finding 1,\n' +
     '     repeated in a second contract');
}

run(BREEDER, 'anchor', BREEDER_REC, C.commit(sec('breeder-recovery')));
run(OTHER_BREEDER, 'anchor', OTHER_REC, C.commit(sec('other-recovery')));

const AL = sec('alice-licence');
const BL = sec('bob-licence');
const CL = sec('carol-licence');
const alice = C.licenseCommit(AL, BREEDER_REC);
const bob = C.licenseCommit(BL, BREEDER_REC);
const carol = C.licenseCommit(CL, OTHER_REC);

run(BREEDER, 'issueLicense', BREEDER_REC, alice);
run(BREEDER, 'issueLicense', BREEDER_REC, bob);
run(OTHER_BREEDER, 'issueLicense', OTHER_REC, carol);
countersign(sec('alice'), AL, BREEDER_REC);
countersign(sec('bob'), BL, BREEDER_REC);
countersign(sec('carol'), CL, OTHER_REC);

// ── 1. does a presentation still work at all? ───────────────────────────────
console.log('\n== 1. does a live licence still prove, and a dead one still fail? ==');
{
  ok('the holder of a live licence proves it',
     presentRefused(sec('alice'), AL, BREEDER_REC) === '');
  ok('a secret nobody issued against proves nothing',
     presentRefused(sec('mallory'), sec('made-up'), BREEDER_REC) !== '',
     'the proof would be worthless if any secret opened it');
  ok('the right secret against the wrong record proves nothing',
     presentRefused(sec('alice'), AL, OTHER_REC) !== '',
     'the leaf binds the record, so a licence is only a licence against its issuer');

  // A licence that was issued but never accepted is not presentable.
  const dangling = sec('never-countersigned');
  run(BREEDER, 'issueLicense', BREEDER_REC, C.licenseCommit(dangling, BREEDER_REC));
  ok('a PENDING licence cannot be presented',
     presentRefused(sec('nobody'), dangling, BREEDER_REC) !== '',
     'the tree holds the ACTIVE set, so a licence the licensee never accepted has no\n' +
     '     leaf to open');
}

// ── 2. what the transcript carries ──────────────────────────────────────────
console.log('\n== 2. does a presentation name the licence or the breeder? ==');
{
  const presentations = calls.filter((c) => c.circuit === 'proveLicense');
  note(`${presentations.length} presentations recorded`);

  const watched = [['alice\'s licence commitment', alice], ['bob\'s licence commitment', bob],
                   ['the breeder\'s record', BREEDER_REC], ['the other breeder\'s record', OTHER_REC]];
  const leaked = new Set();
  for (const c of presentations) {
    note(`proveLicense transcript holds ${c.public.size} 32-byte value(s)`);
    for (const [label, v] of watched) if (c.public.has(hex(v))) leaked.add(label);
  }
  for (const l of leaked) note(`LEAKED: ${l}`);
  ok('no presentation names a licence commitment or an issuing record',
     leaked.size === 0,
     'the commitment was a map lookup key, so it was in the transcript of every\n' +
     '     presentation, and licenseRecordOf maps it straight to the breeder');

  // A value IS published, and an unexplained one would be exactly the kind of thing
  // this file exists to catch. It is the tree root the proof was compared against —
  // already in a ledger cell, identical for every presentation, and therefore
  // carrying nothing about which licence was shown.
  const only = [...presentations[0].public];
  ok('the one value it does publish is the tree root everyone shares',
     only.length === 1 && only[0] === hex(state().activeLicenseRoot),
     `unaccounted value(s) in the transcript: ${only.join(', ')}`);

  // THE CONTROL. If this fails, the scanner is not finding values that are really
  // there, and the check above says nothing at all.
  const cs = calls.find((c) => c.circuit === 'countersignLicense');
  ok('the scanner does find a commitment when one IS published',
     cs.public.has(hex(BREEDER_REC)) || cs.public.has(hex(alice)),
     'countersignLicense inserts into licenseStatusOf and licenseRecordOf, so both\n' +
     '     the licence commitment and the record are in its public transcript. A\n' +
     '     scanner that cannot see them there cannot testify to their absence above.');
  note(`countersign transcript holds ${cs.public.size} 32-byte value(s); ` +
       `licence ${cs.public.has(hex(alice))}, record ${cs.public.has(hex(BREEDER_REC))}`);
  note('countersigning names both, deliberately: it is an agreement between two');
  note('parties who know each other, and the licence has to enter the maps under its');
  note('issuer. Presentation is the act that repeats to strangers.');
}

// ── 3. are two presentations linkable? ──────────────────────────────────────
console.log('\n== 3. can an observer link two presentations? ==');
{
  const before = calls.length;
  present(sec('alice'), AL, BREEDER_REC);   // the same licence, shown twice
  present(sec('alice'), AL, BREEDER_REC);
  present(sec('bob'), BL, BREEDER_REC);     // a different licence, same breeder
  present(sec('carol'), CL, OTHER_REC);     // a different breeder entirely
  const four = calls.slice(before).map((c) => c.shape);

  note('two presentations of ONE licence, one of another, one from another breeder');
  const [a1, a2, b1, c1] = four;
  ok('the same licence shown twice produces identical transcripts', a1 === a2,
     'if they differed, the difference would be the thing that identifies the licence');
  ok('a different licence from the same breeder is indistinguishable', a1 === b1,
     'two presentations linked to each other and to the breeder through the map key');
  ok('a licence from a different breeder is indistinguishable too', a1 === c1,
     'the transcript would otherwise partition presentations by issuer');
  note('every presentation is the same bytes, so the set of them carries only a count');
}

// ── 4. revocation still bites ───────────────────────────────────────────────
console.log('\n== 4. does a revoked licence stop proving? ==');
{
  ok('bob proves before revocation', presentRefused(sec('bob'), BL, BREEDER_REC) === '');

  const p = licTree.planRemove(bob);
  licPath = { ...licPath, siblings: p.siblings, dirs: p.dirs };
  const err = refused(BREEDER, 'revokeLicense', bob);
  licPath = NO_PATH;
  ok('the breeder revokes', err === '', err);
  licTree.applyRemove(bob, p.index);

  ok('the chain root matches the tree after revocation',
     hex(state().activeLicenseRoot) === hex(licTree.root()));
  ok('bob cannot prove afterwards', presentRefused(sec('bob'), BL, BREEDER_REC) !== '',
     'a leaf left behind would be a revoked licence that still proves — proveLicense\n' +
     '     opens the tree, not the map, so removing it from the map alone does nothing');
  ok('alice is unaffected', presentRefused(sec('alice'), AL, BREEDER_REC) === '',
     'revoking one licence must not disturb another');
}

// ── 5. what it still leaks ──────────────────────────────────────────────────
console.log('\n== 5. what a presentation still tells an observer ==');
{
  note('that a presentation happened, and when. Unlinkable is not invisible:');
  note('the transaction exists, and its timing is a channel against a holder who is');
  note('the only party likely to be presenting at a given moment.');
  note('');
  note('and the tree itself is public — anyone replaying the chain knows the set of');
  note('active licences and who issued each. What they cannot do is tie a PRESENTATION');
  note('to a member of that set, which is what the finding was about.');
  ok('the active set is public by construction',
     hex(state().activeLicenseRoot) === hex(licTree.root()),
     'an observer rebuilds the same tree from the map writes, which is what lets a\n' +
     '     holder recover their own path without storing it');
}

console.log(`\n${bad === 0 ? 'finding 9 demonstrated fixed' : `${bad} still failing`}`);
process.exit(bad === 0 ? 0 : 1);
