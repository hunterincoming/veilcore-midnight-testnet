// Slot derivation is what binds a Merkle path to one specific record. If it is
// wrong, any clean slot's path satisfies any record's proof.
import { pureCircuits } from './src/managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const secret = (n) => { const a = new Uint8Array(32); a[0] = n; a[31] = n; return a; };

console.log('--- deterministic ---');
const c = pureCircuits.commit(secret(1));
const a = pureCircuits.slotBits(c);
const b = pureCircuits.slotBits(c);
console.log('same commitment, same slot:', JSON.stringify(a) === JSON.stringify(b), a);

console.log('--- distribution over 200 records ---');
const counts = {};
for (let i = 0; i < 200; i++) {
  const cm = pureCircuits.commit(secret(i % 256));
  const bits = pureCircuits.slotBits(cm);
  const idx = bits.map((x) => (x ? 1 : 0)).join('');
  counts[idx] = (counts[idx] || 0) + 1;
}
const keys = Object.keys(counts).sort();
console.log('distinct slots used:', keys.length, 'of 16');
console.log(keys.map((k) => `${k}:${counts[k]}`).join('  '));

console.log('--- different records land in different slots ---');
const s1 = pureCircuits.slotBits(pureCircuits.commit(secret(7)));
const s2 = pureCircuits.slotBits(pureCircuits.commit(secret(8)));
console.log('slot(7):', s1.map(Number).join(''), ' slot(8):', s2.map(Number).join(''));

console.log('--- empty tree root matches the constant ---');
const NULL_LEAF = new Uint8Array(32);
const nulls = [];
let node = NULL_LEAF;
for (let i = 0; i < 4; i++) { nulls.push(node); node = pureCircuits.merkleStep(node, node, false); }
console.log('root:', hex(node).slice(0, 24), '(expect 59fed5b23edd3bd78f9e3a09)');

console.log('--- a null leaf folds to the empty root from any slot ---');
for (const bits of [[false,false,false,false],[true,true,true,true],[true,false,true,false]]) {
  const r = pureCircuits.merkleRoot(NULL_LEAF, nulls, bits);
  console.log(' slot', bits.map(Number).join(''), hex(r) === hex(node) ? 'OK' : 'MISMATCH');
}
