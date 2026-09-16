// Slot derivation is what binds a Merkle path to one specific record. If it is
// wrong, any clean slot's path satisfies any record's proof.
import { pureCircuits } from './src/managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const secret = (n) => { const a = new Uint8Array(32); a[0] = n; a[31] = n; return a; };

let fails = 0;
// These printed booleans and always exited 0, so a wrong slot derivation reported
// itself as `false` in the log and the suite went green over the top of it.
const check = (name, ok, detail) => {
  console.log(ok ? ' PASS' : ' FAIL', name, detail ? `(${detail})` : '');
  if (!ok) fails++;
};

// Depth from the contract, never a literal. Every hardcoded 4 and 16 below was
// written against a four-level tree and stopped describing the circuit the moment
// it was regenerated at 24 — the same defect tree.mjs had.
const D = pureCircuits.slotBits(new Uint8Array(32)).length;
const SLOTS = 2 ** D;
console.log(`depth ${D}, ${SLOTS} slots\n`);

console.log('--- deterministic ---');
const c = pureCircuits.commit(secret(1));
const a = pureCircuits.slotBits(c);
const b = pureCircuits.slotBits(c);
check('same commitment, same slot', JSON.stringify(a) === JSON.stringify(b));

console.log('--- distribution over 200 records ---');
const counts = {};
for (let i = 0; i < 200; i++) {
  const cm = pureCircuits.commit(secret(i % 256));
  const idx = pureCircuits.slotBits(cm).map((x) => (x ? 1 : 0)).join('');
  counts[idx] = (counts[idx] || 0) + 1;
}
const keys = Object.keys(counts);
// "of 16" was the depth-4 slot count printed next to a depth-24 tree, which read
// as 200 records crammed into 16 slots. The question the line is actually asking is
// how many of the 200 collided, so it asks that.
console.log(`   ${keys.length} distinct slots for 200 records (${200 - keys.length} collision(s))`);
check('slot derivation spreads records rather than concentrating them',
  keys.length >= 190, `${keys.length}/200 distinct`);

console.log('--- different records land in different slots ---');
const s1 = pureCircuits.slotBits(pureCircuits.commit(secret(7)));
const s2 = pureCircuits.slotBits(pureCircuits.commit(secret(8)));
check('two records do not share a slot', s1.join('') !== s2.join(''));

console.log('--- empty tree root matches a fold of null leaves ---');
const NULL_LEAF = new Uint8Array(32);
const nulls = [];
let node = NULL_LEAF;
for (let i = 0; i < D; i++) { nulls.push(node); node = pureCircuits.merkleStep(node, node, false); }
// The expected value was a hardcoded prefix from the depth-4 build, printed as
// "(expect 59fed5b2…)" beside whatever the current depth produced — a mismatch
// nothing compared. The empty root is a function of the depth, so it is derived.
console.log(`   root: ${hex(node).slice(0, 24)}…`);

console.log('--- a null leaf folds to the empty root from any slot ---');
const slot = (bits) => Array.from({ length: D }, (_, i) => bits[i % bits.length]);
for (const pattern of [[false], [true], [true, false]]) {
  const bits = slot(pattern);
  const r = pureCircuits.merkleRoot(NULL_LEAF, nulls, bits);
  check(`slot ${bits.map(Number).join('').slice(0, 8)}… folds to the empty root`,
    hex(r) === hex(node));
}

console.log(fails === 0 ? '\nAll slot tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
