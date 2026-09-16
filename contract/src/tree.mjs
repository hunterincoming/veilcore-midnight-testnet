// Off-chain sparse Merkle tree for the obligation set.
//
// The contract verifies paths but stores only the root, so this maintains the tree
// and produces the sibling paths a caller must supply. Every hash comes from the
// contract's own exported circuits — there is one implementation, not two that
// have to agree, which is the usual source of "the proof fails and nobody knows
// why" bugs.
//
// PARAMETERISED BY THE BUILD, for the same reason. `obligationTreeFor(circuits)`
// binds the builder to any compiled artifact, so a shallow build — used to run an
// attack that costs 27 million hashes at the production depth and a few hundred at
// depth 8 — is exercised by this code rather than by a second copy of it that would
// have to be kept in step. The exports at the bottom are this factory bound to the
// production artifact, and are what everything else imports.
//
// SPDX-License-Identifier: Apache-2.0

import { pureCircuits as productionCircuits } from "./managed/lineage/contract/index.js";

const hex = (u) => Buffer.from(u).toString("hex");

export function obligationTreeFor(C) {
  // Derived from the contract, never declared here. This was a hardcoded 16 while
  // the contract was regenerated at 24, which is a silent break: siblingsFor would
  // return sixteen siblings, the circuit would expect twenty-four, and every
  // encumber, discharge and clean proof would fail — after proving, after paying.
  // A constant that has to track a generated file and has nothing enforcing it is
  // a bug waiting for a regeneration.
  const DEPTH = C.slotBits(new Uint8Array(32)).length;
  const NULL_LEAF = new Uint8Array(32);

  /** Sibling value for an all-null subtree at each level, computed once. */
  const nullNodes = (() => {
    const out = [];
    let n = NULL_LEAF;
    for (let i = 0; i < DEPTH; i++) {
      out.push(n);
      n = C.merkleStep(n, n, false);
    }
    out.push(n); // index DEPTH: root of a fully empty tree
    return out;
  })();

  const EMPTY_ROOT = nullNodes[DEPTH];

  /**
   * A sparse tree holding only non-null leaves. Untouched subtrees are represented
   * by the precomputed null nodes, so memory is proportional to obligations
   * outstanding rather than to 2^DEPTH.
   */
  class ObligationTree {
    constructor() {
      this.leaves = new Map(); // slotKey -> leaf bytes
      // slotKey -> { record, obligation, beneficiary }. The leaf alone is a hash,
      // and proveAncestorClean has to hand the circuit the three values behind
      // whatever occupies the slot so it can rebuild that leaf — see occupantOf.
      this.occupants = new Map();
    }

    /** Slot position for a record, derived by the contract itself. */
    slotOf(recordCommitment) {
      return C.slotBits(recordCommitment);
    }

    /** Leaf key: the slot path read top-down, so it matches subtreeRoot's paths. */
    static key(dirs) {
      return dirs
        .map((b) => (b ? "1" : "0"))
        .slice()
        .reverse()
        .join("");
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
     * is what keeps a 16-million-slot tree cheap when only a few slots are used.
     */
    subtreeRoot(level, path) {
      if (level === 0) return this.leaves.get(path) ?? NULL_LEAF;

      let occupied = false;
      for (const k of this.leaves.keys()) {
        if (k.startsWith(path)) {
          occupied = true;
          break;
        }
      }
      if (!occupied) return nullNodes[level];

      const left = this.subtreeRoot(level - 1, path + "0");
      const right = this.subtreeRoot(level - 1, path + "1");
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
      const top = dirs
        .map((b) => (b ? "1" : "0"))
        .slice()
        .reverse()
        .join("");
      const sibs = [];
      for (let level = 0; level < DEPTH; level++) {
        const depthFromTop = DEPTH - 1 - level;
        const prefix = top.slice(0, depthFromTop);
        const mine = top[depthFromTop];
        sibs.push(this.subtreeRoot(level, prefix + (mine === "1" ? "0" : "1")));
      }
      return sibs;
    }

    /** Current root of the whole tree. */
    root() {
      return this.subtreeRoot(DEPTH, "");
    }

    /**
     * Attach an obligation in favour of a beneficiary.
     *
     * The beneficiary is part of the leaf, so this signature has to match the
     * circuit's or the fold produces a different root and every path fails. The
     * beneficiary is there because a leaf the encumbered party could reconstruct
     * was a leaf they could remove, which made an obligation voluntary.
     */
    encumber(recordCommitment, obligationCommitment, beneficiaryCommitment) {
      const dirs = this.slotOf(recordCommitment);
      const before = this.leafAt(dirs);
      if (hex(before) !== hex(NULL_LEAF))
        throw new Error("slot already carries an obligation");
      const siblings = this.siblingsFor(dirs);
      const leaf = C.obligationLeaf(
        recordCommitment,
        obligationCommitment,
        beneficiaryCommitment,
      );
      const oldRoot = this.root();
      this.leaves.set(ObligationTree.key(dirs), leaf);
      this.occupants.set(ObligationTree.key(dirs), {
        record: recordCommitment,
        obligation: obligationCommitment,
        beneficiary: beneficiaryCommitment,
      });
      return { dirs, siblings, oldRoot, newRoot: this.root() };
    }

    /** Clear an obligation. Only the beneficiary's own commitment reproduces the leaf. */
    discharge(recordCommitment, obligationCommitment, beneficiaryCommitment) {
      const dirs = this.slotOf(recordCommitment);
      // The circuit already refuses a discharge that names the wrong obligation:
      // it folds obligationLeaf(rc, oc, bc) and compares against the current root.
      // This checks the same thing locally so a wrong reference fails here rather
      // than after proving and paying for a transaction that cannot succeed.
      const present = this.leafAt(dirs);
      if (hex(present) === hex(NULL_LEAF))
        throw new Error("slot carries no obligation");
      const expected = C.obligationLeaf(
        recordCommitment,
        obligationCommitment,
        beneficiaryCommitment,
      );
      if (hex(present) !== hex(expected))
        throw new Error("slot carries a different obligation");
      const siblings = this.siblingsFor(dirs);
      const oldRoot = this.root();
      this.leaves.delete(ObligationTree.key(dirs));
      this.occupants.delete(ObligationTree.key(dirs));
      return { dirs, siblings, oldRoot, newRoot: this.root() };
    }

    /**
     * What occupies a record's slot, in the form proveAncestorClean wants.
     *
     * A slot is DEPTH bits of a commitment, so another record's obligation can land
     * in it — by collision, or because a squatter ground a secret until it did. The
     * circuit therefore asks what the occupant IS rather than requiring the slot to
     * be empty, and rebuilds the leaf from these three values to fold the path.
     */
    occupantOf(recordCommitment) {
      const dirs = this.slotOf(recordCommitment);
      const held = this.occupants.get(ObligationTree.key(dirs));
      if (!held)
        return {
          isEmpty: true,
          record: NULL_LEAF,
          obligation: NULL_LEAF,
          beneficiary: NULL_LEAF,
        };
      return { isEmpty: false, ...held };
    }

    /**
     * Path proving a record's slot carries nothing binding THIS record.
     *
     * Threw whenever the slot was non-empty, which made an unrelated leaf in the
     * slot look like the record's own obligation — the false encumbrance a squatter
     * buys by grinding, and the one two honest records hit on a collision. It now
     * refuses only when the leaf actually names this record.
     */
    cleanPath(recordCommitment) {
      const dirs = this.slotOf(recordCommitment);
      const occupant = this.occupantOf(recordCommitment);
      if (!occupant.isEmpty && hex(occupant.record) === hex(recordCommitment))
        throw new Error("record carries an obligation");
      return {
        dirs,
        siblings: this.siblingsFor(dirs),
        root: this.root(),
        occupant,
      };
    }
  }

  return { DEPTH, NULL_LEAF, EMPTY_ROOT, ObligationTree };
}

// The production binding. Everything that is not deliberately exercising another
// build imports these.
const production = obligationTreeFor(productionCircuits);
export const DEPTH = production.DEPTH;
export const NULL_LEAF = production.NULL_LEAF;
export const EMPTY_ROOT = production.EMPTY_ROOT;
export const ObligationTree = production.ObligationTree;
