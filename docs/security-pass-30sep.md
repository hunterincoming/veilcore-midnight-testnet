# VeilCore contract: attack pass, 30 Sep 2026

> **Note, 30 Sep (round 4).** The contracts were merged into one, `veilcore.compact`, and
> the hand-rolled test scripts named below (`attack-30sep.mjs`, `attack-lineage-30sep.mjs`,
> `verify-max-*.mjs`) were replaced by the Vitest suites in `contract/src/test/`, which
> cover every attack listed here. See round 4 at the end.

**Scope:** `contract/src/veilcore.compact` at f652ae2 (the contract going to preprod and then mainnet), its witnesses, and the CLI that deploys it.
**Out of scope for now:** `lineage.compact`, which gets its own deployment and its own pass later.

**Method:** for every circuit, ask who can call it, what they feed in, and how it breaks. Then chain the circuits together, because most of the real problems only show up across two or three calls.

**Status (end of 30 Sep):** every contract finding was first confirmed by running the attack against the old build. All are now fixed on branch `security-pass-30sep`.

- `contract/attack-30sep.mjs` runs each attack against the new build, and all are refused.
- The full existing suite still passes. The 6 older test files were updated to the new circuit signatures.

| Finding | Status |
|---|---|
| H1, H2, H3 | fixed |
| H4 | fixed (CLI) |
| M1, M2, M3, M4, M6 | fixed |
| M5 | not changed, see below |
| L1, L2, L3, L4 | fixed or documented |
| L5 | CLI now has the licensee build their own commitment (menu 16) |

**Found while fixing:**

- **H4b. The CLI wrote the WALLET SEED to the log file** (`midnight-wallet-provider.ts`). This is worse than H4 if a funded wallet is ever used. Fixed: seeds and secrets now go to the screen only (`secret-out.ts`).
- **N1. After a rotation, the client kept using the retired secret.** Every later call was then refused. Fixed in `veilcore-api.ts`.
- **N2. CLI menu 4 asked the issuer for the licensee's secret and committed it with the record tag.** That made a licence that could never be countersigned. Fixed: the issuer now takes the licensee's commitment, and the licensee builds it with menu 16.
- **N3. Keying licences by (licence, issuer) hid the licence commitment from the chain.** Without it nobody could rebuild the tree to get a path. Fixed: activation now publishes the licence and its issuer.
- **N4. The default private state set the recovery secret equal to the genetic secret.** Now all-zero, so a call that forgets to set it fails instead of quietly using the primary.

**Decision taken, not asked (H2):** recovery beats theft. The recovery secret overrides the primary and retires whatever the current head is, even after a thief has rotated. The flip side is that whoever holds the recovery secret owns the record, so it lives offline. `replaceRecoveryCommitment` lets a leaked one be swapped.

**Still open:**

- **Full ZK build on the laptop (`npm run compact`).** It couldn't run here because the build needs Midnight's public parameters download. This gives the real circuit sizes and the fingerprints revision 4 needs.
- **Revision 4** has to describe THIS build (new circuits and fingerprints), not a2ee6ba.
- **M5** (the licence-tree bottleneck).
- **The lineage contract**, which needs its own pass.
- **A second pair of eyes before mainnet.**

---

## HIGH

### H1. Licences get stuck after the issuer rotates their secret

`revokeLicense` accepts the issuer, or the record the issuer rotated to. That's one hop only.

- **After two rotations (A → B → C):**
  - C can't revoke licences A issued, because `rotatedTo(A)` is B, not C.
  - B can't revoke them either, because B is retired and `assertLive` fails.
  - Those licences can never be revoked by anyone.
- **After one rotation:** `approveTransfer` requires `licenseRecordOf(lc) == caller`. The successor fails that check, and the old record fails `assertLive`. Every transfer on a licence issued before the rotation is stuck.

The failing scenario: a breeder rotates away from a leaked secret, then rotates again a year later. Every licence from before the first rotation is now out of their control.

**Fix:** record the original identity once and compare against that, instead of following one hop.

```
export ledger originOf: Map<Bytes<32>, Bytes<32>>;   // set at rotation: originOf(fresh) = origin(old)
circuit origin(r: Bytes<32>): Bytes<32> { return originOf.member(r) ? originOf.lookup(r) : r; }
// authorise: origin(me) == origin(issuer) && assertLive(me)
```

- Use this in `revokeLicense` and `approveTransfer`.
- In `approveTransfer`, `licenseRecordOf(nlc)` must stay the **original issuer**, not the approver. The incoming party builds `nlc = licenseCommit(secret, issuerRecord)`, so switching the record would break their licence.

### H2. Recovery can't beat a thief, and a leaked recovery key alone takes the record

- **Stolen primary secret:** the thief calls `rotateRecordSecret` to a secret of their own. The owner's `recoverRecordSecret(A)` then fails `assertLive(A)`. The thief keeps the record permanently, and as successor can revoke every licence.
- **Leaked recovery secret:** that alone is enough to rotate the record away, instantly. The real owner can't object.

So recovery helps against loss, not theft. The spec's promise that "no role may be permanently lockable by a single lost secret" holds only for loss.

**Fix options (a design decision):**
- **Recovery overrides rotation.** Let `recoverRecordSecret` act on the origin even when it has been rotated, which reclaims it from the thief. Downside: the recovery key becomes the master key.
- **Waiting period.** Recovery goes pending for N blocks, and the primary secret can cancel it during that window. This is the standard approach, but it needs block time on the ledger. Check what Compact exposes.
- **At minimum:** state the limit honestly in the spec and the UI.

### H3. `proveLicense` doesn't prove what a verifier needs

The proof says one thing: *some* leaf of the global tree was opened. It doesn't say which breeder's licence it is, and it isn't bound to the person presenting it or to the verifier.

- Someone licensed for variety X passes when asked about variety Y.
- Every successful `proveLicense` transaction looks identical. Anyone can point a verifier at someone else's transaction and claim it's theirs.
- Old transactions stay valid-looking forever.

**Fix:** the verifier picks a random challenge, and the circuit discloses a value bound to the record and the challenge.

```
witness presentationChallenge(): Bytes<32>;   // or a public argument
const tag = persistentHash<Vector<3, Bytes<32>>>([pad(32, "veilcore:present"), licenseRecord(), challenge]);
presentationTag = disclose(tag);               // new ledger cell, or disclosed into the transcript
```

The verifier knows the record and the challenge, so they compute the same value and compare. An outside observer sees a random-looking value that links to nothing. The challenge gives freshness, and only someone holding the secret could have produced this specific transaction.

### H4. Secrets are written to plain-text log files on the laptop

`bboard-cli` logs to both the terminal and `bboard-cli/logs/<network>/<timestamp>.log`. Three things end up in those files:

- **The genetic secret:** `index.ts:207` ("Your genetic secret is: …").
- **The recovery secret, at anchor:** `index.ts:321`.
- **The maintenance authority signing key, at deploy:** `index.ts:130`. This key can disable any circuit.

The logs are gitignored, so they haven't been committed. But they sit unencrypted on disk, get picked up by backups and syncs, and pile up over time.

**Fix:**
- Print secrets to the terminal only, through a separate writer that never touches the file stream.
- Before mainnet, delete the existing log folders. Preview and preprod keys are throwaway, but get rid of the habit.

---

## MEDIUM

**M1. Rotation silently drops recovery.**
- `rotateRecordSecret` and `recoverRecordSecret` never set `recoveryOf(fresh)`, so after one rotation the record has no recovery until the holder re-anchors it.
- **Fix:** take a new recovery commitment as part of rotation and insert it.

**M2. Recovery commitments use the record tag.**
- `commit(recoverySecret)` is built with the same `"veilcore:commit"` domain as records.
- So a recovery commitment is also a valid record commitment, and its holder could anchor it as a record and issue licences against it.
- This is the same class of bug the contract's own comments warn about for licences.
- **Fix:** give recovery its own tag, `"veilcore:recover"`, in the circuit and in the CLI (`index.ts:316`).

**M3. Anyone can block `issueLicense`.**
- `licenseCommitment` is taken raw and is unique across the whole contract.
- An attacker who sees a pending issue can issue the same value first under their own record. The breeder's transaction then fails with "License already exists".
- The attacker can't hijack the licence, since countersign checks the record, but they can block it again and again.
- The comment at lines 121–124 claims the sniper "produces a DIFFERENT value". That's true for countersign, not for issue.
- **Fix:** key the maps by `hash(lc, issuerRecord)`, or accept the griefing risk and correct the comment.

**M4. `proveOwnership` still works for a retired secret.**
- There's no `assertLive` check, so a thief holding the old secret keeps producing "ownership" proofs after the owner has rotated away.
- **Fix:** add `assertLive`. Or keep the current behaviour and have verifiers check `rotatedTo`, but then document that.

**M5. The single licence-tree root is a bottleneck anyone can jam.**
- Every countersign, transfer and revoke changes `activeLicenseRoot`.
- Any in-flight `proveLicense` or tree update built against the old root then fails.
- Two honest users collide. An attacker with a few cheap self-issued licences can keep changing the root and block everyone.
- **Fix options:** accept a recent-roots window for `proveLicense` (the trade-off is that a just-revoked licence stays provable for that window), and retry logic in the SDK. Ask Nick what other Midnight projects do.

**M6. Record commitment taken from the caller** in `issueLicense`, `pairDna` and `approveTransfer`. This is Nick's flag.
- It isn't exploitable today, because the `assert` forces it to equal `commit(localGeneticSecret())`.
- Still, derive it the Battleship way and drop the parameter. Fewer inputs means fewer ways a future edit can break it.
- Do this alongside H1.

---

## LOW

- **L1.** `pairDna` writes the DNA fingerprint into `lastAnchor`, the same cell `anchor` uses for proved records. That contradicts the contract's own comment at line 52. Give it its own cell.
- **L2.** `countersignLicense`, `proposeTransfer` and `withdrawTransfer` take the licence secret as a circuit argument. Compact treats arguments as private unless disclosed, but the contract's own comment (line 163) says arguments are public. Verify which is true. Either way, move them to the existing `licenseSecret()` witness so a secret never passes through call arguments, which SDK debug logging can print.
- **L3.** The `withdrawTransfer` doc says "the proposal expires". Nothing expires. Fix the wording, or add expiry.
- **L4.** A commitment is visible in the pending `anchor` transaction, so anyone can include it in their own `anchorBatch` in the same block. A batch inclusion proves a commitment existed, not who held it. Make sure the verifier docs never treat a batch inclusion as a possession proof.
- **L5.** `proposeTransfer` doesn't check that `nlc` was built against the same issuer record. A wrong `nlc` gives the incoming party a licence they can never use. Have the SDK compute it from `licenseRecordOf`.

---

## Decision for Hunter (not a bug)

**Maintenance authority.** The CLI asks at deploy time.

- **With an authority:** you can add or replace circuits later, which is likely what Nick meant by "add circuits". But whoever holds the key can change the rules, including switching off revocation.
- **Without one:** nobody can change it, but it can't be repaired either. Midnight proof-system upgrades may need new verifier keys.

If you choose "with", keep the key off the laptop (see H4) and say so publicly. **Ask Nick** what other mainnet projects do.

---

## Order of work

1. **H1** together with **M6**. They touch the same circuits.
2. **H4.** Small change, do it before any preprod run.
3. **H3.** Changes how verification works, so the spec and SDK change too.
4. **H2** and **M1**, once the recovery design is decided.
5. **M2**, **M3**, **M4**, then the lows.
6. Rerun the full test suite and add one regression test per finding.
7. **Second pass:** get someone who didn't write this to attack it (Max, or Timur at Guvenkaya) before mainnet.


---

# Lineage contract pass (30 Sep, afternoon)

Every attack was confirmed against the previous build first. The fixes live in
`contract/attack-lineage-30sep.mjs`: 60+ checks, all refused.

| # | Finding | Fix |
|---|---|---|
| LH1 | **Anyone could poison any record.** `encumber` was callable by anyone against anyone. The record then failed every clean proof, and only the attacker could release it. | Obligations need consent. The beneficiary proposes, the record holder accepts, and only the beneficiary releases. |
| LH2 | **A squatter locked out the real claim.** One tree slot held one leaf. Grinding a secret into a victim's slot took about 81 seconds. | The tree is replaced by sets keyed by the whole obligation. There are no slots, and a record can carry several obligations. |
| LH3 | **Stale-proof window.** Clean proofs accepted any of the last 8 roots, so a seller could beat a fresh encumbrance. | Clean proofs read the current state. |
| LM1 | **Caller identity taken as an argument** in `proposeParent`, `confirmParent` and `withdrawParent`. | Derived from the secret, with one witness only. |
| LM2 | **Empty inputs accepted.** An all-zero parent, record, obligation or ancestor went through. | All are refused. |
| LM3 | **`lineage-checks.mjs` exited 0 even when it found something.** | It now fails the build. |

**What we gave up:** nothing. The tree carried no privacy, because encumbrances and clean proofs already published the record. The prover keys get much smaller as a result, since there are no 24-level path folds. Confirm the sizes with the laptop build.

**Still open for lineage:**

- **The two contracts cannot read each other.** Rotating a secret in provenance gives a new commitment with a clean lineage history. The verifier rule in `docs/design.md` (rule 1) covers this: resolve every record through `originOf` / `rotatedTo`. The SDK verifier and the verify page must implement it.
- **The registry's lineage service** (the separate `veilcore-api` repo on Railway) was built on the tree. It has to move to the consent-based model before this contract is deployed.

# Both contracts: maintenance authority

**MA1. "Deploying with NO maintenance authority" was false.** midnight-js does `signingKey ?? sampleSigningKey()`, so leaving the key out creates an authority with a random key, stored in the local signing-key database.

Fixed in `api/src/maintenance.ts`. "No" now means: deploy, then immediately replace the authority with a key that is never stored, and delete the local copy. CLI menu 19 does the same later, after typing RETIRE. Both contracts' deploys ask the question.


---

# Round 2: independent review (30 Sep, evening)

A separate reviewer, who had not written or seen the fixes being made, attacked both contracts. They demonstrated every finding below against the compiled build. All are now fixed, and each has a regression test in `attack-30sep.mjs`.

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | CRITICAL | **A transfer could forge a licence from another issuer.** The tree leaf was the bare licence commitment. M could transfer her own licence to `licenseCommit(x, B)` and present as B's licensee with no involvement from B. The same commitment could also sit in the tree twice, so B's revocation left the other copy presentable. | The leaf is now `licenseKey(licence, issuer)`, so it names its issuer and appears at most once. |
| F2 | HIGH | **Revocation could be starved.** Revoke needed a path against the current root and read the pending-transfer map, so a licensee toggling a transfer proposal each block kept every revocation from landing. Any tree change also broke every in-flight presentation. | The hand-rolled tree was replaced by the ledger's own `HistoricMerkleTree`. Writers need no path, and revoke reads nothing the licensee can change. Presentations survive activations. Revocations and transfers drop older roots, so they take effect at once. |
| F3 | HIGH | **A thief could block recovery forever.** Recovery read the current head, so rotating again before the recovery landed made it fail. | Liveness is now "is the current head" (`headOf`). Recovery writes the new head without reading the old one. |
| LM1 | MEDIUM | **A thief with a beneficiary's retired secret could discharge a lineage obligation.** | The verifier rule now covers discharges (lineage header, design rule 1). |
| La | LOW | **Anchoring with `recoveryCommit(all-zero)` let anyone recover the record.** | Refused. |
| Lb | LOW | **Rotating an unanchored record stranded it.** | Rotation now requires an anchored identity. |
| — | LOW | **Obligation count contention.** | Disclosed. The worst case is a retry. |

A side effect of the tree change: the CLI and API no longer keep their own licence tree, because the path witness reads the ledger at proving time. The old CLI only worked against a contract deployed in the same session.

**Test totals now:** 106 provenance attack checks and 51 lineage attack checks, all refused, plus the full existing suite.


---

# Round 3: second independent review (30 Sep, night)

A fresh reviewer attacked the fixed build and found **no critical or high issues**. What they found:

| # | Finding | Status |
|---|---|---|
| M1 | The lineage verifier rule said to read `rotatedTo`, but recovery doesn't write it, so a thief's post-recovery discharge passed. | **Fixed.** The rule now says: retired exactly when `headOf(originFor(x)) != x`; replay the rotation and recovery events. It's in the lineage header, the `rotatedTo` comment and design rule 1. |
| L1 | A shared slot counter meant one licence activation per block, and anyone with DUST (which regenerates for free) could block everyone else's. | **Fixed.** The client picks a random free index, and two activations only conflict if they pick the same one. Indices are reused after revocation. Replay tests are in `attack-30sep.mjs` R2-L1. |
| L2 | The revoke comment overclaimed. A licensee can make one revoke of a pending licence fail by countersigning first. | **Comment corrected.** It can't be repeated. |
| — | The deploy comment said "empty committee". | **Corrected.** |
| — | Rotating into an unanchored record that has issued licences merges them into the mover's identity. | **Documented.** The mover holds that record's secret, so it's the same person. |


---

# Round 4: third independent review, at the "standards body" bar (30 Sep, morning)

A fresh reviewer, told to review as a senior Midnight engineer and a standards body
would, attacked the fixed build and the registry service. Every finding below was
confirmed before it was fixed.

| # | Finding | Fix |
|---|---|---|
| 1 | **Lineage could not cope with rotation or recovery.** It knew parties only by raw commitment. A beneficiary who rotated or recovered could never release what they were owed; a holder who rotated passed a clean check. State layout made it unpatchable after deploy. | **Merged lineage into `veilcore.compact`, keyed by identity (origin).** Only anchored identities take part, so an encumbered identity cannot be merged into another. Tests: `lineage.test.ts`, "obligations survive rotation and recovery". |
| 2 | **Anyone could cancel every licence presentation in flight,** once per block, by revoking a throwaway licence of their own: every revocation reset the tree's history. | **Revocation no longer resets history.** `sealRevocations` does, at most once per 600 s and only when something is waiting. A seal keeps the current root, so it only cancels presentations proved against an older one. Tests: `licences.test.ts`, "revocation and sealing". |
| 3 | **The registry's lineage answers were not backed by the chain,** and its header said they were. | Responses labelled registry-attested; header corrected (veilcore-api repo). The contract now holds the pedigree in state (`parentsOf`), and `verify.ts` checks lineage from chain state alone. |
| 4 | **The deploy prompt defaulted to retiring the maintenance authority,** making any flaw permanent. | Defaults to keep; retiring needs typing RETIRE. Governance statement in `design.md`. |
| 5 | A recovery secret stayed in private state if the transaction failed. | Cleared in `finally`, as are the incoming and challenge secrets. |
| 6 | A mempool watcher could take a licensee's slot first. | The client retries with a new random slot. |
| 7 | No versioning, no test vectors, no normative verifier spec. | Tags are `veilcore:v1:*`; `protocolVersion` is on chain; `contract/vectors/v1.json` is checked against the contract and against plain SHA-256; "Verifier rules" in `design.md` are normative. |
| 9 | Licences a thief issued before recovery stay pending. | Documented under "Known limits". |
| — | `assertLive` and `licenseStatus` were public circuits for no reason (the second leaked what was looked up). `proveAncestorClean` proved a public fact. | Removed. 23 circuits. |
| — | Stale comments, changelog-style headers, 19 ad-hoc test scripts, typing gaps, a broken `prepack`, a CLI that turned mistyped hex into wrong bytes. | Cleaned up. Tests are Vitest with a simulator, as in Midnight's examples. The CLI refuses anything but 64 hex characters. |

Not changed: finding 8 (anyone holding a record's body can store a copy in the registry
and make its holder ambiguous there). It affects the registry service only, not the
contract, and is tracked for the registry.


---

# Round 5: fourth independent review (30 Sep, afternoon)

A fresh reviewer attacked the merged contract. No forgery or starvation issue was found
in the contract. Findings and fixes:

| # | Finding | Fix |
|---|---|---|
| M1 | Verifier rule 5 accepted a presentation that landed while a revocation was unsealed, if the verifier "waited". | Rule rewritten: judge against the state at the end of the presentation's block; reject if `unsealedChanges`. `verify.ts` `acceptPresentation` implements it; tested. |
| M2 | What a thief does with a stolen current secret before recovery (revocations, accepted obligations, confirmed edges) survives recovery, undocumented. | Documented under Known limits; a test pins the behaviour; the CLI says so after recovery. |
| M3 | The deploy guard trusted a declared number; nothing tied the deployed keys to the record. | Mainnet deploy refused unless every key matches the committed `docs/fingerprints.md`, which now also records the compiler version. |
| S1 | `checkLineage` reported cycles with no roots as passable, and ignored an obligation on the record itself. | Reports `cyclic`, includes the record, and `accepted` requires recognised roots. Tested. |
| S2 | Rotating into an unanchored commitment carried its earlier events into the identity. | Only anchored identities can act, other than to anchor. |
| S3 | The CLI let the licensee make the verifier's challenge. | Removed; the verifier makes it (option 26) and checks the presentation (option 27). |
| S4 | The obligation count was read-modify-write, so accepts and discharges on one record failed each other. | `Map<Bytes<32>, Counter>`; concurrent calls commute. Tested with prove/land. |
| S5 | Two post-seal tests could not fail (they used a fresh path, which does not exist after revocation). | Rewritten on the saved old path, asserting "stale". Mutation check: removing the seal's reset now fails five tests. |
| S6 | Two seals could land about 301 s apart, because the seal time could be claimed in the past. | The seal takes an upper bound on the block time; the next needs block time ≥ that bound + 600 s. Tested at 600 and 601 s. |
| — | `rotatedTo` was dead state; `LicenseState.NONE` never stored; pending obligations could pile up. | Removed, removed, `rejectObligation` added. |
