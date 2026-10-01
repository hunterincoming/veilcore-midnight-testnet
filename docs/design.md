# VeilCore: Technical Design

**Provenance, licensing and heritable obligations for plant and animal genetics on Midnight**
Protocol version 1 · last updated 30 September 2026

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

- **Zero custody.** Genetic data never leaves the holder. Only commitments reach the chain.
- **Bounded state.** Containers are cleared by the circuit that ends what filled them.
  What grows permanently is listed under "Known limits".
- **Browser-viable proving.** 24 circuits, each under 700 ZKIR operations.
- **Independent verification.** Every hash is plain SHA-256 (next section), so a
  verifier needs no Midnight tooling to recompute one.

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
  used again by whoever saw it there.

Licence authority, parentage and obligations are keyed by identity, so they survive any
number of rotations and recoveries, and a retired secret controls nothing.

## Records

| Circuit | Effect |
|---|---|
| `anchor(recoveryCommitment)` | Anchors the caller's record. Refuses the zero commitment and the zero secret's commitment. |
| `proveOwnership()` | Publishes the caller's live record in `lastOwnershipProof`. The interval since its anchor is the evidence of prior possession. |
| `pairDna(dnaCommitment)` | Binds a DNA report fingerprint to the caller's record. |
| `rotateRecordSecret(newRecord)` | Moves the identity; the caller must hold the new secret. Anchored identities only. |
| `recoverRecordSecret(origin, newRecord)` | Moves the identity with the recovery secret, whoever holds the head. |
| `replaceRecoveryCommitment(origin, new)` | Replaces a recovery secret that may have leaked. |
| `anchorBatch(root)` | Timestamps a batch root. **Unauthenticated**: inclusion in a batch is not possession. |

Every circuit derives the caller from their secret. None takes the caller's record, or
any secret, as an argument (checked by `src/test/interface.test.ts`).

## Licences

1. The **licensee** makes a licence secret and sends the issuer
   `licenseCommit(secret, issuerRecord)`. The issuer never holds the secret.
2. `issueLicense(lc)`: the issuer (an anchored identity) records it, PENDING, keyed
   `licenseKey(lc, issuer)`.
3. `countersignLicense(issuer, slot)`: the licensee proves the secret. The key becomes a
   leaf of `activeLicenses` at a random free index, so activations do not contend.
4. `proveLicense()`: the licensee proves to one verifier that they hold a live licence
   from one issuer. All inputs are witnesses. It publishes
   `presentationTag(issuer, challenge)` and the root proved against. The verifier chose
   the challenge (32 random bytes, used once, never published) and recognises the tag;
   to anyone else it names nothing.
5. `proposeTransfer` / `approveTransfer` / `withdrawTransfer`: the holder proposes a
   commitment the incoming party built; the issuer's identity approves the one it was
   shown. The leaf is replaced in place.
6. `revokeLicense(lc, issuer)`: the issuer's identity removes the licence. It needs no
   tree path and reads nothing the licensee controls, so it cannot be starved.

**Revocation takes effect in two steps.** The licence is removed at once: it cannot be
transferred, and no new path to it exists. Paths proved against earlier roots keep
verifying until the next **seal**. `sealRevocations(bound)` drops every root except the
current one. Anyone may call it, only when a revocation or transfer is waiting, and only
once the block time is at least 600 seconds (`SEAL_INTERVAL`) past the previous seal's
`bound`. `bound` must be ahead of the block time by at most 300 seconds, so two seals are
always at least 600 seconds of block time apart.

Why not drop old roots on every revocation, as version 0 did: then on chain anyone
could revoke a throwaway licence of their own each block and make every older path
fail. Sealing limits that on chain. It does not stop a griefer from costing honest
licensees re-proofs: a presentation records whether a revocation was waiting when it was
proved, so a revocation landing before it sends it back, and while one is waiting, a
verifier following rule 5 refuses a presentation whose root has since moved on. That is
a cost in re-proofs, paid in fees by the griefer too, never a wrong answer. A verifier
that wants to accept more can check the presentation's root against every root since
the last revocation or transfer, from the indexer's history. The client seals straight
after a revocation or transfer when allowed, and otherwise reports when it can.

A leaf names its issuer, so a transfer cannot forge a licence from another issuer, and
a commitment cannot be live twice under one issuer.

## Lineage

**Descent.** `proposeParent(parent)` by the child's holder, `confirmParent(child)` by
the parent's holder. The stored proposal must still name the confirming parent. The
edge is recorded between identities in `parentsOf`, so the pedigree is readable from
state. An edge means both holders said so, not that the child is biologically
descended. The DNA pairing narrows that; it does not close it.

**A record's parents are fixed once it has confirmed offspring** (`hasOffspring`). An
ancestor therefore cannot change the pedigree of material already descended from it,
and no cycle can form: the edge that would close one gives a parent a new parent.
Record a line oldest first.

**Obligations.** An obligation is `obligationKey(record identity, obligation commitment,
beneficiary identity)`. The obligation commitment is a hash of the terms, kept off chain.
- A beneficiary proposes (`proposeObligation`); it binds nobody until the holder accepts
  (`acceptObligation`). The beneficiary can withdraw an unaccepted proposal.
- A holder may place one on their own record in one step (`encumberOwnRecord`), for
  example a breeder marking a licensed mother.
- **Only the beneficiary's current head can release it** (`discharge`). After recovery,
  a thief holding an old secret cannot.
- The holder can reject a proposal (`rejectObligation`). Anyone anchored can file
  proposals against any record, at a fee each; they bind nothing, and clearing them
  costs the holder a transaction each.
- **Obligations follow material down, including ones added later.** An obligation an
  ancestor's holder accepts after a descendant was linked shows on the descendant's
  lineage too, until its beneficiary releases it.
- `obligationCountOf(identity)` counts obligations in force. It is a `Counter`, so
  concurrent accepts and discharges on one record commute rather than failing each other.

**Only anchored identities take part**, so an encumbered identity cannot be merged into
another to shed what it owes.

---

## Verifier rules

These are normative. `contract/src/verify.ts` implements rules 1 to 5, and the tests
exercise each one.

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
   recent transaction that wrote it. Read them from the indexer per transaction.
7. **Batch roots are not possession.** `anchorBatch` is unauthenticated.

## Trust model

**Proven by the contract**
- A record's holder knew its secret when anchoring, proving ownership, or acting.
- A retired commitment can do nothing.
- A licence presentation came from someone holding a live licence from the named issuer.
- An edge was agreed by both holders; an obligation by the holder and the beneficiary.
- An obligation is released only by its beneficiary's current head.

**Assumed, and stated plainly**
- **Record contents are the holder's assertion.** The chain proves when a claim was made
  and that it has not changed, not that the genetics are what the holder says.
- **Participation is voluntary.** A market-access filter, not enforcement.
- **The indexer is trusted for what it reports.** Verifiers read chain state through an
  indexer (Blockfrost for mainnet). A wrong or compromised indexer can report any state:
  make a presentation pass, or a lineage look clean. For a decision that matters, ask a
  second indexer or your own node and compare.
- **The VeilCore registry service is not the source of truth.** It stores records and
  answers lineage queries for the website, attested by VeilCore, not by the chain. Its
  lineage responses are labelled that way. Anything a decision rests on is checked
  against the contract with rule 1 to 7.

## Governance: the maintenance authority

midnight-js always installs a maintenance authority on deployment. It can add and remove
verifier keys, so it can repair or disable any circuit, and a key for a new circuit could
rewrite state: whoever holds it controls the contract. VeilCore keeps it for launch, held offline by the deployer (the client shows it before
deploying and removes it from the local store afterwards), and
will retire it on a date published in the deployment record, using
`retireMaintenanceAuthority` (api/src/maintenance.ts). Until then, holders should treat
the circuit set as changeable by VeilCore.

## Known limits

- **What a thief does before recovery stands.** Someone holding an identity's current
  secret acts as that identity until recovery: they can revoke its licences, accept
  obligations on it (including ones owed to themselves), and confirm parentage.
  Recovery stops them from then on; it does not undo those acts, and no one can remove a
  confirmed edge. Disputes of that kind are for the parties and, while it is held, the
  maintenance authority, which could add a remedy circuit. Keep secrets on devices you
  control and the recovery secret offline.
- **Licence activity is public apart from presentations.** Issue, countersign, transfer
  and revoke publish the licence commitment and the issuer. Only a presentation hides
  them. Whether fee payments can link a presentation to its countersign is an open
  question for the Midnight wallet, not this contract.
- **Licence entries grow with use.** Anyone can issue licences to themselves at a fee per
  entry. The bound is economic, not structural. Identity maps grow by one entry per
  anchor, rotation or recovery. That is the price of a retired secret ceasing to work.
- **The revocation window.** A revoked licence's old path verifies on chain until the
  next seal: up to `SEAL_INTERVAL` plus the time until someone seals. A verifier
  following rule 5 does not accept such a presentation.
- **Record commitments are stable pseudonyms.** Actions under one record link to each
  other.
- **Licences issued by a thief** before recovery stay PENDING under the identity, and
  the owner cannot revoke what it does not know. The thief can activate one later and
  present it straight away, and a verifier asking about the identity accepts it. The
  owner learns its commitment when it is countersigned (`lastActivatedLicense`) and can
  revoke it then.
- **A presentation names the issuer, not the licence.** Any live licence against a
  record passes a check about that record, including one the issuer granted itself.
  Issue licences on different terms from different records if verifiers must tell them
  apart.
- **Rotation does not unlink.** Rotation and recovery publish the old and new commitment;
  a holder who rotates keeps the same, linked identity.
- **An edge whose parent has no holder** (a landrace, a lapsed breeder) can never be
  confirmed. Such pedigrees stop there (rule 4).

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
| `attack-*.test.ts` | The 1 October attack round, one file per area. What held up passes; the attacks the fixes now block are kept as `it.fails`, so each still runs and must still fail |

The contention tests prove a call against one state and land its public transcript on a
later one with the on-chain runtime (`prove` / `land`). That is what happens when other
transactions arrive first. The preprod smoke test (`bboard-cli/src/smoke.ts`) runs the
same flows with real proofs on a real network. The attack history behind these tests is
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
