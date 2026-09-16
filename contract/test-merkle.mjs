// Verify the in-circuit Merkle fold against an independent implementation.
// Both must agree, or the accumulator logic is wrong.
import { pureCircuits } from './src/managed/lineage/contract/index.js';

const b32 = (n) => { const a = new Uint8Array(32); a[31] = n; return a; };
const hex = (u) => Buffer.from(u).toString('hex');

// This printed booleans and exited 0 whatever they said, so a fold that disagreed
// with the circuit logged `false` and the suite went green over it. A check that
// cannot fail is not a check.
let fails = 0;
const check = (name, ok) => { console.log(ok ? ' PASS' : ' FAIL', name); if (!ok) fails++; };

console.log('--- merkleStep determinism ---');
const node = b32(1), sib = b32(2);
const a = pureCircuits.merkleStep(node, sib, false);
const b = pureCircuits.merkleStep(node, sib, false);
check('same inputs match', hex(a) === hex(b));

console.log('--- direction bit changes the result ---');
const left = pureCircuits.merkleStep(node, sib, true);
check('left vs right differ', hex(a) !== hex(left));

console.log('--- swapping node/sibling with flipped dir is symmetric ---');
const swapped = pureCircuits.merkleStep(sib, node, true);
check('step(n,s,false) == step(s,n,true)', hex(a) === hex(swapped));

// Depth comes from the contract. This was written against a four-level tree and
// hardcoded four siblings, so it stopped matching the circuit the moment the tree
// was regenerated deeper — the same hardcoded-depth defect as tree.mjs.
const D = pureCircuits.slotBits(new Uint8Array(32)).length;

console.log(`--- merkleRoot equals ${D} manual steps ---`);
const leaf = b32(9);
const sibs = Array.from({ length: D }, (_, i) => b32(10 + (i % 200)));
const dirs = Array.from({ length: D }, (_, i) => i % 2 === 1);
let manual = leaf;
for (let i = 0; i < D; i++) manual = pureCircuits.merkleStep(manual, sibs[i], dirs[i]);
const rooted = pureCircuits.merkleRoot(leaf, sibs, dirs);
console.log('manual fold:', hex(manual).slice(0, 24));
console.log('merkleRoot :', hex(rooted).slice(0, 24));
check(`merkleRoot equals ${D} manual steps`, hex(manual) === hex(rooted));

console.log('--- a different leaf gives a different root ---');
const other = pureCircuits.merkleRoot(b32(8), sibs, dirs);
check('a different leaf gives a different root', hex(rooted) !== hex(other));

console.log(fails === 0 ? '\nAll merkle tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
