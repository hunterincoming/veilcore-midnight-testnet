# Release checklist

Every change that reaches the mainnet contract, the operator tool used against it, or
the published record format goes through every step below, in order. The checklist does
not depend on who does the work. A step that cannot be done is a reason to stop, not
to skip.

## 1. Before any code

- [ ] The reason is written down: network upgrade, security fix, correctness fix, or a
      change both founders approved in writing (`docs/maintenance-policy.md`).
- [ ] Does it change the contract's stored data layout? If yes, it is a new contract
      version, not a maintenance update. Plan the migration first.

## 2. Build and test

- [ ] Contract compiled with the pinned compiler. The version is named in the commit.
- [ ] Every circuit of the main contract under the 700 ZKIR instruction budget. The claims
      contract's two-tree circuits (proveDistinct, proveUnchanged, k=19) are the
      exception, and are proved once on the release proof server and once in a browser,
      with times recorded in the deployment record.
- [ ] Mutation testing on any changed contract (remove each assert, flip each comparison):
      every surviving mutant is either a comment or explained in `docs/`.
- [ ] `cd contract && npm test` passes, with the expected-fail attack tests still failing.
- [ ] `SLOW_TESTS=1` and the long fuzz run (`FUZZ_RUNS`) pass for any contract change.
- [ ] `cd bboard-cli && npx vitest run` and `cd api && npm run ci` pass.
- [ ] A new test covers the change and fails on the old code.

## 3. Adversarial review

- [ ] At least two independent reviews that did not write the change: one on the
      contract, one on the operator path. Findings and fixes recorded in `docs/`.
- [ ] A re-check of the fixes themselves.
- [ ] Stop rule: from here until release, only a HIGH or blocker reopens code.
- [ ] For a contract change once real users rely on it, an outside paid audit.

## 4. Networks

- [ ] Local chain smoke test (`npm run standalone`, option 3): 26 of 26 (or the
      current count).
- [ ] Preprod smoke test (`npm run preprod-remote`, option 3) on the same build.
- [ ] Fingerprints regenerated, committed, and matched by an independent build.
- [ ] **The offline maintenance key still works with the SDK being released with.** Load
      the paper copy into the current midnight-js and sign a no-op on preprod. (midnight-js
      #1409: 4.x to 5.x stopped accepting stored signing keys, with no migration. A key
      that the current SDK cannot load is a contract nobody can maintain.)
- [ ] **Old state still reads.** After any Midnight network upgrade, query a pre-upgrade
      anchor, a pre-upgrade claim and the licence tree through the indexer and decode
      them with the release's client. (midnight-indexer #1605: after the 28 September
      2026 hard fork, pre-fork contract state came back in an encoding new clients could
      not decode.) Batch roots and record commitments are SHA-256 and do not depend on
      this; claims, presentations and the licence tree do.
- [ ] OpenTimestamps: the registry's last sealed batch has a `.ots` file, and an older
      one upgrades and verifies with the official client (`ots upgrade`, `ots verify`).

## 5. Announce

- [ ] Announced at least 14 days ahead (urgent security fixes: within 72 hours after).
- [ ] Deployment record revision drafted: what changes, why, the fingerprints, the
      test and smoke results.

## 6. Apply

- [ ] A zero-spend rehearsal on mainnet first (sync, DUST check, then exit).
- [ ] The update is applied from a clean checkout of the tagged commit.
- [ ] The maintenance key is used only at the hidden prompt, and removed after.

## 7. After

- [ ] `join` on the mainnet contract matches the new build's keys.
- [ ] The deployment record revision is published with the transaction ids.
- [ ] The commit is tagged, and the release notes link the record.

## Network upgrades (Midnight hard forks)

Midnight's ledger v8 to v9 upgrade is expected in 2026, with no date announced. A tool
still on midnight-js 4.x "cannot read the network afterwards, and cannot call the
contracts it deployed before it" (midnight-js v5 migration guide). So, before each
announced upgrade:

- [ ] Move the operator tool, API and SDK to the midnight-js major that carries the
      upgrade, as soon as it is released (not a release candidate).
- [ ] Recompile with the matching Compact compiler. Compare the new verifier keys with
      the ones on chain. Where they differ, plan the maintenance update under this
      checklist.
- [ ] Run the full checklist on preprod after preprod has upgraded, against a contract
      deployed before preprod's upgrade, to prove the crossing works for ours.
- [ ] Hold all mainnet maintenance and avoid sending transactions in the hours around
      the upgrade. Treat a transaction as done only when it is seen finalized.
- [ ] Watch the open issues that affect contracts deployed before an upgrade
      (as of 3 Oct 2026: midnight-js #1408 and #1409, midnight-indexer #1605).
