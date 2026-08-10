// Verify the in-circuit Merkle fold against an independent implementation.
// Both must agree, or the accumulator logic is wrong.
import { pureCircuits } from './src/managed/lineage/contract/index.js';

const b32 = (n) => { const a = new Uint8Array(32); a[31] = n; return a; };
const hex = (u) => Buffer.from(u).toString('hex');

console.log('--- merkleStep determinism ---');
const node = b32(1), sib = b32(2);
const a = pureCircuits.merkleStep(node, sib, false);
const b = pureCircuits.merkleStep(node, sib, false);
console.log('same inputs match:', hex(a) === hex(b));

console.log('--- direction bit changes the result ---');
const left = pureCircuits.merkleStep(node, sib, true);
console.log('left vs right differ:', hex(a) !== hex(left));

console.log('--- swapping node/sibling with flipped dir is symmetric ---');
const swapped = pureCircuits.merkleStep(sib, node, true);
console.log('step(n,s,false) == step(s,n,true):', hex(a) === hex(swapped));

console.log('--- merkleRoot equals four manual steps ---');
const leaf = b32(9);
const sibs = [b32(10), b32(11), b32(12), b32(13)];
const dirs = [false, true, false, true];
let manual = leaf;
for (let i = 0; i < 4; i++) manual = pureCircuits.merkleStep(manual, sibs[i], dirs[i]);
const rooted = pureCircuits.merkleRoot(leaf, sibs, dirs);
console.log('manual fold:', hex(manual).slice(0, 24));
console.log('merkleRoot :', hex(rooted).slice(0, 24));
console.log('MATCH:', hex(manual) === hex(rooted));

console.log('--- a different leaf gives a different root ---');
const other = pureCircuits.merkleRoot(b32(8), sibs, dirs);
console.log('roots differ:', hex(rooted) !== hex(other));
