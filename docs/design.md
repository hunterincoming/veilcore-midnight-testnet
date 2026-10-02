# VeilCore: Technical Design

**Provenance, licensing and heritable obligations for plant and animal genetics on Midnight**
Protocol version 1 · last updated 1 October 2026 (evening: state bounds)

---

## Summary

Every IP registry records objects. Genetics are not objects: a cutting becomes a
mother plant becomes ten thousand clones, and a claim made upstream should follow the
material down. A licence binds the parties who signed it; it cannot bind a plant that
does not exist yet.

VeilCore is one Midnight contract, `contract/src/veilcore.compact`, that records:

1. **Records.** Who held a genetic record, and when, without disclosing the genetics.
2. **Licences.** Rights granted against a record, presentable to a verifier without
   naming the licence or the licensee.
3. **Lineage.** Parentage both holders agreed to, and obligations (royalties, use
   restrictions) that the record's holder accepted and only the beneficiary can release.

Everything is keyed by **identity**, so it survives a holder changing or losing their
key. A verifier checks all of it from chain state alone (`contract/src/verify.ts`), read
through an indexer it trusts (see Trust model).

## Constraints

- **Commitments, not contents, on chain.** The contract stores commitments and the
  public values listed under "Known limits", never genetic data, terms or names. (The
  website keeps record contents and licence terms on the VeilCore registry, which is
  not the chain; see Trust model.)
- **Bounded state per identity.** Every ledger entry is overwritten, cleared by the
  party who created it, or capped per anchored identity. State grows with the number of
  anchored records, not with how often anyone calls. The bound for every field is under
  "State bounds"; where it does not hold, "Known limits" says so.
- **Browser-viable proving.** 24 circuits, each under 700 ZKIR operations.
- **Independent recomputation of commitments.** The six commitment hashes are plain
  SHA-256 (next section), so anyone can recompute one without Midnight tooling. The
  licence tree is the exception: its inner nodes use Midnight's field hash. Reading
  contract state at all, and checking a presentation (rule 5), needs Midnight's tooling.

---

## Hashes

Each commitment is SHA-256 over 32-byte elements: a tag (UTF-8, right-padded with zero
bytes to 32), then each input. This is exactly Compact's `persistentHash` over
`Vector<n, Bytes<32>>`, so on-chain and off-chain values agree.

| Function | Tag | Inputs |
|---|---|---|
| `commit` | `veilcore:v1:commit` | record secret |
| `recoveryCommit` | `veilcore:v1:recover` | recovery secret |
| `licenseCommit` | `veilcore:v1:license` | licence secret, issuing record |
| `licenseKey` | `veilcore:v1:lickey` | licence commitment, issuing record |
| `presentationTag` | `veilcore:v1:present` | issuing record, verifier challenge |
| `obligationKey` | `veilcore:v1:obligation` | record identity, obligation commitment, beneficiary identity |

Test vectors: `contract/vectors/v1.json`. The test suite checks each vector against the
compiled contract and against a plain SHA-256 implementation. The contract publishes
`protocolVersion = 1`; a change to any tag or input order is a new version.

**Not SHA-256: the licence tree.** `activeLicenses` is a ledger `HistoricMerkleTree`.
Its leaves are licence keys (SHA-256, above), but its inner nodes and root use Midnight's
`transientHash`, a field hash. Rule 5 compares the root a presentation proved against with
the tree's root, so a verifier needs Midnight's ledger tooling for that check
(`verify.ts` uses the compiled contract's `Ledger`).

---

## Identity

A record secret is 32 random bytes held by the record's holder. Its commitment is the
**record**.

- **Anchoring** makes a record an **origin** and fixes its recovery commitment.
- **Rotation** (with the current secret) and **recovery** (with the recovery secret)
  move the identity to a new record, the **head**. `originOf(head) = origin`,
  `headOf(origin) = head`.
- A commitment **may act only while it is its identity's head**. The identity of any
  commitment is `originFor(x)`: `originOf(x)` if set, else `x`.
- A rotation or recovery target must have no history, so two identities never merge.
- **Only an anchored identity acts as a record holder**: ownership proofs, DNA pairing,
  issuing licences and lineage all require one. (Licensees, sealing, batch roots and
  recovery act without a record.) An unanchored commitment therefore has no events to
  carry into an identity it is later rotated into, and an anchored one can never be a
  rotation target.
- **Recovery writes the new head without reading the old one.** A thief holding the
  current secret cannot block it by rotating again. Whoever holds the recovery secret
  controls the identity, so it belongs offline. There is no waiting period.
- **A recovery uses up the recovery secret.** The same call installs a new recovery
  commitment, so a secret typed into a possibly compromised machine to recover cannot be
  used again by whoever saw it there. That protects against a secret being read or
  logged, not against malware that also sees the new one. The contract refuses only the
  current commitment as the new one; the client always makes a fresh one. If a recovery
  reports an error, check whether it landed before retrying: the client does.
- **Moves are capped.** An identity can make 16 rotations (`MAX_ROTATIONS`), and a
  recovery resets that count, so a thief who spent them leaves the owner a fresh 16. An
  identity can make 16 recoveries in its lifetime (`MAX_RECOVERIES`). A thief cannot
  spend recoveries: they need the recovery secret.

Licence authority, parentage and obligations are keyed by identity, so they survive
every rotation and recovery, and a retired secret controls nothing.

## Records

| Circuit | Effect |
|---|---|
| `anchor(recoveryCommitment)` | Anchors the caller's record. Refuses the zero commitment and the zero secret's commitment. |
| `proveOwnership(challenge)` | Publishes the caller's live record in `lastOwnershipProof` and the verifier's challenge in `lastOwnershipChallenge`, so the proof answers one verifier (rule 8). The interval since its anchor is the evidence of prior possession. |
| `pairDna(dnaCommitment)` | Records any non-zero 32-byte value the holder chooses against the caller's record. It is the holder's own statement that a report belongs to the record; the contract cannot check it. |
| `rotateRecordSecret(newRecord)` | Moves the identity; the caller must hold the new secret. Anchored identities only. At most 16 since the anchor or the last recovery. |
| `recoverRecordSecret(origin, newRecord, newRecoveryCommitment)` | Moves the identity with the recovery secret, whoever holds the head. At most 16 per identity; each one resets the rotation count. |
| `replaceRecoveryCommitment(origin, new)` | Replaces a recovery secret that may have leaked. |
| `anchorBatch(root)` | Timestamps a batch root. **Unauthenticated**: inclusion in a batch is not possession. |

Every circuit that acts for a record holder derives the caller from their record
secret. Eight circuits have no record-holder caller: `anchorBatch` and
`sealRevocations` (anyone), `recoverRecordSecret` and `replaceRecoveryCommitment`
(authorised by the recovery secret), and `countersignLicense`, `proposeTransfer`,
`withdrawTransfer` and `proveLicense` (authorised by the licence secret). No circuit
takes the caller's record, or any secret, as an argument (checked by
`src/test/interface.test.ts`).

## Licences

1. The **licensee** makes a licence secret and sends the issuer
   `licenseCommit(secret, issuerRecord)`. The issuer never holds the secret.
2. `issueLicense(lc)`: the issuer (an anchored identity) records it, PENDING, keyed
   `licenseKey(lc, issuer)`, and publishes `lc` in `lastIssuedLicense`. The contract
   tracks only PENDING and ACTIVE: no terms, no expiry. Terms, end dates and any
   "expired" state are the app's, kept off chain. An identity can have at most 32
   licences PENDING at once (`MAX_PENDING_LICENSES`); a countersign or a revoke of a
   pending one frees a place.
3. `countersignLicense(issuer, slot)`: the licensee proves the secret. The key becomes a
   leaf of `activeLicenses` at a random free index, so activations do not contend. An
   issuing identity can have at most 1024 licences ACTIVE (`MAX_ACTIVE_LICENSES`);
   beyond that a countersign is refused until the issuer revokes one. A transfer keeps
   the count the same.
4. `proveLicense()`: the licensee proves to one verifier that they hold a licence from
   one issuer that is in the tree at a root the contract still accepts. That is "live"
   only once the verifier also applies rule 5 (see "The revocation window"). All inputs
   are witnesses. It publishes
   `presentationTag(issuer, challenge)` and the root proved against. The verifier chose
   the challenge (32 random bytes, used once, never published) and recognises the tag.
   To anyone else the tag names nothing, but the root does narrow it: it fixes which
   licences were live, and countersigns are public, so an observer learns the issuer was
   one of those with a live licence at that root. While few issuers have live licences,
   as at launch, that can be one.
5. `proposeTransfer` / `approveTransfer` / `withdrawTransfer`: the holder proposes a
   commitment the incoming party built; the issuer's identity approves the one it was
   shown. The leaf is replaced in place.
6. `revokeLicense(lc, issuer)`: the issuer's identity removes the licence. It needs no
   tree path and does not read the pending-transfer map. It does read the licence's
   status, so a licensee who countersigns first can make one revoke of a PENDING licence
   fail; the retry then revokes the ACTIVE licence. It cannot be starved repeatedly.

**Revocation takes effect in two steps.** The licence is removed at once: it cannot be
transferred, and no new path to it exists. Paths proved against earlier roots keep
verifying until the next **seal**. `sealRevocations(bound)` drops every root except the
current one. Anyone may call it, only when the tree has changed since the last seal (a
revocation or transfer is waiting, or an activation added a root: `rootsSinceSeal`), and
only once the block time is at least 600 seconds (`SEAL_INTERVAL`) past the previous
seal's `bound`. `bound` must be ahead of the block time by at most 300 seconds, so two
seals are always at least 600 seconds of block time apart. A seal after activations only
does not make anything safer; it clears the root history, which otherwise grows with
every activation (see "State bounds"). Like any seal, it makes a licensee whose path
predates it fetch a new one.

Why not drop old roots on every revocation, as version 0 did: then on chain anyone
could revoke a throwaway licence of their own each block and make every older path
fail. Sealing limits that on chain. It does not stop a griefer from costing honest
licensees re-proofs: a presentation records whether a revocation was waiting when it was
proved, so a revocation landing before it, or a seal, sends it back, and while one is
waiting, a
verifier following rule 5 refuses a presentation whose root has since moved on. That is
a cost in re-proofs, paid in fees by the griefer too, never a wrong answer. A verifier
that wants to accept more can check the presentation's root against every root since
the last revocation or transfer, from the indexer's history. The client seals straight
after a revocation or transfer when allowed, and otherwise reports when it can. It does
not seal after a countersign; the operator runs CLI option 15 ("Seal waiting
revocations") for that (`docs/runbook.md`).

A leaf names its issuer, so a transfer cannot forge a licence from another issuer, and
a commitment cannot be live twice under one issuer.

## Lineage

**Descent.** `proposeParent(parent)` by the child's holder, `confirmParent(child)` by
the parent's holder. The stored proposal must still name the confirming parent. The
edge is recorded between identities in `parentsOf`, so the pedigree is readable from
state. An edge means both holders said so, not that the child is biologically
descended. The DNA pairing narrows that; it does not close it. A record can have at most
two confirmed parents (`MAX_PARENTS`); a third is refused at proposal and at
confirmation.

**A record's parents are fixed once it has confirmed offspring** (`hasOffspring`). An
ancestor therefore cannot change the pedigree of material already descended from it,
and no cycle can form: the edge that would close one gives a parent a new parent.
Record a line oldest first: a parent proposed for a record can no longer confirm once
that record has confirmed offspring of its own.

**Obligations.** An obligation is `obligationKey(record identity, obligation commitment,
beneficiary identity)`. The obligation commitment is a hash of the terms with a random
salt, both kept off chain; without the salt, short terms could be guessed back from the
chain (the CLI salts them).
- A beneficiary proposes (`proposeObligation`); it binds nobody until the holder accepts
  (`acceptObligation`). The beneficiary can withdraw an unaccepted proposal. A proposal
  publishes the obligation commitment, the record's identity and the proposer's identity
  (`lastProposedObligation`, `lastProposedAgainst`, `lastProposedBy`), so a beneficiary
  who recovers from a theft can find and withdraw proposals a thief made in its name,
  and the holder can find what to reject. One identity can have at most 8 proposals
  waiting (`MAX_PENDING_OBLIGATIONS`); a withdraw, accept or reject frees a place.
- A holder may place one on their own record in one step (`encumberOwnRecord`), for
  example a breeder marking a licensed mother.
- **Only the beneficiary's current head can release it** (`discharge`). After recovery,
  a thief holding an old secret cannot.
- The holder can reject a proposal (`rejectObligation`). Anyone anchored can file
  proposals against any record, at a fee each and at most 8 waiting per proposer; they
  bind nothing, and clearing them costs the holder a transaction each.
- A record can carry at most 16 obligations in force (`MAX_OPEN_OBLIGATIONS`), plus 16
  more for each recovery it has had, counting both accepted proposals and its own
  encumbrances. A full record cannot accept or encumber until a beneficiary discharges
  one. The extra room per recovery exists because a thief holding the record can fill
  it with obligations owed to himself, which only he can release.
- **Obligations follow material down, including ones added later.** An obligation an
  ancestor's holder accepts after a descendant was linked shows on the descendant's
  lineage too, until its beneficiary releases it.
- `obligationCountOf(identity)` counts obligations in force. It is a `Counter`, so
  concurrent accepts and discharges on one record commute rather than failing each other.

**Only anchored identities take part**, so an encumbered identity cannot be merged into
another to shed what it owes.

## State bounds

Every ledger field, from the `export ledger` lines of `contract/src/veilcore.compact`.
"Identity" means an anchored identity; the caps are counted per identity, not per
commitment, so rotating does not reset them.

| Field | Bound | Who can clear it | Why it is bounded |
|---|---|---|---|
| `protocolVersion` | one value | nobody (sealed) | fixed slot |
| 10 counters: `anchorSeq`, `proofSeq`, `batchSeq`, `pairSeq`, `rotationSeq`, `transferSeq`, `presentationSeq`, `sealSeq`, `descentSeq`, `obligationSeq` | one value each | nobody; they only count | fixed slot |
| 24 event cells: `lastAnchor`, `lastBatchRoot`, `lastOwnershipProof`, `lastOwnershipChallenge`, `lastPairedRecord`, `lastPairedDna`, `lastRotatedFrom`, `lastRotatedTo`, `lastRecoveredOrigin`, `lastPresentation`, `lastPresentationRoot`, `lastPresentationUnsealed`, `lastIssuedLicense`, `lastActivatedLicense`, `lastTransferredLicense`, `lastActivatedRecord`, `lastDescentChild`, `lastDescentParent`, `lastObligationRecord`, `lastObligation`, `lastBeneficiary`, `lastProposedObligation`, `lastProposedAgainst`, `lastProposedBy` | one value each | overwritten by the next transaction that writes it | fixed slot |
| `lastSealTime`, `unsealedChanges`, `rootsSinceSeal` | one value each | overwritten | fixed slot |
| `recoveryOf` | 1 per identity | nobody; replaced in place by recovery and `replaceRecoveryCommitment` | created once, at anchor |
| `obligationCountOf`, `rotationsOf`, `recoveriesOf`, `pendingObligationsBy`, `pendingLicensesBy`, `activeLicensesBy` | 1 counter each per identity | nobody | created once, at anchor; each holds a count, not a list |
| `originOf` | at most 288 per identity: 16 rotations in each of 17 periods (before the first recovery and after each of 16), plus one entry per recovery | nobody | `MAX_ROTATIONS` 16, reset by recovery; `MAX_RECOVERIES` 16 |
| `headOf` | 1 per identity that has moved | nobody; overwritten by each move | one head per identity |
| `licenseStatusOf` | per issuing identity, at most 32 PENDING and 1024 ACTIVE | the issuer (`revokeLicense`); `approveTransfer` swaps one entry for another | `MAX_PENDING_LICENSES`, `MAX_ACTIVE_LICENSES` |
| `pendingTransferOf` | at most 1 per active licence | the holder (`withdrawTransfer`), the issuer (`approveTransfer`, `revokeLicense`) | one proposal per licence, and active licences are capped |
| `activeLicenses` leaves | at most 1024 per issuing identity; 2^24 = 16,777,216 in all | the issuer (`revokeLicense`) | `MAX_ACTIVE_LICENSES`; the tree has depth 24 |
| `activeLicenses` root history | one root per tree change (activation, approved transfer, revocation) since the last seal | anyone (`sealRevocations`), at most once per 600 s | only if someone seals; see Known limits |
| `licenseSlotOf`, `licenseAtSlot` | 1 each per active licence | the issuer (`revokeLicense`); a transfer reuses the slot | as active licences |
| `pendingParentOf` | at most 1 per child identity | the child (`withdrawParent`), the parent (`confirmParent`) | one proposal at a time |
| `parentsOf` | at most 2 per child identity | nobody | `MAX_PARENTS` 2 |
| `hasOffspring` | at most 1 per identity | nobody | set membership |
| `pendingObligations` | at most 8 per proposing identity | the proposer (`withdrawObligation`), the holder (`acceptObligation`, `rejectObligation`) | `MAX_PENDING_OBLIGATIONS` 8 |
| `openObligations` | at most 16 per record identity, plus 16 per recovery (so at most 272) | the beneficiary (`discharge`) | `MAX_OPEN_OBLIGATIONS` 16 × (recoveries + 1) |

**Why this is Tier 2 on Midnight's State-Space-at-Risk rubric.** Each identity's share of
state is capped, and every identity costs an `anchor` transaction and its fee. So state
grows with the number of anchored records, not with how often anyone calls: a repeated
call by one identity overwrites a cell, stops at a cap, or clears what it created.
`contract/src/test/state-bounds.test.ts` checks each cap, the moves that free a place,
and that 50 rounds of propose/withdraw, issue/revoke and parent propose/withdraw leave
state where it started. That is the rubric's Tier 2 shape (bounded per user, growing with
the number of users). It is not Tier 1: there is no global ceiling on the number of
identities. Two things are not bounded per identity, and are listed under Known limits:
the licence tree's root history, which is bounded only while someone seals, and the
total created by one party with many anchors.

---

## Verifier rules

These are normative. `contract/src/verify.ts` implements rules 1 to 5 and 8, with one
gap: rule 5's "refuse a presentation that landed before you issued its challenge" is
not implemented, because it needs the block time of the presentation's transaction.
"Use each challenge once" is implemented by `ChallengeBook` with `acceptPresentationOnce`
and `acceptOwnershipOnce`: a challenge is accepted once, only for the kind it was issued
for (licence or ownership), and only within 7 days of issue. The CLI keeps the book
encrypted under `~/.veilcore/challenges`, one file per network
(`bboard-cli/src/challenge-file.ts`). The tests exercise each rule
(`rules-coverage-round11.test.ts` among them).

1. **Resolve identity.** A commitment's identity is `originFor(x)`. It may act only if
   `headOf(identity) = x`, or it is an un-moved origin. Judge every action by the
   identity, not the commitment presented (`identityOf`, `isLive`, `commitmentsOf`).
2. **Walk the pedigree yourself.** Start from the record's identity and follow
   `parentsOf` upward. Never accept a pedigree from the party it benefits.
3. **Clean means nothing owes.** A lineage is clean when the record is anchored and
   neither its identity nor any ancestor has `obligationCountOf > 0`
   (`checkLineage().clean`). A commitment the chain has never seen is not clean.
4. **Clean is not complete.** Accept a lineage only if it is clean, has no cycle, and
   every root (ancestor with no confirmed parent) is an identity you recognise as the
   start of a line (`checkLineage(ledger, record, recognisedRoots).accepted`). Anyone can
   anchor fresh material with no history. The contract makes cycles impossible; the walk
   refuses one anyway, in case an indexer reports one.
5. **Presentations.** Send the licensee a fresh 32-byte random challenge, privately, and
   use it once: keep the challenges you issued, when, and whether each was used, and
   refuse a presentation that landed before you issued its challenge. The licensee gives
   you the presentation's transaction id. Check that it is a successful transaction whose
   only call **on this contract's address** is one `proveLicense` (no seal or anything
   else bundled with it, not a later transaction, not a look-alike contract). Read the
   contract state recorded for that call and accept only if:
   - its `lastPresentation` equals `presentationTag(c, challenge)` for some commitment
     `c` of the issuing identity (a licence issued after a rotation is tagged under the
     successor). Never take the tag from the licensee, who can compute any tag; and
   - its `lastPresentationRoot` is the licence tree's current root in that state, or
     its `lastPresentationUnsealed` is false: no revocation was waiting when the
     presentation was proved. Never use the live `unsealedChanges` for this; a seal
     clears it without making an older root any safer.

   (`acceptPresentation`; `presentationState` in `api/src/presentation-lookup.ts` does
   the lookup, and `VeilcoreAPI.checkPresentation` both.) It proves that someone holding
   the licence secret took part, not which party. The published root also shows
   roughly when the licensee last fetched their path.
6. **Event cells are per transaction.** Each `last*` cell holds the value from the most
   recent transaction that wrote it. Read them from the indexer per transaction, together
   with which circuit that transaction called: several circuits write the same cells
   (accepting and releasing an obligation, say), and a rotation and a recovery both
   write `lastRotatedTo` (a recovery clears `lastRotatedFrom`; a rotation clears
   `lastRecoveredOrigin`). `lastIssuedLicense` is written only by `issueLicense`,
   `lastTransferredLicense` only by `approveTransfer`, and
   `lastProposedObligation`, `lastProposedAgainst` and `lastProposedBy` only by
   `proposeObligation`.
7. **Batch roots are not possession.** `anchorBatch` is unauthenticated.
8. **Ownership proofs.** Send the holder a fresh 32-byte random challenge and use it once.
   The holder gives you the transaction id of a `proveOwnership(challenge)` call. Look
   it up as in rule 5 (successful, its only call on this contract) and accept only if
   `lastOwnershipChallenge` is your challenge and `lastOwnershipProof` is the live,
   anchored head of the identity you asked about (`acceptOwnership`;
   `VeilcoreAPI.checkOwnership`). Never accept a proof made for someone else's challenge:
   anyone can point you at the real holder's. The challenge becomes public with the
   proof, so never use one challenge for both an ownership proof and a licence
   presentation: published, it would let anyone recognise the presentation's tag and
   name its issuer. Also read the current state and refuse the proof if the proving
   commitment is no longer its identity's head: a proof made with a stolen secret is
   then refused once the owner has recovered (`acceptOwnership` with its `now`
   argument; `checkOwnership` always passes it). An ownership proof publishes the
   record's commitment. Like a presentation, a proof shows that the holder of the secret
   answered your challenge, not that the party in front of you is that holder: a
   middleman can relay it. Answer challenges only from the party you are dealing with.

## Trust model

**Proven by the contract**
- A record's holder knew its secret when anchoring, proving ownership, or acting.
- A retired commitment can do nothing.
- A licence presentation came from someone holding the secret of a licence from the
  named issuer that was in the tree at a root the contract still accepted. On its own
  the contract accepts a revoked licence's old path until the next seal.
- An edge was agreed by both holders; an obligation by the holder and the beneficiary.
- An obligation is released only by its beneficiary's current head.

**Proven by the contract plus verifier rule 5**
- A presentation came from someone holding a live licence from the named issuer.

**Assumed, and stated plainly**
- **Record contents are the holder's assertion.** The chain proves when a claim was made
  and that it has not changed, not that the genetics are what the holder says.
- **A parent edge is an agreement, not a genetic test.** It proves both holders said
  the child descends from the parent. Whether it does is for a DNA test and the parties.
- **The recovery secret is the master key.** Whoever holds an identity's current
  recovery secret controls it, at once and without a waiting period, and an identity can
  be recovered at most 16 times. Generate it offline, keep it offline (on paper, in two
  places), and never type it on the machine that holds the record secret.
- **Participation is voluntary.** A market-access filter, not enforcement.
- **The indexer is trusted for what it reports.** Verifiers read chain state through an
  indexer (Blockfrost for mainnet). A wrong or compromised indexer can report any state:
  make a presentation pass, or a lineage look clean. For a decision that matters, ask a
  second indexer or your own node and compare.
- **The VeilCore registry service is not the source of truth.** It stores records and
  answers lineage queries for the website, attested by VeilCore, not by the chain. Its
  lineage responses are labelled that way. It also holds what the website
  never puts on chain: record contents, DNA pairings, licence terms and status. Anything
  a decision rests on is checked against the contract with rules 1 to 8.

## Deployment in fragments

The network refuses a deploy transaction that carries a verifier key for all 24 circuits
("exceeded block limit"). The contract is therefore deployed with the keys of the first
few circuits (`FIRST_FRAGMENT`, halved on a refusal), and the maintenance authority adds
each remaining key in its own transaction (`VeilcoreAPI.deploy`,
`addMissingCircuitKeys`; CLI deploy menu option 4 finishes an interrupted run). The
ledger state and every circuit are the ones compiled; only which keys ride the first
transaction differs. Joining the contract checks every key on chain against the local
build, and refuses a contract carrying any circuit the build does not have, and on mainnet the local build is first checked against `docs/fingerprints.md`.
Anyone can do the same: read the contract's verifier keys from the indexer and compare
them with the published fingerprints.

## Governance: the maintenance authority

midnight-js always installs a maintenance authority on deployment. It can add and remove
verifier keys, so it can repair or disable any circuit, and a key for a new circuit could
rewrite state: whoever holds it controls the contract. VeilCore keeps it for launch, held offline by the deployer (the client shows it before
deploying and removes it from the local store afterwards), and
will retire it on a date published in the deployment record, using
`retireMaintenanceAuthority` (api/src/maintenance.ts; CLI main menu option 33, which asks
for the key from the offline copy. Option 32 shows the record secret; do not confuse
them). Until then, holders should treat
the circuit set as changeable by VeilCore.

## Known limits

- **What a thief does before recovery stands.** Someone holding an identity's current
  secret acts as that identity until recovery: they can revoke its licences, accept
  obligations on it (including ones owed to themselves), and confirm parentage.
  Recovery stops them from then on; it does not undo those acts, and no one can remove a
  confirmed edge. Disputes of that kind are for the parties and, while it is held, the
  maintenance authority, which could add a remedy circuit. Keep secrets on devices you
  control and the recovery secret offline.
- **Licence activity is public apart from presentations.** Issue, countersign, approve
  and revoke publish the licence key and the issuing record; a transfer proposal and its
  withdrawal publish the licence key; a seal publishes neither. The licence key links
  these calls to each other. Issue, countersign and an approved transfer publish a
  licence commitment (`lastIssuedLicense`, `lastActivatedLicense`,
  `lastTransferredLicense`). Issue publishes it so that an owner who recovers from a
  theft can revoke PENDING licences the thief issued: revoking needs the commitment, and
  the key alone does not give it. An approved transfer publishes it so the same owner can
  revoke a licence the thief activated and then transferred. A transfer proposal
  publishes the incoming commitment. Revoke and approve publish the caller's record.
  Only a presentation hides the licence and the licensee. Whether fee payments can link a
  presentation to its countersign is an open question for the Midnight wallet, not this
  contract.
- **Obligation proposals are public.** A proposal publishes who proposed what against
  whom, and the obligation commitment, before the holder has answered. A proposal the
  holder rejects still shows that it was made. The commitment hides the terms only if
  it is salted: the CLI salts it (SHA-256 of a random salt and the text); a client that
  passes a guessable value publishes something guessable.
- **Parentage and identity entries are permanent.** Confirmed edges (`parentsOf`),
  `hasOffspring`, `originOf`, `headOf`, `recoveryOf` and the per-identity counters are
  never removed. Each is capped per identity ("State bounds"). Keeping old successors in
  `originOf` is the price of a retired secret ceasing to work.
- **The caps can refuse legitimate use.** A record cannot take a third parent. A record
  that has never been recovered, with 16 obligations in force, cannot accept another
  until one is discharged (the cap is 16 per record, plus 16 per recovery, at most 272). A
  proposer with 8 proposals waiting, or an issuer with 32 licences waiting for
  countersignature, must wait for answers or withdraw. An issuer with 1024 active
  licences must revoke one, or issue from another anchored identity, to activate more. After 16
  recoveries an identity cannot be recovered again, and once it has also used the 16
  rotations after its last recovery it cannot move at all. Obligations a thief accepted
  owed to himself stay in force after recovery (only their beneficiary can release
  them); the record gets 16 more places per recovery, so it can still take new ones.
- **A thief can fill both parent slots for good.** Someone holding an identity's current
  secret can propose two parents and, with the holders of those records (their own
  anchors, say), confirm them. Recovery does not remove confirmed edges, so the true
  parent can never be recorded (`attack-bounds.test.ts`, F4). A shorter route needs one
  confirmation: the thief anchors a throwaway record, proposes the stolen identity as
  ITS parent, and confirms that as the identity. The identity then has offspring, so its
  own parents are fixed as they stand, even with none recorded. Record parents first.
- **The licence tree's root history is bounded only while someone seals.** Every
  activation, approved transfer and revocation adds a root, and only `sealRevocations`
  clears them. Nothing in the contract seals on its own: if nobody calls it, the history
  grows with every tree change. A seal is possible at most once per 600 s of block time,
  and a sealer that sets its bound the full 300 s ahead pushes the next possible seal to
  900 s. The operator should run a sealer (CLI option 15) after licence activations
  (`attack-bounds.test.ts`, F6).
- **The caps are per anchored identity, so many anchors get more.** Each `anchor` costs
  one fee and no material, and brings a fresh set of caps. One party with many anchors
  can, for example, keep 8 proposals per anchor waiting against one record. The holder
  can find each one from the proposal cells and reject it, a transaction each
  (`attack-bounds.test.ts`, F7).
- **The revocation window.** A revoked licence's old path verifies on chain until the
  next seal: up to `SEAL_INTERVAL` plus `SEAL_SLACK` (a sealer may set the bound 300
  seconds ahead) plus the time until someone seals. A verifier following rule 5 does not
  accept such a presentation.
- **The web app's file fingerprints** (DNA reports, photos) are run through the record
  commitment, so whoever holds a report could anchor its fingerprint as a record of their
  own, and could find a record paired with it. The app does not put these on chain today;
  before it does, they get their own salted tag.
- **Record commitments are stable pseudonyms.** Actions under one record link to each
  other.
- **Licences issued by a thief** before recovery stay PENDING under the identity until
  the owner revokes them. Each issue publishes its licence commitment
  (`lastIssuedLicense`), so after recovering, the owner should read the identity's
  `issueLicense` transactions from the indexer and revoke every licence it did not
  issue. The client does not do this lookup for you yet. Until then the thief can
  activate one and present it, and a verifier asking
  about the identity accepts it. The same applies to obligation proposals a thief made
  in the identity's name (`lastProposed*`, `withdrawObligation`). A thief can also
  activate licences, one countersign each, up to the identity's 1,024-active cap, and
  recovery adds no room: the owner revokes each from the indexer record
  (`lastIssuedLicense`, `lastActivatedLicense`) before new licensees fit.
- **A presentation names the issuer, not the licence.** Any live licence against a
  record passes a check about that record, including one the issuer granted itself.
  Issue licences on different terms from different records if verifiers must tell them
  apart.
- **A record made from the all-zero secret** can be anchored, and then anyone can act
  as it. No client here ever uses a zero secret; one that did would be giving its record
  away.
- **Rotation does not unlink.** Rotation and recovery publish the old and new commitment;
  a holder who rotates keeps the same, linked identity.
- **An edge whose parent has no holder** (a landrace, a lapsed breeder) can never be
  confirmed. Such pedigrees stop there (rule 4).
- **A thief holding a beneficiary's current secret can release what is owed to it.**
  `discharge` accepts the beneficiary's current head, so a thief who has it before
  recovery can release obligations owed to that identity. Recovery does not restore
  them; putting one back needs a new proposal and the holder's acceptance.
- **A parent proposal filed by a thief survives recovery.** If the named parent then
  confirms, the edge is permanent. After recovering, the owner should withdraw any
  pending proposal they did not make (`withdrawParent`, CLI option 18).
- **The contract keeps no list of revoked licences.** On chain, a revoked commitment can
  be issued again, or be the target of another licensee's transfer. The API refuses both
  for commitments revoked from the same client (remembered in its private state), but
  that does not stop a revoked licensee who makes a new licence secret: the new
  commitment cannot be linked to them. An issuer must know who it is issuing to or
  approving.
- **A retired maintenance authority looks the same on chain as a live one.** Retiring
  replaces the authority's key with one nobody stores. The chain cannot show that nobody
  holds it, so outsiders take the deployer's word for it.

---

## Tests

`cd contract && npm test` runs the Vitest suites in `contract/src/test/` against the
compiled contract, in the style of Midnight's examples (`veilcore-simulator.ts`).

| Suite | Covers |
|---|---|
| `records.test.ts` | Anchoring, ownership, rotation, recovery; recovery against a thief who keeps rotating |
| `licences.test.ts` | Lifecycle, forgery through transfer, squatting, starvation of revocation, sealing and its rate limit, slot contention |
| `lineage.test.ts` | Consent, release by beneficiary only, survival across rotation and recovery, identity merging, the verifier walk |
| `interface.test.ts` | Published vectors, protocol version, the circuit list, no secret or caller record as an argument |
| `attack-*.test.ts` | The contract-side attacks from rounds 8 to 12. Most tests assert the refusal or the fix directly; a few blocked attacks are kept as `it.fails`, so they still run and must still fail. `attack-bounds.test.ts` is round 12, the attack on the state bounds (F1 to F7) |
| `state-bounds.test.ts` | Each per-identity cap, the moves that free a place, and that repeated calls by one identity leave state where it started. The 1024-active-licence test runs only with `SLOW_TESTS=1` |
| `rules-coverage-round11.test.ts` | Round 11: one test for each rule in this file and the README that had none (40), including limits the docs had wrong |
| `fuzz-invariants.test.ts`, `deploy-fragments.test.ts` | Random multi-party sequences with invariants checked after every step; the fragmented deploy |

Fixes outside the contract are tested where they live, not here:
`bboard-cli/src/attack-round11-deploy.test.ts` and `reattack-round11.test.ts` (CLI,
API client, challenge file, password, log scrubbing; `cd bboard-cli && npx vitest run`),
`api/test-deploy-guard.mjs` and `api/test-presentation-lookup.mjs` (`cd api && npm
test`), and the registry's `test/*.test.mjs` in the veilcore-api repository (`npm
test`). Not every finding in the attack history has a test.

The contention tests prove a call against one state and land its public transcript on a
later one with the on-chain runtime (`prove` / `land`). That is what happens when other
transactions arrive first. The smoke test (`bboard-cli/src/smoke.ts`) deploys a fresh
contract and calls 16 of the 24 circuits with real proofs, checking 26 results. It does
not call `anchorBatch`, `replaceRecoveryCommitment`, `withdrawTransfer`, `withdrawParent`,
`proposeObligation`, `acceptObligation`, `rejectObligation` or `withdrawObligation`. It
passed 26 of 26 on a local Midnight chain on this build (the state bounds, `ceb3a16`) on
1 October 2026 at 20:56 EDT. The preprod run on this build has not been done yet. The
attack history behind these tests is
in `docs/security-pass-30sep.md`.

## Repository

```
contract/src/veilcore.compact   the contract
contract/src/verify.ts          the verifier rules, over chain state
contract/src/witnesses.ts       private state and witnesses
contract/src/test/              the test suites and simulator
contract/vectors/v1.json        hash test vectors
api/src/veilcore-api.ts         the client API
api/src/deploy-guard.ts         refuses mainnet until the deployment record is filed
bboard-cli/                     command-line client, deploy and smoke test
bboard-ui/                      the breeder-facing website
```

Build: install the Compact toolchain, then `cd contract && npm run compact && npm test`.
`npm run fingerprints` records the compiler version and the SHA-256 of every proving
and verifying key, every circuit's ZKIR and the compiled contract code in
`docs/fingerprints.md`, the table the deployment record carries. A mainnet deploy from
the CLI is refused unless the local build matches that table as committed
(`bboard-cli/src/keys-check.ts`), and unless the deployment record revision is declared
(`api/src/deploy-guard.ts`).
