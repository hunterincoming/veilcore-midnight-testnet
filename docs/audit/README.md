# VeilCore audit pack

Prepared 6 October 2026 for Guvenkaya's review of the VeilCore contracts. Everything here
was checked against the code at `a3d1884` on 6 October; where a number was measured, the
command that measured it is given. Where another document in this repository says
something different, section 10 lists it.

Contents:

1. Scope and the proposed frozen commit
2. Building exactly
3. Running the simulators and tests
4. Circuit map: main contract (`veilcore.compact`)
5. Circuit map: claims contract (`veilcore-claims.compact`)
6. Trust boundaries
7. Known limitations and accepted risks
8. History of internal attack rounds
9. Open questions for you
10. Statements elsewhere in this repository that are out of date
11. Claims-only scope

Security contact: `SECURITY.md` (hunter@veilcore.org, or GitHub private vulnerability
reporting).

---

## 1. Scope and the proposed frozen commit

### In-scope files

| File | Lines | Code lines | Last changed | What changed it |
|---|---|---|---|---|
| `contract/src/veilcore.compact` | 734 | 463 | `ceb3a16`, 1 Oct | per-identity state bounds (round 12) |
| `contract/src/veilcore-claims.compact` | 345 | 200 | `cd30c11`, 4 Oct | layout change so every circuit is at most k=17 |
| `contract/src/schnorr.compact` | 58 | 37 | `74e529c`, 3 Oct | fixes from claims attack rounds A and B |
| `contract/src/witnesses.ts` | 175 | 93 | `95e40b7`, 1 Oct | round 11 (`revokedLicenses` bookkeeping field) |
| `contract/src/claims.ts` | 167 | 126 | `cd30c11`, 4 Oct | layout change |
| `contract/src/verify.ts` | 463 | 332 | `99008f4`, 4 Oct | round D (`acceptPresentationAt`, `MAX_PRESENTATION_AGE_MS`) |
| `contract/src/verify-claims.ts` | 694 | 578 | `bdad91a`, 4 Oct | round C |
| `contract/src/field-schema.ts` | 464 | 382 | `bdad91a`, 4 Oct | round C (`ledgerIdentity` committed) |
| `contract/src/fields.ts` | 198 | 141 | `cd30c11`, 4 Oct | layout change |
| `contract/src/attest.ts` | 124 | 78 | `bdad91a`, 4 Oct | round C (`isSigningKey`, `verifyRecordSignature`) |
| **Total** | **3,422** | **2,430** | | |

"Code lines" excludes blank lines and lines that start with `//`, `/*` or `*`. That gives
the 2,430 you measured at `b274acd`. The in-scope files are byte-identical at `b274acd`
and `a3d1884` (`git diff --quiet b274acd a3d1884 -- <the ten paths>` exits 0).

Last-changed commits, in full: `ceb3a1606e29fb87da3def2d0c69036e99f1f055`,
`cd30c1132a587cb95b6077933c63654c88b5dd3a`, `74e529c8e8ffbe967f72cce2ce6f134bfcd899f8`,
`95e40b7ee53c3c42de981e52e7c8774713a6b559`, `99008f47fc33c8137a0fc8a46740448973ec3e6e`,
`bdad91af5eec925805c2afddf57eec7dcadc1548`. The newest is `99008f4` (4 October, 20:14 EDT),
which reached `main` through the merge `e710882` (4 October, 20:56). Every commit on
`main`'s first-parent line from `e710882` to `a3d1884` has the ten files exactly as they are
now. (Two side-branch commits merged later, `ed46027` and `726bda1`, were forked before
`99008f4` and carry older copies; neither is on that line.)

### Proposed frozen commit

**The commit on `main` that adds this file** (documentation only, on top of `a3d1884`; its
hash is in the kickoff message, since a file cannot name its own commit). For the in-scope
files it is identical to `a3d1884`, `b274acd` and `99008f4`. Check it with:

```sh
git diff --quiet 99008f4 <pinned commit> -- contract/src/veilcore.compact \
  contract/src/veilcore-claims.compact contract/src/schnorr.compact contract/src/witnesses.ts \
  contract/src/claims.ts contract/src/verify.ts contract/src/verify-claims.ts \
  contract/src/field-schema.ts contract/src/fields.ts contract/src/attest.ts && echo identical
```

Why the latest `main` and not `99008f4` itself: later commits changed the build around
the in-scope files, though not the files. `ed46027` removed `contract/package-lock.json`
(the root lockfile covers the workspace) and pinned the compiler and Node in CI; `5a980b3`
added the claims table and the `--claims` and `--check` modes to
`contract/fingerprints.mjs`; `d9d563f` made the lockfile acceptable to npm 10 and current
npm 11; `765cab1` committed the claims fingerprints. At `99008f4` there is no
`npm run fingerprints:check` and no claims table. The latest `main` is the build the
deployment record describes.

Adjacent code that is not in the list but sits on the trust path (section 6):
`contract/src/veilcore.ts` (the main contract's compiled wrapper and
`startsFromConstructor`), `api/src/presentation-lookup.ts` (finds the state recorded for
one call, which `verify.ts` then judges), `api/src/claims-api.ts` (`readClaim`,
`assertClaimsDeployAllowed`), `api/src/maintenance.ts`
(`retireMaintenanceAuthorityProvably`), `api/src/starting-state.ts` and
`api/src/deploy-guard.ts`. The compiler's output (`contract/src/managed/*/contract/index.js`)
is what the tests and the clients run.

---

## 2. Building exactly

### Toolchain

| Tool | Version | Where it is pinned |
|---|---|---|
| Compact compiler | `compactc` 0.31.1, language version 0.23 (`pragma language_version 0.23` in both contracts) | `.github/workflows/ci.yaml` |
| Node.js | 24.11.1 | `.nvmrc`; CI uses it |
| npm | 11.6.2 (ships with Node 24.11.1) | CI fails on any other |
| Proof server (only for live networks) | `midnightntwrk/proof-server:8.0.3`, pinned by digest (`sha256:8e6c36c3…17ab`) | runbook, `bboard-cli/proof-server.yml` |
| midnight-js | 4.1.1; ledger 8 | root `package.json` |

Install the compiler the way CI does: the Linux release asset, checked against the SHA-256
recorded in CI. The checksum below is the one in `ci.yaml`; the zip we built with on 6
October matches it.

```sh
V=0.31.1
curl -fsSL -o compactc.zip \
  "https://github.com/midnightntwrk/compact/releases/download/compactc-v$V/compactc_v${V}_x86_64-unknown-linux-musl.zip"
echo "e291b4bab4d4e857707008f8b1c25c2b8e0c843f6c737d0ee6c0d9ac69a6bbfb  compactc.zip" | sha256sum -c -
mkdir -p compactc && unzip -q compactc.zip -d compactc
# contract/package.json calls `compact compile`; CI puts a one-line shim in front of compactc:
printf '#!/usr/bin/env bash\n[ "$1" = compile ] || exit 2; shift; exec "%s/compactc" "$@"\n' "$PWD/compactc" > compactc/compact
chmod +x compactc/compact && export PATH="$PWD/compactc:$PATH"
compact compile --version   # must print 0.31.1
```

On macOS, `compact update 0.31.1` with Midnight's `compact` tool installs the same version.
We have recorded a checksum only for the Linux asset; check a macOS download against the
GitHub release page.

### Build

```sh
git checkout <pinned commit>
npm ci                         # at the repository root (npm workspaces)
cd contract
npm run compact                # both contracts, keys included
npm run fingerprints:check     # compares the build with docs/fingerprints.md; writes nothing
```

`npm run compact` runs
`compact compile src/veilcore.compact ./src/managed/veilcore && compact compile src/veilcore-claims.compact ./src/managed/veilcore-claims`.
Generating keys downloads Midnight's public proving parameters
(`midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p*`), so it
needs that host. Without it, `compact compile --skip-zk` produces the ZKIR files and the
contract code, which is all the simulators and tests need; it produces no keys and no
`.bzkir` files.

Expected output of `npm run fingerprints:check` on a full build that matches:

```
main contract: all 97 artefacts match docs/fingerprints.md.
claims contract: all 21 artefacts match docs/fingerprints.md.
```

97 rows for the main contract: a prover and a verifier key for each of its 24 circuits, two
ZKIR forms (`.zkir`, `.bzkir`) of each, and `contract/index.js`. 21 for the claims contract:
the same for its 5 circuits. The tables carry the commits they were built at: `ceb3a16`
(main, committed in `e89a387`) and `c75c155` (claims, committed in `765cab1`). Neither
contract's source has changed since.

**What has been reproduced, and what has not.** On 6 October we rebuilt both contracts
with `--skip-zk` and the checksummed 0.31.1 compiler from `a3d1884`: all 24 `.zkir` files and
`contract/index.js` of the main contract, and all 5 `.zkir` files and `contract/index.js`
of the claims contract, match the committed tables byte for byte (31 of the 118 rows). The
other 87 rows (keys and `.bzkir`) were built once, on Hunter Roberts's Mac, and have not
been reproduced by anyone else: the environment we work in cannot reach the parameter
host. **Your `fingerprints:check` result on a full build would be the first independent
check of the keys.** We do not know whether key generation is deterministic for a given
compiler and parameter set; if your keys differ, that is worth knowing in itself.

CI (`.github/workflows/ci.yaml`) compiles with the checksummed compiler and runs
`npm run ci` in `contract/` (compact, typecheck, lint, build, test). It does not run
`fingerprints:check`.

### Circuit sizes

```sh
cd contract
ZKIR=<path to the zkir binary that ships with compactc> bash scripts/circuit-sizes.sh
```

prints the claims circuits and fails if any is above k=17. Measured on 6 October:

| Claims circuit | k | rows |
|---|---|---|
| `proveAttested` | 13 | 6,371 |
| `proveDistinct` | 17 | 128,015 |
| `proveRange` | 16 | 34,828 |
| `proveUnchanged` | 17 | 123,547 |
| `proveValue` | 15 | 29,339 |

Main contract (same tool, `zkir mock-compile` on each `.zkir`): `anchorBatch` and
`sealRevocations` k=9; `confirmParent`, `pairDna`, `proposeParent`, `proveOwnership`,
`withdrawParent` k=13; the other 17 k=14. The largest by rows is `proveLicense` (15,575).

---

## 3. Running the simulators and tests

The tests run the compiled circuits in Midnight's JS runtime against an in-memory ledger.
No chain, proof server or keys are needed (`--skip-zk` is enough).

| Simulator | What it adds |
|---|---|
| `contract/src/test/veilcore-simulator.ts` | Main contract, one party at a time, block time set by the test. It can **prove** a call against one state and **land** its public transcript on a later one (`prove` / `land`), which is how the contention and front-running attacks are tested. |
| `contract/src/test/claims-simulator.ts` | Claims contract. Witnesses are whatever the test supplies, passed straight to the compiled circuits, so every witness is attacker-controlled. Also `prove` / `land`. |

### Commands and expected counts

```sh
cd contract
npm test                                   # vitest run, every suite in src/test/
```

On 6 October, at `a3d1884` on a 2-vCPU Linux machine (Node 22.22.2 with npm 10, not the
pinned 24.11.1; `npm ci` accepted the lockfile), built with `--skip-zk`:

```
Test Files  32 passed (32)
     Tests  528 passed | 9 expected fail | 1 skipped (538)
  Duration  221.33s
```

- **9 expected fail** are attacks kept as `it.fails`: they must keep failing.
- **1 skipped** is the 1,024-active-licences cap (`attack-bounds.test.ts`, "F5 ACTIVE
  licences"), about 2,000 circuit calls. Run it with
  `SLOW_TESTS=1 npx vitest run src/test/attack-bounds.test.ts`: on 6 October that file
  passed 16 of 16 in 3 min 17 s, the slow test included.
- `fuzz-invariants.test.ts` reads `FUZZ_RUNS` (default 4), `FUZZ_STEPS` (default 80),
  `FUZZ_SEED` (replay one failure) and `FUZZ_STATS`.
- The claims side alone: section 11.

Outside `contract/`, these exercise in-scope behaviour from the client side:

```sh
cd contract && npm run build && cd ../api && npm run build && npm test
```

runs `test-deploy-guard.mjs` (which networks need the record revision; 36 rows),
`test-presentation-lookup.mjs` (rule 5's transaction lookup against a fake indexer: a
look-alike contract, a later seal, a bundled seal, two presentations in one transaction,
failed transactions) and `test-maintenance.mjs` (the empty-committee retirement applied to a
real ledger-v8 state: afterwards the old key, any other key and an unsigned update are
refused). All three passed on 6 October.

The operator tool's own suites (`cd bboard-cli && npx vitest run`) and the end-to-end smoke
test (`bboard-cli/src/smoke.ts`, 37 checks with real proofs, both contracts, last passed on
preprod on 5 October: `docs/preprod-run-5oct.md`) are outside your scope.

### Test files, by what they cover

Main contract: `records`, `licences`, `lineage`, `interface` (published vectors, protocol
version, the circuit list, no secret or caller record taken as an argument),
`state-bounds`, `deploy-fragments`, `fuzz-invariants`; attacks from the rounds in section 8:
`attack-round2` to `attack-round4`, `attack-identity`, `attack-licences`, `attack-lineage`,
`attack-verifier`, `attack-round11-contract`, `rules-coverage-round11` (one test for each
stated rule, 40), `attack-bounds`, `reattack-bounds`, `final-audit-contract`,
`hardening-roundD`; mutation follow-ups `mutation-gaps` and `mutation-gaps-verifier`.

Claims contract: section 11.

Vectors: `contract/vectors/v1.json` (the six `veilcore:v1:*` hashes, checked against the
compiled contract and plain SHA-256), `fields-v1.json` (field sets, schema ids,
canonicalisation and rejections, shared with the SDK), `ledger-identity-sdk.json`.

---

## 4. Circuit map: main contract (`veilcore.compact`)

**Shared helpers.** `liveSelf()` (line 257) is the only place the caller's record is
derived: `disclose(commit(localGeneticSecret()))`, then `assertLive`. `anchoredSelf()` adds
"belongs to an anchored identity"; `myIdentity()` returns that identity (origin).
`originFor(x)` is `originOf(x)` if set, else `x`. `assertLive(r)` reads `headOf`. No
circuit takes the caller's record or any secret as an argument (`interface.test.ts`).

**Witnesses** (7): `localGeneticSecret`, `incomingGeneticSecret`, `recoverySecret`,
`licenseSecret`, `licenseRecord`, `licensePath`, `presentationChallenge`. All are plain
reads from private state in `witnesses.ts` except `licensePath`, which computes the leaf
from the licence secret and record and asks the ledger for its path at proving time
(`findPathForLeaf`).

**Pure circuits** (no keys, used by clients and verifiers): `commit`, `recoveryCommit`,
`licenseCommit`, `licenseKey`, `presentationTag`, `obligationKey`. Each is SHA-256
(`persistentHash`) over a 32-byte tag `veilcore:v1:*` and 32-byte inputs
(design.md, *Hashes*).

**`disclose()`**: 44 calls in the file, listed per circuit below; "self" means the one in
`liveSelf`. Line numbers are those of `veilcore.compact` at the frozen commit.

| Circuit (line) | Purpose | Witnesses | `disclose()` | State written (and read) | Design rule (docs/design.md) |
|---|---|---|---|---|---|
| `anchor(recoveryCommitment)` (317) | Make the caller's record an origin and fix its recovery commitment | local | self; `recoveryCommitment` | `anchorSeq`, `lastAnchor`, `recoveryOf`, and a zero counter in each of `obligationCountOf`, `rotationsOf`, `recoveriesOf`, `pendingObligationsBy`, `pendingLicensesBy`, `activeLicensesBy` (reads `originOf`, `headOf`, `recoveryOf`) | *Identity*; *Records*; *State bounds* (7 permanent entries per anchor). Refuses the zero recovery commitment and `recoveryCommit(0)` |
| `anchorBatch(root)` (338) | Timestamp a batch root. Unauthenticated | none | `root` | `batchSeq`, `lastBatchRoot` | *Records*; rule 7 (inclusion is not possession) |
| `proveOwnership(challenge)` (350) | Answer one verifier's challenge as the live, anchored head | local | self; `challenge` | `proofSeq`, `lastOwnershipProof`, `lastOwnershipChallenge` | *Records*; rule 8 |
| `pairDna(dnaCommitment)` (361) | Record a DNA-report fingerprint against the caller's record (the holder's statement) | local | self; `dnaCommitment` | `pairSeq`, `lastPairedRecord`, `lastPairedDna` | *Records* |
| `rotateRecordSecret(newRecordCommitment)` (372) | Move an anchored identity to a new secret the caller holds | local, incoming | self; `newRecordCommitment` | `rotationsOf[origin]`+1, `originOf`, `headOf`, `rotationSeq`, `lastRecoveredOrigin`=0, `lastRotatedFrom`, `lastRotatedTo` | *Identity* (target unused; anchored only; `MAX_ROTATIONS` 16); rules 1, 6 |
| `recoverRecordSecret(recordCommitment, newRecordCommitment, newRecoveryCommitment)` (398) | Move an identity with its recovery secret, whoever holds the head; install a new recovery commitment | recovery, incoming | `recordCommitment`; `newRecoveryCommitment`; `newRecordCommitment` | `recoveriesOf`+1, `rotationsOf` reset to 0, `recoveryOf`, `originOf`, `headOf`, `rotationSeq`, `lastRecoveredOrigin`, `lastRotatedFrom`=0, `lastRotatedTo` | *Identity* (writes the head without reading it; a recovery uses up the secret; `MAX_RECOVERIES` 16); *Trust model* |
| `replaceRecoveryCommitment(recordCommitment, newRecoveryCommitment)` (425) | Swap a recovery secret that may have leaked | recovery | `recordCommitment`; `newRecoveryCommitment` | `recoveryOf` | *Records* |
| `issueLicense(licenseCommitment)` (442) | Issuer records a licence PENDING, keyed `licenseKey(lc, issuer)` | local | self; `licenseCommitment` | `pendingLicensesBy`+1, `licenseStatusOf`, `lastIssuedLicense` | *Licences* 2; `MAX_PENDING_LICENSES` 32 |
| `countersignLicense(recordCommitment, slot)` (457) | Licensee proves the licence secret; leaf placed at a client-chosen free slot | licence | `recordCommitment`; `licenseKey(lc, rc)`; `slot`; `lc` | `licenseStatusOf`=ACTIVE, `pendingLicensesBy`−1, `activeLicensesBy`+1, `activeLicenses.insertIndex`, `licenseSlotOf`, `licenseAtSlot`, `rootsSinceSeal`, `lastActivatedLicense`, `lastActivatedRecord` | *Licences* 3; `MAX_ACTIVE_LICENSES` 1024 |
| `proposeTransfer(recordCommitment, newLicenseCommitment)` (484) | Holder proposes a commitment the incoming party built | licence | `recordCommitment`; licence key; `newLicenseCommitment` | `transferSeq`, `pendingTransferOf` | *Licences* 5 |
| `approveTransfer(licenseCommitment, issuingRecord, expectedNewLicense)` (502) | Issuer's identity approves the commitment it was shown; leaf replaced in place | local | self; `issuingRecord`; `licenseCommitment`; `expectedNewLicense` | removes old key from `licenseStatusOf`, `pendingTransferOf`, `licenseSlotOf`; inserts new key in `licenseStatusOf`, `licenseSlotOf`, `licenseAtSlot`, `activeLicenses`; `unsealedChanges`, `transferSeq`, `lastTransferredLicense` | *Licences* 5; *Known limits* (no list of revoked licences) |
| `withdrawTransfer(recordCommitment)` (526) | Holder withdraws its proposal | licence | `recordCommitment`; licence key | `pendingTransferOf` removed, `transferSeq` | *Licences* 5 |
| `revokeLicense(licenseCommitment, issuingRecord)` (539) | Issuer's identity removes a licence; needs no path, does not read `pendingTransferOf` | local | self; `issuingRecord`; `licenseCommitment` | `licenseStatusOf`, `pendingTransferOf` removed; if ACTIVE: `activeLicenses.insertIndexDefault`, `licenseSlotOf`, `licenseAtSlot` removed, `activeLicensesBy`−1, `unsealedChanges`; else `pendingLicensesBy`−1 | *Licences* 6; *Revocation takes effect in two steps* |
| `sealRevocations(bound)` (571) | Drop every licence-tree root but the current one | none | `bound` | `activeLicenses.resetHistory`, `lastSealTime`, `unsealedChanges`, `rootsSinceSeal`, `sealSeq` (reads both flags, `lastSealTime`, block time) | *Revocation takes effect in two steps* (`SEAL_INTERVAL` 600 s, `SEAL_SLACK` 300 s); *State bounds* (root history) |
| `proveLicense()` (590) | Licensee proves to one verifier a live licence from one issuer | licence, record, path, challenge | `challenge != 0` (a boolean); `path.leaf == leaf` (a boolean); the root; `presentationTag(record, challenge)` | `presentationSeq`, `lastPresentationRoot`, `lastPresentationUnsealed` (copied from `unsealedChanges` at proof time), `lastPresentation` (reads `activeLicenses.checkRoot`) | *Licences* 4; rule 5 |
| `proposeParent(parentRecord)` (608) | Child's holder names a parent | local | self; `parentRecord` | `pendingParentOf` (reads `hasOffspring`, `parentsOf`) | *Lineage, Descent*; `MAX_PARENTS` 2 |
| `confirmParent(childRecord)` (620) | Parent's holder confirms for that child | local | self; `childRecord` | `pendingParentOf` removed, `parentsOf`, `hasOffspring`, `descentSeq`, `lastDescentChild`, `lastDescentParent` | *Lineage, Descent* (parents fixed once a record has confirmed offspring) |
| `withdrawParent()` (639) | Child's holder retracts its proposal | local | self | `pendingParentOf` removed | *Lineage*; *Known limits* (withdraw a thief's proposal) |
| `proposeObligation(record, obligationCommitment)` (663) | Beneficiary proposes; binds nobody until accepted | local | self; `record`; `obligationCommitment` | `pendingObligationsBy`+1, `pendingObligations`, `lastProposedObligation`, `lastProposedAgainst`, `lastProposedBy` | *Lineage, Obligations*; `MAX_PENDING_OBLIGATIONS` 8 |
| `encumberOwnRecord(obligationCommitment)` (682) | Holder places an obligation on its own record in one step | local | self; `obligationCommitment` | via `addObligation`: `openObligations`, `obligationCountOf`+1, `obligationSeq`, `lastObligationRecord`, `lastObligation`, `lastBeneficiary` (reads `recoveriesOf`) | *Lineage, Obligations*; `MAX_OPEN_OBLIGATIONS` 16 × (recoveries + 1) |
| `withdrawObligation(record, obligationCommitment)` (692) | Beneficiary retracts an unaccepted proposal | local | self; `record`; `obligationCommitment` | `pendingObligations` removed, `pendingObligationsBy`−1 | *Lineage, Obligations* |
| `acceptObligation(obligationCommitment, beneficiary)` (701) | Holder accepts a proposal from the named beneficiary | local | self; `obligationCommitment`; `beneficiary` | `pendingObligations` removed, `pendingObligationsBy[b]`−1, then `addObligation` as above | *Lineage, Obligations* |
| `rejectObligation(obligationCommitment, beneficiary)` (713) | Holder declines a proposal | local | self; `beneficiary`; `obligationCommitment` | `pendingObligations` removed, `pendingObligationsBy[b]`−1 | *Lineage, Obligations* |
| `discharge(record, obligationCommitment)` (722) | Only the beneficiary's current head releases | local | self; `record`; `obligationCommitment` | `openObligations` removed, `obligationCountOf`−1, `obligationSeq`, `lastObligationRecord`, `lastObligation`, `lastBeneficiary` | *Lineage, Obligations*; rule 3 |

Notes for reading the table:

- `issueLicense`, `revokeLicense`, `replaceRecoveryCommitment`, the parent proposals and
  withdrawals, and the obligation proposals, withdrawals and rejections increment no
  sequence counter. Verifiers identify a call by its transaction and entry point, not by
  counters (rule 6).
- The contract's constants are circuits, not ledger fields: `SEAL_INTERVAL` 600,
  `SEAL_SLACK` 300, `MAX_ROTATIONS` 16, `MAX_RECOVERIES` 16, `MAX_PARENTS` 2,
  `MAX_OPEN_OBLIGATIONS` 16, `MAX_PENDING_OBLIGATIONS` 8, `MAX_PENDING_LICENSES` 32,
  `MAX_ACTIVE_LICENSES` 1024.
- The constructor sets only `protocolVersion = 1` (a `sealed` field). Midnight does not run
  the constructor on chain; section 6 says how `join` compensates.
- Only `sealRevocations` reads block time (`blockTimeGte`, `blockTimeLt`).

---

## 5. Circuit map: claims contract (`veilcore-claims.compact`, with `schnorr.compact`)

A separate contract. It reads **no** ledger state: every circuit recomputes record
commitments from witnesses and writes one claim to event cells.

**Witnesses** (8): `firstFieldSet`, `secondFieldSet`, `slotOpening`, `slotNumber`,
`schemaTerms`, `attesterKey`, `attesterSignature`, and `schnorrReduction` (declared in
`schnorr.compact`). In `claims.ts` each throws if the call's input does not supply it, so a
call missing one is never built; `schnorrReduction` splits the challenge hash at 2^248.

**State written by every claim** (`publish`, line 210): `claimSeq`+1, `lastClaimKind`,
`lastClaimRecord`, `lastClaimOther`, `lastClaimSchema`, `lastClaimSlot`, `lastClaimParam`,
`lastClaimOp`, and `lastClaimAttesterX`/`Y` set to 0 (then set to the key by
`proveAttested`). Every circuit writes every cell, so consecutive claims in one transaction
never mix cells; only the last claim in a transaction survives in its post-transaction
state (accepted A8, section 7). Nothing grows with use.

**`disclose()`**: 19 in `veilcore-claims.compact`, 6 in `schnorr.compact` (`q` and `c`
inside the three challenge-split asserts, and `c` in the final check).

| Circuit (line) | Proves | Witnesses | `disclose()` | Cells written | Design rule |
|---|---|---|---|---|---|
| `proveValue(record, schema, slot, value)` (276) | Slot `slot` of `record` holds exactly `value` | `slotOpening` | `record`, `schema`, `slot`, `value` | kind VALUE; record; other 0; schema; slot; param = value; op AT_LEAST (fixed) | claims-design.md *What it lets a holder prove* (value reveals the value); *What it does not do* |
| `proveRange(record, schema, slot, op, bound)` (289) | The number in the slot is ≥ or ≤ `bound`; the number is not published | `schemaTerms`, `slotOpening`, `slotNumber` | `record`, `schema`, `slot`, `op`, `bound` | kind RANGE; param = `numberBytes(bound)`; op | *How a record seals its fields* (present marker: byte 8 = 1, so an absent slot is never the number 0); the slot must be in the schema's numeric mask (`schemaOf(terms) == schema`) |
| `proveDistinct(first, second)` (305) | The records differ in at least k of the schema's comparable slots, both values present | `schemaTerms`, `firstFieldSet`, `secondFieldSet` | `first`, `second`, `schemaOf(terms)` (in `checkDistinct`) | kind DISTINCT; record, other; schema (derived from the terms); slot 0; param 0 | *What it lets a holder prove*; k and the comparable mask come from the schema id, `k ≥ 1`; *What it does not do* (a count, not a verdict) |
| `proveUnchanged(original, corrected, schema, mayChange)` (316) | Values outside the mask are equal (salts may differ) | `firstFieldSet`, `secondFieldSet` | `original`, `corrected`, `schema`, `mayChange` | kind UNCHANGED; record, other; schema; param = `maskBytes(mask)` | *What it lets a holder prove* (says nothing about which is the correction; read with `supersedes`) |
| `proveAttested(record)` (339) | A key signed the record commitment (Schnorr over Jubjub) | `attesterKey`, `attesterSignature`, `schnorrReduction` | `record`; key x and y (`publishAttester`) | kind ATTESTED; record; schema 0; attester x, y | *What it lets a holder prove*, *Laboratory signatures*; `schnorr.compact` (subgroup check `r·pk = O`, `x ≠ 0`, exact challenge split) |

Hashes (claims-design.md, *How a record seals its fields*): `fieldLeaf` = SHA-256(value ‖
23-byte salt), 55 bytes; `fieldSetRoot` = SHA-256(`veilcore:v1:fset` ‖ schema id ‖ 16
leaves), 560 bytes; `fieldRecord` = H(`veilcore:v1:frecord`, set root, JSON digest);
`schemaId` = H(`veilcore:v1:fschema`, document digest, terms), with the terms packing the
comparable mask, the numeric mask and k into one element (`termsBytes`). The signed message
is `attestationMessage(record)`: the tag, the record as a field element, and a tagged hash
of the record (`veilcore:v1:fattest2`) that covers the byte the field element drops.

Exported pure or helper circuits (`fieldLeaf`, `fieldSetRoot`, `fieldRecord`, `schemaId`,
`numberBytes`, `maskBytes`, `termsBytes`, `attestationMessage`, `attestationChallenge`)
carry no keys; the off-chain code (`fields.ts`, `attest.ts`) is tested against them.

**Off-chain claims code.** `fields.ts` computes the same hashes with plain SHA-256.
`field-schema.ts` is a synchronous copy of the SDK's canonical JSON, schema validation,
formats and typed values (veilcore-sdk, branch `fields-v1`), kept identical through the
shared vectors. `attest.ts` makes keys (512-bit reduction, attack A7), signs records, and
checks keys and signatures off chain exactly as the circuit does (`isSigningKey`,
`verifyRecordSignature`). `verify-claims.ts` implements SPEC 4.5's nine checks (SPEC lives
in the veilcore-sdk repository):

| SPEC 4.5 check | What `verifyClaim` does |
|---|---|
| 1 Which contract, read how | Returned as "to check" (published contract and fingerprints; each attested claim on the same contract; read per call) |
| 2 Anchored records | "to check"; for distinct, also that the reference's anchor predates the claim's purpose |
| 3 The schema | Recomputes the schema id from the document; range needs a `uint` slot; value checks number form; compares a shown value. A schema that fails is not used to word the statement |
| 4 Committed JSON | Recomputes each supplied record's commitment (`fieldRecordCommitment`), requires it to be named by the claim and to name the claim's schema |
| 5 Currency | "to check" (report the claim as about the record as sealed) |
| 6 Laboratory signatures | Each named record needs a valid attested claim; keys must be signing keys; "a laboratory" only if the key is in `trustedAttesters`; key validity at claim time is "to check" |
| 7 Distinctness reference | "to check" that someone other than the prover chose it |
| 8 Unchanged | Refuses an all-slots mask; checks `supersedes` when both records are given |
| 9 Disclosure accounting | Reports what earlier value and range claims on the same record and slot already revealed |

---

## 6. Trust boundaries

### What the main contract enforces

- The caller of every record-holder circuit holds the secret behind a live head
  (`liveSelf`); licence circuits derive the licence key from the licence secret; recovery
  circuits check the recovery secret against `recoveryOf`.
- Identity: a successor is never merged with another identity (`assertUnused`); only
  anchored identities act as holders; recovery writes the head without reading it.
- Licence lifecycle and authorisation; a leaf names its issuer; at most one proposal per
  licence; revocation needs no path and cannot be starved by the licensee.
- Presentation: membership of `licenseKey(licenseCommit(secret, record), record)` at a root
  `checkRoot` still accepts; the tag binds record and challenge; whether a revocation was
  waiting at proof time.
- Seal rate limit against block time.
- Consent for descent edges and obligations; only the beneficiary's head discharges; no
  cycles (parents fixed once a record has offspring).
- Every per-identity cap in design.md, *State bounds*.

### What verifiers and clients enforce off chain

- **Rules 1 to 8** (design.md, *Verifier rules*): identity resolution; walking the
  pedigree from state; "clean" and "accepted" (recognised roots); presentation acceptance
  (state recorded for the presentation's own call, root current or nothing waiting);
  challenge freshness, single use and kind (`ChallengeBook`, 7 days); presentation age (one
  hour) and "not before its challenge" (`acceptPresentationAt`); control proofs against
  the live head now (`acceptOwnership` with `now`).
- **Which state is judged.** `verify.ts` judges the ledger it is handed. That the ledger is
  the one recorded for one successful `proveLicense` (or `proveOwnership`) call on the
  right contract address, alone in its transaction, is done by
  `api/src/presentation-lookup.ts` against the indexer (out of scope, tested by
  `api/test-presentation-lookup.mjs`).
- **Client discipline the contract cannot check:** the licensee makes the licence secret;
  obligation terms are salted; record secrets are random and never zero; a revoked
  commitment is not re-issued or approved (remembered in private state,
  `revokedLicenses`); a recovery is confirmed by two reads 30 s apart before the client
  switches secrets.
- **The indexer is trusted for what it reports** (Blockfrost for mainnet). A wrong indexer
  can make a presentation pass or a lineage look clean.

### What the claims contract enforces, and what it leaves to the verifier

- Enforced: the record commitment(s) recompute from the witnesses under the published
  schema id; an opening is at its slot; range and distinct use the schema's own terms; the
  present marker; `k ≥ 1`; the signature verifies under a key in the prime-order subgroup.
- Not enforced: that the record is anchored or current; that the schema document is
  authentic (only its id is bound); that a key belongs to a laboratory, or was valid at the
  claim; who chose a distinctness reference; **who made the claim**: anyone holding the
  opening or field sets can publish it (accepted A10); reading per call.

### Deployment and maintenance

- **Main contract: a maintenance authority is kept.** Whoever holds its key can add or
  remove verifier keys, so can change or disable any circuit, and a key for a new circuit
  could rewrite state. At launch: one key, on paper only, two copies held by the founders
  (approved by Hunter Roberts on 6 October; Makoto Steiner to confirm). The chain shows
  every use, not who holds the key. `docs/maintenance-policy.md`.
- **Claims contract: no authority.** The deploy adds the five keys with a temporary key the
  tool generates, then replaces the authority with an empty committee and threshold 1, which
  anyone can read from the contract state. The operator tool refuses any other ending off a
  test network (`assertClaimsDeployAllowed`). Between those two steps the temporary key is
  live and kept in the deploying computer's encrypted private-state store, so an interrupted
  deploy can be finished; it is deleted once the empty committee is confirmed.
- **Deployed in fragments.** The deploy carries the first 8 circuit keys of the main
  contract (halved on a block-limit refusal); the authority adds the rest one transaction
  each. During that window some circuits are callable and others not.
- **Midnight does not run the constructor on chain.** A deploy carries whatever starting
  state its deployer built, so `join` compares the deploy transaction's state with this
  build's constructor (`startsFromConstructor`, `contract/src/veilcore.ts`;
  `api/src/starting-state.ts`) and, on mainnet, accepts only the address pinned in
  `api/src/deploy-guard.ts`. The address is the contract's identity.
- **VeilCore-run** (`docs/MANAGED.md`), the managed service, holds partners' record,
  licence and claim secrets in per-partner stores. It uses only the partner kit's public
  exports (`veilcore-run/test/surface.test.ts` checks this), so it cannot reach deploy,
  circuit keys or the maintenance authority. Its fee-paying wallet is not the maintenance
  key. It is out of your scope.

---

## 7. Known limitations and accepted risks

Stated in design.md (*Known limits*, *Trust model*), claims-design.md (*What it does not
do*) and the deployment record (*Known and not fixed*). Briefly:

**Main contract**

- What a thief does with a stolen current secret before recovery stands: revocations,
  accepted obligations (including ones owed to himself), confirmed parentage. A thief can
  fill both parent slots for good (F4), or freeze an identity's parents with one confirmed
  throwaway child.
- Licences a thief issued stay PENDING until the owner revokes them; each issue publishes
  its commitment, but no client does the lookup yet. A thief can also activate licences up
  to the 1,024 cap.
- The caps are per anchored identity, and anchors cost only a fee in DUST, which
  regenerates (F7). The caps can refuse legitimate use (a third parent, a 17th obligation on
  a never-recovered record, a 33rd pending or 1,025th active licence, a move after 16
  recoveries and 16 more rotations).
- The licence tree's root history is cleared only when someone seals (F6); there is no
  automated sealer. A revoked licence's old path verifies on chain until the next seal (up
  to 600 + 300 s plus the time until someone seals); rule 5 refuses it.
- No list of revoked licences on chain; a presentation names the issuer, not the licence;
  the licensee making the secret is stated, not enforced; no expiry on chain.
- Linkability: record commitments are stable pseudonyms; rotation does not unlink;
  parentage, obligations (including rejected proposals) and licence activity are public; a
  presentation's root narrows the issuer to those with live licences at that root, which at
  launch can be one.
- A record made from the all-zero secret can be anchored, and then anyone can act as it.
- An edge whose parent has no holder can never be confirmed.
- A thief holding a beneficiary's current secret can discharge what is owed to it.
- The maintenance authority can change the circuits while it is held.

**Claims contract** (labels from `attack-claims-A.test.ts` and `attack-claims-C.test.ts`)

- A3: a signature is not bound to a deployment; it verifies on any claims contract.
- A4: the Schnorr response is an unchecked `Field` in the circuit; `s + order` is refused by
  the JS runtime that builds the proof, not by the contract.
- A8: an earlier claim bundled in the same transaction is invisible in the
  post-transaction state; a proof can be landed twice. Verifiers read per call
  (`readClaim`).
- A9 (open): `unchanged` is symmetric and says nothing about the JSON part of the records.
- A10: anyone given a single slot opening can publish a value claim for that slot.
- A12 (open): distinctness counts byte inequality, so one genotype written two ways counts
  as a difference. Formats are enforced when typed values are sealed, not on raw sealing;
  without a laboratory's signature a dishonest holder can inflate a count (round C format
  gap 5).
- A13: a holder can mint its own schema id (same document digest, other masks); only
  verifier check 3 catches it.
- Round C INFO: an attested claim can be made on any 32 bytes a laboratory signed; the
  announcement and response are unconstrained private inputs in the ZKIR (no on-curve
  check there).
- Repeated range claims narrow a hidden number; repeated distinct claims leak a bit each;
  16 slots per record; distinctness needs one party holding both value sets.
- Claims live in event cells read through the indexer and transaction decoding, which
  broke for old state after the 28 September fork (indexer #1605). Section 9, question 4.
- Five format gaps from round C (Unicode version, nesting depth, duplicate JSON keys, the
  nonce, format enforcement) are in the shared specification, to be fixed in all
  implementations together (`docs/mainnet-completeness.md`, *Attack round C*).

**Verifiers and tooling**

- Every reader trusts its indexer. On mainnet that is Blockfrost; Midnight's hosted mainnet
  indexer endpoint was retired on 30 September.
- Challenges are single-use only within one verifier's `ChallengeBook` (kept by the CLI in
  an encrypted file per network). A control-proof challenge becomes public with the proof, so
  rule 8 forbids using one challenge for both a control proof and a presentation; the
  CLI issues them separately, the contract cannot tell.
- A proof answers a challenge; it does not show that the party in front of the verifier is
  the holder (relaying, rule 8).

---

## 8. History of internal attack rounds

None of these is an audit. Round 1 was ours; the rest were AI reviewers in
separate sessions directed by the founders, plus an outside Midnight developer's human reviews of earlier
builds. "In scope" below means a change to one of the ten files in section 1 (or their
predecessors).

| Round | Date | Record | Found and fixed in in-scope files |
|---|---|---|---|
| Outside Midnight developer | 24–25 Aug | Deployment record, *Revision — 24–25 August 2026*; issue #22 | Four licensing authorisation defects (public countersign, unauthenticated and overwriting transfer proposals, unauthenticated withdraw, revoke leaving the proposal), then the transfer model itself (a secret cannot be un-known). Earlier contract |
| Outside Midnight developer | 16 Sep | Deployment record, *Correction — 16 September 2026* | A circuit's return value is not public: control proofs, DNA pairing and rotations published nothing a third party could check. Fixed with event cells |
| 1. Security pass | 30 Sep | `docs/security-pass-30sep.md` (H1–H4, M1–M6, L1–L5) | Licences stuck after two rotations (`originOf`); recovery could not beat a thief; `proveLicense` bound to nothing; rotation dropped recovery; recovery used the record tag; `issueLicense` front-running; retired secrets proving control; caller records taken as arguments (`13e7704`) |
| Lineage pass | 30 Sep | same, *Lineage contract pass* | Anyone could encumber any record; slot squatting; stale-proof window; caller identity as argument; empty inputs (`f03ebcf`) |
| 2 | 30 Sep | same, *Round 2* | CRITICAL: a transfer could forge a licence from another issuer (leaf is now `licenseKey`); revocation starvation (ledger `HistoricMerkleTree`); thief blocking recovery (`headOf`); `recoveryCommit(0)` refused (`6a499a5`) |
| 3 | 30 Sep | *Round 3* | No critical or high. A shared slot counter let anyone block activations (now a client-chosen random free slot); the lineage verifier rule read `rotatedTo`, which recovery did not write (rule 1 now uses `headOf`) (`ddbfe3a`) |
| 4 | 30 Sep | *Round 4* | Lineage merged into one contract keyed by identity; revocation no longer resets history (`sealRevocations`); versioned tags, `protocolVersion`, vectors; `assertLive`/`licenseStatus` no longer public (`6f35bee`) |
| 5 | 30 Sep | *Round 5* | Rule 5 rewritten (`acceptPresentation`); `checkLineage` reports cycles and needs recognised roots; obligation count a `Counter`; seal bound is an upper bound on block time (`c9d649f`) |
| 6 | 30 Sep | *Round 6* | Tag read from chain state, not from the licensee; state immediately after the presentation's transaction; backcross is not a cycle; `lastPresentationRoot` (`0560946`) |
| 7 | 30 Sep | *Round 7* | Lookup by transaction (single `proveLicense` on this address); iterative lineage walk (`5b23836`) |
| 8 (+ re-attack) | 1 Oct | *Round 8* | HIGH: stale presentation bundled with a seal (`lastPresentationUnsealed`); recovery secret reusable (new commitment per recovery); ancestors rewriting pedigrees (`hasOffspring`); `checkLineage` called unanchored commitments clean (`fe3ae54`; re-attack `2690968`) |
| 9 | 1 Oct | *Round 9* | `proveOwnership` named no verifier (challenge, rule 8); stale `lastRotatedFrom` after recovery (`e0f2815`) |
| 10 | 1 Oct | *Round 10* | Contract held. Separate challenges for control proofs and licences (client) |
| 11 (+ re-attack) | 1 Oct | *Round 11* | Contract held. `verify.ts`: `ChallengeBook` (single use, kind, 7 days); `acceptOwnership` refuses a moved prover. `witnesses.ts`: `revokedLicenses` (`95e40b7`, `6b7d725`) |
| 12 (+ second attacker) | 1 Oct | *Round 12* | State bounds; F1 (`lastIssuedLicense`), F2 (`lastProposed*`), F3 (recovery resets rotations), F5 (`activeLicensesBy`), R1 (16 more obligation places per recovery), R2 (`lastTransferredLicense`); F4, F6, F7, P2 documented (`ceb3a16`) |
| Final review | 1 Oct | *Final review* | Contract and verifier: no HIGH or MEDIUM; build reproduced byte for byte (ZKIR and contract code) |
| Fresh-session AI review | 2 Oct | *Fresh-session AI review, 2 October 2026 afternoon* | Contract: no blocker, high or medium; two lows documented in design.md |
| Self-review | 3 Oct | `docs/self-audit-3oct.md` | Midnight's Compact checklist line by line; mutation testing of all 68 asserts in `veilcore.compact` (64 caught; one real gap, `recoverRecordSecret`'s incoming-secret check, now tested in `mutation-gaps.test.ts`); StrykerJS on `verify.ts`, 217 then 246 of 283 mutants killed (`mutation-gaps-verifier.test.ts`, 12 tests) |
| Claims A and B | 3 Oct | Commit `74e529c`; `attack-claims-A.test.ts` (FIXED, DEFENCE, ACCEPTED and OPEN labels); comments A1, A2, A5, A6, A7 and B-H1 in the source | HIGH: a lab signature could be moved to another record with the same field set (now signs the record commitment, all 32 bytes); small-order keys (A6, subgroup check); a second challenge split (A5); biased nonces (A7, `attest.ts`); range claims on non-number slots (numeric mask in the schema id) |
| Claims layout and mutation testing | 4 Oct | claims-design.md, *Size* and *Mutation testing*; commit `cd30c11` | 71 mutants; three Schnorr survivors now killed by `claims-schnorr.test.ts`; one equivalent (`c < p − 115·2^248` vs `<=`) |
| C | 4 Oct | `docs/mainnet-completeness.md`, *Attack round C*; commit `bdad91a` | Claims circuits: no false claim accepted. `verify-claims.ts`: any key called "a laboratory" (C3), exact numbers for any scale (C2), same-contract reading (C4). `field-schema.ts`: `ledgerIdentity` left out of the commitment (C1). `attest.ts`: `isSigningKey`, `verifyRecordSignature`. Tests `attack-claims-C`, `attack-verifier-C`, `ledger-identity` |
| D (+ re-check) | 4 Oct | `docs/security-pass-4oct-roundD.md` | Main contract: nothing at Medium or above, unchanged. `verify.ts`: a presentation shows the licence was live when presented, not later, so rule 5 refuses one older than an hour or older than its challenge (`acceptPresentationAt`, D-7). Tests `hardening-roundD.test.ts` (`99008f4`; re-check fixes `8de6f2a`, outside your files) |

Not re-checked by a fresh-session AI review yet, and outside your files: `8de6f2a` (join reads the deploy
transaction) and `5a980b3` (claims mainnet gate). The per-finding write-ups of claims round
A and of round D are kept outside the repository; the commit messages, test labels and the
documents above are the record here.

---

## 9. Open questions for you

1. **Custom Schnorr or the standard library.** `schnorr.compact` is a port of
   `example-zkloan`'s verifier with our own subgroup check (`(r − 1)·pk + pk` is the
   identity), an exact challenge split (`q < 116`, and `q < 115` or `c < p − 115·2^248`) and
   an unchecked response (A4). The standard library's `jubjubSchnorrVerify` gained the
   identity-key check in Compact 0.35.0 (our source comment says 0.34; claims-design.md
   records the correction). Is our port sound on 0.31.1? On the move to ledger 9, should we
   go straight to the stdlib verifier, and does anything in our message encoding
   (`attestationMessage`) need to change for it?
2. **Linkability.** Within the stated model (record commitments are pseudonyms, rotation
   does not unlink), is there linkage we have not stated? In particular: the presentation
   root narrowing the issuer; fee payments linking a presentation to its countersign (we
   list this as a question for the Midnight wallet); claims publishing record commitments
   that the record's JSON ties to a main-contract identity (`ledgerIdentity`, SPEC 3.6);
   and one VeilCore-run wallet sending transactions for many partners.
3. **State growth.** Is the Tier 2 argument (design.md, *State bounds*; deployment record,
   *State*) right, given that anchors cost only regenerating DUST and root history depends
   on someone sealing? Are the per-identity counters and their decrements safe under
   concurrent calls (round 9 found counters cannot go below zero; please confirm)?
4. **Claims in event cells, and indexer #1605.** A claim exists only as the state recorded
   for its call, read through the indexer and transaction decoding, which broke for old
   state after the 28 September fork. The alternative, storing claims in state, grows with
   use. Is per-call reading (`readClaim`) sound when a transaction carries several calls,
   and what would you do instead?
5. **The maintenance authority.** One key, two paper copies, at launch; a two-of-three
   committee later (`docs/maintenance-policy.md`). Is that defensible for a registry, and
   what should the committee code look like? For the claims contract: is an empty committee
   with threshold 1 unsatisfiable on ledger 8, and will it stay so across ledger upgrades?
   Is the window in which the temporary key is live during the claims deploy acceptable?
6. **`disclose()` placement.** 44 in the main contract, 25 in the claims contracts. In
   `schnorr.compact`, `q` and `c` are disclosed inside assert conditions. Please confirm
   nothing reaches a public transcript beyond what section 5 lists.
7. **Block time in `sealRevocations`.** How far can a block producer move the time the
   circuit sees, and does that break the 600 s spacing?
8. **Fragmented deploy.** Any risk in a contract existing with some verifier keys and not
   others while the authority adds them?

---

## 10. Statements elsewhere in this repository that are out of date

Found while checking this pack against the code. The code is right in each case.

- `docs/design.md`, *Tests*: "The preprod run on this build has not been done yet." It was
  done on 2 October (26 of 26) and, with the claims phase, on 4 and 5 October (37 of 37).
- `docs/design.md`, *Tests* table: puts the 1,024-active-licence test in
  `state-bounds.test.ts`. It is in `attack-bounds.test.ts`.
- `docs/self-audit-3oct.md` §1 counts 43 `disclose` calls in `veilcore.compact`; a count of
  `disclose(` in the file gives 44, the same since `e0f2815` (1 October).
- `contract/src/schnorr.compact` line 3 says the stdlib check is in Compact 0.34; it is in
  0.35.0. The file is frozen and fingerprinted, so the comment stays (claims-design.md,
  *Note for the next compiler migration*).
- `docs/PARTNERS.md` describes managed dating as "the only managed service at launch" and
  says VeilCore does not hold partners' secrets. Later on 6 October that changed to
  VeilCore-run (`docs/MANAGED.md`), which does; `docs/mainnet-completeness.md` records the
  change.
- The deployment record's statements that the slow test had never run to completion, and
  that `verify.ts` does not refuse a presentation that landed before its challenge, were
  out of date; corrected in `docs/deployment-record-revision-4.md` in the same commit as
  this file.

---

## 11. Claims-only scope

If the review covers only the claims side:

**Files** (2,050 lines; 1,542 code lines):

| File | Lines | Code lines | Last changed |
|---|---|---|---|
| `contract/src/veilcore-claims.compact` | 345 | 200 | `cd30c11` |
| `contract/src/schnorr.compact` | 58 | 37 | `74e529c` |
| `contract/src/claims.ts` | 167 | 126 | `cd30c11` |
| `contract/src/verify-claims.ts` | 694 | 578 | `bdad91a` |
| `contract/src/field-schema.ts` | 464 | 382 | `bdad91a` |
| `contract/src/fields.ts` | 198 | 141 | `cd30c11` |
| `contract/src/attest.ts` | 124 | 78 | `bdad91a` |

**Circuits:** `proveValue`, `proveRange`, `proveDistinct`, `proveUnchanged`,
`proveAttested`, and inside them `schnorrVerify` (from `schnorr.compact`). No ledger reads;
the cells listed in section 5.

**Starting points:** claims-design.md; SPEC 4.5 in veilcore-sdk (the nine checks);
`verify-claims.ts`; section 5 of this file.

**Build:** as section 2. The claims table in `docs/fingerprints.md` has 21 rows; `npm run
fingerprints:check` checks both contracts, and its claims line is the one that matters.

**Tests** (10 files):

```sh
cd contract
npx vitest run src/test/claims.test.ts src/test/claims-schnorr.test.ts \
  src/test/claims-vectors.test.ts src/test/claims-wrapper.test.ts \
  src/test/attack-claims-A.test.ts src/test/attack-claims-C.test.ts \
  src/test/attack-verifier-C.test.ts src/test/verify-claims.test.ts \
  src/test/field-schema.test.ts src/test/ledger-identity.test.ts
```

On 6 October at `a3d1884`: `Test Files 10 passed (10)`, `Tests 231 passed (231)`, about 40 s.
What they cover: `claims.test.ts` (each claim, in-circuit hashes against `fields.ts`),
`claims-schnorr.test.ts` (signatures, and the subgroup and split checks read from the
compiled circuit), `claims-vectors.test.ts` (the SDK's shared vectors recomputed by the
compiled contract), `claims-wrapper.test.ts` (`claims.ts` and the deploying variant),
`attack-claims-A.test.ts` and `attack-claims-C.test.ts` (rounds A and C, labelled FIXED,
DEFENCE, ACCEPTED, OPEN or INFO), `attack-verifier-C.test.ts` and `verify-claims.test.ts`
(the nine checks), `field-schema.test.ts`, `ledger-identity.test.ts`.

**Adjacent, out of scope but on the trust path:** `api/src/claims-api.ts` (`readClaim`,
which reads one claim per contract call; `assertClaimsDeployAllowed`) and
`api/src/maintenance.ts` (`retireMaintenanceAuthorityProvably`, the empty committee; tested
by `api/test-maintenance.mjs`).

**Not needed:** `veilcore.compact`, `witnesses.ts`, `verify.ts`. The claims contract does
not read the main contract; a verifier checks that a record is anchored separately (check
2).
