/**
 * Pre-deployment checks for lineage.compact.
 *
 * Four claims the contract or its comments make, each tested rather than
 * reasoned about. A FAIL means the claim does not hold; a pass means the
 * concern was mine and the contract is fine.
 *
 *   node contract/lineage-checks.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = path.join(here, 'src/managed/lineage/contract/index.js');
const mod = await import(pathToFileURL(artifact).href);
const { Contract, ledger, pureCircuits } = mod;
const { ObligationTree } = await import(pathToFileURL(path.join(here, 'src/tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`OK   ${name}`);
  else { console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); failures++; }
};
const note = (s) => console.log(`     ${s}`);
const rejects = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message ?? e); } };

const b32 = (fill) => new Uint8Array(32).fill(fill);
const hex = (b) => Buffer.from(b).toString('hex');
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const COIN = '0'.repeat(64);
const src = (await import('node:fs')).readFileSync(path.join(here, 'src/lineage.compact'), 'utf8');

// Depth from the compiled artifact, not from a regex over a comment in the source.
// The regex read the header line, so a file whose header and unrolled fold had
// drifted apart would have been measured against the comment.
const DEPTH = pureCircuits.slotBits(new Uint8Array(32)).length;

/**
 * A caller. Every witness the contract declares has to be supplied or the Contract
 * constructor throws before any circuit runs — which is how this file stopped
 * executing at all when `beneficiarySecret` was added.
 */
const EMPTY_SLOT = { isEmpty: true, record: b32(0), obligation: b32(0), beneficiary: b32(0) };
const party = ({ own = b32(0x11), beneficiary = own, siblings = [], dirs = [],
                 occupant = EMPTY_SLOT,
                 chain = [b32(0), b32(0), b32(0), b32(0)] } = {}) =>
  new Contract({
    localGeneticSecret: (ctx) => [ctx.privateState, own],
    beneficiarySecret: (ctx) => [ctx.privateState, beneficiary],
    // What is sitting in the ancestor's slot. A clean proof no longer requires an
    // EMPTY slot, only one holding nothing that binds the ancestor, so the circuit
    // has to be told what the occupant is in order to rebuild its leaf.
    slotIsEmpty: (ctx) => [ctx.privateState, occupant.isEmpty],
    slotOccupantRecord: (ctx) => [ctx.privateState, occupant.record],
    slotOccupantObligation: (ctx) => [ctx.privateState, occupant.obligation],
    slotOccupantBeneficiary: (ctx) => [ctx.privateState, occupant.beneficiary],
    merkleSiblings: (ctx) => [ctx.privateState, siblings],
    merkleDirections: (ctx) => [ctx.privateState, dirs],
    ancestryChain: (ctx) => [ctx.privateState, chain],
  });

const freshCtx = () => {
  const c = party();
  return rt.createCircuitContext(
    rt.sampleContractAddress(), COIN,
    c.initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
  );
};

// ────────────────────────────────────────────────────────────── 1. slot space
//
// slotBits takes the high bit of each of the first DEPTH bytes, so the tree is
// 2^DEPTH slots however deep it looks. Two records in one slot is not a curiosity:
// `encumber` asserts the slot is clean, so the second record can never carry an
// obligation.
console.log('\n== 1. how many records before two share a slot? ==');
{
  note(`compiled depth: ${DEPTH}, ${2 ** DEPTH} slots`);

  const slotOf = (c) => {
    let bits = 0n;
    for (let i = 0; i < DEPTH; i++) bits = (bits << 1n) | BigInt(c[i] > 127 ? 1 : 0);
    return bits;
  };

  const LIMIT = 6000;
  const seen = new Map();
  let first = null;
  for (let i = 0; i < LIMIT && first === null; i++) {
    const secret = createHash('sha256').update(`record-${i}`).digest();
    const c = pureCircuits.commit(secret);
    const slot = slotOf(c);
    if (seen.has(slot)) first = { at: i + 1, slot, a: seen.get(slot), b: i };
    else seen.set(slot, i);
  }

  if (first === null) {
    note(`no collision in ${LIMIT} records`);
  } else {
    note(`records ${first.a} and ${first.b} both land in slot ${first.slot}`);
    note(`first collision after ${first.at} records`);
    note('the second of the two can never be encumbered: the slot is not clean');
  }
  ok('the tree holds more than a season of lots before colliding',
     first === null || first.at > 1000,
     first ? `collision at ${first.at} records` : '');
}

// ─────────────────────────────────────────── 2. what proveAncestorClean proves
//
// The file header says a verifier cross-checks the caller's ancestry claim against
// declared descent edges. That requires knowing which commitment was proven clean.
console.log('\n== 2. does proveAncestorClean name the ancestor it clears? ==');
{
  // This asked its question of the SOURCE — it grepped for the string
  // `lastClearedAncestor = ancestor` and called that an answer. A line of source is
  // not a public value: the circuit could disclose nothing, or write the wrong
  // cell, and the grep would still pass. So it runs the circuit and reads the
  // ledger the chain would actually hold.
  const t = new ObligationTree();
  const ancestor = pureCircuits.commit(createHash('sha256').update('the-ancestor').digest());
  const p = t.cleanPath(ancestor);

  const caller = party({ own: b32(0x11), siblings: p.siblings, dirs: p.dirs,
                         occupant: p.occupant,
                         chain: [ancestor, ancestor, ancestor, ancestor] });
  let ctx = freshCtx();
  const err = rejects(() => { ctx = caller.impureCircuits.proveAncestorClean(ctx).context; });

  if (err) note(`refused: ${err}`);
  ok('a clean ancestor can be proven clean at all', err === '', err);

  const st = ledger(ctx.currentQueryContext.state);
  note(`ancestor supplied in the witness: ${hex(ancestor).slice(0, 24)}…`);
  note(`lastClearedAncestor on chain:    ${hex(st.lastClearedAncestor).slice(0, 24)}…`);
  note(`lastCleanProofBy on chain:       ${hex(st.lastCleanProofBy).slice(0, 24)}…`);

  ok('the cleared ancestor reaches a public position',
     err === '' && same(st.lastClearedAncestor, ancestor),
     'nothing in the transaction says WHICH ancestor was proven clean');
  ok('the proof names the party who made it',
     err === '' && same(st.lastCleanProofBy, pureCircuits.commit(b32(0x11))),
     'the circuit computed the caller\'s commitment and discarded it, so the proof\n' +
     '     restated public root state and named nobody');
}

// ──────────────────────────────────────── 3. the unused ancestry witnesses
console.log('\n== 3. are the ancestry witnesses used? ==');
{
  // Count declarations, not mentions: a comment explaining why a witness was
  // removed is not a witness, and an earlier version of this check failed on
  // exactly that.
  const declared = (name) => new RegExp(`^witness ${name}\\(`, 'm').test(src);
  const uses = (name) => (src.match(new RegExp(name, 'g')) || []).length;
  for (const w of ['ancestryChain', 'ancestrySiblings', 'ancestryDirections']) {
    note(`${w}: declared ${declared(w)}, ${uses(w)} mention(s) in the file`);
  }
  ok('every declared witness is read',
     !declared('ancestrySiblings') && !declared('ancestryDirections') && declared('ancestryChain'),
     'a witness is declared and never read, so the interface describes behaviour the\n' +
     '     circuit does not have');
}

// ──────────────────────────────────────────── 4. lastDescent holds two things
console.log('\n== 4. does lastDescent hold one kind of value? ==');
{
  // Also grepped the source. The question is what a reader of the CELL sees, so
  // both writers run and the cell is read afterwards: an edge hash and a bare
  // commitment are indistinguishable as bytes, and only running both shows whether
  // one cell is being asked to carry both.
  const childSecret = createHash('sha256').update('child').digest();
  const child = pureCircuits.commit(childSecret);
  const parent = pureCircuits.commit(createHash('sha256').update('parent').digest());

  let ctx = freshCtx();
  ctx = party({ own: childSecret }).impureCircuits.declareParent(ctx, child, parent).context;
  const afterEdge = ledger(ctx.currentQueryContext.state);
  note(`after declareParent, lastDescent = ${hex(afterEdge.lastDescent).slice(0, 24)}…`);
  ok('lastDescent holds the edge hash',
     same(afterEdge.lastDescent, pureCircuits.descentEdge(child, parent)));

  const t = new ObligationTree();
  const ancestor = pureCircuits.commit(createHash('sha256').update('anc4').digest());
  const p = t.cleanPath(ancestor);
  ctx = party({ own: childSecret, siblings: p.siblings, dirs: p.dirs,
                occupant: p.occupant,
                chain: [ancestor, ancestor, ancestor, ancestor] })
        .impureCircuits.proveAncestorClean(ctx).context;
  const afterProof = ledger(ctx.currentQueryContext.state);
  note(`after proveAncestorClean, lastDescent = ${hex(afterProof.lastDescent).slice(0, 24)}…`);

  ok('one field, one meaning', same(afterProof.lastDescent, afterEdge.lastDescent),
     'a clean proof overwrote lastDescent with a bare commitment, so a reader of the\n' +
     '     cell could not tell whether it held descentEdge(child,parent) or a record\n' +
     '     commitment, and the two are indistinguishable as bytes.');
}

console.log(`\n${failures === 0 ? 'no findings' : `${failures} finding(s) above`}`);
process.exit(0);
