// Off-chain active-licence tree.
//
// The contract verifies paths and stores only the root, so this maintains the tree
// and produces the paths a caller supplies to countersignLicense, revokeLicense,
// approveTransfer and proveLicense. Every hash comes from the contract's own
// exported circuits — one implementation, not two that have to agree.
//
// WHAT THE TREE IS FOR. proveLicense opens a leaf of it and says nothing else. A
// map lookup would put the licence commitment in the public transcript, and
// licenseRecordOf maps that straight to the issuing record, so every presentation
// named the breeder and repeated presentations linked.
//
// POSITIONS ARE ASSIGNED, NOT DERIVED. A slot is whatever index was free when the
// licence was activated, which is why there is no birthday bound and no grinding
// target here — unlike the obligation tree, where the slot has to be derivable from
// the record commitment alone so no registry has to assign it. Licences already
// have a party on both sides, so assignment costs nothing.
//
// The order is reproducible from chain history: leaves enter at activation and
// leave at revocation or assignment, so anyone replaying the contract's
// transactions arrives at the same tree. A holder does not need to store their
// position, only to rebuild it.
//
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pureCircuits as C } from "./managed/veilcore/contract/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Depth from the compiled artifact's own signature, never a literal here.
 *
 * lineage.compact can be asked its depth directly — slotBits returns one bit per
 * level — but nothing in veilcore returns a vector sized by the tree, and adding a
 * circuit that exists only to be measured would be an interface describing
 * behaviour the contract does not have. The build records the argument types, so
 * that is what is read. A regenerated tree at another depth moves this with it.
 */
export const DEPTH = (() => {
  const info = JSON.parse(
    readFileSync(
      path.join(here, "managed/veilcore/compiler/contract-info.json"),
      "utf8",
    ),
  );
  const fold = info.circuits.find((c) => c.name === "licenseMerkleRoot");
  const siblings = fold?.arguments?.find((a) => a.name === "siblings");
  const d = siblings?.type?.length;
  if (!d)
    throw new Error("cannot read licence tree depth from contract-info.json");
  return d;
})();

export const CAPACITY = 2 ** DEPTH;
export const NULL_LEAF = new Uint8Array(32);

const hex = (u) => Buffer.from(u).toString("hex");

/** Sibling value for an all-null subtree at each level, computed once. */
const nullNodes = (() => {
  const out = [];
  let n = NULL_LEAF;
  for (let i = 0; i < DEPTH; i++) {
    out.push(n);
    n = C.licenseNode(n, n, false);
  }
  out.push(n);
  return out;
})();

export const EMPTY_ROOT = nullNodes[DEPTH];

/** Position index to the top-down path string the tree stores leaves under. */
const keyOf = (index) => index.toString(2).padStart(DEPTH, "0");

/**
 * Direction bits for a position, bottom-up, matching the circuit's fold order.
 *
 * Keys are top-down and dirs are indexed 0 = deepest, so the two are reverses of
 * each other. Getting that wrong produces a path that folds to the wrong root and
 * fails after proving rather than before.
 */
const dirsOf = (index) =>
  keyOf(index)
    .split("")
    .reverse()
    .map((c) => c === "1");

export class LicenseTree {
  constructor() {
    this.leaves = new Map(); // top-down key -> leaf bytes
    this.indexOf = new Map(); // leaf hex -> position index
  }

  subtreeRoot(level, prefix) {
    if (level === 0) return this.leaves.get(prefix) ?? NULL_LEAF;
    let occupied = false;
    for (const k of this.leaves.keys()) {
      if (k.startsWith(prefix)) {
        occupied = true;
        break;
      }
    }
    if (!occupied) return nullNodes[level];
    const left = this.subtreeRoot(level - 1, prefix + "0");
    const right = this.subtreeRoot(level - 1, prefix + "1");
    // licenseNode(node, sibling, siblingIsLeft) — node is the right child here.
    return C.licenseNode(right, left, true);
  }

  root() {
    return this.subtreeRoot(DEPTH, "");
  }

  siblingsFor(index) {
    const top = keyOf(index);
    const sibs = [];
    for (let level = 0; level < DEPTH; level++) {
      const depthFromTop = DEPTH - 1 - level;
      const prefix = top.slice(0, depthFromTop);
      const mine = top[depthFromTop];
      sibs.push(this.subtreeRoot(level, prefix + (mine === "1" ? "0" : "1")));
    }
    return sibs;
  }

  /** Lowest free position. Slots freed by revocation or assignment come back. */
  freeIndex() {
    for (let i = 0; i < CAPACITY; i++) if (!this.leaves.has(keyOf(i))) return i;
    throw new Error(
      `licence tree is full (${CAPACITY} concurrent active licences)`,
    );
  }

  // PLAN THEN APPLY, because a path has to be built BEFORE the call that uses it
  // and the call may be refused. A DApp works the same way round: it derives the
  // path, submits, and moves its own tree forward only once the transaction lands.
  // A mutate-on-build API silently desynchronises the local tree from the chain
  // every time a call fails, and every path after that is wrong.

  /** The path countersignLicense needs to activate a licence. Does not mutate. */
  planInsert(licenseCommitment) {
    if (this.indexOf.has(hex(licenseCommitment)))
      throw new Error("that licence is already active");
    const index = this.freeIndex();
    return {
      index,
      dirs: dirsOf(index),
      siblings: this.siblingsFor(index),
      oldRoot: this.root(),
    };
  }

  /** Record an activation that the chain accepted. */
  applyInsert(licenseCommitment, index) {
    this.leaves.set(keyOf(index), licenseCommitment);
    this.indexOf.set(hex(licenseCommitment), index);
    return this.root();
  }

  /** Activate a licence. Returns the path countersignLicense needs. */
  insert(licenseCommitment) {
    const p = this.planInsert(licenseCommitment);
    return { ...p, newRoot: this.applyInsert(licenseCommitment, p.index) };
  }

  /** Where a live licence sits. Throws if it is not live. */
  positionOf(licenseCommitment) {
    const index = this.indexOf.get(hex(licenseCommitment));
    if (index === undefined)
      throw new Error("no live licence with that commitment");
    return index;
  }

  /** The path revokeLicense needs. Does not mutate. */
  planRemove(licenseCommitment) {
    const index = this.positionOf(licenseCommitment);
    return {
      index,
      dirs: dirsOf(index),
      siblings: this.siblingsFor(index),
      oldRoot: this.root(),
    };
  }

  /** Record a revocation that the chain accepted. */
  applyRemove(licenseCommitment, index) {
    this.leaves.delete(keyOf(index));
    this.indexOf.delete(hex(licenseCommitment));
    return this.root();
  }

  /** Revoke. Returns the path revokeLicense needs. */
  remove(licenseCommitment) {
    const p = this.planRemove(licenseCommitment);
    return { ...p, newRoot: this.applyRemove(licenseCommitment, p.index) };
  }

  /**
   * Assign a licence to a new holder, in place.
   *
   * The same slot, because it is the same agreement continuing with a party the
   * issuer has just consented to. One fold rather than a removal and an insertion.
   */
  replace(oldCommitment, newCommitment) {
    const p = this.planReplace(oldCommitment);
    return {
      ...p,
      newRoot: this.applyReplace(oldCommitment, newCommitment, p.index),
    };
  }

  /** The path approveTransfer needs. Does not mutate. */
  planReplace(oldCommitment) {
    const index = this.positionOf(oldCommitment);
    return {
      index,
      dirs: dirsOf(index),
      siblings: this.siblingsFor(index),
      oldRoot: this.root(),
    };
  }

  /** Record an assignment that the chain accepted. */
  applyReplace(oldCommitment, newCommitment, index) {
    this.leaves.set(keyOf(index), newCommitment);
    this.indexOf.delete(hex(oldCommitment));
    this.indexOf.set(hex(newCommitment), index);
    return this.root();
  }

  /**
   * The path proveLicense opens.
   *
   * Returned to the holder and never published: the position is what would make one
   * presentation linkable to the next.
   */
  pathFor(licenseCommitment) {
    const index = this.positionOf(licenseCommitment);
    return {
      index,
      dirs: dirsOf(index),
      siblings: this.siblingsFor(index),
      root: this.root(),
    };
  }
}
