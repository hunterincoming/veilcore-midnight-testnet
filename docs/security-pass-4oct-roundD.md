# Attack round D, 4 October 2026

Six independent reviews, each told to assume the code is broken: the fee-paying demo
service, the website, the SDK (TypeScript, Python `verify.py`, Rust), the registry, the
main contract with its operator tool and client API, and the supply chain (dependencies,
CI, publishing, deploy). Every fix was then checked by a seventh reviewer who had not
written it, by removing each guard and confirming a test fails (32 of 36 guards had a
test; the other four are covered by another layer or noted below).

Full per-finding write-ups with the original test cases are kept outside the repo.
This file is the record of what was found and what was done.

## Summary

| Area | Worst finding | Status |
|---|---|---|
| Main contract (`veilcore.compact`) | Nothing at Medium or above | Unchanged, still frozen |
| Fee-paying demo service (`sponsor/`, branch `demo-real`) | **Critical**: concurrent requests passed the limits before any were counted | Fixed |
| Website | **High** ×3: shown as anchored / lab-signed / private without checking | Fixed |
| Operator tool and client API | Medium ×3, Low ×6 | Fixed (tool reopened: these were deploy blockers) |
| Registry (veilcore-api, branch `ots`) | Medium; plus a live bug (below) | Fixed on `ots`, not live |
| SDK and Rust port | Wrong "valid" on malformed input in several verifiers | Fixed; no hash output changed |
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
fields; the registry recomputed without them and refused those records. Fixed on `ots`
(`d2db3aa`). Goes live with the registry merge.

## What held
Main contract circuits; registry SQL, holder scoping and operator gating; sponsor policy
(only VeilCore's own circuits, one call, no token moves); PoW tickets; no script execution
on the site from any payload; no secrets in any repository's history; CI actions pinned to
commit SHAs; the published SDK rebuilds byte-for-byte.

## Still open
- Shared spec gaps (nesting depth limit, null attestation fields, challenge `state` not
  signed), to fix in all implementations together with new vectors.
- Site and registry move to SDK 0.15.0 once published.
- Counter-signing by the other party of a licence needs a registry endpoint.
- Per-recipient disclosure (different links showing different fields) not built.
- Attester private key unencrypted in the browser.
- Proof-server image pinned by tag, not digest (needs a lookup from a machine with Docker Hub).
- Branch protection on the GitHub repositories (a settings change).
