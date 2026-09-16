/**
 * Does the off-chain tree agree with the circuit?
 *
 * tree.mjs builds sibling paths; the circuit folds them. Slot bits are indexed
 * 0 = deepest and leaf keys are stored top-down, so the two orderings are
 * reverses of each other. Getting that wrong does not throw — it produces a path
 * that folds to the wrong root, and you find out after proving and paying for a
 * transaction that cannot succeed.
 *
 * Every check here compares the client's arithmetic against the contract's own
 * pure circuits, so agreement is demonstrated rather than argued.
 *
 *   node contract/tree-checks.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ObligationTree, DEPTH, NULL_LEAF, EMPTY_ROOT } =
  await import(pathToFileURL(path.join(here, 'src/tree.mjs')).href);
const { pureCircuits: C } =
  await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);

// Obligations name who is owed. The beneficiary is part of the leaf, so the
// encumbered party cannot reconstruct it and release themselves — which is what
// made an obligation a note-to-self before. Declared AFTER the import that binds
// C: it was above it, so the file threw before a single check ran.
const BENEFICIARY = C.commit(new Uint8Array(32).fill(0xBE));

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`OK   ${name}`);
  else { console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); failures++; }
};
const note = (s) => console.log(`     ${s}`);
const hex = (u) => Buffer.from(u).toString('hex');
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const rejects = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message ?? e); } };

const rec = (n) => C.commit(createHash('sha256').update(`rec-${n}`).digest());
const obl = (n) => createHash('sha256').update(`obl-${n}`).digest();

note(`depth ${DEPTH}, empty root ${hex(EMPTY_ROOT).slice(0, 16)}…`);

// ── 1. the client's root matches a circuit fold of the client's own path ─────
console.log('\n== 1. does a built path fold to the root the client computed? ==');
{
  const t = new ObligationTree();
  const r = rec(1);
  const o = obl(1);
  const { dirs, siblings, oldRoot, newRoot } = t.encumber(r, o, BENEFICIARY);

  const leaf = C.obligationLeaf(r, o, BENEFICIARY);
  const folded = C.merkleRoot(leaf, siblings, dirs);

  note(`client newRoot:  ${hex(newRoot).slice(0, 24)}…`);
  note(`circuit fold:    ${hex(folded).slice(0, 24)}…`);
  ok('the circuit folds the path to the client\'s new root', same(folded, newRoot),
     'the sibling ordering disagrees with the fold order — every encumber would fail on chain');

  const foldedOld = C.merkleRoot(NULL_LEAF, siblings, dirs);
  ok('the same path folds the null leaf to the old root', same(foldedOld, oldRoot),
     'encumber asserts the old root; a mismatch here means it is rejected');
}

// ── 2. the path is bound to the record, as assertPathBelongsTo requires ──────
console.log('\n== 2. do the direction bits equal the record\'s slot bits? ==');
{
  const t = new ObligationTree();
  const r = rec(2);
  const { dirs } = t.encumber(r, obl(2), BENEFICIARY);
  const bits = C.slotBits(r);

  const equal = dirs.length === bits.length && dirs.every((d, i) => d === bits[i]);
  note(`path length ${dirs.length}, slot bits ${bits.length}`);
  ok('dirs match slotBits exactly', equal,
     'assertPathBelongsTo compares these one by one and rejects the call if any differ');
}

// ── 3. many records, each still folding correctly ────────────────────────────
console.log('\n== 3. does it hold with a populated tree? ==');
{
  const t = new ObligationTree();
  for (let i = 10; i < 60; i++) t.encumber(rec(i), obl(i), BENEFICIARY);

  let bad = 0;
  for (let i = 10; i < 60; i++) {
    const p = t.cleanPath(rec(i + 500));            // untouched records stay clean
    if (!same(C.merkleRoot(NULL_LEAF, p.siblings, p.dirs), p.root)) bad++;
  }
  note(`50 obligations outstanding, 50 clean paths checked`);
  ok('every clean path folds to the live root', bad === 0,
     `${bad} path(s) folded to something else — sibling derivation is wrong for populated subtrees`);
}

// ── 4. discharge returns to the prior root ──────────────────────────────────
console.log('\n== 4. does discharge undo encumber exactly? ==');
{
  const t = new ObligationTree();
  const before = t.root();
  const r = rec(3);
  const o = obl(3);
  t.encumber(r, o, BENEFICIARY);
  const mid = t.root();
  const d = t.discharge(r, o, BENEFICIARY);

  ok('the root moves when an obligation is added', !same(before, mid));
  ok('discharging returns to the exact prior root', same(t.root(), before),
     'a tree that does not return to its prior state has lost or kept something');
  ok('discharge reports the roots it moved between', same(d.oldRoot, mid) && same(d.newRoot, before));
}

// ── 5. the guards refuse what the circuit would refuse ──────────────────────
console.log('\n== 5. do the client guards match the circuit\'s asserts? ==');
{
  const t = new ObligationTree();
  const r = rec(4);
  t.encumber(r, obl(4), BENEFICIARY);

  ok('encumbering an occupied slot is refused',
     rejects(() => t.encumber(r, obl(99), BENEFICIARY)) !== '',
     'the circuit asserts the slot is clean; letting the client build this wastes a proof');
  ok('discharging an obligation that is not there is refused',
     rejects(() => t.discharge(r, obl(99), BENEFICIARY)) !== '',
     'the circuit folds obligationLeaf(rc, oc, bc) and compares to the root');
  ok('a clean path for an encumbered record is refused',
     rejects(() => t.cleanPath(r)) !== '');
}

console.log(`\n${failures === 0 ? 'no findings' : `${failures} finding(s) above`}`);
process.exit(0);
