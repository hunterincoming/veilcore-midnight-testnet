/**
 * Finding 4, demonstrated.
 *
 * L2 and L6 run against the compiled artifact. L4 is stated rather than fixed and
 * the last section shows why no circuit can close it.
 *
 * L3 has two halves and they are closed in different places:
 *   · silence — a child declaring nothing, or stopping short — is closed off
 *     chain by verifyDescent walking the declared graph. descent-checks.mjs
 *     cases 2 and 4, and test-descent.mjs, run it.
 *   · substitution — a child declaring a parent that never agreed — is closed on
 *     chain, below. declareParent took the parent on the child holder's word;
 *     proposeParent/confirmParent is the licence transfer flow's shape, so the
 *     record being named has to prove its own secret before the edge exists.
 *
 *   node contract/verify-max-4.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);
const tree = await import(pathToFileURL(path.join(here, 'src/tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();

const C = L.pureCircuits;
const HOLDER = sec('holder');
const BENEFICIARY = sec('beneficiary');
const STRANGER = sec('stranger');

const RECORD = C.commit(HOLDER);
const OBLIGATION = sec('royalty-5pc');
const BENEFICIARY_C = C.commit(BENEFICIARY);

// A party: whose secret it holds, and whose beneficiary secret it can prove.
const EMPTY_SLOT = { isEmpty: true, record: new Uint8Array(32), obligation: new Uint8Array(32), beneficiary: new Uint8Array(32) };
const party = (own, ben = own, chain = [RECORD, RECORD, RECORD, RECORD], occupant = EMPTY_SLOT) => (sibs, dirs) =>
  new L.Contract({
    localGeneticSecret: (c) => [c.privateState, own],
    beneficiarySecret: (c) => [c.privateState, ben],
    slotIsEmpty: (c) => [c.privateState, occupant.isEmpty],
    slotOccupantRecord: (c) => [c.privateState, occupant.record],
    slotOccupantObligation: (c) => [c.privateState, occupant.obligation],
    slotOccupantBeneficiary: (c) => [c.privateState, occupant.beneficiary],
    merkleSiblings: (c) => [c.privateState, sibs],
    merkleDirections: (c) => [c.privateState, dirs],
    ancestryChain: (c) => [c.privateState, chain],
  });

const emptyCtx = () => {
  const c = party(HOLDER)([], []);
  return rt.createCircuitContext(
    rt.sampleContractAddress(), COIN,
    c.initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
  );
};

// The off-chain tree, kept in step with the contract.
const t = new tree.ObligationTree();
let ctx = emptyCtx();

const call = (mk, circuit, sibs, dirs, ...args) => {
  const r = mk(sibs, dirs).impureCircuits[circuit](ctx, ...args);
  ctx = r.context;
  return r;
};
const refused = (mk, circuit, sibs, dirs, ...args) => {
  try { call(mk, circuit, sibs, dirs, ...args); return ''; }
  catch (e) { return String(e?.message ?? e); }
};
const state = () => L.ledger(ctx.currentQueryContext.state);

// ── L2: can the encumbered party release themselves? ────────────────────────
console.log('\n== L2. can a holder discharge their own obligation? ==');
{
  // The BENEFICIARY encumbers. Compute the leaf the way the contract will.
  const leaf = C.obligationLeaf(RECORD, OBLIGATION, BENEFICIARY_C);
  const dirs = C.slotBits(RECORD);
  const sibs = t.siblingsFor(dirs);

  const err = refused(party(STRANGER, BENEFICIARY), 'encumber', sibs, dirs, RECORD, OBLIGATION);
  note(err ? `encumber refused: ${err}` : 'encumbered');
  ok('a beneficiary can encumber a record they do not hold', err === '',
     'encumber required the ENCUMBERED party\'s secret, so only the person who owed\n' +
     '     could record that they owed it');

  if (!err) {
    t.leaves.set(tree.ObligationTree.key(dirs), leaf);
    note(`lastBeneficiary: ${hex(state().lastBeneficiary).slice(0, 24)}…`);
    ok('the beneficiary is on chain', hex(state().lastBeneficiary) === hex(BENEFICIARY_C));

    // The holder tries to release themselves.
    const sibs2 = t.siblingsFor(dirs);
    const selfErr = refused(party(HOLDER, HOLDER), 'discharge', sibs2, dirs, RECORD, OBLIGATION);
    note(selfErr ? `self-discharge refused: ${selfErr}` : 'the holder discharged their own obligation');
    ok('the encumbered holder cannot discharge', selfErr !== '',
       'the holder encumbered with a royalty removed it alone and proved clean in the\n' +
       '     next call — an obligation only the obligated can remove is not an obligation');

    // The beneficiary can.
    const benErr = refused(party(STRANGER, BENEFICIARY), 'discharge', sibs2, dirs, RECORD, OBLIGATION);
    note(benErr ? `beneficiary discharge refused: ${benErr}` : 'the beneficiary released it');
    ok('the beneficiary can discharge', benErr === '', benErr);
  }
}

// ── L6: does a clean proof name anybody? ────────────────────────────────────
console.log('\n== L6. does a clean proof name who made it? ==');
{
  ctx = emptyCtx();
  const t2 = new tree.ObligationTree();
  const ancestor = C.commit(sec('ancestor'));
  const dirs = C.slotBits(ancestor);
  const sibs = t2.siblingsFor(dirs);

  const mk = (s, d) => new L.Contract({
    localGeneticSecret: (c) => [c.privateState, HOLDER],
    beneficiarySecret: (c) => [c.privateState, HOLDER],
    slotIsEmpty: (c) => [c.privateState, true],
    slotOccupantRecord: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantObligation: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantBeneficiary: (c) => [c.privateState, new Uint8Array(32)],
    merkleSiblings: (c) => [c.privateState, s],
    merkleDirections: (c) => [c.privateState, d],
    ancestryChain: (c) => [c.privateState, [ancestor, ancestor, ancestor, ancestor]],
  });

  const err = refused(mk, 'proveAncestorClean', sibs, dirs);
  note(err ? `refused: ${err}` : 'proved');
  ok('a clean proof succeeds for a clean ancestor', err === '', err);

  if (!err) {
    note(`lastCleanProofBy: ${hex(state().lastCleanProofBy).slice(0, 24)}…`);
    note(`caller's record : ${hex(RECORD).slice(0, 24)}…`);
    ok('the proof names the party who made it',
       hex(state().lastCleanProofBy) === hex(RECORD),
       'the circuit computed the caller\'s commitment and discarded it, so the proof\n' +
       '     restated public root state and named nobody — anyone could make it about anyone');
  }

  // A record cannot clear itself.
  const selfMk = (s, d) => new L.Contract({
    localGeneticSecret: (c) => [c.privateState, HOLDER],
    beneficiarySecret: (c) => [c.privateState, HOLDER],
    slotIsEmpty: (c) => [c.privateState, true],
    slotOccupantRecord: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantObligation: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantBeneficiary: (c) => [c.privateState, new Uint8Array(32)],
    merkleSiblings: (c) => [c.privateState, s],
    merkleDirections: (c) => [c.privateState, d],
    ancestryChain: (c) => [c.privateState, [RECORD, RECORD, RECORD, RECORD]],
  });
  const selfDirs = C.slotBits(RECORD);
  const selfErr = refused(selfMk, 'proveAncestorClean', t2.siblingsFor(selfDirs), selfDirs);
  ok('a record is not its own ancestor', selfErr !== '', 'a record cleared itself');
}

// ── L3: can a child name a parent that never agreed? ────────────────────────
console.log('\n== L3. does an edge take the parent\'s agreement? ==');
{
  ctx = emptyCtx();
  const sellerSecret = sec('seller');
  const strangerSecret = sec('a-clean-stranger');
  const seller = C.commit(sellerSecret);
  const stranger = C.commit(strangerSecret);
  const realMother = C.commit(sec('the-encumbered-mother'));

  const edges = (who, circuit, ...args) =>
    refused(party(who, who), circuit, [], [], ...args);

  // The seller's real mother is encumbered, so they name a clean stranger instead.
  const proposed = edges(sellerSecret, 'proposeParent', seller, stranger);
  note(proposed ? `proposal refused: ${proposed}` : 'the seller proposed the stranger as their parent');
  ok('anyone may still PROPOSE any parent', proposed === '',
     'proposing is an offer, not a claim — refusing it here would only move the\n' +
     '     problem to whoever decides which offers are allowed');

  note(`pendingParentOf holds the offer: ${state().pendingParentOf.member(seller)}`);
  ok('an unconfirmed proposal is not an edge',
     Number(state().descentSeq) === 0 &&
     hex(state().lastDescentChild) === hex(new Uint8Array(32)),
     'a proposal that counted as an edge would be declareParent with extra steps');

  // The seller confirms it themselves. This is the whole attack.
  const selfConfirm = edges(sellerSecret, 'confirmParent', seller, stranger);
  note(selfConfirm ? `self-confirmation refused: ${selfConfirm}` : 'the seller confirmed their own parentage');
  ok('THE SELLER CANNOT CONFIRM AN EDGE TO SOMEBODY ELSE', selfConfirm !== '',
     'declareParent asserted the CHILD\'s preimage and took the parent on their word,\n' +
     '     so a seller whose mother was encumbered declared descent from any clean\n' +
     '     record they liked and the edge was indistinguishable from a real one');

  // Nor can a third party who holds neither.
  const byStrangerElse = edges(sec('unrelated'), 'confirmParent', seller, stranger);
  ok('nor can a bystander confirm it', byStrangerElse !== '');

  // The named record itself can — that is what consent means.
  const consented = edges(strangerSecret, 'confirmParent', seller, stranger);
  note(consented ? `refused: ${consented}` : 'the named parent agreed, and the edge exists');
  ok('the named parent can confirm, and only then is there an edge', consented === '',
     consented);
  ok('the edge is on chain once both parties have acted',
     hex(state().lastDescentChild) === hex(seller) &&
     hex(state().lastDescentParent) === hex(stranger) &&
     Number(state().descentSeq) === 1);

  // And a child cannot swap the parent out from under a confirmation.
  ctx = emptyCtx();
  const childSecret = sec('swapper');
  const child = C.commit(childSecret);
  const agreed = C.commit(sec('parent-who-agreed'));
  const other = C.commit(sec('parent-who-did-not'));
  refused(party(childSecret, childSecret), 'proposeParent', [], [], child, agreed);
  refused(party(childSecret, childSecret), 'withdrawParent', [], [], child);
  refused(party(childSecret, childSecret), 'proposeParent', [], [], child, other);
  const stale = edges(sec('parent-who-agreed'), 'confirmParent', child, agreed);
  ok('a confirmation lands on the parent that is actually proposed', stale !== '',
     'the parent agreed to one thing and the child re-proposed another underneath\n' +
     '     them — the same swap approveTransfer takes expectedNewLicense to stop');

  note('');
  note('WHAT THIS COSTS: a record whose parent has no holder — a landrace, a');
  note('collection accession, a breeder who has gone — can never have that edge');
  note('confirmed. Descent through such a record is not expressible, which is why a');
  note('registry requires a confirmed path to an origin IT recognises rather than');
  note('reading a sparse graph as a clean one.');
}

// ── L4: what cannot be fixed here ───────────────────────────────────────────
console.log('\n== L4. a fresh secret is a clean slot, and no circuit stops that ==');
{
  const laundered = C.commit(sec('material-with-a-past'));
  const genuine = C.commit(sec('genuinely-new-accession'));
  note(`laundered: ${hex(laundered).slice(0, 24)}…`);
  note(`genuine  : ${hex(genuine).slice(0, 24)}…`);
  ok('the contract cannot tell them apart', true,
     'both are commitments nobody has seen before. So the absence of a declared dirty\n' +
     '     ancestor is not evidence of a clean line, and a verifier has to require a\n' +
     '     confirmed path to an origin they already recognise. Stated in the contract\n' +
     '     header rather than papered over.');
}

console.log(`\n${bad === 0
  ? 'L2, L3 and L6 closed; L4 stated and unclosable'
  : `${bad} check(s) failing`}`);
process.exit(bad === 0 ? 0 : 1);
