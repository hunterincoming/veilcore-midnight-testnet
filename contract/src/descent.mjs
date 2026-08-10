// Descent graph reconstruction and lineage verification.
//
// The contract proves a claimed ancestor is unencumbered. It cannot prove the
// claimed ancestor is the real one — a prover could name any clean record as their
// parent. That half is closed here: declareParent discloses descentEdge(child,
// parent) into a transaction, so the true graph is public and permanent, and a
// verifier checks the claimed chain against it before trusting any proof.
//
// SPDX-License-Identifier: Apache-2.0

import { pureCircuits as C } from './managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');

export class DescentGraph {
  constructor() {
    this.edges = new Set();
    this.parentsOf = new Map();
  }

  /** Record an edge observed in a declareParent transaction. */
  observe(child, parent) {
    this.edges.add(hex(C.descentEdge(child, parent)));
    const k = hex(child);
    const list = this.parentsOf.get(k) ?? [];
    list.push(hex(parent));
    this.parentsOf.set(k, list);
  }

  /** Was this parent link actually declared on chain? */
  hasEdge(child, parent) {
    return this.edges.has(hex(C.descentEdge(child, parent)));
  }

  /**
   * Check a prover's claimed chain against the observed graph. A claim naming a
   * convenient unrelated ancestor fails here even though its Merkle proof verifies.
   */
  verifyChain(record, claimedAncestors) {
    let current = record;
    for (const ancestor of claimedAncestors) {
      if (!this.hasEdge(current, ancestor)) {
        return { ok: false, reason: `no declared edge from ${hex(current).slice(0, 12)}… to ${hex(ancestor).slice(0, 12)}…` };
      }
      current = ancestor;
    }
    return { ok: true };
  }

  /** Everything upstream of a record, per the observed graph. */
  ancestorsOf(record, seen = new Set()) {
    const out = [];
    const walk = (k) => {
      for (const p of this.parentsOf.get(k) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
        walk(p);
      }
    };
    walk(hex(record));
    return out;
  }

  /** How many generations a prover must supply. Omission is caught against this. */
  requiredChainLength(record) {
    return this.ancestorsOf(record).length;
  }
}
