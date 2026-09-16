/**
 * Finding 4, demonstrated.
 *
 * L2 and L6 run against the compiled artifact. L4 is stated rather than fixed and
 * the last section shows why no circuit can close it.
 *
 * L3 IS NOT DEMONSTRATED HERE, and the header used to say it was. It has two
 * halves and they are in different places:
 *   · silence — a child declaring nothing, or stopping short — is closed off
 *     chain by verifyDescent walking the declared graph. descent-checks.mjs
 *     cases 2 and 4, and test-descent.mjs, run it.
 *   · substitution — a child declaring a parent that never agreed — is NOT
 *     closed. declareParent still takes the parent's commitment on the child
 *     holder's word alone; the review's direction is a propose/countersign pair
 *     shaped like the licence flow, and no circuit here does that yet.
 * Naming a case in a summary line is not running it.
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
  ? 'L2 and L6 closed; L4 stated; L3 substitution still open (see header)'
  : `${bad} check(s) failing`}`);
process.exit(bad === 0 ? 0 : 1);
