/**
 * Finding 3, answered by building the third party.
 *
 * The review's fix was "publish rc and oc from encumber/discharge, and child and
 * parent from declareParent, through ledger writes". Cells were added for all of
 * those. The open question was whether that is actually SUFFICIENT — and the only
 * honest way to answer it is to write the outsider and make them do the work.
 *
 * The Observer below sees exactly one thing per transaction: the ledger cells the
 * chain holds afterwards. No witnesses, no sibling paths, no entry point, and no
 * access to the ObligationTree the callers keep. From that alone it has to
 * reconstruct the tree and the descent graph, reproduce every root the contract
 * published, and hand out sibling paths that the circuit itself accepts.
 *
 *   node contract/verify-max-3.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);
const { ObligationTree, EMPTY_ROOT, NULL_LEAF } =
  await import(pathToFileURL(path.join(here, 'src/tree.mjs')).href);
const { DescentGraph } = await import(pathToFileURL(path.join(here, 'src/descent.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const sec = (s) => createHash('sha256').update(s).digest();
const C = L.pureCircuits;
const COIN = '0'.repeat(64);
const ZERO = hex(new Uint8Array(32));

// ── the chain ───────────────────────────────────────────────────────────────
const EMPTY_SLOT = { isEmpty: true, record: new Uint8Array(32), obligation: new Uint8Array(32), beneficiary: new Uint8Array(32) };
const party = (own, ben, sibs = [], dirs = [], chain = [new Uint8Array(32)], occupant = EMPTY_SLOT) =>
  new L.Contract({
    localGeneticSecret: (c) => [c.privateState, own],
    beneficiarySecret: (c) => [c.privateState, ben],
    slotIsEmpty: (c) => [c.privateState, occupant.isEmpty],
    slotOccupantRecord: (c) => [c.privateState, occupant.record],
    slotOccupantObligation: (c) => [c.privateState, occupant.obligation],
    slotOccupantBeneficiary: (c) => [c.privateState, occupant.beneficiary],
    merkleSiblings: (c) => [c.privateState, sibs],
    merkleDirections: (c) => [c.privateState, dirs],
    ancestryChain: (c) => [c.privateState, [chain[0], chain[0], chain[0], chain[0]]],
  });

let ctx = rt.createCircuitContext(
  rt.sampleContractAddress(), COIN,
  party(sec('x'), sec('x')).initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
);
const state = () => L.ledger(ctx.currentQueryContext.state);

/**
 * What a chain indexer gets: the ledger cells after each transaction, nothing else.
 * Deliberately NOT the entry point. The chain does carry it, and an indexer may use
 * it — but a reconstruction that needs it is one that breaks the moment two circuits
 * write the same cells, so this proves the stronger property.
 */
const chainLog = [];
const observe = () => {
  const s = state();
  chainLog.push({
    encumberedRoot: hex(s.encumberedRoot),
    lastEncumberedRecord: hex(s.lastEncumberedRecord),
    lastObligation: hex(s.lastObligation),
    lastBeneficiary: hex(s.lastBeneficiary),
    lastDescentChild: hex(s.lastDescentChild),
    lastDescentParent: hex(s.lastDescentParent),
    lastClearedAncestor: hex(s.lastClearedAncestor),
    lastCleanProofBy: hex(s.lastCleanProofBy),
    encumberSeq: Number(s.encumberSeq),
    descentSeq: Number(s.descentSeq),
    cleanProofSeq: Number(s.cleanProofSeq),
  });
};
observe(); // the deployed state

// The callers' own tree, which the observer never sees.
const insider = new ObligationTree();
const run = (contract, circuit, ...args) => {
  ctx = contract.impureCircuits[circuit](ctx, ...args);
  ctx = ctx.context;
  observe();
};

// ── a season of activity ────────────────────────────────────────────────────
console.log('\n== a season of transactions ==');
const holder = (n) => sec(`holder-${n}`);
const rec = (n) => C.commit(holder(n));
const benSec = (n) => sec(`beneficiary-${n}`);
const ben = (n) => C.commit(benSec(n));
const obl = (n) => sec(`obligation-${n}`);

// Four records, a two-generation pedigree with a cross at the top.
for (const [child, parent] of [[2, 1], [3, 1], [4, 2], [4, 3]]) {
  run(party(holder(child), holder(child)), 'declareParent', rec(child), rec(parent));
}

// Three encumbrances, one of them later discharged and re-attached under a
// different obligation — the case where an observer that guessed the operation
// from the cells alone would diverge and never recover.
const attach = (r, o, b) => {
  const p = insider.encumber(rec(r), obl(o), ben(b));
  run(party(holder(r), benSec(b), p.siblings, p.dirs), 'encumber', rec(r), obl(o));
};
const release = (r, o, b) => {
  const p = insider.discharge(rec(r), obl(o), ben(b));
  run(party(holder(r), benSec(b), p.siblings, p.dirs), 'discharge', rec(r), obl(o));
};

attach(1, 'royalty', 1);
attach(2, 'levy', 2);
release(1, 'royalty', 1);
attach(1, 'second-royalty', 1);
attach(3, 'levy', 2);

// A clean proof on record 4, whose own slot is untouched.
{
  const p = insider.cleanPath(rec(4));
  run(party(holder(9), holder(9), p.siblings, p.dirs, [rec(4)], p.occupant), 'proveAncestorClean');
}
note(`${chainLog.length - 1} transactions, ${insider.leaves.size} obligations outstanding`);

// ── the outsider ────────────────────────────────────────────────────────────
/**
 * Rebuilds both structures from the cell log alone.
 *
 * The operation is NOT published — encumber and discharge write byte-identical
 * cells and both increment encumberSeq — but it does not have to be. The tree the
 * observer already holds settles it: a slot holding the null leaf can only have
 * been encumbered, and a slot holding exactly obligationLeaf(rc,oc,bc) can only
 * have been discharged. If neither matches, the log is inconsistent and the
 * observer says so rather than guessing.
 */
const replay = (log) => {
  const tree = new ObligationTree();
  const graph = new DescentGraph();
  const cleanProofs = [];         // { ancestor, by, root }
  const problems = [];
  let prev = log[0];

  for (let i = 1; i < log.length; i++) {
    const e = log[i];
    if (e.descentSeq > prev.descentSeq) {
      graph.observe(Buffer.from(e.lastDescentChild, 'hex'), Buffer.from(e.lastDescentParent, 'hex'));
    }
    if (e.cleanProofSeq > prev.cleanProofSeq) {
      cleanProofs.push({ ancestor: e.lastClearedAncestor, by: e.lastCleanProofBy, root: e.encumberedRoot });
    }
    if (e.encumberSeq > prev.encumberSeq) {
      const r = Buffer.from(e.lastEncumberedRecord, 'hex');
      const o = Buffer.from(e.lastObligation, 'hex');
      const b = Buffer.from(e.lastBeneficiary, 'hex');
      const dirs = C.slotBits(r);
      const sitting = hex(tree.leafAt(dirs));
      const mine = hex(C.obligationLeaf(r, o, b));
      if (sitting === ZERO) tree.encumber(r, o, b);
      else if (sitting === mine) tree.discharge(r, o, b);
      else { problems.push(`tx ${i}: slot holds a leaf that is neither empty nor this obligation`); continue; }
      if (hex(tree.root()) !== e.encumberedRoot)
        problems.push(`tx ${i}: rebuilt root ${hex(tree.root()).slice(0, 12)} != published ${e.encumberedRoot.slice(0, 12)}`);
    }
    prev = e;
  }
  return { tree, graph, cleanProofs, problems };
};

console.log('\n== 1. can an outsider reproduce every root the contract published? ==');
const out = replay(chainLog);
for (const p of out.problems) note(p);
ok('the rebuilt root matches the published root at every transaction',
   out.problems.length === 0,
   'the leaf inputs on chain are not enough to follow the tree');
note(`final rebuilt root : ${hex(out.tree.root()).slice(0, 24)}…`);
note(`final chain root   : ${chainLog.at(-1).encumberedRoot.slice(0, 24)}…`);
ok('the outsider ends on the chain\'s own root',
   hex(out.tree.root()) === chainLog.at(-1).encumberedRoot);

console.log('\n== 2. can the outsider tell which records are encumbered? ==');
{
  const encumbered = (r) => hex(out.tree.leafAt(C.slotBits(r))) !== ZERO;
  const got = [1, 2, 3, 4].map((n) => `${n}:${encumbered(rec(n)) ? 'held' : 'clean'}`).join(' ');
  const want = [1, 2, 3, 4].map((n) => `${n}:${hex(insider.leafAt(C.slotBits(rec(n)))) !== ZERO ? 'held' : 'clean'}`).join(' ');
  note(`outsider: ${got}`);
  note(`actual  : ${want}`);
  ok('the outsider\'s encumbrance answers match the real tree', got === want,
     'an encumbrance published only its new root, so a third party saw a sequence of\n' +
     '     roots and could not tell which records they concerned');
}

console.log('\n== 3. can the outsider build a sibling path the CIRCUIT accepts? ==');
{
  // The test of a rebuilt tree is not that it agrees with itself. A path the
  // outsider derived is folded by the contract's own circuit and compared against
  // the root the chain published.
  const subject = rec(4);
  const p = out.tree.cleanPath(subject);
  const folded = C.merkleRoot(NULL_LEAF, p.siblings, C.slotBits(subject));
  note(`folded by the circuit: ${hex(folded).slice(0, 24)}…`);
  note(`published root       : ${chainLog.at(-1).encumberedRoot.slice(0, 24)}…`);
  ok('a path built from chain data alone folds to the published root',
     hex(folded) === chainLog.at(-1).encumberedRoot,
     'without the leaves that produced each root a third party can build no sibling\n' +
     '     path, so every clean-descent answer depends on the registry that watched\n' +
     '     the API calls');

  // And it must be able to build the ENCUMBERED side too, or it cannot verify a
  // discharge someone else performs next.
  const held = rec(1);
  const dirs = C.slotBits(held);
  const leaf = out.tree.leafAt(dirs);
  const foldedHeld = C.merkleRoot(leaf, out.tree.siblingsFor(dirs), dirs);
  ok('an occupied slot\'s path folds to the published root too',
     hex(foldedHeld) === chainLog.at(-1).encumberedRoot,
     'the leaf is a function of record, obligation AND beneficiary; missing any one\n' +
     '     of the three makes the occupied side of the tree unreconstructable');
}

console.log('\n== 4. can the outsider enumerate a record\'s parents? ==');
{
  const parents = out.graph.parentsOf.get(hex(rec(4))) ?? [];
  note(`record 4 declared parents: ${parents.length}`);
  ok('both sides of a cross are enumerable', parents.length === 2 &&
     parents.includes(hex(rec(2))) && parents.includes(hex(rec(3))),
     'the edge hash alone let a verifier TEST a pair they already suspected; it did\n' +
     '     not let them ENUMERATE, so the graph verifyDescent walks was not\n' +
     '     independently obtainable');

  note(`ancestorCount(record 4) = ${out.graph.ancestorCount(rec(4))}`);
  ok('the full ancestry is reachable', out.graph.ancestorCount(rec(4)) === 3);
}

console.log('\n== 5. does the outsider reach the same verdict as the insider? ==');
{
  // The whole point of rebuilding: answering clean descent without asking anyone.
  const encumbered = (r) => hex(out.tree.leafAt(C.slotBits(r))) !== ZERO;
  const proven = out.graph.ancestorsOf(rec(4))
    .filter((h) => !encumbered(Buffer.from(h, 'hex')));
  const verdict = out.graph.verifyDescent(rec(4), proven);
  note(verdict.ok ? `accepted, ${verdict.ancestorsChecked} ancestors checked` : `rejected: ${verdict.reason}`);
  ok('record 4 is refused while an ancestor is encumbered', !verdict.ok,
     'records 1, 2 and 3 are upstream of 4 and two of them carry obligations');

  // Clear them and the same walk accepts.
  release(2, 'levy', 2);
  release(3, 'levy', 2);
  release(1, 'second-royalty', 1);
  const out2 = replay(chainLog);
  const enc2 = (r) => hex(out2.tree.leafAt(C.slotBits(r))) !== ZERO;
  const v2 = out2.graph.verifyDescent(rec(4), out2.graph.ancestorsOf(rec(4)).filter((h) => !enc2(Buffer.from(h, 'hex'))));
  note(v2.ok ? `after discharge: accepted, ${v2.ancestorsChecked} checked` : `after discharge: ${v2.reason}`);
  ok('the same walk accepts once every ancestor is discharged', v2.ok);
  ok('the outsider tracked three more discharges without being told the operation',
     out2.problems.length === 0 && hex(out2.tree.root()) === chainLog.at(-1).encumberedRoot,
     out2.problems.join('; '));
  ok('and the tree is back to empty', hex(out2.tree.root()) === hex(EMPTY_ROOT));
}

console.log('\n== 6. clean proofs are attributable ==');
{
  const proof = out.cleanProofs.at(-1);
  note(`a clean proof names ancestor ${proof.ancestor.slice(0, 16)}… and prover ${proof.by.slice(0, 16)}…`);
  ok('a clean proof is attributable from chain data',
     proof.ancestor === hex(rec(4)) && proof.by === hex(C.commit(holder(9))));
  note('proveAncestorClean asserts against the root current at the time, so an observer');
  note('reading an old proof re-checks the slot in the tree it rebuilt rather than');
  note('trusting the proof — which it can, because it has the tree.');
}

// ── the condition sufficiency actually rests on ─────────────────────────────
console.log('\n== 7. what the cells are NOT sufficient for ==');
{
  // "Single cells are enough; history keeps them" is the whole claim, and the
  // second half is doing the work. A cell holds one value: everything before it is
  // recoverable only from per-transaction history. An observer handed the contract's
  // CURRENT state — which is what "read the ledger" usually means — gets one
  // encumbrance and one edge and cannot rebuild anything.
  const currentStateOnly = replay([chainLog[0], chainLog.at(-1)]);
  const rebuilt = hex(currentStateOnly.tree.root());
  note(`from current state alone, rebuilt root: ${rebuilt.slice(0, 24)}…`);
  note(`the chain's actual root              : ${chainLog.at(-1).encumberedRoot.slice(0, 24)}…`);
  ok('current ledger state alone does NOT rebuild the tree',
     rebuilt !== chainLog.at(-1).encumberedRoot || currentStateOnly.problems.length > 0,
     'if one snapshot were enough, the cells would be carrying history they cannot hold');

  const edges = currentStateOnly.graph.parentsOf.get(hex(rec(4)))?.length ?? 0;
  note(`from current state alone, record 4 has ${edges} discoverable parent(s) of 2`);
  ok('current ledger state alone does NOT rebuild the graph', edges < 2);
  note('So finding 3 is closed against an ARCHIVAL indexer, which is what the contract');
  note('header claims and what a registry consuming this has to run. A verifier with');
  note('only a state query still has to be given the history by someone.');
}

console.log(`\n${bad === 0 ? 'finding 3: the published cells are sufficient — the outsider rebuilt both structures' : `${bad} still failing`}`);
process.exit(bad === 0 ? 0 : 1);
