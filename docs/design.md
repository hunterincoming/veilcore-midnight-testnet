# VeilCore — Technical Design

**Provenance and heritable rights for plant genetics on Midnight**
Last updated 10 August 2026

---

## The problem

Every intellectual property registry records **objects**. A patent, a work, a
registered variety — a thing that exists once and stays put.

Biological IP is not an object. A cutting becomes a mother plant becomes ten thousand
clones, and every one of them carries a claim from upstream. A licence agreement binds
the parties who signed it; it cannot bind a plant that does not exist yet.

That gap is why cannabis genetics have no working IP system. High-THC cultivars are
excluded from US plant variety protection entirely. Where protection does exist — the
EU's Essentially Derived Varieties doctrine, for instance — proving that one variety
descends from another is the hard part, and there is no infrastructure for it.

VeilCore records two things:

1. **Who held a cultivar, and when** — without anyone disclosing the genetics.
2. **What obligations descend with it** — provable without disclosing the ancestry.

The second is the part nothing else does.

---

## Constraints that shaped the design

**Zero custody.** The system never receives genetic material or sequence data. Records
are hashed client-side; only commitments reach the network. This is not a privacy
feature bolted on — it is why breeders will use it. The last attempt at a cannabis
genetics registry failed because it required physical samples.

**Bounded ledger state.** Midnight's deployment rubric scores contracts on
state-space risk, and a Tier 3 score blocks deployment outright. Tier 3 is
*"unbounded growth, cheap interactions, no cleanup"* — which is exactly what a naive
registry looks like.

**Browser-viable proving.** A prover key that a browser cannot load is a prover key
nobody uses.

---

## Contract 1 — Provenance

`contract/src/veilcore.compact` · deployed to Preview at
`dc18e54d2f8031dda0eca1970bb1b1639c1686a14303fe057bb46f07bd0a233b`

### Ledger state

```
anchorSeq           Counter
lastAnchor          Bytes<32>     // proven anchors only
proofSeq            Counter
batchSeq            Counter
lastBatchRoot       Bytes<32>     // unauthenticated, see below
transferSeq         Counter
lastOwnershipProof  Bytes<32>
lastPairedRecord    Bytes<32>
lastRotatedFrom     Bytes<32>
lastRotatedTo       Bytes<32>
activeLicenseRoot   Bytes<32>     // root of the active-licence tree
licenseStatusOf     Map<Bytes<32>, LicenseState>   // live licences only
licenseRecordOf     Map<Bytes<32>, Bytes<32>>      // live licences only
pendingTransferOf   Map<Bytes<32>, Bytes<32>>      // cleared on approve/withdraw
rotatedTo           Map<Bytes<32>, Bytes<32>>      // set-once, never cleared
recoveryOf          Map<Bytes<32>, Bytes<32>>      // one per anchored record
```

Eleven fixed slots, three maps cleared by the circuit that filled them, and two that
grow permanently.

**A value a verifier needs has to be written to a ledger cell.** Returning it from a
circuit does not publish it: the return travels in the call's communication commitment,
which is blinded, so it reaches the caller's own DApp and nobody reading the chain. An
earlier revision returned the ownership proof, the paired record and the old side of a
rotation and described that as publishing them. The four `last*` cells above are what
actually reaches a third party.

**`lastAnchor` holds proven anchors only.** `anchor` proves the preimage of what it
writes there; `rotateRecordSecret` and `pairDna` do not, so they write their own cells.
A reader treating one cell's history as dated possession would otherwise collect claims
nobody established.

**`rotatedTo` and `recoveryOf` are unbounded by design.** One entry per rotation and one
per anchored record, never cleared. That is the price of the two guarantees they carry —
that a retired secret stops working, and that a lost secret is not final — and neither
can be kept without remembering something.

### Why anchoring stores nothing

The first version kept every anchor in `Map<Bytes<32>, Field>` keyed by commitment,
plus a second map for DNA bindings. That is unbounded growth with no cleanup path —
Tier 3, and blocked.

The fix follows the pattern in `midnightzk-anchor.md`, which passed review on the same
basis: **the commitment lives in the transaction, and the chain already retains
transaction history.** Nothing on-chain ever read the map back. Existence is resolved
by querying transaction history through the indexer, which is where a verifier looks
anyway.

So `anchor` asserts the caller holds the preimage, discloses the commitment, bumps a
counter, and writes one slot. A million records add nothing beyond those three fields.

`proveOwnership` does not check membership in a map. It emits a dated transaction
disclosing a commitment only the preimage-holder could produce. A verifier compares it
to the earlier anchor transaction carrying the same commitment; **the interval between
the two is the evidence.**

### Licensing

Licences are genuinely stateful — countersigning has to know a licence is pending — so
they keep a map. But `revokeLicense` **removes** both entries rather than marking a
status. State is bounded by open agreements rather than by cumulative usage, and
clearing is initiated by the party who created the entry.

**Known limitation.** A licence issued and countersigned but never revoked stays
indefinitely. Terms carry dates off-chain, but the contract has no notion of expiry, so
time alone does not clear an entry. This keeps the profile at Tier 2 rather than Tier 1.
The mitigation is an on-chain expiry field permitting a permissionless sweep.

**A licence commitment is bound to its issuing record.** `licenseCommit(secret, record)`
puts the record inside the hash, so the same secret under a different issuer is a
different licence. Without that binding a sniper who read a pending `issueLicense` out
of the transcript could register the commitment first under their own record, and the
licensee's countersignature would land on the sniper's entry.

**Presentation goes through a tree, not a map.** `proveLicense` takes no arguments at
all: the licence secret, the record and the path are private witnesses, and the only
public statement is that some leaf of `activeLicenseRoot` was opened by someone who
knows what is behind it. A map lookup would put its key in the transcript, and
`licenseRecordOf` maps that key straight to the breeder — so every presentation named
the issuer and repeated presentations linked to each other.

The tree holds the **ACTIVE** set: `countersignLicense` inserts, `revokeLicense` removes,
`approveTransfer` replaces the outgoing leaf with the incoming one in the same slot. A
pending licence was never inserted and a revoked one has no leaf to open. Capacity is
**65,536 concurrent** active licences — a structural ceiling rather than an economic
one, and the only one in either contract. Positions are assigned rather than derived
from the commitment, so there is no birthday bound and no grinding target.

### Verified on chain

All six circuits exercised on Preview, 10 August 2026: anchor (`anchorSeq` 0→1,
`lastAnchor` set), prove prior possession (`proofSeq` 0→1, commitment unchanged), issue
(PENDING), countersign (ACTIVE), prove, revoke — then a proof attempt against the
revoked licence correctly failed with *"No such license"*, confirming the entry was
cleared rather than flagged.

---

## Contract 2 — Lineage

`contract/src/lineage.compact` · generated by `gen-lineage.mjs` at depth 24

Sits **above** the record commitments in the provenance contract and references them by
hash. It does not fork or replace that contract, which means it can be adopted or
ignored independently.

### Ledger state

```
descentSeq            Counter
lastDescent           Bytes<32>    // edge hash
lastDescentChild      Bytes<32>
lastDescentParent     Bytes<32>
encumberSeq           Counter
lastEncumberedRecord  Bytes<32>
lastObligation        Bytes<32>
lastBeneficiary       Bytes<32>
cleanProofSeq         Counter
lastClearedAncestor   Bytes<32>
lastCleanProofBy      Bytes<32>
encumberedRoot        Bytes<32>    // current
recentRoot1..7        Bytes<32>    // the seven before it
lastProofRoot         Bytes<32>    // which root the last clean proof used
```

Twenty fixed slots. No growable container anywhere.

**The leaf inputs are on chain because otherwise nobody can rebuild the tree.** An
encumbrance that published only its new root left a third party watching a sequence of
roots without the leaves that produced them: it could build no sibling path and could
not tell which records were encumbered, so every clean-descent answer depended on the
registry that happened to watch the API calls. Child and parent are published for the
same reason — an edge hash lets a verifier *test* a pair they already suspect, but not
*enumerate* a record's parents.

`contract/verify-max-3.mjs` is the proof that this is enough: it builds an outsider that
sees only these cells, and rebuilds both structures from them.

### Descent edges are transactions, not state

`declareParent` asserts the caller holds the child's preimage, then discloses
`descentEdge(child, parent)` into the transaction. The graph is reconstructed off-chain
from those transactions — public, permanent, and costing no ledger growth.

### Obligations: a sparse Merkle tree

Obligations live in a depth-24 sparse Merkle tree — **16,777,216 slots** — represented
on-chain only by its root.

**Slot derivation.** A record's position is derived from its own commitment: one byte
per level, high bit taken. Hash output is uniform, so slots distribute evenly (measured:
200 records, 200 distinct slots at depth 24). No assignment, no registry, and **an
untouched slot is clean by default** — which is what lets a brand-new record prove clean
immediately.

**A record is clean when its slot holds nothing that binds it** — not when the slot is
empty. Encumbering writes `obligationLeaf(record, obligation, beneficiary)`; discharging
writes null back. A slot is 24 bits of a commitment, so another record's obligation can
land in it, and requiring emptiness reported the second record as carrying an obligation
it never incurred. That happens to two honest records on a collision, and it can be
arranged: grinding a secret into a chosen slot costs about 2^24 hashes — 27.4 million,
81 seconds on one core — and a squatter who encumbers their own record there blocks
somebody else's sale. The leaf names the record it binds, so `proveAncestorClean` shows
the occupant is somebody else.

**The beneficiary is inside the leaf, and `discharge` proves their secret.** An
obligation the encumbered party could reconstruct was one they could remove: encumber a
record with a royalty, discharge it in the next block, prove clean in the one after. The
party who is owed decides when they stop being owed. `encumber` is likewise called by
the beneficiary — a holder has no reason to encumber their own record and every reason
not to, so a circuit only they could call made the whole mechanism voluntary.

An encumbrance is *somebody asserting a claim*, not a finding. Anyone may encumber any
record; whether it is owed is for the parties.

**Soundness — the caller never supplies a root.** The new root is derived in-circuit
from the current root plus a Merkle path given as a private witness. A forged path
fails to reproduce the root already on chain, so nobody can rewrite the accumulator to
erase what they owe.

An earlier draft took `newRoot` as a parameter and assigned it directly. It compiled
and it was worse than the map version — anyone could have called it with a root that
excluded every obligation they held. Compiling is not correctness.

**Path binding.** A path's direction bits *are* its slot position. `assertPathBelongsTo`
checks the supplied directions against the bits derived from the commitment, which is
what stops a prover borrowing the path of some unrelated clean slot — a claim whose
Merkle proof would otherwise verify perfectly.

**One traversal, not two.** `replaceLeaf` verifies the old leaf and computes the new
root in a single pass. The siblings are identical for both, so folding twice doubles the
constraint count for no benefit.

---

## Why one Merkle path per circuit

The first clean-descent circuit proved five paths at once — the record plus four
generations. It worked, and its prover key was **146MB.**

For scale: NIGHTGATE's entire WASM runtime is 1.4MB. A browser would have to download
146MB before generating a single proof.

Measured cost against depth:

| Design | Depth 4 | Depth 8 | Depth 12 | Depth 16 |
|---|---|---|---|---|
| Five paths in one circuit | 37MB | 73MB | 146MB | 146MB |
| **One path per circuit** | **10MB** | **19MB** | — | **37MB** |

Splitting it gives **65,536 slots at a quarter of the cost of the depth-4 bundled
version.** A verifier collects one proof per generation instead of one proof for all of
them.

The table above is the measurement that settled the design; the deployed depth is now
24, which the review measured at the same prover-key bucket as 16 (76.6MB against
76.5MB) — so the extra capacity cost nothing. Depth 32 is the next bucket at 152.5MB,
and a key that size has been observed to exceed wasm's memory space, which would put
encumbrance behind a self-hosted proof server.

The sizes step in powers of two, which is characteristic of circuits sized as 2^k — so
shaving constraints only helps when it crosses a boundary. Worth knowing before
optimising further.

`persistentHash` is the only hash primitive available; NIGHTGATE uses it too, and fixed
its own tree at depth 4 for the same reason. Depth is a generator parameter here rather
than hand-written levels, so it can grow without redesign.

---

## Two mechanisms, both necessary

A clean-descent claim needs two independent things to be true, and neither mechanism
covers the other.

**The Merkle proof** shows a claimed ancestor's slot holds nothing that binds it — it
carries no unmet obligation of its own.

**The descent graph** shows the claimed ancestor is the real one.

Without the graph, a seller blocked by an obligation on their mother plant could simply
name a clean unrelated record as their parent. **The Merkle proof for that record would
verify perfectly.** Only the declared edges — public in transaction history — catch it.

The graph also catches omission — but **the verifier walks it, the prover does not
supply it.** Taking a chain from the party who benefits from it means trusting them to
have included the inconvenient part, and a pedigree branches: a cross has a seed parent
and a pollen parent, so "the chain" is not a single thing a prover could hand over even
honestly. `verifyDescent(record, provenClean)` takes only the set of commitments the
verifier holds clean proofs for, walks every declared edge upstream, and requires each
one to be covered.

An earlier design compared the claimed chain's *length* against a transitive ancestor
count. That could not work on any branching pedigree, and nothing ever called it.

---

## Rules for a registry consuming this

These are not style preferences. Each one is a way the contract can be read wrongly by
somebody who has done everything else right, and each is demonstrated in a script under
`contract/verify-max-*.mjs`.

### 1. Require `lastProofRoot == encumberedRoot` when the answer decides money

`proveAncestorClean` accepts the current root **or any of the seven before it**. That
ring is what stops a reader being starved: against a single global root, any unrelated
encumbrance landing between proving and inclusion killed the proof, and a party toggling
an obligation on their own record once a block could deny everyone else indefinitely for
the price of the transactions.

**The window cuts both ways.** A freshly attached obligation is not binding on a proof
citing a root from before it. A seller who watches for an encumbrance and submits a
proof they prepared a moment earlier defeats it, and keeps defeating it until seven
further updates have pushed that root off the ring.

So the contract publishes `lastProofRoot` — the root the proof actually folded against —
and the choice is the registry's:

| If you are | Require | You accept |
|---|---|---|
| Settling a sale, releasing funds, issuing a certificate | `lastProofRoot == encumberedRoot` | The proof may need resubmitting on a busy or hostile registry |
| Showing a status indicator, pre-screening, populating a UI | any recent root | An obligation from the last seven updates may not show yet |

A registry that never reads `lastProofRoot` has the second behaviour whether it meant to
or not. `contract/verify-max-8.mjs` runs both sides: sections 1–5 show the starvation
closed, section 6 shows the seller defeating a fresh encumbrance and the published value
that catches it.

### 2. Rebuild from archival history, not from current state

Every cell is a single slot holding its latest value. "Single cells are enough; history
keeps them" is true, and the second half is doing the work — a verifier with only a state
query sees one encumbrance and one edge and can rebuild nothing. Reconstructing the tree
and the graph needs a per-transaction indexer. `verify-max-3.mjs` §7 demonstrates the
difference.

The operation is not published: `encumber` and `discharge` write byte-identical cells
and both bump `encumberSeq`. It does not need to be. The tree state settles it — a slot
holding the null leaf can only have been encumbered, and one holding exactly
`obligationLeaf(rc, oc, bc)` can only have been discharged.

### 3. Make the check positive, not the absence of a negative

A party can anchor material under a fresh secret and get a clean slot with no history.
**No circuit can prevent that**, because the contract cannot tell a genuinely new
accession from a laundered one — both look like a commitment nobody has seen before.

So absence of a declared dirty ancestor is not evidence of a clean line. What a registry
should require is a **confirmed path from the record to an origin it already
recognises**, with every node on it clean. That is a policy decision the contract
supports and cannot make.

### 4. A record that cannot be encumbered may be squatted

The false-encumbrance half of slot squatting is closed — a victim sharing a slot with a
stranger's obligation proves clean. The denial half is not: one slot holds one leaf, so
a genuine beneficiary cannot attach a claim to a record a squatter is sitting on, and
`encumber` fails with *"Slot is not clean, or the Merkle path is invalid"*.

A registry seeing that error on a record whose slot is occupied by a **different**
record should report a squatted slot, not a pre-existing obligation. Closing it properly
needs a bucket leaf or a tree indexed by the full commitment — a redesign of the tree
rather than a check. `verify-max-7.mjs` runs the grind and pins the remainder.

### 5. Licence presentation is unlinkable; the licence set is not

`proveLicense` names nothing, and two presentations are byte-identical. But the tree is
public: anyone replaying the chain knows the active set and who issued each entry. What
they cannot do is tie a *presentation* to a member of that set. Unlinkable is also not
invisible — the transaction exists, and its timing is a channel against a holder who is
the only party likely to be presenting at a given moment.

### 6. Parentage is still declared unilaterally

`declareParent` asserts the caller holds the **child's** preimage and takes the parent
on their word. Omission is caught by `verifyDescent` walking the graph; **substitution is
not.** A child naming a parent that never agreed produces an edge that looks exactly like
a real one. The fix is a propose/countersign pair shaped like the licence flow, and it
is not built. `verify-max-4.mjs` states this in its header rather than claiming L3
closed, which an earlier version of that file did.

---

## What is proven and what is assumed

Being precise about this matters more than the feature list.

**Proven cryptographically**
- The record existed, unaltered, at the anchor transaction's timestamp
- The claimant holds the preimage behind the commitment
- A named record's slot holds nothing that binds it — against a root the chain
  published within the last eight updates, named in `lastProofRoot`
- The accumulator was not rewritten — every root derives from the previous one
- The holder of a live licence knows the secret behind it, without naming which one

**Established by public record**
- Which parent links were declared, and when
- Which records carry obligations, in whose favour, and which were discharged
- Who made each clean proof, and about which ancestor

**Assumed, and worth stating plainly**
- **The record's contents are the claimant's assertion.** The system proves *when* a
  claim was made and that it has not changed. It does not prove the cultivar is what
  they say it is. The DNA report binding narrows this; it does not close it.
- **Participation is voluntary.** Someone who never logs their offspring is not in the
  graph at all, so a clean-descent proof cannot catch them. This is a **market-access
  filter, not enforcement** — the record has value at the point of legitimate transfer,
  where a buyer demands one.
- **A squatted record cannot be encumbered.** Depth prices the grind and does not stop
  it — depth 32 is about 4.3 billion hashes, minutes on a GPU — so this is not fixed by
  the generator parameter. See rule 4 above.
- **Parentage is declared unilaterally.** See rule 6 above.
- **A clean proof may be up to seven updates stale.** See rule 1 above.

---

## Off-chain components

**`contract/src/tree.mjs`** — maintains the obligation tree and produces sibling paths.
Uses the contract's own exported circuits for every hash, so there is one implementation
rather than two that must agree. That agreement is the usual source of "the proof fails
and nobody knows why."

Parameterised by the build: `obligationTreeFor(circuits)` binds it to any compiled
artifact, so the shallow build used to run the squatting attack for real is exercised by
the same code the production depth uses.

**`contract/src/descent.mjs`** — reconstructs the descent graph from declared edges.
`verifyDescent(record, provenClean)` walks it; `verifyChain` checks a single stated line
and does **not** catch omission, which its own comment says.

**`contract/src/license-tree.mjs`** — maintains the active-licence tree and produces the
paths for countersign, revoke, assign and present. Plan-then-apply: a path is built
before the call that uses it and the local tree moves forward only once the chain has
accepted, because a mutate-on-build API desynchronises from the chain on every refused
call and every path after that is wrong.

Its depth comes from `managed/veilcore/compiler/contract-info.json` — the build's own
record of the argument types. `lineage.compact` can be asked its depth directly, since
`slotBits` returns one bit per level, but nothing in `veilcore.compact` returns a vector
sized by the tree and a circuit existing only to be measured would be an interface
describing behaviour the contract does not have.

**`veilcore-api/lineage/`** — the same modules running server-side, rebuilt from the
database on boot. The tree is shared state: one holder's obligation must be visible to
everyone checking descent, so a per-browser copy would be meaningless.

---

## Test coverage

`npm test` runs `test-*.mjs`, `*-checks.mjs` and `verify-max-*.mjs`. Three kinds of
file, and the difference matters when reading the output:

| Kind | Exits non-zero on failure | Purpose |
|---|---|---|
| `test-*.mjs` | yes | Behaviour that must not regress |
| `verify-max-*.mjs` | yes | One review finding each, demonstrated failing |
| `*-checks.mjs` | **no** | Standing findings reports — they print `FAIL` for defects that are known, accepted and documented, so they must not gate the build |

`audit-checks.mjs` prints two `FAIL` lines on every green run. Both are deliberate: a
party with a self-chosen secret can grow the licence maps (the bound is economic, not
structural, and the contract header says so), and `anchorBatch` is unauthenticated by
design so `lastBatchRoot` is a scratch slot rather than evidence.

`verify-max-7.mjs` and `verify-max-8.mjs` print `PIN` lines for consequences that are
understood, bounded and deliberately not fixed — kept separate from `FAIL` so a pin
cannot be mistaken for a regression.

| Suite | What it establishes |
|---|---|
| `test-merkle.mjs` | The fold is deterministic and matches manual iteration |
| `test-slots.mjs` | Slot derivation is deterministic and evenly distributed |
| `test-lifecycle.mjs` | Encumber, discharge and clean-descent state transitions |
| `test-tree.mjs` | The builder agrees with the circuit under multi-leaf conditions |
| `test-generations.mjs` | Obligations reach descendants four generations down |
| `test-descent.mjs` | Spoofed ancestry and truncated chains are rejected |
| `test-contract.mjs` | The provenance flows, then the same flows driven by an attacker |
| `test-license.mjs`, `test-license-state.mjs` | Licence commitment binding and lifecycle |
| `verify-max-1-2.mjs` | The tree deploys live; values a verifier needs are on chain |
| `verify-max-3.mjs` | An outsider rebuilds tree and graph from ledger cells alone |
| `verify-max-4.mjs` | Obligations and descent are not opt-in for the party they bind |
| `verify-max-5.mjs` | Rotation retires the old secret; recovery survives a lost one |
| `verify-max-6.mjs` | Front-run, resurrection and sublicence no longer work |
| `verify-max-7.mjs` | Slot squatting, ground for real against a shallow build |
| `verify-max-8.mjs` | Proofs survive unrelated updates, and what that costs |
| `verify-max-9.mjs` | A licence presentation names nothing and two do not link |

**Three ways a test can be worse than no test, all of which were in this suite.**

A test that **cannot fail**: `test-merkle.mjs`, `test-lifecycle.mjs` and
`test-slots.mjs` printed `PASS`/`FAIL` and exited 0 either way, so a broken fold logged
`FAIL` and the suite went green over it.

A test that **asks a different question from its name**: two checks named "does this
publish the commitment?" asserted on the circuit's return value, which is exactly the
thing finding 2 established is *not* published. Both passed while the question in their
own name was answered no.

A test that **matches nothing**: the first version of the finding 9 transcript check
searched the serialised JSON for a hex commitment. The runtime serialises byte strings
as `{"0":84,"1":91,…}`, so it would have reported a clean transcript whatever the
circuit published. It now extracts values as bytes and carries a positive control that
fails if the scanner stops seeing a commitment that really is there.

**And two bugs were found only by tests that were harder than necessary.**

`subtreeRoot` folded each contained leaf and kept the last one — correct for a single
leaf, silently wrong for two. The single-leaf test passed. Only a three-obligation test
exposed it.

`nullNodes` was one entry short: it held siblings for levels 0–15 but `root()` asks for
level 16. Nothing caught it until the tree had to compute its own root.

Both are the same lesson. **A test that only exercises the easy case will pass on
broken code.**

---

## Repository layout

```
contract/
  src/veilcore.compact       provenance — anchor, prove, licence lifecycle
  src/lineage.compact        heritable rights (generated, depth 24)
  src/lineage-shallow.compact  depth 8, generated; used only by verify-max-7
  gen-lineage.mjs            generator; depth and output path are parameters
  src/tree.mjs               off-chain obligation tree
  src/license-tree.mjs       off-chain active-licence tree
  src/descent.mjs            descent graph and descent verification
  src/witnesses.ts           private state and witness providers for both contracts
  test-*.mjs                 behaviour that must not regress
  verify-max-*.mjs           one review finding each, demonstrated
  *-checks.mjs               standing findings reports (always exit 0)
api/
  src/veilcore-api.ts        provenance circuits
  src/lineage-api.ts         lineage circuits and descent verification
bboard-ui/                   the breeder-facing application
bboard-cli/                  developer CLI, used to deploy and exercise on Preview
```

Separately: **`veilcore-api`** — the record store and lineage service, deployed to
Railway with a persistent volume.

---

## Build

`managed/` is gitignored, so a fresh clone has no compiled contract.

```bash
# Compact toolchain
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update

cd contract && npm run compact   # both contracts, plus the shallow build
cd contract && npm run build     # then api, then bboard-ui — order matters
```

Regenerate lineage at a different depth:

```bash
cd contract && node gen-lineage.mjs 20 && npm run compact
```

Nothing downstream hardcodes the depth: `tree.mjs` reads it from `slotBits`,
`license-tree.mjs` from the build's `contract-info.json`, and the tests from the same.
A hardcoded 16 sitting beside a contract regenerated at 24 is a silent break — the
client supplies sixteen siblings, the circuit expects twenty-four, and every call fails
after proving and after paying.
