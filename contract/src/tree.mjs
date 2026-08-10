// Off-chain sparse Merkle tree for the obligation set.
//
// The contract verifies paths but stores only the root, so this maintains the tree
// and produces the sibling paths a caller must supply. Every hash comes from the
// contract's own exported circuits — there is one implementation, not two that
// have to agree, which is the usual source of "the proof fails and nobody knows
// why" bugs.
//
// SPDX-License-Identifier: Apache-2.0

import { pureCircuits as C } from './managed/lineage/contract/index.js';

export const DEPTH = 16;
export const NULL_LEAF = new Uint8Array(32);

const hex = (u) => Buffer.from(u).toString('hex');

/** Sibling value for an all-null subtree at each level, computed once. */
const nullNodes = (() => {
  const out = [];
  let n = NULL_LEAF;
  for (let i = 0; i < DEPTH; i++) { out.push(n); n = C.merkleStep(n, n, false); }
  out.push(n); // index DEPTH: root of a fully empty tree
  return out;
})();

export const EMPTY_ROOT = (() => {
  let n = NULL_LEAF;
  for (let i = 0; i < DEPTH; i++) n = C.merkleStep(n, n, false);
  return n;
})();

/**
 * A sparse tree holding only non-null leaves. Untouched subtrees are represented
 * by the precomputed null nodes, so memory is proportional to obligations
 * outstanding rather than to 2^DEPTH.
 */
export class ObligationTree {
  constructor() {
    this.leaves = new Map(); // slotKey -> leaf bytes
  }

  /** Slot position for a record, derived by the contract itself. */
  slotOf(recordCommitment) {
    return C.slotBits(recordCommitment);
  }

  /** Leaf key: the slot path read top-down, so it matches subtreeRoot's paths. */
  static key(dirs) {
    return dirs.map((b) => (b ? '1' : '0')).slice().reverse().join('');
  }

  /** The leaf currently at a record's slot. */
  leafAt(dirs) {
    return this.leaves.get(ObligationTree.key(dirs)) ?? NULL_LEAF;
  }

  /**
   * Root of the subtree at `level` reached by following `path` from the top.
   * `path` is a string of '0'/'1', length DEPTH - level.
   *
   * Recursive: a node is the hash of its two children. A subtree containing no
   * stored leaf short-circuits to the precomputed null node for that level, which
   * is what keeps a 65,536-slot tree cheap when only a few slots are used.
   */
  subtreeRoot(level, path) {
    if (level === 0) return this.leaves.get(path) ?? NULL_LEAF;

    let occupied = false;
    for (const k of this.leaves.keys()) {
      if (k.startsWith(path)) { occupied = true; break; }
    }
    if (!occupied) return nullNodes[level];

    const left = this.subtreeRoot(level - 1, path + '0');
    const right = this.subtreeRoot(level - 1, path + '1');
    // merkleStep(node, sibling, siblingIsLeft) — node is the right child here.
    return C.merkleStep(right, left, true);
  }

  /**
   * Sibling path for a slot, bottom-up, matching the circuit's fold order.
   *
   * Slot bits are indexed 0 = deepest. Leaf keys are stored top-down, so the two
   * orderings are reverses of each other — getting that wrong is the classic way
   * an off-chain builder silently disagrees with its circuit.
   */
  siblingsFor(dirs) {
    const top = dirs.map((b) => (b ? '1' : '0')).slice().reverse().join('');
    const sibs = [];
    for (let level = 0; level < DEPTH; level++) {
      const depthFromTop = DEPTH - 1 - level;
      const prefix = top.slice(0, depthFromTop);
      const mine = top[depthFromTop];
      sibs.push(this.subtreeRoot(level, prefix + (mine === '1' ? '0' : '1')));
    }
    return sibs;
  }

  /** Current root of the whole tree. */
  root() {
    return this.subtreeRoot(DEPTH, '');
  }

  /** Record an obligation. Returns the path a caller supplies to `encumber`. */
  encumber(recordCommitment, obligationCommitment) {
    const dirs = this.slotOf(recordCommitment);
    const before = this.leafAt(dirs);
    if (hex(before) !== hex(NULL_LEAF)) throw new Error('slot already carries an obligation');
    const siblings = this.siblingsFor(dirs);
    const leaf = C.obligationLeaf(recordCommitment, obligationCommitment);
    const oldRoot = this.root();
    this.leaves.set(ObligationTree.key(dirs), leaf);
    return { dirs, siblings, oldRoot, newRoot: this.root() };
  }

  /** Clear an obligation. Returns the path a caller supplies to `discharge`. */
  discharge(recordCommitment, obligationCommitment) {
    const dirs = this.slotOf(recordCommitment);
    const siblings = this.siblingsFor(dirs);
    const oldRoot = this.root();
    this.leaves.delete(ObligationTree.key(dirs));
    return { dirs, siblings, oldRoot, newRoot: this.root() };
  }

  /** Path proving a record's slot is clean. Throws if it is not. */
  cleanPath(recordCommitment) {
    const dirs = this.slotOf(recordCommitment);
    if (hex(this.leafAt(dirs)) !== hex(NULL_LEAF)) throw new Error('record carries an obligation');
    return { dirs, siblings: this.siblingsFor(dirs), root: this.root() };
  }
}
