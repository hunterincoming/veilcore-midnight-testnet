# VeilCore contract: attack pass, 30 Sep 2026

Last updated 1 October 2026 (final review, night). Twelve rounds in all: round 1 (this
first pass and the lineage pass, our own) and rounds 2 to 7 by reviewers who had not seen
the fixes, on 30 September; rounds 8 to 12 on 1 October, rounds 8, 11 and 12 each followed
by a fresh-session AI re-attack of their fixes. A final review followed (last section).
None of these rounds is an audit: they are AI reviews in fresh sessions, directed by the founders. Times in headings are commit times from `git log` (EDT); they
replace earlier time-of-day labels that were out of order.

> **Note, 30 Sep (round 4).** The contracts were merged into one, `veilcore.compact`, and
> the hand-rolled test scripts named below (`attack-30sep.mjs`, `attack-lineage-30sep.mjs`,
> `verify-max-*.mjs`) were replaced by the Vitest suites in `contract/src/test/`, which
> cover every attack listed here. See round 4 at the end.

**Scope:** `contract/src/veilcore.compact` at f652ae2 (the contract going to preprod and then mainnet), its witnesses, and the CLI that deploys it.
**Out of scope for now:** `lineage.compact`, which gets its own deployment and its own pass later.

**Method:** for every circuit, ask who can call it, what they feed in, and how it breaks. Then chain the circuits together, because most of the real problems only show up across two or three calls.

**Status (30 Sep, after the first fixes, 13e7704 at 05:59):** every contract finding was first confirmed by running the attack against the old build. All are now fixed on branch `security-pass-30sep`.

- `contract/attack-30sep.mjs` runs each attack against the new build, and all are refused.
- The full existing suite still passes. The 6 older test files were updated to the new circuit signatures.

| Finding | Status |
|---|---|
| H1, H2, H3 | fixed |
| H4 | fixed (CLI) |
| M1, M2, M3, M4, M6 | fixed |
| M5 | not changed, see below |
| L1, L2, L3, L4 | fixed or documented |
| L5 | CLI now has the licensee build their own commitment (menu 16 then; option 7 now) |

**Found while fixing:**

- **H4b. The CLI wrote the WALLET SEED to the log file** (`midnight-wallet-provider.ts`). This is worse than H4 if a funded wallet is ever used. Fixed: seeds and secrets now go to the screen only (`secret-out.ts`).
- **N1. After a rotation, the client kept using the retired secret.** Every later call was then refused. Fixed in `veilcore-api.ts`.
- **N2. CLI menu 4 asked the issuer for the licensee's secret and committed it with the record tag.** That made a licence that could never be countersigned. Fixed: the issuer now takes the licensee's commitment, and the licensee builds it with menu 16 (option 7 in the current menu; the issuer issues with option 8).
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
- There's no `assertLive` check, so a thief holding the old secret keeps producing control proofs after the owner has rotated away.
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
7. **Second pass:** get someone who didn't write this to attack it (an outside Midnight developer, or a paid security firm) before mainnet.


---

# Lineage contract pass (30 Sep, morning; f03ebcf at 07:10)

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

Fixed in `api/src/maintenance.ts`. "No" now means: deploy, then immediately replace the authority with a key that is never stored, and delete the local copy. CLI main menu option 33 does the same later, after typing RETIRE (it was 19 then). Both contracts' deploys ask the question.


---

# Round 2: fresh-session AI review (30 Sep, morning; fixes in 6a499a5 at 07:31)

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

# Round 3: second fresh-session AI review (30 Sep, morning; ddbfe3a at 07:42)

A fresh reviewer attacked the fixed build and found **no critical or high issues**. What they found:

| # | Finding | Status |
|---|---|---|
| M1 | The lineage verifier rule said to read `rotatedTo`, but recovery doesn't write it, so a thief's post-recovery discharge passed. | **Fixed.** The rule now says: retired exactly when `headOf(originFor(x)) != x`; replay the rotation and recovery events. It's in the lineage header, the `rotatedTo` comment and design rule 1. |
| L1 | A shared slot counter meant one licence activation per block, and anyone with DUST (which regenerates for free) could block everyone else's. | **Fixed.** The client picks a random free index, and two activations only conflict if they pick the same one. Indices are reused after revocation. Replay tests are in `attack-30sep.mjs` R2-L1. |
| L2 | The revoke comment overclaimed. A licensee can make one revoke of a pending licence fail by countersigning first. | **Comment corrected.** It can't be repeated. |
| — | The deploy comment said "empty committee". | **Corrected.** |
| — | Rotating into an unanchored record that has issued licences merges them into the mover's identity. | **Documented.** The mover holds that record's secret, so it's the same person. |


---

# Round 4: third fresh-session AI review, at the "standards body" bar (30 Sep, morning; 6f35bee at 09:11)

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

# Round 5: fourth fresh-session AI review (30 Sep, morning; c9d649f at 09:33)

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


---

# Round 6: fifth fresh-session AI review, of round 5's changes (30 Sep, morning; 0560946 at 09:47)

| # | Finding | Fix |
|---|---|---|
| M1 | `acceptPresentation` took the tag as an argument, so a licensee could hand over a tag they computed themselves, with no licence. | The tag is read from chain state; the API looks the state up by transaction id. Tested. |
| M2 | Judging on the state at the end of the block (or later) let a seal landing after the presentation hide a revocation. | Rule 5 judges on the state immediately after the presentation's own transaction. Tested with a seal following it. |
| M3 | `checkLineage` called any shared ancestor (a backcross) a cycle. | Depth-first walk tracking the current path; shared ancestors are not cycles. Tested. |
| S1 | Anyone could keep a revocation unsealed and so block every acceptance under rule 5. | `proveLicense` records the root it proved against (`lastPresentationRoot`); a presentation against the then-current root is accepted regardless. Tested with a griefer. |
| S2 | The first obligation on a record still had a read race. | The counter is created at anchor; accepting only increments. Tested concurrently. |
| S3 | Fingerprints covered keys only, not the compiled contract code or ZKIR. | Both added to `fingerprints.mjs` and the deploy check. CRLF tables handled. |
| S4 | CLI and API lineage checks ignored `accepted` and recognised roots. | Both take recognised roots and report `accepted` and `cyclic`. |
| P1 | A founding record with no parents was never accepted. | It is its own root. Tested. |
| P3 | The API's seal lead (120 s) could miss slow inclusion. | 200 s. |


---

# Round 7: sixth fresh-session AI review, of round 6's changes (30 Sep, morning; 5b23836 at 09:57)

| # | Finding | Fix |
|---|---|---|
| M1 | A licensee could cite a later transaction (such as a seal) instead of the presentation, and have a revoked licence accepted. | The lookup requires the transaction to be a successful, single `proveLicense` call and reads the state recorded for that call. |
| M2 | The midnight-js `txId` stream ignores the contract address, so a look-alike contract's state could be read. | Replaced with a direct indexer query that checks status, contract address and entry point, with a timeout (`api/src/presentation-lookup.ts`). Tested against a fake indexer for each impostor case; the preprod smoke test checks it for real. |
| S1 | The lineage walk was recursive and overflowed on very long pedigrees. | Iterative, with an explicit stack. |
| P1 | `lastPresentationRoot` hints when the licensee fetched their path. | Stated in rule 5. |


---

# Round 8: four fresh-session AI attackers, one per area (1 Oct, morning; fe3ae54 at 07:07)

Licences, lineage, identity and recovery, and the verifier and client, each attacked by a
reviewer who had seen none of the earlier rounds and was asked to prove every finding
with a test. Their tests are `contract/src/test/attack-*.test.ts`.

| Severity | Finding | Fix |
|---|---|---|
| HIGH | A revoked licensee could put a stale `proveLicense` and a `sealRevocations` in one transaction; a verifier reading state after the whole transaction saw no revocation waiting and accepted. | `proveLicense` records `lastPresentationUnsealed` at proof time and the verifier reads that, never the live flag. The lookup refuses a presentation bundled with any other call on the contract. |
| MEDIUM | A recovery secret stayed valid after use; anyone who saw it typed in could recover the identity back and replace it, locking the owner out. | `recoverRecordSecret` installs a new recovery commitment in the same call; the client shows the new secret before sending. |
| MEDIUM | An ancestor could add parents, a loop or an unrecognised root to itself after descendants were linked, failing every descendant's check permanently. | A record's parents are fixed once it has confirmed offspring (`hasOffspring`); cycles can no longer form. |
| MEDIUM | Griefers can make honest presentations re-prove, more often than the old design note said. | Documented honestly (design.md, Licences). Costs re-proofs, never a wrong answer. |
| MEDIUM | The recovery secret was shown only after the anchor transaction returned; a failure after landing lost it for good. | Shown, and stored, before the anchor is sent. |
| MEDIUM | The indexer is a trusted party, and the design said "chain state alone". | Stated in the trust model; compare a second source for decisions that matter. |
| LOW | The maintenance key stayed in the local signing-key store after deploy. | Removed from the store after deploy. |
| LOW | `checkLineage` called a never-anchored commitment clean. | Reports `anchored`; clean requires it. |
| LOW | Challenges were not tracked as used or dated. | Rule 5 now requires it of the verifier. |
| LOW | The log scrubber missed child bindings, Errors and circular objects. | Secrets are scrubbed from each finished log line. |
| LOW | A countersign that landed could be reported as failed. | The client checks the licence is active before retrying. |
| LOW | A thief's pending licences cannot be revoked until activated; obligation proposals can be piled on at the filer's cost; a presentation names the issuer, not the licence; rotation does not unlink. | Known limits, stated in design.md. |

What held up, by test: no licence forgery, no double activation, revocation cannot be
starved, no identity takeover, fork or merge, obligation counts cannot drift.

**Re-attack of the fixes, same morning (2690968 at 07:25).** A fresh reviewer confirmed all three contract
fixes hold, including two- and three-cycles in every landing order, competing
recoveries, and every revoke, transfer and seal ordering around a presentation. It found
two client problems in the changes, both fixed: a recovery or anchor that landed but
reported an error could be retried into secrets that control nothing (the client now
checks the chain first), and removing the maintenance key after deploy broke retiring it
later (option 33 now asks for it). It also noted that a seal, not only a revocation,
sends presentations in flight back to be re-proved; design.md says so. Its tests are
`contract/src/test/attack-round2.test.ts`.

# Round 9: new angles (1 Oct, morning; e0f2815 at 07:49)

Economics and denial of service, privacy, the fragmented deploy, multi-step composition,
arithmetic. Nothing critical or high. Tests: `contract/src/test/attack-round3.test.ts`.

| Severity | Finding | Fix |
|---|---|---|
| LOW/MEDIUM | `proveOwnership` named no verifier: anyone could cite the real holder's proof. | Contract: `proveOwnership(challenge)` records the challenge; rule 8 and `acceptOwnership`. |
| MEDIUM | A presentation hides its issuer only among issuers with live licences at its root; at launch that can be one. design.md said it named nothing. | Documented. |
| MEDIUM | CLI obligation terms were an unsalted hash; short terms were guessed back in about 200 tries. | Salted; the salt is shown to keep. |
| LOW | The web app fingerprints files with the record commitment. | Not on chain today; documented, to get its own salted tag before it is. |
| LOW | `join` did not notice extra circuits added by the authority. | `join` refuses circuits the build does not have. |
| INFO | A recovery left `lastRotatedFrom` from another identity; `rejectObligation` bumped the obligation counter with stale cells. | Contract: both fixed; rule 6 says to read cells with the circuit called. |
| INFO | The revocation window can run to `SEAL_INTERVAL` + 300 s + time to seal. | Documented. |

Held: the licence tree cannot practically be filled; event-cell writes do not break
presentations; counters cannot go below zero; seal arithmetic cannot wrap; nobody but the
authority can insert keys during the fragmented deploy, and rerunning it is safe.

# Round 10: front-running, disclosure, witness tampering, hash domains; and the web layer (1 Oct, morning; eac09c7 at 08:42)

**Contract:** held. Every front-running race tried (anchor, recovery, control proof,
transfer, obligation, parentage) fails for the attacker; `proveLicense` discloses only
the root, the waiting flag, the tag and two pass/fail bits and looks up no secret key;
forged paths and wrong-length witnesses are refused; the six hash domains cannot
collide. Fixed in the client and docs: a control-proof challenge is public, so CLI option
26 now issues separate licence and control-proof challenges and rule 8 forbids sharing
one. Documented: relaying, and the all-zero secret. Tests:
`contract/src/test/attack-round4.test.ts`.

**Registry and website** (veilcore-api, bboard-ui), fixed the same morning:
`/records/:localId` returned whole private records; a copied record could lock the
real holder out of the lineage layer; anyone could rename a lab or overwrite its
attestation; the verify page reported holder-typed attestations, DNA pairing and
licence counts, and a holder-chosen date, as facts; documents fetched from GitHub were
rendered unsanitised; no rate limits. See veilcore-api commit 69ff5b0 and its
`test/registry-security-1oct.test.mjs`.

# Round 11: four fresh-session AI attackers, and a re-attack (1 Oct 2026)

Four attackers worked separately, one area each: the contract and verifier; the
deploy tooling and CLI; the registry and website; and a check of every stated rule
against the code, which added 40 rule tests (`contract/src/test/rules-coverage-round11.test.ts`).

**The contract held.** No HIGH or MEDIUM finding on chain; the contract and the build did
not change. The findings were in the client, the registry, the website and the docs, and
all were fixed (vc 95e40b7, registry 982ee41). Among them:

- CLI and API: the test kit's wallet builder logged the Blockfrost project id and new
  seeds; every typed secret is now hidden and scrubbed from logs. The private-state
  password is checked at start with midnight-js's own rules, typed twice. Challenges are
  single-use, tied to their kind and valid 7 days (`ChallengeBook`), kept encrypted per
  network; options 27 and 28 enforce them. `checkOwnership` refuses a proof whose prover
  is no longer the live head. The issuer's client refuses to re-issue, or approve a
  transfer to, a commitment it revoked. The smoke test counts only real contract
  refusals as refusals.
- Registry and website: backdating through a changed fingerprint, unvetted attester keys
  shown as labs, transfer blocking and leaks, and the public view. See the registry's
  `test/attack-round11.test.mjs`.
- Docs: the overclaims corrected in README.md and design.md on 1 October (hashes,
  licence states, what is stored where, what the smoke test covers, what "live" needs).

Tests: `contract/src/test/attack-round11-contract.test.ts`,
`rules-coverage-round11.test.ts`, and `bboard-cli/src/attack-round11-deploy.test.ts`
(`cd bboard-cli && npx vitest run`).

**Re-attack of the fixes.** A fresh-session AI reviewer attacked the round 11 fixes and
found six smaller issues, plus one that predated round 11. All fixed (vc 6b7d725,
registry cee857f):

- Two CLI runs open at once could erase each other's "used" marks on challenges. The
  challenge file is now merged on every save and consumed under a lock.
- The log scrubber missed JSON-escaped forms of typed secrets.
- `revokeLicense`'s comment overclaimed: refusing a revoked commitment does not stop a
  revoked licensee who makes a new licence secret. Now stated (design.md, Known limits).
- Registry: a holder with more than 500 records could no longer save; a null
  fingerprint could keep a "first seen" date; a record could claim to correct another
  holder's record.
- Pre-existing: a transfer claim could read and stamp a record stored later under the
  same id by someone else.

Tests: `bboard-cli/src/reattack-round11.test.ts` and the registry's
`test/reattack-round11.test.mjs`.

**Local-chain smoke test (1 Oct).** Running `smoke.ts` on a local Midnight chain found a
real bug: two private-state store operations at once failed with "Database failed to
open". Fixed in 41332e1 (the store now runs one operation at a time). On 1 October the smoke
test passed 26 of 26 on the local chain. The preprod run on this build is still to do.

# Round 12 (1 Oct 2026, evening): state bounds

**Why.** Scored against Midnight's deployment rubric, the contract was a 3 on
State-Space-at-Risk: anchors, rotations, recoveries and confirmed parents added entries
nothing removed, an identity could rotate or take parents without limit, and pending
licences and obligation proposals had no limit. A 3 blocks deployment.

**What changed.** Every entry is now overwritten, cleared by the party who created it, or
capped per anchored identity: 16 rotations (reset by recovery), 16 recoveries, 2
parents, 16 obligations in force per record, 8 waiting proposals per proposer, 32
pending and 1024 active licences per issuer. Five counter maps, made at anchor, hold the
counts. A seal is now allowed when only activations changed the licence tree
(`rootsSinceSeal`), and CLI option 15 seals in that case too. Tests:
`contract/src/test/state-bounds.test.ts`. The full bound table is in `docs/design.md`,
State bounds. The fingerprints changed and must be regenerated.

**The attack on it.** A fresh-session AI attacker went after the bounds
(`contract/src/test/attack-bounds.test.ts`) and found seven issues.

| | Finding | Outcome |
|---|---|---|
| F1 | A thief with the head key fills the 32 pending-licence places; the owner cannot revoke them after recovery, because issue did not publish the licence commitment. | Fixed: issue publishes it (`lastIssuedLicense`). |
| F2 | The same for the 8 waiting-proposal places. | Fixed: a proposal publishes what, against whom and by whom (`lastProposedObligation`, `lastProposedAgainst`, `lastProposedBy`). |
| F3 | A thief spends all 16 rotations. | Fixed: recovery resets the rotation count. |
| F4 | A thief fills both parent slots with records whose holders confirm; the true parent can never be recorded. | Documented (design.md, Known limits). |
| F5 | Active licences were not counted per issuer. | Fixed: capped at 1024 (`activeLicensesBy`). |
| F6 | The root history grows with every tree change until someone seals, at most once per 600 to 900 s. | Documented; the operator runs a sealer (CLI option 15). |
| F7 | Caps are per anchored identity, so a party with many anchors, one fee each, gets more. | Documented. |

Held: a thief cannot spend recoveries; self-encumbrances and thief-activated licences
publish what the recovered owner needs to clear them; the counters stay in step across
rotations, and a countersign racing a revoke cannot decrement twice; a cap check
conflicts with concurrent calls only when the count crosses the cap.

**A second attacker on the fixed bounds** (`contract/src/test/reattack-bounds.test.ts`)
found two more ways for a thief to leave the owner stuck after recovery.

| | Finding | Outcome |
|---|---|---|
| R1 | A thief accepts 16 obligations owed to his own record; only he can release them, so the record can never take another. | Fixed: a record gets 16 more places per recovery (bounded at 272). |
| R2 | A thief activates a licence and transfers it to a new commitment no event cell showed, so the owner cannot revoke it. | Fixed: an approved transfer publishes the new commitment (`lastTransferredLicense`). |
| R3 | F4 again: thief-confirmed parents stay. | Documented. Letting a record drop a confirmed parent would let a grower shed a breeder's inherited obligations, which is worse. |
| P2 | A proposal now publishes the obligation commitment, even if rejected. | Documented: harmless when salted, as the CLI does. |

Held: `lastIssuedLicense` adds nothing linkable the issue transcript did not already
carry; `activeLicensesBy` stays in step through rotation, recovery, transfer and double
revoke; the rotation reset cannot push `originOf` past 288 entries per identity; every
circuit is under 700 ZKIR instructions (largest: approveTransfer 686).

# Final review (1 Oct, night)

Three fresh reviewers, one per area, at `56b119a`.

- **Contract and verifier:** no HIGH or MEDIUM finding. The build was reproduced byte
  for byte (the 24 `.zkir` files and `contract/index.js`). Three documentation fixes.
- **Deployment record:** about 25 accuracy items corrected in
  `docs/deployment-record-revision-4.md`. The State-Space and Privacy scores are now
  argued in the record, including why a reviewer may read either as Tier 3.
- **Operator dry run:** two blockers and several majors in the CLI, fixed the same night
  (tests in `bboard-cli/src/final-audit-cli.test.ts`): the recovery phrase can no longer
  reach the log through a menu answer or a multi-line paste; a generated maintenance key
  must be typed back from paper; the deploy logs the address and stores the key before
  sending, and option 4 accepts the paper key; the fingerprint check runs before the
  sync; a wrong password stops instead of re-syncing over saved progress; Ctrl+C during a
  deploy warns instead of stopping silently; log files are private (0600). The new deploy
  order has been tested with the transaction functions faked; it needs a run on a real
  chain (the local smoke test) before mainnet.

## Preprod smoke run, 2 October 2026

The preprod node refused the deploy with `1010: Invalid Transaction: Custom error: 171`
(OutOfDustValidityWindow: the preprod indexer, which the wallet reads the chain's time
from, was behind the chain; the sync before it had logged repeated `Wallet.Sync`
reconnects). Two operator-tool faults showed, both fixed with tests that fail on the old
code (`bboard-cli/src/preprod-1002.test.ts`):

- **The deploy took any 1010 refusal for "over the block limit"** and retried smaller at
  new addresses (three in this run), then reported a deploy that "may still have landed".
  Only the block-limit refusals now count (the wallet's fee-computation message, or the
  node's custom error 154). A 171 is tried once, its unused key dropped, and the reason
  given in plain words. Nothing could land from a 1010, so no funds were at risk.
- **Two saves of wallet progress could run at once** (the 2-minute timer and the save on
  stop), sharing one temporary file: the second failed with ENOENT, and interleaved
  writes could have left a file the password cannot open (which the tool would move
  aside, costing a fresh sync). Saves now run one at a time.

The contract is unchanged; its fingerprints still match.

## Fresh-session AI review, 2 October 2026 afternoon

Two fresh reviewers, one on the contract, one on the mainnet operator path.

**Contract:** no blocker, high or medium. Two low items, both damage a thief can do
before recovery, now in design.md Known limits: freezing an identity's parents with one
confirmation (a throwaway child), and filling the 1,024 active-licence cap. A wording fix:
design.md no longer says re-proofs are limited to "about twice per seal interval". The
contract is unchanged.

**Operator tool,** fixed with tests (`bboard-cli/src/preprod-1002.test.ts`):
- HIGH: a transaction whose confirmation never arrives (a dropped websocket the libraries
  do not report) held the run for ever with Ctrl+C refused. The third Ctrl+C now stops it,
  saying not to deploy again and to finish with option 4; the key and address were saved
  before sending.
- HIGH: a failure while adding circuit keys, after the contract existed, showed only the
  raw error. It now says the contract IS on chain, not to deploy again, and to finish with
  option 4. The key stays on the computer for it.
- MEDIUM: every node refusal (1010) other than a block limit or 171 was reported as "may
  still have landed". A 1010 was never admitted, so it now says nothing was created and to
  ask before retrying. Option 4's "no contract" and "never showed the key" messages now say
  the indexer may be behind, and not to deploy again until an explorer confirms nothing is
  there.
- MEDIUM: polkadot's websocket provider prints "disconnected from wss://…?project_id=…"
  straight to the terminal on reconnects, past the logger's scrubber. On mainnet the
  terminal itself is now scrubbed of the Blockfrost project id and typed secrets.
- LOW: option 33 (retire) now accepts the key with spaces, as option 4 does. Runbook lines
  now match what the tool prints.

A re-check of those fixes found one regression, fixed: the Ctrl+C count did not reset
between transactions, so presses during one could make a single press during a later one
force a stop. It now resets when a new transaction starts. Also: the forced-stop message
covers non-deploy transactions; a wallet save stuck on a dead connection no longer keeps
the wallet from stopping (15 s limit); terminal scrubbing leaves a byte chunk cut
mid-character untouched; a deploy over the block limit even with one key now says nothing
was created.
