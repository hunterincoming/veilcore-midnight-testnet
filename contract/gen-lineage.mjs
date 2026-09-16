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

// Optional output path. The production contract is depth 24, where grinding a
// commitment into a chosen slot costs about 27 million hashes — far too slow to run
// inside a test. A shallow build makes the same attack cheap enough to execute for
// real rather than describe, and depth changes nothing about the attack except its
// price. See verify-max-7.mjs.
const OUT = process.argv[3] || 'src/lineage.compact';

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

const emptyFold = Array.from({ length: DEPTH }, (_, i) =>
  i === 0
    ? '  const e0 = merkleStep(nullLeaf, nullLeaf, false);'
    : `  const e${i} = merkleStep(e${i - 1}, e${i - 1}, false);`
).join('\n');

const slotBits = Array.from({ length: DEPTH }, (_, i) =>
  `    (recordCommitment[${i}] as Uint<8>) > 127,`
).join('\n');

const pathChecks = Array.from({ length: DEPTH }, (_, i) =>
  `  assert(disclose(dirs[${i}] == bits[${i}]), "Merkle path does not belong to this record");`
).join('\n');

// Finding 8: a ring of recent roots. RING - 1 previous roots are kept beside the
// current one, so a proof built against a root that has since moved on is still
// accepted. Eight is the review's suggestion and is a straight latency/soundness
// trade: the older the root a proof may cite, the longer an obligation attached in
// the meantime goes unnoticed by that proof.
const RING = 8;

const ringCells = Array.from({ length: RING - 1 }, (_, i) =>
  `export ledger recentRoot${i + 1}: Bytes<32>;`
).join('\n');

// Newest first: each cell takes the value of the one before it, then the current
// root moves into slot 1. Written back to front so no cell is overwritten before
// it has been read.
const ringShift = [
  ...Array.from({ length: RING - 2 }, (_, i) =>
    `  recentRoot${RING - 1 - i} = recentRoot${RING - 2 - i};`),
  '  recentRoot1 = encumberedRoot;',
].join('\n');

const ringInit = Array.from({ length: RING - 1 }, (_, i) =>
  `  recentRoot${i + 1} = e${DEPTH - 1};`
).join('\n');

const ringAccept = Array.from({ length: RING - 1 }, (_, i) =>
  `             || f == recentRoot${i + 1}`
).join('\n');

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
// Every ledger field is a fixed single slot except pendingParentOf, which holds
// parentage offered and not yet accepted and is cleared on confirmation or
// withdrawal — bounded by open proposals rather than by cumulative usage, the same
// bound licensing has. Obligations live in a sparse Merkle tree represented only by
// its root; the tree is reconstructed off-chain from transaction history, as the
// descent graph is, and the leaf inputs are published so that a third party can
// actually do it.
//
// SPARSE TREE — depth ${DEPTH}, ${2 ** DEPTH} slots
// Every record has a deterministic slot derived from its own commitment, so no
// assignment or registry is needed and an unwritten slot is clean by default.
//
// A RECORD IS CLEAN WHEN ITS SLOT HOLDS NOTHING THAT BINDS IT — not when the slot
// is empty. A slot is ${DEPTH} bits of a commitment, so another record's obligation can
// land in it, and requiring emptiness reported the second record as carrying an
// obligation it never incurred. That happens to two honest records on a collision,
// and it can be arranged deliberately: grinding a secret into a chosen slot costs
// about 2^${DEPTH} hashes, and a squatter who encumbers their own record there blocks
// somebody else's sale. The leaf names the record it binds, so a clean proof shows
// the occupant is somebody else.
//
// WHAT THAT DOES NOT FIX: the squatted record still cannot BE encumbered, because
// one slot holds one leaf. Closing that needs a bucket leaf or a tree indexed by
// the full commitment — a redesign rather than a check. verify-max-7.mjs runs the
// attack and pins the remainder.
//
// SOUNDNESS
// A new root is never supplied by the caller. It is derived in-circuit from the
// current root plus a Merkle path given as a private witness, and the path is bound
// to the record by its derived slot bits. A forged or borrowed path fails.
//
// WHAT THIS CANNOT DO
// A party can anchor material under a fresh secret and get a clean slot with no
// history. No circuit can prevent that: the contract cannot tell a genuinely new
// accession from a laundered one, because both look like a commitment nobody has
// seen before. So absence of a dirty ancestor is not evidence of a clean line, and
// a verifier who treats it that way is reading the wrong thing. What the contract
// can support is a POSITIVE check — a confirmed path from the record to an origin
// the verifier already recognises, with every node on it clean — and that is what
// a registry consuming this should require.
//
// BOUNDARY
// An edge takes both parties: the child offers and the named parent confirms under
// their own secret. A seller can still name any record as their mother; what they
// cannot do is make it stick, because that record has to agree. A verifier walks the
// confirmed edges in transaction history and requires a clean proof for every
// ancestor it finds — the walk is the verifier's, never the prover's, because a
// pedigree branches and a chain handed over by the party who benefits from it is
// missing whatever was inconvenient.
//
// WHAT AN EDGE STILL DOES NOT MEAN: that the child is biologically descended from
// the parent. It means both holders said so. Two colluding parties can agree to
// any edge they like, and the contract cannot tell breeding from agreement — that
// is what the DNA pairing in the provenance contract narrows and does not close.

pragma language_version 0.23;

import CompactStandardLibrary;

// Fixed single-slot fields. No growable container anywhere in this contract.
export ledger descentSeq: Counter;
export ledger lastDescent: Bytes<32>;

// The edge hash alone lets a verifier TEST a pair they already suspect. It does not
// let them ENUMERATE a record's parents, so the descent graph cannot be rebuilt from
// chain data and every clean-descent answer depends on the registry that watched the
// API calls. Child and parent go on chain so the graph is independently obtainable.
export ledger lastDescentChild: Bytes<32>;
export ledger lastDescentParent: Bytes<32>;

/**
 * Parentage proposed by a child and not yet accepted by the parent.
 *
 * AN EDGE USED TO BE UNILATERAL. declareParent asserted the caller held the CHILD's
 * preimage and took the parent on their word, so a seller whose real mother was
 * encumbered could declare descent from any clean record they liked. The edge it
 * produced was indistinguishable from a real one — same circuit, same cells, same
 * hash — so a verifier walking the graph was walking a graph the seller had
 * written. Omission was closed by making the verifier walk it; substitution was
 * not, because the thing being walked was still the prover's claim.
 *
 * Naming a parent is now an offer. The propose/countersign shape is the licence
 * transfer flow: one party asks, the other agrees, and until both have acted
 * nothing is established.
 *
 * Cleared on confirmation and on withdrawal, so it is bounded by open proposals
 * rather than by cumulative usage — the same bound licensing has, and the same
 * remedy: the party who created the entry is the one who can clear it.
 */
export ledger pendingParentOf: Map<Bytes<32>, Bytes<32>>;

// Proposals and withdrawals move this; confirmations move descentSeq. One counter
// per kind of event, because a reader rebuilding the graph counts edges and an
// offer is not an edge.
export ledger descentProposalSeq: Counter;

// Same for the obligation tree. An encumbrance published only its new root, so a
// third party saw a sequence of roots without the leaves that produced them: it could
// build no sibling path and could not tell which records were encumbered.
export ledger lastEncumberedRecord: Bytes<32>;
export ledger lastObligation: Bytes<32>;

// Who an encumbrance is in favour of. A third party rebuilding the tree needs it:
// the leaf is a function of the beneficiary, so without it no sibling path can be
// reconstructed and no discharge verified.
export ledger lastBeneficiary: Bytes<32>;
export ledger lastClearedAncestor: Bytes<32>;
export ledger encumberSeq: Counter;
export ledger cleanProofSeq: Counter;

// Who made a clean proof. Without it the circuit computed the caller's commitment
// and discarded it, so the proof restated public root state and named nobody.
export ledger lastCleanProofBy: Bytes<32>;
export ledger encumberedRoot: Bytes<32>;

/**
 * The ${RING - 1} roots before the current one.
 *
 * ONE GLOBAL ROOT MADE EVERY PROOF RACE EVERY OTHER TRANSACTION. encumber,
 * discharge and proveAncestorClean all asserted the single current root, so any
 * unrelated update landing between proving and inclusion invalidated every proof
 * in flight — and a party toggling an obligation on its own record each block
 * starved everyone else for the cost of the transactions.
 *
 * A reader collects one proof per generation and a busy registry moves the root
 * between them, so the failure was not a corner case. Writers still need the
 * current root, because two writers folding against different roots would produce
 * two incompatible trees; a READER only needs a root the chain published recently.
 *
 * WHAT IT COSTS, PLAINLY. A freshly attached obligation is not binding on a proof
 * that cites a root from before it. A seller who watches for an encumbrance and
 * submits a proof they prepared a moment earlier defeats it, and keeps defeating it
 * until ${RING - 1} further updates have pushed that root off the ring. The window
 * cuts both ways and this is the other edge of it.
 *
 * That is why lastProofRoot exists. A verifier deciding anything that matters
 * requires lastProofRoot == encumberedRoot and accepts that a busy or hostile
 * registry may make a proof take several attempts; one who does not care about the
 * last few updates takes the older root and cannot be starved. The contract
 * publishes what is needed to make that choice instead of making it for everyone.
 * verify-max-8.mjs runs both sides.
 */
${ringCells}

// Which root the last clean proof was folded against. Without it a verifier
// reading a proof cannot tell how stale the tree behind it was.
export ledger lastProofRoot: Bytes<32>;

/**
 * Set the obligation tree to its empty root.
 *
 * Without this the root starts at the default Bytes<32>, which is all zeros — and
 * all zeros is not the root of an empty tree, it is an unset cell. Every encumber
 * then fails "Slot is not clean" and every proveAncestorClean fails "This ancestor
 * carries an unmet obligation", because both compare a correctly folded root
 * against a value no fold can produce. The contract deployed dead.
 *
 * The suite did not catch it. The tree tests compare pure circuits against an empty
 * root computed off-chain, and nothing ran encumber against a freshly constructed
 * state. One harness did call proveAncestorClean on the initial state, got the
 * refusal, and reported it as expected — a test that saw the bug and called it
 * correct.
 *
 * The fold pairs the null leaf with itself at every level, which is what an empty
 * sparse tree is.
 */
constructor() {
  const nullLeaf = default<Bytes<32>>;
${emptyFold}
  encumberedRoot = e${DEPTH - 1};
  // The whole ring starts at the empty root for the same reason the current one
  // does: a default Bytes<32> is an unset cell, not a tree, and a reader accepting
  // it would accept a proof folded against nothing.
${ringInit}
  lastProofRoot = e${DEPTH - 1};
}

witness localGeneticSecret(): Bytes<32>;

/**
 * The secret behind an obligation's beneficiary.
 *
 * An obligation used to be a leaf the encumbered party could remove alone, which
 * made it a note-to-self rather than a claim: the holder of an encumbered record
 * discharged their own royalty and proved clean in the next call. The beneficiary
 * is now inside the leaf and discharge proves their secret, so the party who is
 * owed decides when they stop being owed.
 */
witness beneficiarySecret(): Bytes<32>;
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

/**
 * Whatever is sitting in the ancestor's slot, and what it is made of.
 *
 * SLOT SQUATTING. A slot is derived from the first ${DEPTH} bytes of a commitment, one
 * bit each, so finding a secret whose commitment lands in a chosen slot costs about
 * 2^${DEPTH} hashes — measured at 27.4 million in 81 seconds on one core. A squatter
 * grinds such a secret, encumbers THEIR OWN record, and the leaf lands in the
 * victim's slot. The victim's clean proof then failed, because it asserted the slot
 * held the null leaf, and the contract reported an obligation the victim had never
 * incurred. Two honest records colliding produced exactly the same false
 * encumbrance, and depth only changes the grinding cost.
 *
 * The leaf already names the record it binds. So a clean proof no longer requires
 * an EMPTY slot, it requires a slot holding nothing that binds THIS ancestor: the
 * null leaf, or a well-formed obligation against somebody else. The occupant's
 * three fields are witnesses so the fold can reproduce the real leaf; forging them
 * needs a hash collision, because the same bytes have to fold to the published root.
 *
 * NOT FIXED BY THIS: the victim still cannot BE encumbered, because encumber
 * asserts the slot is clean and one slot holds one leaf. That needs a bucket leaf
 * or an indexed tree keyed by the full commitment, and it is a redesign of the tree
 * rather than a check. verify-max-7.mjs runs the attack and pins that half.
 */
witness slotIsEmpty(): Boolean;
witness slotOccupantRecord(): Bytes<32>;
witness slotOccupantObligation(): Bytes<32>;
witness slotOccupantBeneficiary(): Bytes<32>;

export circuit commit(secret: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "veilcore:commit"), secret]);
}

export circuit descentEdge(child: Bytes<32>, parent: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>([pad(32, "veilcore:descent"), child, parent]);
}

/**
 * The leaf for an obligation on a record, naming who is owed.
 *
 * The beneficiary is inside the hash. Without it the leaf was a function of the
 * encumbered record and the obligation alone, so the encumbered party could
 * reconstruct it and discharge themselves — an obligation nobody but the obligated
 * could remove is not an obligation.
 */
export circuit obligationLeaf(
  recordCommitment: Bytes<32>,
  obligationCommitment: Bytes<32>,
  beneficiaryCommitment: Bytes<32>,
): Bytes<32> {
  return persistentHash<Vector<4, Bytes<32>>>([
    pad(32, "veilcore:obligation"), recordCommitment, obligationCommitment, beneficiaryCommitment,
  ]);
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

/**
 * Offer a parent. THE CHILD'S HOLDER ASKS; nothing is established yet.
 *
 * Replaces declareParent, which did the whole thing in one call on the child's word
 * alone. A proposal is visible — the map key is public — so a parent can see an
 * offer standing against them, and so can anyone else; an unconfirmed proposal is
 * exactly as good as the assertion it is, which is to say not evidence.
 *
 * ONE LIVE PROPOSAL PER CHILD. A cross has two parents, so declaring both is two
 * rounds rather than one: propose, confirm, propose, confirm. That is the same
 * serialisation proposeTransfer accepts for the same reason — replacing a standing
 * offer is a withdrawal followed by a new one, and both need the proposer.
 */
export circuit proposeParent(childCommitment: Bytes<32>, parentCommitment: Bytes<32>): [] {
  assert(childCommitment == commit(localGeneticSecret()),
         "Only the record holder can propose its parentage");
  const c = disclose(childCommitment);
  const p = disclose(parentCommitment);
  assert(c != p, "A record is not its own parent");
  assert(!pendingParentOf.member(c), "This record already has a parentage proposal outstanding");
  descentProposalSeq.increment(1);
  pendingParentOf.insert(c, p);
}

/**
 * Accept being named as a parent. ONLY THE PARENT'S HOLDER.
 *
 * This is the half that closes substitution. A seller can still NAME any record;
 * what they cannot do is make the naming stick, because the record they named has
 * to prove its own secret here. Pointing at a convenient clean stranger now needs
 * that stranger's cooperation.
 *
 * The parent confirms a SPECIFIC CHILD, and the stored proposal has to still name
 * them — the same reason approveTransfer takes expectedNewLicense rather than
 * approving whatever is pending at execution time. A child who withdraws and
 * re-proposes to somebody else between the parent's decision and their transaction
 * gets a refusal, not a confirmation the parent did not mean to give.
 *
 * WHAT THIS COSTS, and it is a real cost: a record whose parent has no holder — a
 * landrace, an accession from a collection that never joined, a breeder who has
 * gone — can never have that edge confirmed. Descent through such a record is not
 * expressible. That is the price of an edge meaning both parties agreed, and it is
 * why a registry should require a confirmed path to an origin IT recognises rather
 * than treating a sparse graph as a clean one.
 */
export circuit confirmParent(childCommitment: Bytes<32>, parentCommitment: Bytes<32>): [] {
  const c = disclose(childCommitment);
  const p = disclose(parentCommitment);
  assert(pendingParentOf.member(c), "No parentage proposed for that record");
  assert(parentCommitment == commit(localGeneticSecret()),
         "Only the named parent's holder can confirm an edge to it");
  assert(pendingParentOf.lookup(c) == p, "That is not the parent proposed for this record");

  pendingParentOf.remove(c);
  descentSeq.increment(1);
  lastDescent = descentEdge(c, p);
  lastDescentChild = c;
  lastDescentParent = p;
}

/** Retract a proposal. The proposer only, the same as withdrawTransfer. */
export circuit withdrawParent(childCommitment: Bytes<32>): [] {
  assert(childCommitment == commit(localGeneticSecret()),
         "Only the record holder can withdraw its own proposal");
  const c = disclose(childCommitment);
  assert(pendingParentOf.member(c), "No parentage proposed for that record");
  descentProposalSeq.increment(1);
  pendingParentOf.remove(c);
}

/**
 * Attach an obligation to a record, in favour of a named beneficiary.
 *
 * Called BY THE BENEFICIARY, not by the encumbered party. The holder of a record
 * has no reason to encumber it and every reason not to, so a circuit only they
 * could call made the whole mechanism voluntary. The beneficiary proves their own
 * secret here and again at discharge.
 *
 * Note what this does not establish: that the beneficiary is entitled to anything.
 * Anyone may encumber any record, and a verifier reads an encumbrance as "somebody
 * asserts a claim against this" rather than as a finding. The contract records the
 * assertion and who made it; whether it is owed is for the parties.
 */
export circuit encumber(recordCommitment: Bytes<32>, obligationCommitment: Bytes<32>): [] {
  const beneficiary = commit(beneficiarySecret());

  const siblings = merkleSiblings();
  const dirs = merkleDirections();
  const nullLeaf = default<Bytes<32>>;

  assertPathBelongsTo(recordCommitment, dirs);

  const rc = disclose(recordCommitment);
  const oc = disclose(obligationCommitment);
  const bc = disclose(beneficiary);
  const roots = replaceLeaf(nullLeaf, obligationLeaf(rc, oc, bc), siblings, dirs);

  assert(disclose(roots[0]) == encumberedRoot, "Slot is not clean, or the Merkle path is invalid");
  encumberSeq.increment(1);
  // A WRITER STILL NEEDS THE CURRENT ROOT — asserted above. Two writers folding
  // against different roots would each produce a valid-looking new root for a
  // different tree, and the second to land would silently drop the first's leaf.
  // Only readers get the ring.
${ringShift}
  encumberedRoot = disclose(roots[1]);
  lastEncumberedRecord = rc;
  lastObligation = oc;
  lastBeneficiary = bc;
}

/**
 * Clear an obligation. ONLY THE BENEFICIARY.
 *
 * This used to require the encumbered record's secret, which meant the party who
 * owed discharged the debt: encumber a record with a royalty, discharge it in the
 * next block, prove clean in the one after. The beneficiary's secret is what
 * releases it now, because being released is their decision.
 */
export circuit discharge(recordCommitment: Bytes<32>, obligationCommitment: Bytes<32>): [] {
  const beneficiary = commit(beneficiarySecret());

  const siblings = merkleSiblings();
  const dirs = merkleDirections();
  const rc = disclose(recordCommitment);
  const oc = disclose(obligationCommitment);

  assertPathBelongsTo(recordCommitment, dirs);

  const nullLeaf = default<Bytes<32>>;
  const bc = disclose(beneficiary);
  // The fold only reproduces the current root if the beneficiary in the leaf is the
  // one calling, so a stranger's discharge fails here rather than needing a
  // separate check.
  const roots = replaceLeaf(obligationLeaf(rc, oc, bc), nullLeaf, siblings, dirs);

  assert(disclose(roots[0]) == encumberedRoot, "No such obligation at this slot, or the Merkle path is invalid");
  encumberSeq.increment(1);
${ringShift}
  encumberedRoot = disclose(roots[1]);
  lastEncumberedRecord = rc;
  lastObligation = oc;
  lastBeneficiary = bc;
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
// the descent edges confirmed through proposeParent/confirmParent, and check that
// each parent in the chain has a clean proof naming it. That division is deliberate
// and it is what the file header describes.
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
/**
 * Is this a root the chain published recently?
 *
 * A reader's proof is built, then included some blocks later. Against a single
 * global root any unrelated encumbrance in between invalidated it, so a verifier
 * collecting one proof per generation on a busy registry could be starved
 * indefinitely — deliberately, by anyone willing to pay for a transaction a block.
 */
// The argument must already be disclosed by the caller. The root of a valid path is a
// value the chain published, so disclosing it gives nothing away — and comparing a
// witness-derived value against ledger cells is a disclosure the compiler is right
// to refuse until it is declared.
export circuit rootIsRecent(folded: Bytes<32>): Boolean {
  // Declared here as well as at the call site: a parameter of an exported circuit
  // is witness-derived as far as the compiler is concerned, whatever the caller did
  // with it, and comparing it against a ledger cell is a disclosure either way.
  const f = disclose(folded);
  return f == encumberedRoot
${ringAccept};
}

export circuit proveAncestorClean(): [] {
  const self = commit(localGeneticSecret());
  const nullLeaf = default<Bytes<32>>;

  const siblings = merkleSiblings();
  const dirs = merkleDirections();
  const chain = ancestryChain();

  const ancestor = disclose(chain[0]);
  // The proof is bound to the caller. The value was computed and never used, so the
  // circuit proved a fact about public root state that anyone could prove about
  // anybody — a clean proof with no claimant is a statement nobody made.
  assert(self != ancestor, "A record is not its own ancestor");
  lastCleanProofBy = disclose(self);
  assertPathBelongsTo(ancestor, dirs);

  // WHAT IS ACTUALLY IN THE SLOT. One extra hash, and still one fold: the leaf is
  // either the null leaf or an obligation binding a DIFFERENT record, which says
  // nothing about this ancestor. Lying about which costs a hash collision — the
  // bytes chosen here have to fold to a root the chain published.
  const empty = disclose(slotIsEmpty());
  const occRecord = slotOccupantRecord();
  const occupant = empty
    ? nullLeaf
    : obligationLeaf(occRecord, slotOccupantObligation(), slotOccupantBeneficiary());
  // A leaf that names the ancestor IS this ancestor's obligation, so it is refused
  // here rather than by the fold.
  assert(empty || disclose(occRecord != ancestor),
         "This ancestor carries an unmet obligation");

  const folded = disclose(merkleRoot(occupant, siblings, dirs));
  assert(rootIsRecent(folded), "This ancestor carries an unmet obligation");

  // Which root this proof was folded against, so a verifier can see how stale it is.
  lastProofRoot = folded;
  cleanProofSeq.increment(1);
  // Its own slot, because lastDescent holds edge hashes and the two are
  // indistinguishable as bytes. One field with two meanings is a field a reader
  // cannot use.
  lastClearedAncestor = ancestor;
}
`;

fs.writeFileSync(OUT, src);
console.log(`generated ${OUT} at depth ${DEPTH} (${2 ** DEPTH} slots)`);
