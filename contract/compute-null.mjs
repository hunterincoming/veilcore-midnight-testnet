// The null tree: a Merkle tree of a fixed depth where every leaf is NULL_LEAF.
// Each level's node is identical, so the "empty sibling" at every level is a
// constant. These are what a proof uses for untouched parts of the tree.
import { pureCircuits } from './src/managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const NULL_LEAF = new Uint8Array(32); // all zeroes

let node = NULL_LEAF;
console.log('NULL_LEAF   ', hex(NULL_LEAF));
for (let level = 0; level < 4; level++) {
  // both children identical, so direction does not matter
  node = pureCircuits.merkleStep(node, node, false);
  console.log(`NULL_L${level + 1}      `, hex(node));
}
console.log('');
console.log('EMPTY ROOT  ', hex(node));
