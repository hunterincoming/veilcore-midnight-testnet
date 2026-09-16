/**
 * Finding 8, demonstrated fixed.
 *
 * "Any unrelated update between proving and inclusion invalidates every in-flight
 * proof, and a party toggling its own obligation each block starves everyone else."
 *
 * A proof is built against the root the prover saw, then included some blocks
 * later. Against a single global root, anything landing in between killed it. The
 * scenario below is exactly that: a reader collects one clean proof per generation
 * while a griefer attaches and releases an obligation on their own record, and the
 * reader's proofs have to survive.
 *
 *   node contract/verify-max-8.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);
const { ObligationTree, EMPTY_ROOT } =
  await import(pathToFileURL(path.join(here, 'src/tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
let pinned = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
// A consequence that is understood, bounded and deliberately accepted. Reported
// every run so it stays visible, and kept separate from a regression.
const pin = (n, stillHolds, d) => {
  if (stillHolds) { console.log(`PIN  ${n}`); if (d) console.log(`     ${d}`); pinned++; }
  else console.log(`NOTE ${n} — this no longer holds; the pin can be removed`);
};
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const sec = (s) => createHash('sha256').update(s).digest();
const C = L.pureCircuits;
const COIN = '0'.repeat(64);
const NO_OCC = { isEmpty: true, record: new Uint8Array(32), obligation: new Uint8Array(32), beneficiary: new Uint8Array(32) };

const mk = (own, ben, sibs, dirs, chain, occupant = NO_OCC) =>
  new L.Contract({
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

let ctx = rt.createCircuitContext(
  rt.sampleContractAddress(), COIN,
  mk(sec('x'), sec('x'), [], [], new Uint8Array(32))
    .initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
);
const state = () => L.ledger(ctx.currentQueryContext.state);
const call = (contract, circuit, ...args) => {
  const r = contract.impureCircuits[circuit](ctx, ...args);
  ctx = r.context;
  return r;
};
const refused = (contract, circuit, ...args) => {
  try { call(contract, circuit, ...args); return ''; }
  catch (e) { return String(e?.message ?? e); }
};

const tree = new ObligationTree();
const GRIEFER = sec('griefer');
const GRIEF_REC = C.commit(GRIEFER);
const GRIEF_BEN = sec('griefer-beneficiary');
const GRIEF_BENC = C.commit(GRIEF_BEN);
const GRIEF_OBL = sec('griefer-own-obligation');

// A griefer attaching and releasing an obligation on their OWN record — the
// review's exact scenario. Every call is legitimate; the point is that each one
// moves the global root.
let toggled = false;
const toggle = () => {
  const p = toggled ? tree.discharge(GRIEF_REC, GRIEF_OBL, GRIEF_BENC)
                    : tree.encumber(GRIEF_REC, GRIEF_OBL, GRIEF_BENC);
  const err = refused(mk(GRIEFER, GRIEF_BEN, p.siblings, p.dirs, GRIEF_REC),
                      toggled ? 'discharge' : 'encumber', GRIEF_REC, GRIEF_OBL);
  if (err) throw new Error(`toggle failed: ${err}`);
  toggled = !toggled;
};

/**
 * An update that produces a root the contract has never held before.
 *
 * The toggle above alternates between two tree states and therefore between two
 * roots, so a proof against either keeps finding its root back in the ring however
 * long it waits. That flatters the fix: measuring how far the ring actually reaches
 * needs each update to be genuinely new, which encumbering a fresh record is.
 */
let churnCount = 0;
const churn = () => {
  const n = churnCount++;
  const rec = C.commit(sec(`churn-holder-${n}`));
  const benS = sec(`churn-ben-${n}`);
  const p = tree.encumber(rec, sec(`churn-obl-${n}`), C.commit(benS));
  const err = refused(mk(sec(`churn-holder-${n}`), benS, p.siblings, p.dirs, rec),
                      'encumber', rec, sec(`churn-obl-${n}`));
  if (err) throw new Error(`churn failed: ${err}`);
};

// ── the ring exists and starts sane ─────────────────────────────────────────
console.log('\n== 1. does the contract deploy with a usable ring? ==');
{
  const s = state();
  const ring = [s.encumberedRoot, s.recentRoot1, s.recentRoot2, s.recentRoot3,
                s.recentRoot4, s.recentRoot5, s.recentRoot6, s.recentRoot7];
  note(`ring size ${ring.length}, all at the empty root: ${ring.every((r) => hex(r) === hex(EMPTY_ROOT))}`);
  ok('every ring slot starts at the empty tree root',
     ring.every((r) => hex(r) === hex(EMPTY_ROOT)),
     'a ring slot left at the default Bytes<32> would accept a proof folded against\n' +
     '     an unset cell — finding 1 again, one cell along');
}

// ── the attack ──────────────────────────────────────────────────────────────
console.log('\n== 2. a proof built before an unrelated update ==');
{
  const ancestor = C.commit(sec('the-ancestor'));
  const reader = sec('a-buyer');

  // The reader builds a proof against the root they can see NOW.
  const p = tree.cleanPath(ancestor);
  const builtAgainst = tree.root();
  note(`proof built against ${hex(builtAgainst).slice(0, 20)}…`);

  // An unrelated party moves the root before it is included.
  toggle();
  note(`root moved to       ${hex(state().encumberedRoot).slice(0, 20)}…`);
  ok('the root did move', hex(state().encumberedRoot) !== hex(builtAgainst));

  const err = refused(mk(reader, reader, p.siblings, p.dirs, ancestor, p.occupant),
                      'proveAncestorClean');
  note(err ? `refused: ${err}` : 'accepted');
  ok('THE PROOF STILL LANDS', err === '',
     'every proof in flight died whenever anyone else touched the tree, and a party\n' +
     '     toggling an obligation on their own record each block starved everyone\n' +
     '     else for the price of one transaction a block');
  note(`lastProofRoot ${hex(state().lastProofRoot).slice(0, 20)}… (the root it used)`);
  ok('the transcript says which root the proof used',
     hex(state().lastProofRoot) === hex(builtAgainst),
     'a verifier cannot otherwise tell how stale the tree behind a proof was');
}

// ── the reader collects one proof per generation while being griefed ────────
console.log('\n== 3. one proof per generation, under a griefer ==');
{
  const generations = ['g0', 'g1', 'g2', 'g3'].map((n) => C.commit(sec(`gen-${n}`)));
  const reader = sec('a-buyer');

  // All four proofs are built against the root visible now — that is what "in
  // flight" means: they were prepared together and are included one at a time.
  const built = generations.map((g) => ({ g, p: tree.cleanPath(g) }));
  const builtAgainst = tree.root();
  note(`4 proofs prepared against ${hex(builtAgainst).slice(0, 20)}…`);

  let landed = 0, lost = 0;
  for (const { g, p } of built) {
    toggle();   // the griefer moves the root before every inclusion
    const err = refused(mk(reader, reader, p.siblings, p.dirs, g, p.occupant), 'proveAncestorClean');
    if (err) { lost++; note(`generation proof refused: ${err}`); } else landed++;
  }
  note(`${landed} landed, ${lost} lost, with the root moved before each one`);
  ok('every generation proof survives an unrelated update', lost === 0,
     'a verifier collecting one proof per generation could never finish while anyone\n' +
     '     else was using the contract');
}

// ── the bound the ring buys, stated rather than assumed ─────────────────────
console.log('\n== 4. how stale a proof may be ==');
{
  const ancestor = C.commit(sec('stale-subject'));
  const reader = sec('a-buyer');
  const p = tree.cleanPath(ancestor);
  const builtAgainst = tree.root();

  // Push the root exactly as far as the ring reaches. Each update shifts the
  // proof's root one slot along, so after 7 it is sitting in recentRoot7 and after
  // 8 it has fallen off the end.
  for (let i = 0; i < 7; i++) churn();
  const atEdge = refused(mk(reader, reader, p.siblings, p.dirs, ancestor, p.occupant), 'proveAncestorClean');
  note(atEdge ? `after 7 updates: ${atEdge}` : 'after 7 updates: still accepted');
  ok('a proof survives 7 intervening updates', atEdge === '',
     'the ring is 8 deep, so the 7 roots before the current one are still accepted');

  // One more and it falls off the end. That is the deliberate limit, not a bug:
  // an unbounded ring would let a proof cite a root from any point in history and
  // an obligation attached since would never block anything.
  const p2 = tree.cleanPath(ancestor);
  for (let i = 0; i < 8; i++) churn();
  const offEnd = refused(mk(reader, reader, p2.siblings, p2.dirs, ancestor, p2.occupant), 'proveAncestorClean');
  note(offEnd ? `after 8 updates: ${offEnd}` : 'after 8 updates: still accepted');
  ok('a proof older than the ring is refused', offEnd !== '',
     'an unbounded ring would accept a proof against any root the contract ever had,\n' +
     '     so an obligation attached at any point since would never block a sale');
  void builtAgainst;

  note('so the window is a choice: 7 updates of staleness bought against a proof');
  note('that cannot be starved by ordinary traffic. lastProofRoot lets a verifier');
  note('demand the current root when that trade is the wrong way round for them.');
}

// ── what the ring does NOT do ───────────────────────────────────────────────
console.log('\n== 5. the grief the ring bounds rather than removes ==');
{
  const ancestor = C.commit(sec('determined-target'));
  const reader = sec('a-buyer');
  const p = tree.cleanPath(ancestor);

  // The review's griefer toggles one obligation, which alternates between two tree
  // states — so the reader's root keeps reappearing in the ring and that attack is
  // simply over. A griefer willing to produce EIGHT DISTINCT roots can still push a
  // proof off the end.
  for (let i = 0; i < 8; i++) churn();
  const err = refused(mk(reader, reader, p.siblings, p.dirs, ancestor, p.occupant), 'proveAncestorClean');
  note(err ? `after 8 distinct updates: ${err}` : 'after 8 distinct updates: still accepted');
  ok('8 distinct updates still invalidate an in-flight proof', err !== '',
     'if this passed the ring would be unbounded and a proof could cite any root'
     + ' the contract ever held');
  note('What changed: starvation was free and unbounded — one toggled obligation,');
  note('one transaction a block, and nobody could ever land a proof. It now costs 8');
  note('distinct encumbrances per proof denied, and the reader only has to rebuild');
  note('and resubmit. A deployment that wants a wider window widens the ring; that');
  note('is a constant in gen-lineage.mjs, and it trades against proof staleness.');
}

// ── the price of the window, demonstrated rather than described ─────────────
console.log('\n== 6. what accepting an old root costs a beneficiary ==');
{
  const seller = C.commit(sec('a-seller'));
  const creditorSecret = sec('a-creditor');
  const obligation = sec('unpaid-royalty');

  // The seller builds a clean proof while their slot really is clean.
  const before = tree.cleanPath(seller);
  note(`seller's clean path built against ${hex(tree.root()).slice(0, 20)}…`);

  // A beneficiary attaches a claim. This is the mechanism working exactly as it
  // should — the beneficiary needs nobody's permission, which is finding 4.
  const p = tree.encumber(seller, obligation, C.commit(creditorSecret));
  const encErr = refused(mk(sec('a-creditor-holder'), creditorSecret, p.siblings, p.dirs, seller),
                         'encumber', seller, obligation);
  ok('the beneficiary attaches the obligation', encErr === '', encErr);
  ok('the seller is genuinely encumbered now',
     hex(tree.occupantOf(seller).record) === hex(seller));

  // And the seller presents the proof they prepared a moment earlier.
  const err = refused(mk(sec('a-buyer'), sec('a-buyer'), before.siblings, before.dirs, seller, before.occupant),
                      'proveAncestorClean');
  note(err ? `refused: ${err}` : 'ACCEPTED against the pre-encumbrance root');
  pin('a proof built before an encumbrance still lands for up to 7 updates after it',
      err === '',
      'This is the ring, working as specified, seen from the other side. A reader\n' +
      '     cannot be starved; the price is that a freshly attached obligation is not\n' +
      '     binding on proofs citing a root from before it. A seller who watches for an\n' +
      '     encumbrance and submits a prepared proof defeats it until 8 further updates\n' +
      '     have pushed that root off the ring.');

  // The mitigation is not advice, it is a published value.
  const st = state();
  note(`lastProofRoot ${hex(st.lastProofRoot).slice(0, 20)}…`);
  note(`current root  ${hex(st.encumberedRoot).slice(0, 20)}…`);
  ok('the transcript exposes the staleness, so a verifier can refuse it',
     hex(st.lastProofRoot) !== hex(st.encumberedRoot),
     'if the proof did not say which root it used, a stale proof would be\n' +
     '     indistinguishable from a current one and the window would be unfalsifiable');
  note('So a verifier who is deciding money requires lastProofRoot == encumberedRoot');
  note('and accepts the starvation risk; one who is not can take the older root. The');
  note('contract publishes what is needed to make that choice rather than making it.');
}

console.log(`\n${bad === 0
  ? `finding 8 demonstrated fixed; ${pinned} pinned consequence(s) above`
  : `${bad} still failing`}`);
process.exit(bad === 0 ? 0 : 1);
