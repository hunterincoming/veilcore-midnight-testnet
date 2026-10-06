# Attack round D, 4 October 2026

Six independent reviews, each told to assume the code is broken: the fee-paying demo
service, the website, the SDK (TypeScript, Python `verify.py`, Rust), the registry, the
main contract with its operator tool and client API, and the supply chain (dependencies,
CI, publishing, deploy). The claims contract was not part of this round; it was attacked
in rounds A to C (3 and 4 October). The first set of fixes was then checked by a seventh
reviewer who had not written them, by removing each guard and confirming a test fails (32
of 36 guards had a test; the other four are covered by another layer or noted below). That
re-check (4 October, evening) also found new problems. They were fixed afterwards, and
those later fixes have **not** been checked by anyone who did not write them (see *Status,
5 October*).

Full per-finding write-ups with the original test cases are kept outside the repo.
This file is the record of what was found and what was done.

## Status, 5 October 2026

- **Registry:** the round D fixes are live. Railway runs `veilcore-api` `main` at
  `a9a9611` since about 07:30 on 5 October. It still uses SDK `veilcore-records` 0.13.0.
  Its `/.well-known` (as read on 5 October) still names the test network `preview` and
  contract `f75d42dc…` (deployed 27 September, before the merge), not mainnet.
- **Website:** the round D fixes are live since about 07:57 on 5 October (`b274acd`). The
  new site copy written on 5 October (`ea4302c` to `149484e`) is not part of round D and
  has not been attacked; it is being deployed on the evening of 5 October. The site still
  uses SDK 0.13.0.
- **SDK:** 0.15.0, with the round D SDK fixes, was published to npm on 5 October at 23:55
  UTC from `veilcore-sdk` `db91cc7`. The published package was rebuilt from that commit and
  came out byte-identical. There is no `v0.15.0` git tag and no npm provenance. The site
  and the registry have not moved to it yet.
- **Operator tool:** passed the preprod smoke test 37 of 37 on 5 October (main at
  `d9d563f`, `docs/preprod-run-5oct.md`), both contracts. Since then only one message line
  in `bboard-cli/src/smoke.ts` has changed in `bboard-cli`, `api` or `contract`.
- **Fee-paying demo service:** fixed on branch `demo-real` (`762cd6f`), which is not merged
  into `main` and not deployed. The website demo stays simulated.

**Not independently re-checked.** These came after the re-check and have been reviewed only
by whoever wrote them (plus automated tests and, for some, the 5 October Semgrep and CodeQL
scan):

- `8de6f2a`: `join` reads the real deploy transaction to check the starting state (fixes
  the re-check's Medium: the genuine contract could be refused after a key change); the
  flaky test; the interrupted-MOVE scratch copy.
- `abc1fc9`: verify links carry the record's fingerprint (`?fp=`); no ticks on the
  registry's word (fixes the re-check's Medium on the verify page).
- `2d79192` (branch `demo-real`): the demo service's two Lows from the re-check.
- `e6a1b6a`: the pinned Vercel CLI installs even when `NODE_ENV=production`.
- `5a980b3`: the claims contract's mainnet gate (deploy guard, address pin, fingerprint
  check). Not part of round D.
- Also after the re-check: registry `a9a9611` (batches only lowercase 64-hex
  fingerprints), and `b274acd` (scan follow-ups: encrypted-file GCM tag and minimum length;
  workflow token only where used).

The parts of these that run only on mainnet (fingerprint refusals, empty-pin refusals,
refusing a claims deploy that keeps an authority, joining at the pin without re-checking
the starting state) cannot run on preprod and are covered only by unit tests from the same
author. `docs/release-checklist.md` section 3 asks for a re-check of the fixes themselves;
one focused review of these commits is still to do before mainnet.

## Summary

| Area | Worst finding | Status |
|---|---|---|
| Main contract (`veilcore.compact`) | Nothing at Medium or above | Unchanged, still frozen |
| Fee-paying demo service (`sponsor/`, branch `demo-real`) | **Critical**: concurrent requests passed the limits before any were counted | Fixed on `demo-real`; not merged, not deployed |
| Website | **High** ×3: shown as anchored / lab-signed / private without checking | Fixed; live since 5 Oct (`b274acd`) |
| Operator tool and client API | Medium ×3, Low ×6 | Fixed (tool reopened: these were deploy blockers); preprod 37/37 on 5 Oct |
| Registry (veilcore-api) | Medium; plus a live bug (below) | Fixed; live since 5 Oct (`main` `a9a9611`); two Lows open (below) |
| SDK and Rust port | Wrong "valid" on malformed input in several verifiers | Fixed; no hash output changed. On npm as 0.15.0 since 5 Oct; site and registry still on 0.13.0 |
| Supply chain | **High**: demo service staged unreviewed package versions | Fixed |

## Findings

### 🚨 Critical — Race in admission (CWE-362, CWE-367)
* Location: `sponsor/src/sponsor.ts` `Sponsor.handle`
* What went wrong: the per-network quota, the duplicate guard and the budget were checked
  before an `await` and recorded after it, so requests in flight together all passed.
* Impact: one sender could spend the day's fee budget, and the same transaction could be
  paid for twice.
* Fix: quota slot, duplicate slot and a worst-case budget hold are claimed in one
  synchronous step before any wait; each request releases only what it claimed; the hold
  is lowered to the real fee once known; the fee estimate times out. Tests fail on the old
  code.

### 🚨 High — A failing duplicate cleared the winner's replay guard (CWE-362)
* Location: `sponsor/src/sponsor.ts` (NotSentError path)
* Fix: duplicate-guard entries carry the owning request; only the owner releases them.

### 🚨 High — Demo service staged unreviewed dependencies (CWE-1104, CWE-829)
* Location: `sponsor/scripts/stage.mjs`
* What went wrong: staging generated a fresh lockfile, pulling 43 versions never reviewed
  into the service that holds the fee wallet's seed, and continued if that step failed.
* Fix: staging uses the committed root lockfile, stops on any failure, and refuses any
  package whose name, version or integrity hash is not in it. Test-only key derivation
  replaced by the wallet SDK's own, proven byte-identical.

### 🚨 High — "Anchored" not tied to the record (CWE-345)
* Location: `bboard-ui/src/veilcore/proofs.ts`, verify page, certificate
* Fix: a proof counts only if its commitment is this record's and its path folds to the
  stated root. The site cannot read the chain, so it says "the registry reports an anchor",
  never "Anchored".

### 🚨 High — Lab signatures not tied to the record; retractions unchecked (CWE-347)
* Location: `bboard-ui/src/veilcore/attesters.ts`
* Fix: an attestation counts only if bound to this record's commitment and its signature
  verifies; a retraction counts only if the lab's key signed it.

### 🚨 High — "Choose what they see" did not limit what strangers got (CWE-639)
* Location: `bboard-ui` step 5 and verify page; registry `/verify/:id`
* What went wrong: the choice lived only in the link, so editing the link revealed parent
  names and breeding method.
* Fix: the holder's choice is stored on the registry as a grant
  (`PUT /api/records/:id/disclosure`, holder key required); `/verify` and `/embed` return
  only granted fields; `?show=` can only narrow.

### 🚨 Medium — Verify page trusted the registry's fingerprint (CWE-345)
* Found by the verification pass. Share links and QR codes now carry the record's
  fingerprint (`?fp=`); the page checks against it and shows no ticks, and a warning, when
  the registry's answer differs. Old links without `fp` show only "the registry reports".

### 🚨 Medium — "Removed" maintenance key still on disk (CWE-312, CWE-226)
* Location: operator tool private-state store (LevelDB keeps deleted values until compaction)
* Fix: the maintenance key and one-call secrets are never written to the store; the store
  moved to `~/.veilcore/<network>/` with owner-only permissions; the old folder is detected
  and migrated without opening it, and the operator is told to delete it.

### 🚨 Medium — Recovery-secret replacement could land while reported as failed (CWE-754)
* Fix: same "did it land?" check as rotation and recovery, two reads 30 s apart; the tool
  says which secrets to keep; new option 42 checks a secret without sending anything.

### 🚨 Medium — A look-alike contract passed `join` (CWE-345)
* Fix: `join` reads the deploy transaction and compares its starting state with this
  build's constructor; mainnet joins accept only the pinned address
  (`MAINNET_VEILCORE_ADDRESS`, set after deploy). The verification pass found the first
  version could refuse the genuine contract after a key change; fixed.

### 🚨 Medium — Registry: unbounded attestations per record (CWE-770)
* Fix: caps (vetted labs never blocked), bounded and paged reads.

### 🚨 Medium — Website: docs loaded live from the SDK's `main` (CWE-829)
* Fix: docs are built in from the pinned SDK package; GitHub removed from allowed connections.

### Other Medium and Low items fixed
Website: exported fingerprint now equals the registry's; licence fingerprint salted; lab
signing shows exactly what is signed; import validation; no key or polling for visitors who
never save; HSTS, COOP, CORP, Trusted Types; production build mode. Registry: obligation
proposal checks and paging, one bad record no longer fails a batch, one seal at a time,
transfers no longer copy private fields, constant-time operator token, Node pinned, the
copied-in contract's source recorded. SDK: small-order Ed25519 keys refused; corrections
compare only committed fields; attestations must name their subject; strict DER and hex;
verifiers return failures instead of throwing; `verify.py` reads only files inside the
package and refuses unlisted ones; publish gate. Operator tool: secret switch needs two
agreeing reads; indexer errors retried, not fatal; stale licence presentations refused;
exact circuit names; password kept out of the environment; provable retirement for the main
contract. Supply chain: root audit 14 → 0; nested lockfiles removed; react-router, vitest,
esbuild updated; site on veilcore-records 0.13.0; CI compiler pinned by checksum; Node and
npm pinned; audit step in CI; Vercel CLI pinned; CODEOWNERS.

### Live bug found along the way
Since 3 October the site seals records with `profile` (and `taxon`) in the committed
fields; the registry recomputed without them and refused those records. Fixed in
`d2db3aa`, live with the registry deploy of 5 October.

## What held
Main contract circuits; registry SQL, holder scoping and operator gating; sponsor policy
(only VeilCore's own circuits, one call, no token moves); PoW tickets; no script execution
on the site from any payload; no secrets in any repository's history; CI actions pinned to
commit SHAs; the published SDK rebuilds byte-for-byte (0.13.0 then; 0.15.0 checked the same
way on 5 October).

## Still open
- **Independent re-check** of the fixes made after the re-check, and of `5a980b3` (see
  *Status, 5 October*). Needed before mainnet.
- **Site and registry move to SDK 0.15.0.** It is published; neither has moved. Until they
  do, both use 0.13.0, which accepts small-order Ed25519 keys (SDK finding 1, High in the
  SDK), and the site's built-in `/docs/spec` is the 0.13.0 SPEC.
- **Registry Low: small-order Ed25519 keys accepted at attester registration**
  (`lineage/attesters.mjs:71`, raw `importKey` with no small-order check). Found by the
  re-check; not fixed.
- **Registry Low: an uppercase `subjectCommitment` is accepted** (`lineage/attesters.mjs:206`,
  `/^[0-9a-fA-F]{64}$/`). SDK 0.15 refuses it and the site never matches it; make it
  lowercase-only. Found by the re-check; not fixed.
- Shared spec gaps (nesting depth limit, null attestation fields, challenge `state` not
  signed), to fix in all implementations together with new vectors.
- Counter-signing by the other party of a licence needs a registry endpoint.
- Per-recipient disclosure (different links showing different fields) not built.
- Attester private key unencrypted in the browser.
- Proof-server image pinned by tag, not digest (needs a lookup from a machine with Docker Hub).
- Branch protection on the GitHub repositories (a settings change).
