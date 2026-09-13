// Descent graph reconstruction and lineage verification.
//
// The contract proves a claimed ancestor is unencumbered. It cannot prove the
// claimed ancestor is the real one — a prover could name any clean record as their
// parent. That half is closed here: declareParent discloses descentEdge(child,
// parent) into a transaction, so the true graph is public and permanent.
//
// TWO ATTACKS, AND THEY NEED DIFFERENT ANSWERS. Substitution — naming an unrelated
// clean record — is caught by checking the edge was declared. Omission — declaring
// the parent and staying quiet about the grandparent — states nothing false and
// passes any check that walks only what the prover hands over. So the verifier
// walks the graph themselves: they supply the set of ancestors they hold clean
// proofs for, and verifyDescent requires every declared ancestor to be in it.
//
// SPDX-License-Identifier: Apache-2.0

import { pureCircuits as C } from "./managed/lineage/contract/index.js";

const hex = (u) => Buffer.from(u).toString("hex");

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
   * Check a prover's claimed chain against the observed graph.
   *
   * Catches SUBSTITUTION: naming a convenient unrelated record fails here even
   * though its Merkle proof verifies, because no edge to it was ever declared.
   *
   * ⚠️ DOES NOT CATCH OMISSION, and omission is the easier attack because the
   * prover states nothing false, only less. A seller whose grandparent is
   * encumbered declares the parent edge, proves the parent clean, presents a
   * one-element chain, and every link in it is genuine. Use verifyDescent for
   * anything a decision rests on; this remains for checking a single stated line.
   */
  verifyChain(record, claimedAncestors) {
    let current = record;
    for (const ancestor of claimedAncestors) {
      if (!this.hasEdge(current, ancestor)) {
        return {
          ok: false,
          reason: `no declared edge from ${hex(current).slice(0, 12)}… to ${hex(ancestor).slice(0, 12)}…`,
        };
      }
      current = ancestor;
    }
    return { ok: true };
  }

  /**
   * Is this record clean through every ancestor the graph knows about?
   *
   * THE VERIFIER WALKS, NOT THE PROVER. Taking a chain from the party who
   * benefits from it means trusting them to have included the inconvenient part,
   * and a pedigree is a graph rather than a line — a cross has a seed parent and a
   * pollen parent, so "the chain" is not a single thing a prover could supply even
   * honestly. Here the caller supplies only the set of commitments they have clean
   * proofs for, and this walks every declared edge upstream and requires each one
   * to be covered.
   *
   * An obligation on any ancestor blocks the descendant, which is the whole point:
   * a per-record check passes on material whose mother is encumbered, and that is
   * the failure this contract exists to prevent.
   *
   * @param record        the commitment being asked about
   * @param provenClean   hex commitments with a verified clean proof
   */
  verifyDescent(record, provenClean) {
    const cleared = new Set([...provenClean].map((c) => (typeof c === 'string' ? c : hex(c))));
    const seen = new Set();
    const missing = [];

    const walk = (k) => {
      for (const parent of this.parentsOf.get(k) ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        if (!cleared.has(parent)) missing.push(parent);
        walk(parent);
      }
    };
    walk(hex(record));

    if (missing.length > 0) {
      return {
        ok: false,
        reason:
          missing.length === 1
            ? `no clean proof for ancestor ${missing[0].slice(0, 12)}…`
            : `no clean proof for ${missing.length} ancestors, including ${missing[0].slice(0, 12)}…`,
        missing,
      };
    }
    return { ok: true, ancestorsChecked: seen.size };
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

  /**
   * How many ancestors the graph knows about.
   *
   * Renamed from requiredChainLength, which was misleading twice over: it counts
   * every ancestor transitively while verifyChain follows a single line, so on any
   * branching pedigree — which is to say on any cross — the number it returned
   * could not be met by a valid chain. And nothing ever compared against it, so
   * the omission check it was named for did not exist. verifyDescent walks the
   * graph instead of counting it.
   */
  ancestorCount(record) {
    return this.ancestorsOf(record).length;
  }
}
