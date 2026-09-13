// Generates lineage.compact at a chosen tree depth. Compact has no loops, so the
// Merkle fold and the slot-bit derivation are unrolled — writing them by hand at
// depth 16 or 24 is how subtle errors get in, so they are generated instead.
import fs from 'node:fs';

// CHOOSING A DEPTH — this is a capacity decision, not a tuning knob.
//
// A record's slot is derived from its own commitment, which is what removes the
// need for any registry to assign slots. The cost is a birthday bound: with
// 2^DEPTH slots a collision becomes likely at roughly 2^(DEPTH/2) records, not
// 2^DEPTH. Measured, one draw each (contract/slot-capacity.mjs regenerates this):
//
//   depth 16      65,536 slots        373 records before a collision
//   depth 24  16,777,216 slots      3,804 records
//   depth 32   4.29e9    slots    114,915 records
//
// A collision is not cosmetic and it cuts both ways. The second record to land in
// a taken slot cannot be encumbered, because `encumber` asserts the slot is clean.
// It also cannot prove clean, because `proveAncestorClean` asserts the slot holds
// the null leaf — so a record sharing a slot with someone else's obligation
// reports as carrying one it never had. For a contract that exists to answer
// whether material is free of upstream claims, that is a false encumbrance, and it
// blocks a sale that should have gone through.
//
// PROVER KEYS DO NOT SCALE SMOOTHLY, and this is why 24 is the default rather than
// 16. Measured on encumber.prover:
//
//   depth 16    76.5 MB
//   depth 24    76.6 MB      <- same bucket, so the extra capacity is free
//   depth 32   152.5 MB      <- next bucket
//
// So depth 24 gives ten times the capacity of depth 16 for no cost at all.
// Depth 32 doubles the key, and a prover key that size has been observed to
// exceed wasm's memory space and fail to prove in a browser, which would put
// encumbrance behind a self-hosted proof server. That trade is available if a
// deployment genuinely needs ~100,000 records; it should be made deliberately.
//
// 32 is the hard ceiling: the slot derivation takes one byte per level and a
// commitment is 32 bytes, so past that the tree cannot be addressed from the
// commitment alone. No depth makes this unbounded. Registry-free slot assignment
// is bought with a birthday bound, and the only question is where to put it.
const DEPTH = Number(process.argv[2] || 24);
if (DEPTH < 1 || DEPTH > 32) throw new Error('depth must be 1..32 (one byte per level)');

const fold = Array.from({ length: DEPTH }, (_, i) =>
  i === 0
    ? `  const n0 = merkleStep(leaf, siblings[0], dirs[0]);`
    : `  const n${i} = merkleStep(n${i - 1}, siblings[${i}], dirs[${i}]);`
).join('\n');

const dualFold = Array.from({ length: DEPTH }, (_, i) =>
  i === 0
    ? `  const o0 = merkleStep(oldLeaf, siblings[0], dirs[0]);\n  const w0 = merkleStep(newLeaf, siblings[0], dirs[0]);`
    : `  const o${i} = merkleStep(o${i - 1}, siblings[${i}], dirs[${i}]);\n  const w${i} = merkleStep(w${i - 1}, siblings[${i}], dirs[${i}]);`
).join('\n');

const slotBits = Array.from({ length: DEPTH }, (_, i) =>
  `    (recordCommitment[${i}] as Uint<8>) > 127,`
).join('\n');

const pathChecks = Array.from({ length: DEPTH }, (_, i) =>
  `  assert(disclose(dirs[${i}] == bits[${i}]), "Merkle path does not belong to this record");`
).join('\n');

const ancestors = '';

const src = `// Veilcore Lineage — heritable rights for self-replicating assets.
// SPDX-License-Identifier: Apache-2.0
//
// GENERATED FILE — edit gen-lineage.mjs and re-run \`node gen-lineage.mjs ${DEPTH}\`.
// Compact has no loops, so the Merkle fold and slot derivation are unrolled. At
// depth ${DEPTH} that is ${DEPTH} levels; generating them removes a whole class of
// hand-transcription errors.
//
// Every IP registry on earth records objects: a patent, a work, a variety.
// Biological IP is not an object, it is a lineage — a cut becomes a mother becomes
// ten thousand clones, and every descendant carries a fractional claim from
// upstream. Nothing records rights that inherit. This does.
//
// STATE MODEL
// Bounded by design. Every ledger field is a fixed single slot. Obligations live in
// a sparse Merkle tree represented only by its root; the tree is reconstructed
// off-chain from transaction history, as the descent graph is.
//
// SPARSE TREE — depth ${DEPTH}, ${2 ** DEPTH} slots
// Every record has a deterministic slot derived from its own commitment, so no
// assignment or registry is needed and an unwritten slot is clean by default. A
// record is clean when its slot holds the null leaf.
//
// SOUNDNESS
// A new root is never supplied by the caller. It is derived in-circuit from the
// current root plus a Merkle path given as a private witness, and the path is bound
// to the record by its derived slot bits. A forged or borrowed path fails.
//
// BOUNDARY
// The caller asserts who their ancestors are. A verifier cross-checks that claim
// against the descent edges declared in transaction history.

pragma language_version 0.23;

import CompactStandardLibrary;

// Fixed single-slot fields. No growable container anywhere in this contract.
export ledger descentSeq: Counter;
export ledger lastDescent: Bytes<32>;
export ledger lastClearedAncestor: Bytes<32>;
export ledger encumberSeq: Counter;
export ledger cleanProofSeq: Counter;
export ledger encumberedRoot: Bytes<32>;

witness localGeneticSecret(): Bytes<32>;
witness merkleSiblings(): Vector<${DEPTH}, Bytes<32>>;
witness merkleDirections(): Vector<${DEPTH}, Boolean>;
// One ancestor per proof, by design: a verifier collects one proof per generation
// rather than paying for a bundled walk in every prover key. ancestryChain is a
// fixed vector so the caller names which ancestor this proof concerns; only
// element 0 is read.
//
// ancestrySiblings and ancestryDirections were declared for a four-generation walk
// that was never built. They are removed rather than left in place: an unread
// witness still shapes the interface a caller has to satisfy, and a declaration
// that describes behaviour the circuit does not have is worse than a missing
// feature, because a reader plans around it.
witness ancestryChain(): Vector<4, Bytes<32>>;

export circuit commit(secret: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "veilcore:commit"), secret]);
}

export circuit descentEdge(child: Bytes<32>, parent: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>([pad(32, "veilcore:descent"), child, parent]);
}

export circuit obligationLeaf(recordCommitment: Bytes<32>, obligationCommitment: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>([pad(32, "veilcore:obligation"), recordCommitment, obligationCommitment]);
}

export circuit merkleStep(node: Bytes<32>, sibling: Bytes<32>, siblingIsLeft: Boolean): Bytes<32> {
  const left = siblingIsLeft ? sibling : node;
  const right = siblingIsLeft ? node : sibling;
  return persistentHash<Vector<3, Bytes<32>>>([pad(32, "veilcore:node"), left, right]);
}

export circuit merkleRoot(
  leaf: Bytes<32>,
  siblings: Vector<${DEPTH}, Bytes<32>>,
  dirs: Vector<${DEPTH}, Boolean>,
): Bytes<32> {
${fold}
  return n${DEPTH - 1};
}

// One byte per level, high bit taken. Hash output is uniform, so slots distribute
// evenly across the tree.
export circuit slotBits(recordCommitment: Bytes<32>): Vector<${DEPTH}, Boolean> {
  return [
${slotBits}
  ];
}

// A path's direction bits are its slot position. Checking them against the derived
// bits is what binds a path to one record — without it, any clean slot's path would
// satisfy any record's proof.
export circuit assertPathBelongsTo(recordCommitment: Bytes<32>, dirs: Vector<${DEPTH}, Boolean>): [] {
  const bits = slotBits(recordCommitment);
${pathChecks}
}

// Verify the current leaf and compute the replacement in one traversal. The
// siblings are identical for both — only the leaf differs — so folding twice
// doubles the constraint count for no benefit. Returns the new root; the caller
// asserts the old one matches.
export circuit replaceLeaf(
  oldLeaf: Bytes<32>,
  newLeaf: Bytes<32>,
  siblings: Vector<${DEPTH}, Bytes<32>>,
  dirs: Vector<${DEPTH}, Boolean>,
): Vector<2, Bytes<32>> {
${dualFold}
  return [o${DEPTH - 1}, w${DEPTH - 1}];
}

export circuit declareParent(childCommitment: Bytes<32>, parentCommitment: Bytes<32>): [] {
  assert(childCommitment == commit(localGeneticSecret()), "Only the record holder can declare its parentage");
  const c = disclose(childCommitment);
  const p = disclose(parentCommitment);
  descentSeq.increment(1);
  lastDescent = descentEdge(c, p);
}

export circuit encumber(recordCommitment: Bytes<32>, obligationCommitment: Bytes<32>): [] {
  assert(recordCommitment == commit(localGeneticSecret()), "Only the record holder can encumber it");

  const siblings = merkleSiblings();
  const dirs = merkleDirections();
  const nullLeaf = default<Bytes<32>>;

  assertPathBelongsTo(recordCommitment, dirs);

  const rc = disclose(recordCommitment);
  const oc = disclose(obligationCommitment);
  const roots = replaceLeaf(nullLeaf, obligationLeaf(rc, oc), siblings, dirs);

  assert(disclose(roots[0]) == encumberedRoot, "Slot is not clean, or the Merkle path is invalid");
  encumberSeq.increment(1);
  encumberedRoot = disclose(roots[1]);
}

export circuit discharge(recordCommitment: Bytes<32>, obligationCommitment: Bytes<32>): [] {
  assert(recordCommitment == commit(localGeneticSecret()), "Only the holder can discharge");

  const siblings = merkleSiblings();
  const dirs = merkleDirections();
  const rc = disclose(recordCommitment);
  const oc = disclose(obligationCommitment);

  assertPathBelongsTo(recordCommitment, dirs);

  const nullLeaf = default<Bytes<32>>;
  const roots = replaceLeaf(obligationLeaf(rc, oc), nullLeaf, siblings, dirs);

  assert(disclose(roots[0]) == encumberedRoot, "No such obligation at this slot, or the Merkle path is invalid");
  encumberSeq.increment(1);
  encumberedRoot = disclose(roots[1]);
}

// Prove one ancestor is clean. One Merkle path per proof, not five in one circuit:
// each path costs DEPTH hashes, and bundling them makes the prover key unusable in
// a browser. A verifier collects one proof per generation.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT.
//
// It proves that a named commitment occupies a clean slot. It does not prove that
// commitment is an ancestor of the caller — nothing in contract state records the
// descent graph, so no circuit can check it. The join is the verifier's: they take
// the descent edges declared through declareParent, and check that each parent in
// the chain has a clean proof naming it. That division is deliberate and it is what
// the file header describes.
//
// THE ANCESTOR COMMITMENT IS DISCLOSED, and an earlier version of this circuit hid
// it. Hiding it was not privacy, it was the proof having no subject: a verifier
// could see that somebody proved something clean and could not tell what, so they
// could not perform the join above, and a caller whose real parent was encumbered
// could supply any commitment with a clean slot and the proof would pass.
//
// Disclosing it costs nothing a holder wants to keep. A commitment is a hash and
// means nothing without the record behind it — the breeding programme, the
// counterparties and the generation count stay private, which is the privacy the
// format actually promises. What it does cost is correlation: an observer can see
// the same commitment cleared repeatedly. A holder who minds that rotates the
// record's secret and clears under the new commitment.
export circuit proveAncestorClean(): [] {
  const self = commit(localGeneticSecret());
  const nullLeaf = default<Bytes<32>>;

  const siblings = merkleSiblings();
  const dirs = merkleDirections();
  const chain = ancestryChain();

  const ancestor = disclose(chain[0]);
  assertPathBelongsTo(ancestor, dirs);
  assert(disclose(merkleRoot(nullLeaf, siblings, dirs)) == encumberedRoot,
         "This ancestor carries an unmet obligation");

  cleanProofSeq.increment(1);
  // Its own slot, because lastDescent holds edge hashes and the two are
  // indistinguishable as bytes. One field with two meanings is a field a reader
  // cannot use.
  lastClearedAncestor = ancestor;
}
`;

fs.writeFileSync('src/lineage.compact', src);
console.log(`generated lineage.compact at depth ${DEPTH} (${2 ** DEPTH} slots)`);
