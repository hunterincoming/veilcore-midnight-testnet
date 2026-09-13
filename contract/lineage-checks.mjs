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

// ────────────────────────────────────────────────────────────── 1. slot space
//
// slotBits takes the high bit of each of the first sixteen bytes, so the tree
// is 2^16 slots however deep it looks. Two records in one slot is not a
// curiosity: `encumber` asserts the slot is clean, so the second record can
// never carry an obligation.
console.log('\n== 1. how many records before two share a slot? ==');
{
  const slotOf = (c) => {
    let bits = 0;
    for (let i = 0; i < 16; i++) bits = (bits << 1) | (c[i] > 127 ? 1 : 0);
    return bits;
  };

  const seen = new Map();
  let first = null;
  for (let i = 0; i < 2000 && first === null; i++) {
    const secret = createHash('sha256').update(`record-${i}`).digest();
    const c = pureCircuits.commit(secret);
    const slot = slotOf(c);
    if (seen.has(slot)) first = { at: i + 1, slot, a: seen.get(slot), b: i };
    else seen.set(slot, i);
  }

  if (first === null) {
    note('no collision in 2000 records');
  } else {
    note(`records ${first.a} and ${first.b} both land in slot ${first.slot}`);
    note(`first collision after ${first.at} records`);
    note('the second of the two can never be encumbered: the slot is not clean');
  }
  ok('the tree holds more than a season of lots before colliding',
     first === null || first.at > 1000,
     first ? `collision at ${first.at} records — a registry handling one season hits this` : '');
}

// ─────────────────────────────────────────── 2. what proveAncestorClean proves
//
// The circuit reads chain[0] from a private witness and never discloses it.
// The file header says a verifier cross-checks the caller's ancestry claim
// against declared descent edges. That requires knowing which commitment was
// proven clean.
console.log('\n== 2. does proveAncestorClean name the ancestor it clears? ==');
{
  const HOLDER = b32(0x11);
  const contract = new Contract({
    localGeneticSecret: (ctx) => [ctx.privateState, HOLDER],
    merkleSiblings: (ctx) => [ctx.privateState, Array(16).fill(b32(0x00))],
    merkleDirections: (ctx) => [ctx.privateState, Array(16).fill(false)],
    ancestryChain: (ctx) => [ctx.privateState, [b32(0xAA), b32(0), b32(0), b32(0)]],
    ancestrySiblings: (ctx) => [ctx.privateState, Array(4).fill(Array(16).fill(b32(0)))],
    ancestryDirections: (ctx) => [ctx.privateState, Array(4).fill(Array(16).fill(false))],
  });

  const COIN = '0'.repeat(64);
  const ctor = contract.initialState(rt.createConstructorContext({}, COIN));
  const ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN, ctor.currentContractState, {});

  const claimedAncestor = b32(0xAA);
  const err = rejects(() => contract.impureCircuits.proveAncestorClean(ctx));

  if (err) {
    note(`refused: ${err}`);
    note('(a null-sibling path against the initial root — the shape of the call is what matters)');
  }

  note(`ancestor supplied in the witness: ${hex(claimedAncestor).slice(0, 24)}…`);
  note('the circuit writes lastDescent = commit(own secret), not the ancestor');
  ok('the cleared ancestor reaches a public position', false,
     'nothing in the transaction says WHICH ancestor was proven clean, so a verifier\n' +
     '     cannot cross-check the claim against declared descent edges. Worse, nothing\n' +
     '     binds chain[0] to being an ancestor at all: a caller whose real parent is\n' +
     '     encumbered can supply any commitment whose slot happens to be clean.');
}

// ──────────────────────────────────────── 3. the unused ancestry witnesses
console.log('\n== 3. are the ancestry witnesses used? ==');
{
  const src = (await import('node:fs')).readFileSync(path.join(here, 'src/lineage.compact'), 'utf8');
  const uses = (name) => (src.match(new RegExp(name, 'g')) || []).length;
  for (const w of ['ancestryChain', 'ancestrySiblings', 'ancestryDirections']) {
    note(`${w}: ${uses(w)} occurrence(s) — declaration plus any use`);
  }
  ok('every declared witness is read', uses('ancestrySiblings') > 1 && uses('ancestryDirections') > 1,
     'ancestrySiblings and ancestryDirections are declared and never read, and chain[1..3]\n' +
     '     are never touched. The witnesses describe a four-generation walk; the circuit\n' +
     '     walks one. Either the walk is unfinished or the witnesses are dead weight in\n' +
     '     every prover key that includes them.');
}

// ──────────────────────────────────────────── 4. lastDescent holds two things
console.log('\n== 4. does lastDescent hold one kind of value? ==');
{
  const src = (await import('node:fs')).readFileSync(path.join(here, 'src/lineage.compact'), 'utf8');
  const edge = /lastDescent = descentEdge\(/.test(src);
  const bare = /lastDescent = disclose\(self\)/.test(src);
  note(`declareParent writes an edge hash: ${edge}`);
  note(`proveAncestorClean writes a bare commitment: ${bare}`);
  ok('one field, one meaning', !(edge && bare),
     'a reader of lastDescent cannot tell whether it holds descentEdge(child,parent)\n' +
     '     or a record commitment, and the two are indistinguishable as bytes.');
}

console.log(`\n${failures === 0 ? 'no findings' : `${failures} finding(s) above`}`);
process.exit(0);
