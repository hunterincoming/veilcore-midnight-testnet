/**
 * Finding 7, demonstrated.
 *
 * Slot squatting, run rather than described — the attack executes, and then the
 * same attack executes against the fixed circuit and fails.
 *
 * TWO BUILDS, ON PURPOSE.
 *   · the production artifact, depth 24. Grinding a commitment into a chosen slot
 *     there costs about 2^24 hashes — 27.4 million, 81 seconds on one core in the
 *     review's measurement — which is too slow to run inside a suite. So the
 *     COLLIDED STATE is constructed directly and the circuit is asked to rule on
 *     it. That is the half the fix changes, and it is checked at the real depth.
 *   · a depth-8 build, 256 slots. Grinding costs a few hundred hashes, so the
 *     squatter's whole path runs for real: grind, encumber on chain, and watch the
 *     victim's clean proof. Depth changes the price of the grind and nothing else
 *     about the attack, which is the review's own finding.
 *
 * WHAT IS FIXED AND WHAT IS NOT. The false encumbrance is fixed: a victim sharing
 * a slot with someone else's obligation proves clean. The denial is NOT: the victim
 * still cannot BE encumbered, because one slot holds one leaf. That needs a bucket
 * leaf or a tree indexed by the full commitment, which is a redesign rather than a
 * check, and the last section pins it as a failing expectation rather than leaving
 * it to be rediscovered.
 *
 *   node contract/verify-max-7.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);
const S = await import(pathToFileURL(path.join(here, 'src/managed/lineage-shallow/contract/index.js')).href);
const { obligationTreeFor } = await import(pathToFileURL(path.join(here, 'src/tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
let pinned = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
// A finding that is understood, bounded and deliberately not fixed. Reported every
// run so it stays visible, and separated from a regression so it cannot be mistaken
// for one.
const pin = (n, stillBroken, d) => {
  if (stillBroken) { console.log(`PIN  ${n}`); if (d) console.log(`     ${d}`); pinned++; }
  else console.log(`NOTE ${n} — this no longer holds; the pin can be removed`);
};
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const sec = (s) => createHash('sha256').update(s).digest();
const COIN = '0'.repeat(64);

// ── a party, for either build ───────────────────────────────────────────────
const partyFor = (mod) => (own, ben, sibs, dirs, chain, occupant) =>
  new mod.Contract({
    localGeneticSecret: (c) => [c.privateState, own],
    beneficiarySecret: (c) => [c.privateState, ben],
    slotIsEmpty: (c) => [c.privateState, occupant.isEmpty],
    slotOccupantRecord: (c) => [c.privateState, occupant.record],
    slotOccupantObligation: (c) => [c.privateState, occupant.obligation],
    slotOccupantBeneficiary: (c) => [c.privateState, occupant.beneficiary],
    merkleSiblings: (c) => [c.privateState, sibs],
    merkleDirections: (c) => [c.privateState, dirs],
    ancestryChain: (c) => [c.privateState, [chain, chain, chain, chain]],
  });

const freshCtx = (mod, mk) => rt.createCircuitContext(
  rt.sampleContractAddress(), COIN,
  mk(sec('x'), sec('x'), [], [], new Uint8Array(32), { isEmpty: true, record: new Uint8Array(32), obligation: new Uint8Array(32), beneficiary: new Uint8Array(32) })
    .initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
);

// ─────────────────────────────────────────────────────────────────────────────
// 1. the production depth: does an unrelated leaf still read as an encumbrance?
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== 1. depth 24: a victim sharing a slot with a stranger\'s obligation ==');
{
  const C = L.pureCircuits;
  const { ObligationTree } = obligationTreeFor(C);

  const victimSecret = sec('victim');
  const victim = C.commit(victimSecret);
  const squatter = C.commit(sec('squatter'));
  const beneficiary = C.commit(sec('squatters-beneficiary'));
  const obligation = sec('squatters-obligation');

  // The collided state, built directly: the squatter's leaf sitting in the
  // VICTIM's slot. Grinding a secret that lands there is what costs 27 million
  // hashes; the state it produces is this, and the circuit cannot tell the
  // difference because a leaf is a leaf.
  const tree = new ObligationTree();
  const dirs = C.slotBits(victim);
  const leaf = C.obligationLeaf(squatter, obligation, beneficiary);
  tree.leaves.set(ObligationTree.key(dirs), leaf);
  tree.occupants.set(ObligationTree.key(dirs), {
    record: squatter, obligation, beneficiary,
  });

  note(`victim   ${hex(victim).slice(0, 20)}…`);
  note(`squatter ${hex(squatter).slice(0, 20)}… (leaf placed in the victim's slot)`);

  // No contract instance here, deliberately. Reaching this state through `encumber`
  // needs the grind; the state itself is just a leaf in a slot, and what the circuit
  // does with it is decided by the fold. So the folds the circuit performs are run
  // directly against the production artifact. Section 2 runs the contract.
  const occupant = tree.occupantOf(victim);
  const sibs = tree.siblingsFor(dirs);
  const squattedRoot = C.merkleRoot(leaf, sibs, dirs);

  ok('the constructed state is a real tree state',
     hex(squattedRoot) === hex(tree.root()),
     'the leaf placed by hand does not fold to the tree it was placed in');
  note(`squatted root ${hex(squattedRoot).slice(0, 20)}…`);
  ok('the occupant leaf names the squatter, not the victim',
     hex(occupant.record) === hex(squatter) && hex(occupant.record) !== hex(victim));

  // What the OLD circuit asserted: the slot holds the null leaf.
  const oldStyle = C.merkleRoot(new Uint8Array(32), sibs, dirs);
  ok('the old check would have refused the victim',
     hex(oldStyle) !== hex(squattedRoot),
     'if these matched there would be no finding to fix');
  note('the old circuit folded the NULL leaf and compared to the root, so the');
  note('victim read as encumbered by an obligation they never incurred');

  // What the NEW circuit asserts: the slot holds nothing binding the victim.
  ok('the new check folds the real occupant to the real root',
     hex(C.merkleRoot(C.obligationLeaf(occupant.record, occupant.obligation, occupant.beneficiary), sibs, dirs)) === hex(squattedRoot),
     'the occupant witnesses do not reproduce the leaf actually in the slot');

  // And the victim's own obligation is still refused: occRecord != ancestor.
  const ownLeaf = C.obligationLeaf(victim, obligation, beneficiary);
  ok('a leaf naming the victim is a different leaf',
     hex(ownLeaf) !== hex(leaf),
     'the leaf binds the record it encumbers; if it did not, the exemption above\n' +
     '     would let anyone prove clean through their own obligation');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. depth 8: the whole attack, on chain
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== 2. depth 8: grind a collision and run the attack for real ==');
{
  const C = S.pureCircuits;
  const { ObligationTree, DEPTH } = obligationTreeFor(C);
  const mk = partyFor(S);

  const victimSecret = sec('victim-shallow');
  const victim = C.commit(victimSecret);
  const victimSlot = C.slotBits(victim).map(Number).join('');

  // THE GRIND. Search for a secret whose commitment lands in the victim's slot.
  const t0 = Date.now();
  let squatterSecret = null, squatter = null, tried = 0;
  for (let i = 0; i < 200000; i++) {
    tried++;
    const s = sec(`squat-${i}`);
    const c = C.commit(s);
    if (C.slotBits(c).map(Number).join('') === victimSlot) { squatterSecret = s; squatter = c; break; }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok('a colliding commitment was found by grinding', squatter !== null,
     'no collision in 200,000 attempts — raise the budget or lower the depth');
  note(`depth ${DEPTH}, ${2 ** DEPTH} slots: ${tried} hashes in ${secs}s`);
  note(`victim slot   ${victimSlot}`);
  note(`squatter slot ${C.slotBits(squatter).map(Number).join('')}`);
  note('at depth 24 the same search is about 27.4 million hashes, 81s on one core;');
  note('at depth 32, about 4.3 billion. Depth prices the grind, it does not stop it.');

  const benSecret = sec('squatter-beneficiary');
  const beneficiary = C.commit(benSecret);
  const obligation = sec('squatters-own-royalty');

  const tree = new ObligationTree();
  let ctx = freshCtx(S, mk);
  const state = () => S.ledger(ctx.currentQueryContext.state);
  const call = (contract, circuit, ...args) => {
    const r = contract.impureCircuits[circuit](ctx, ...args);
    ctx = r.context;
    return r;
  };
  const refused = (contract, circuit, ...args) => {
    try { call(contract, circuit, ...args); return ''; }
    catch (e) { return String(e?.message ?? e); }
  };
  const NO_OCC = { isEmpty: true, record: new Uint8Array(32), obligation: new Uint8Array(32), beneficiary: new Uint8Array(32) };

  // The squatter encumbers THEIR OWN record. Nothing about this call is illegitimate.
  const p = tree.encumber(squatter, obligation, beneficiary);
  const err = refused(mk(squatterSecret, benSecret, p.siblings, p.dirs, squatter, NO_OCC),
                      'encumber', squatter, obligation);
  ok('the squatter encumbers their own record', err === '', err);
  note(`root now ${hex(state().encumberedRoot).slice(0, 20)}…`);
  ok('the chain root matches the tree', hex(state().encumberedRoot) === hex(tree.root()));

  // THE VICTIM. Their own slot now holds a leaf, and it is not theirs.
  const occupant = tree.occupantOf(victim);
  ok('the victim\'s slot is occupied by the squatter',
     !occupant.isEmpty && hex(occupant.record) === hex(squatter));

  const vp = tree.cleanPath(victim);
  const proveErr = refused(mk(sec('a-buyer'), sec('a-buyer'), vp.siblings, vp.dirs, victim, vp.occupant),
                           'proveAncestorClean');
  note(proveErr ? `clean proof refused: ${proveErr}` : 'clean proof accepted');
  ok('THE VICTIM STILL PROVES CLEAN', proveErr === '',
     'a squatter\'s leaf in the victim\'s slot made the victim read as carrying an\n' +
     '     obligation they never incurred, and blocked a sale that should have gone\n' +
     '     through. Two honest records colliding produced the same false encumbrance.');
  ok('the proof records which root it used',
     hex(state().lastProofRoot) === hex(tree.root()));

  // The exemption must not become a way out of your OWN obligation.
  const realTree = new ObligationTree();
  let ctx2 = freshCtx(S, mk);
  const saved = ctx; ctx = ctx2;
  const q = realTree.encumber(victim, obligation, beneficiary);
  refused(mk(sec('anyone'), benSecret, q.siblings, q.dirs, victim, NO_OCC), 'encumber', victim, obligation);
  const own = realTree.occupantOf(victim);
  // Claim the occupant is somebody else while it is in fact the victim's own leaf.
  const lie = { isEmpty: false, record: squatter, obligation, beneficiary };
  const lieErr = refused(mk(sec('a-buyer'), sec('a-buyer'), realTree.siblingsFor(C.slotBits(victim)), C.slotBits(victim), victim, lie),
                         'proveAncestorClean');
  ok('claiming somebody else\'s leaf when it is your own is refused', lieErr !== '',
     'the exemption would otherwise clear every encumbered record: name a stranger\n' +
     '     as the occupant and the obligation disappears');
  const honestErr = refused(mk(sec('a-buyer'), sec('a-buyer'), realTree.siblingsFor(C.slotBits(victim)), C.slotBits(victim), victim, own),
                            'proveAncestorClean');
  ok('and the victim\'s real obligation still blocks them', honestErr !== '', honestErr);
  ctx = saved;

  // ── the half that is NOT fixed ────────────────────────────────────────────
  console.log('\n== 3. what squatting still costs the victim ==');
  const realObligation = sec('a-genuine-royalty');
  let encErr = '';
  try {
    const r = tree.encumber(victim, realObligation, beneficiary);
    encErr = refused(mk(sec('a-creditor'), benSecret, r.siblings, r.dirs, victim, NO_OCC),
                     'encumber', victim, realObligation);
  } catch (e) { encErr = String(e?.message ?? e); }
  note(encErr ? `encumbering the victim refused: ${encErr}` : 'the victim was encumbered');
  pin('a squatted record still cannot be encumbered for a real obligation',
      encErr !== '',
      'encumber asserts the slot is clean and one slot holds one leaf, so a genuine\n' +
      '     beneficiary cannot attach a claim to a record a squatter is sitting on.\n' +
      '     Closing it needs a bucket leaf (a hash over the slot\'s obligations) or a\n' +
      '     tree indexed by the full commitment — a redesign of the tree, not a check.\n' +
      '     Cost to the attacker: one grind plus one transaction, per record.');
}

console.log(`\n${bad === 0
  ? `finding 7: the false encumbrance is closed; ${pinned} pinned finding(s) above`
  : `${bad} check(s) failing`}`);
process.exit(bad === 0 ? 0 : 1);
