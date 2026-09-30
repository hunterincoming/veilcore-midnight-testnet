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
`f75d42dc1e4ec5a2cdcc50509f2d432ad60fb5c64b5da921a0ec22a0e287f939`

### Ledger state

```
anchorSeq, proofSeq, batchSeq, transferSeq,
pairSeq, rotationSeq, presentationSeq          Counter
lastAnchor            Bytes<32>   // proven anchors only
lastBatchRoot         Bytes<32>   // unauthenticated, see below
lastOwnershipProof    Bytes<32>
lastPairedRecord      Bytes<32>
lastPairedDna         Bytes<32>
lastRotatedFrom       Bytes<32>
lastRotatedTo         Bytes<32>
lastRecoveredOrigin   Bytes<32>
lastPresentation      Bytes<32>   // presentationTag(record, challenge)
lastActivatedLicense  Bytes<32>
lastActivatedRecord   Bytes<32>
licenseStatusOf     Map<Bytes<32>, LicenseState>   // key = licenseKey(licence, issuer); live only
pendingTransferOf   Map<Bytes<32>, Bytes<32>>      // key = licenseKey; cleared on approve/withdraw/revoke
activeLicenses      HistoricMerkleTree<24, Bytes<32>>  // leaves = licenseKey of ACTIVE licences
licenseSlotOf       Map<Bytes<32>, Uint<64>>       // licenseKey -> leaf index; live only
licenseAtSlot       Map<Uint<64>, Bytes<32>>       // leaf index -> licenseKey; live only
rotatedTo           Map<Bytes<32>, Bytes<32>>      // rotation history: retired -> next
originOf            Map<Bytes<32>, Bytes<32>>      // successor -> origin
headOf              Map<Bytes<32>, Bytes<32>>      // moved origin -> current head (liveness)
recoveryOf          Map<Bytes<32>, Bytes<32>>      // origin -> recovery commitment
```

Fixed slots, licence maps cleared by the circuits that filled them, the ledger's own
Merkle tree for active licences, and four identity maps that grow by one entry per
anchor, rotation or recovery.

**A value a verifier needs has to be written to a ledger cell.** Returning it from a
circuit does not publish it: the return travels in the call's communication commitment,
which is blinded, so it reaches the caller's own DApp and nobody reading the chain. An
earlier revision returned the ownership proof, the paired record and the old side of a
rotation and described that as publishing them. The four `last*` cells above are what
actually reaches a third party.

**`lastAnchor` holds proven anchors only.** `anchor` proves the preimage of what it
writes there; `rotateRecordSecret` and `pairDna` do not, so they write their own cells
(`pairDna` wrote the DNA side into `lastAnchor` until 30 Sep 2026).
A reader treating one cell's history as dated possession would otherwise collect claims
nobody established.

**The identity maps are unbounded by design.** One entry per anchored record and a few
per rotation or recovery, never cleared. That is the price of the guarantees they carry —
that a retired secret stops working, and that a lost or stolen secret is not final.

### Identity: origins, heads and recovery (security pass, 30 Sep 2026)

Every circuit that acts for a record **derives the caller's record from their secret**
and requires it to be live. None takes the caller's record as an argument.

A record is an **origin** (anchored, nobody rotated into it) or a **successor**. Rotation
and recovery write `originOf(successor) = origin` and `headOf(origin) = successor`.
**A record is live only if it is its identity's current head** (`headOf`), and only an
anchored identity can rotate.
Authority over a licence is decided by comparing **origins**, so it survives any number
of rotations. The previous one-hop check (`rotatedTo(issuer) == me`) meant that after a
second rotation nobody could ever revoke a licence the first record issued, and after
one rotation no transfer of an earlier licence could be approved.

A rotation or recovery target must have no history: not retired, not a successor, not
anchored, not an origin with rotations. Anything else would overwrite an origin and
orphan the licences under it.

**Recovery is the master key.** `recoverRecordSecret(origin, new)` works whether or not
the identity has been rotated since, and retires whatever the current head is. It used
to require the record to be live, so a thief holding the primary secret could rotate
first and keep the record for good. It also **writes the new head without reading the
old one**: an intermediate version read the head, so a thief who rotated again before
the recovery landed made it fail, every time (found by the independent review). The recovery commitment sits on the origin, so a
rotation no longer drops it, and `replaceRecoveryCommitment` (gated by the current
recovery secret) replaces a recovery secret that may have leaked. Recovery commitments
use their own domain tag (`veilcore:recover`); sharing the record tag made every
recovery commitment a valid record as well.

What this does not do: a party holding the **recovery** secret controls the record
outright. There is no waiting period in which the primary secret can object. That is
the chosen trade: recovery beats theft of the primary, so the recovery secret belongs
offline.

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
different licence.

**Licence entries are keyed by `licenseKey(licence, issuer)`.** Binding the commitment
stopped a sniper *capturing* a licence but not *blocking* one: `issueLicense` cannot check
that a commitment was built against the caller's record, so a sniper who read a pending
issue could insert the same commitment under their own record first and the breeder's
call failed with "already exists". With the issuer in the key the sniper's entry is a
different entry. It can never be activated, since activation needs a secret whose
licence commitment under the sniper's record is that value.

**Licence secrets are witnesses.** `countersignLicense`, `proposeTransfer` and
`withdrawTransfer` read `licenseSecret()` instead of taking the secret as an argument.

**Presentation goes through a tree, not a map, and is bound to a challenge.**
`proveLicense` takes no arguments: the licence secret, the record, the path and the
verifier's challenge are witnesses. It publishes one value,
`presentationTag(record, challenge)`. The verifier chose the challenge and knows which
record they asked about, so they recompute the tag and find it in the transaction; to
anyone else it is random and links to nothing.

Before 30 Sep 2026 the only public statement was that *some* leaf of the global tree had
been opened. That named no record, so a licence for one variety passed a check about
another, and it bound no challenge, so every successful presentation was byte-identical
and anyone could point a verifier at somebody else's. **The challenge must be 32 random
bytes, chosen by the verifier, used once and never published.** A public or reused
challenge lets anyone test every issuing record against the tag.

**The tree is the ledger's own `HistoricMerkleTree`, and its leaves are licence KEYS.**
`countersignLicense` places `licenseKey(lc, issuer)` at a free index the client picks
at random (a shared next-index counter let only one activation land per block, which
anyone with DUST could exploit to block everyone else's);
`revokeLicense` clears it; `approveTransfer` replaces it in place. The ledger does the
placing, so **writers supply no path** and a revocation cannot be starved by other tree
traffic. A presentation proves a path against any root since the last revocation or
transfer (`resetHistory`), so new activations do not invalidate it, but a revocation
takes effect at once. The path witness reads the ledger at proving time
(`findPathForLeaf`), so clients keep no tree of their own.

Two things the independent review found in the hand-rolled tree this replaced: **a
transfer could forge a licence from another issuer**, because the leaf was the bare
licence commitment and nothing bound a transfer target to its issuer; and **the same
commitment could sit in the tree twice**, so one issuer's revocation left the other copy
presentable. With the key as the leaf, a leaf names its issuer and appears at most once.
It also found that a licensee could keep a revocation from ever landing by toggling a
transfer proposal, because revoke read it; revoke now clears it unconditionally.

Capacity is **2^24 concurrent active licences**; indices are reused after revocation.

### Verified on chain

All six circuits exercised on Preview, 10 August 2026: anchor (`anchorSeq` 0→1,
`lastAnchor` set), prove prior possession (`proofSeq` 0→1, commitment unchanged), issue
(PENDING), countersign (ACTIVE), prove, revoke — then a proof attempt against the
revoked licence correctly failed with *"No such license"*, confirming the entry was
cleared rather than flagged.

---

## Contract 2 — Lineage

`contract/src/lineage.compact` · hand-written, no generator (redesigned 30 Sep 2026)

Sits **above** the record commitments in the provenance contract and references them by
hash. It does not fork or replace that contract, so it can be adopted or ignored
independently.

### Ledger state

```
descentSeq, descentProposalSeq, obligationSeq, cleanProofSeq     Counter
lastDescent, lastDescentChild, lastDescentParent                 Bytes<32>
lastObligationRecord, lastObligation, lastBeneficiary            Bytes<32>
lastCleanProofBy, lastClearedAncestor                            Bytes<32>
pendingParentOf     Map<Bytes<32>, Bytes<32>>    // child -> proposed parent
pendingObligations  Set<Bytes<32>>               // proposed, not yet accepted
openObligations     Set<Bytes<32>>               // in force
obligationCountOf   Map<Bytes<32>, Uint<32>>     // record -> obligations in force
```

Every container is cleared by the circuit that ends what filled it, so state is bounded
by open business — open proposals and unreleased obligations — never by cumulative
usage. Every event names its parties in a cell, so the descent graph and the obligation
set can be rebuilt from chain history by anyone (`contract/verify-max-3.mjs` builds that
outsider and grades it against the chain).

### Every caller is derived

One witness, `localGeneticSecret`. The child proposing, the parent confirming, the
holder accepting and the beneficiary proposing or discharging are all
`commit(localGeneticSecret())`. No circuit takes the caller's own record as an argument.

### Descent edges take both holders

`proposeParent(parent)` is an offer from the child's holder; `confirmParent(child)` is
the named parent's holder accepting it, and the stored proposal must still name them.
Until both have acted there is no edge. A single unilateral `declareParent` once let a
seller whose real mother was encumbered declare descent from any clean record they
liked, and the edge it produced was indistinguishable from a real one.

**What an edge does not mean:** that the child is biologically descended from the
parent. It means both holders said so. The DNA pairing narrows that and does not close it.

### Obligations take both parties too (security pass, 30 Sep 2026)

The beneficiary proposes (`proposeObligation`), the record's holder accepts
(`acceptObligation`), and only the beneficiary can release (`discharge`). A holder
claiming against their OWN record — a breeder marking a licensed mother so descendants
cannot prove clean while the royalty stands — does it in one step
(`encumberOwnRecord`), since they are both parties. A clean proof
(`proveAncestorClean(ancestor)`) fails while any obligation is in force against the
ancestor, and reads the state it executes against.

**What this replaced, and why.** Obligations used to live in a depth-24 sparse Merkle
tree with slots derived from commitments, and any party could encumber any record.
Confirmed against that build:

- **Anyone could poison anyone.** A competitor attached a claim to a stranger's record;
  the record failed every clean proof from then on and only the competitor could
  release it. Poisoning a registry cost a fee per record.
- **A squatter locked out the real claim.** One slot held one leaf, and grinding a
  secret into a chosen slot took about 81 seconds, so a genuine royalty could be kept
  off any record.
- **Readers accepted any of the last eight roots**, so a seller could present a proof
  prepared just before an encumbrance landed and defeat it.

Consent closes the first: a claim the holder never agreed to is a dispute, which belongs
off chain. Sets keyed by the whole obligation close the second: there are no slots and
nothing to collide with, and a record can carry several obligations. Reading current
state closes the third. The tree carried no privacy — encumbrances and clean proofs
already published the record — so nothing was given up, and the circuits no longer fold
24-level paths: the prover keys drop from ~76 MB to a size a browser loads.

The holder's leverage to refuse an obligation is real, and so is the beneficiary's: they
confirm parentage, and sell material, only once it is accepted. `contract/attack-lineage-30sep.mjs`
runs every attack above against the compiled contract.

---

## Two mechanisms, both necessary

A clean-descent claim needs two independent things to be true, and neither covers the
other.

**A clean proof** shows a claimed ancestor carries no obligation in force.

**The descent graph** shows the claimed ancestor is the real one.

Without the graph, a seller blocked by an obligation on their mother plant could name a
clean unrelated record as their parent, and the clean proof for that record would pass.
Only the confirmed edges catch it. And **the verifier walks the graph; the prover does
not supply it.** A pedigree branches, and a chain handed over by the party who benefits
from it is missing whatever was inconvenient. `verifyDescent(record, provenClean)` walks
every confirmed edge upstream and requires each ancestor to be covered.

---

## Rules for a registry consuming this

Each is a way the contracts can be read wrongly by somebody who has done everything else
right.

### 1. Resolve every record through the provenance contract's identity chain

A commitment `x` is retired from the moment `headOf(originFor(x)) != x`. **`rotatedTo`
is not a complete list** — recovery does not write it — so learn retirement times by
replaying the rotation and recovery events (`lastRotatedTo`, `lastRecoveredOrigin`).

The two contracts cannot read each other. A holder who rotates a secret in the
provenance contract gets a new commitment with a clean lineage history. So:

- check obligations against **every** commitment in the identity's chain
  (`originOf` / `rotatedTo` / `headOf`), not only the one presented;
- ignore an edge confirmed, a proof made, or **a discharge** made under a commitment
  **after** the provenance contract retired it.

Without this, rotating a secret sheds its obligations, and a thief holding a
beneficiary's retired secret can release what that beneficiary is owed. On-chain state
alone cannot tell a legitimate discharge from a thief's, so a clean proof is only as
good as the verifier's replay of the discharges behind it.

### 2. Rebuild from archival history, not from current state

Current state shows *whether* a record is encumbered (`obligationCountOf`). It does not
show who is owed or on what terms (the sets hold hashes), and it cannot rebuild the
descent graph. Both need a per-transaction indexer reading the event cells.
`verify-max-3.mjs` §7 demonstrates the difference.

### 3. Make the check positive, not the absence of a negative

A party can anchor material under a fresh secret and get a record with no history. No
circuit can tell a new accession from a laundered one. Require a **confirmed path to an
origin you recognise**, with every node on it clean.

### 4. A licence presentation proves one thing to one verifier

`proveLicense` publishes `presentationTag(record, challenge)`. Only the verifier who
chose the challenge can check it, and the challenge must be 32 fresh random bytes that
are never published. The licence set itself is public; tying a presentation to a member
of it is what is hidden. The transaction and its timing are visible.

### 5. A sparse graph is not a clean one

A record whose parent has no holder can never have that edge confirmed — a landrace, an
accession from a collection that never joined, a breeder who has gone. Treat a pedigree
that stops at an unconfirmable parent as unproven, not clean.

---

## What is proven and what is assumed

Being precise about this matters more than the feature list.

**Proven cryptographically**
- The record existed, unaltered, at the anchor transaction's timestamp
- The claimant holds the preimage behind the commitment
- A named record carries no obligation in force, as of the proof's transaction
- The holder of a live licence knows the secret behind it, bound to one issuing record
  and one verifier's challenge

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
- **Parentage and obligations are what both parties agreed to**, not independently
  established facts. See the lineage section.
- **The contracts cannot see each other.** See rule 1 above.

---

## Off-chain components

**`contract/src/descent.mjs`** — reconstructs the descent graph from declared edges.
`verifyDescent(record, provenClean)` walks it; `verifyChain` checks a single stated line
and does **not** catch omission, which its own comment says.

**`contract/src/license-tree.mjs`** — maintains the active-licence tree and produces the
paths for countersign, revoke, assign and present. Plan-then-apply: a path is built
before the call that uses it and the local tree moves forward only once the chain has
accepted, because a mutate-on-build API desynchronises from the chain on every refused
call and every path after that is wrong.

Its depth comes from `managed/veilcore/compiler/contract-info.json` — the build's own
record of the argument types.

**`veilcore-api/lineage/`** — the registry's lineage service, in the separate
`veilcore-api` repository. ⚠ It was built against the obligation TREE and must be moved
to the consent-based model before the redesigned lineage contract is deployed; until
then the two disagree.

---

## Test coverage

`npm test` runs `test-*.mjs`, `*-checks.mjs`, `verify-max-*.mjs` and `attack-*.mjs`.
The kinds differ, and the difference matters when reading the output:

| Kind | Exits non-zero on failure | Purpose |
|---|---|---|
| `test-*.mjs` | yes | Behaviour that must not regress |
| `verify-max-*.mjs` | yes | One review finding each, demonstrated failing |
| `attack-*.mjs` | yes | The 30 Sep security pass: every attack, all refused |
| `lineage-checks.mjs`, `descent-checks.mjs` | yes | Claims the contracts' comments make, tested |
| `audit-checks.mjs` | **no** | Standing findings report — prints `FAIL` for defects that are known, accepted and documented |

`audit-checks.mjs` prints two `FAIL` lines on every green run. Both are deliberate: a
party with a self-chosen secret can grow the licence maps (the bound is economic, not
structural, and the contract header says so), and `anchorBatch` is unauthenticated by
design so `lastBatchRoot` is a scratch slot rather than evidence.

| Suite | What it establishes |
|---|---|
| `attack-30sep.mjs` | Provenance security pass: every attack refused |
| `attack-lineage-30sep.mjs` | Lineage security pass: every attack refused |
| `test-generations.mjs` | Obligations reach descendants four generations down |
| `test-descent.mjs` | Spoofed ancestry and truncated chains are rejected |
| `test-contract.mjs` | The provenance flows, then the same flows driven by an attacker |
| `test-license.mjs`, `test-license-state.mjs` | Licence commitment binding and lifecycle |
| `verify-max-1-2.mjs` | Both contracts deploy live; values a verifier needs are on chain |
| `verify-max-3.mjs` | An outsider rebuilds the obligation set and graph from ledger cells alone |
| `verify-max-4.mjs` | Obligations and descent are not opt-in for the party they bind |
| `verify-max-5.mjs` | Rotation retires the old secret; recovery survives a lost one |
| `verify-max-6.mjs` | Front-run, resurrection and sublicence no longer work |
| `verify-max-9.mjs` | A licence presentation publishes only a challenge-bound tag, and two do not link |

(`verify-max-7`, `verify-max-8`, `test-merkle`, `test-slots`, `test-lifecycle` and
`test-tree` tested the obligation tree and were retired with it on 30 Sep 2026.)

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
  src/lineage.compact        heritable rights: descent edges and consent-based obligations
  src/license-tree.mjs       off-chain active-licence tree
  src/descent.mjs            descent graph and descent verification
  src/witnesses.ts           private state and witness providers for both contracts
  test-*.mjs                 behaviour that must not regress
  verify-max-*.mjs           one review finding each, demonstrated
  attack-*.mjs               30 Sep security pass, every attack
  *-checks.mjs               claims tested (audit-checks is a standing report)
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

cd contract && npm run compact   # both contracts
cd contract && npm run build     # then api, then bboard-ui — order matters
```

`license-tree.mjs` reads the licence tree's depth from the build's `contract-info.json`, so nothing downstream hardcodes it.
