# What VeilCore needs before mainnet

Status as of 5 October 2026. Owner: Claude (CTO work) unless marked. Decisions are for
Hunter and Mako. This list replaces "is it ready?" with what is done and what is not.

## Already in the main contract (frozen, tested, fingerprinted)

Seal and date a record (one or in batches) · prove you hold it · pair a DNA report ·
change or recover a key · licences (issue, countersign, transfer, revoke, prove privately)
· lineage both holders confirm · royalties and obligations that follow offspring.

## Being added

| # | What | Why it matters | Status |
|---|---|---|---|
| 1 | **Claims contract**: prove one value, a bound, distinctness, or an unchanged correction without showing the rest; a laboratory's signature on a record as its own claim | The examiner and certifier problems (USDA PVPO, AOSCA ACR) | Built, two attack rounds fixed, mutation tested. Layout revised 4 Oct so every circuit fits a laptop (item 3). Preprod 37/37 (item 4). **Ready for mainnet in code (5 Oct, branch `claims-mainnet`):** a mainnet claims deploy is allowed only when the claims build matches its own committed fingerprints, record revision 4 is declared, and the deploy ends with an empty-committee authority; joining on mainnet accepts only `MAINNET_CLAIMS_ADDRESS` (empty until deployed). **Hunter: make the claims fingerprints on the Mac (runbook C0)**, then it deploys on deploy day right after the main contract (runbook C, steps 23-31) |
| 2 | **Field sets in the record format** (SPEC 4.5) in TypeScript, Python, Rust | So any registry can seal records the claims contract can prove | Done: 100 shared test vectors, all three agree, and the compiled contract recomputes them. Merged to main 4 Oct |
| 3 | Prove the two heavy claims (distinct, unchanged) on an ordinary computer | A holder who cannot prove on their own machine has to hand their values to someone else | **Done 4 Oct.** At k=19 (old layout) the unchanged claim crashed the proof server on Hunter's 16 GB Mac. Leaner layout: every claim k=17 or less. Re-run on the same Mac: all claims back to back, proof server peak 3.7 GB, distinct 8.6 s, unchanged 6.7 s |
| 4 | Operator tool: deploy the claims contract, make claims, read them back; smoke test covers it | Nothing ships that has not run end to end on preprod | **Done 4 Oct.** Menu options 34-40, claims verifier, smoke test 37 checks. Local chain with real proofs 37/37, then **preprod 37/37** (main contract f239e680…, claims contract 175f2357…, maintenance authority provably retired on chain). See docs/preprod-run-4oct.md |
| 5 | Deploy the claims contract with **no** maintenance authority, provably (an empty committee, not a discarded key) | Otherwise every claim depends on trusting us | Built and tested against the real ledger code locally, and on preprod (PASS 28). Since 5 Oct the tool **only** allows this on mainnet: a claims deploy that would keep an authority is refused there. **Decision to confirm: Hunter + Mako** (recommended); if they want an authority on the claims contract instead, that rule has to change first |
| 6 | Website demo uses the real test-network contracts, VeilCore pays the network fees | Today licensing and settlement in the demo are simulated | Phase 1 built on branch `demo-real` behind `VITE_REAL_CHAIN=1`: proofs made in the visitor's browser, a separate fee-paying service (`sponsor/`) with strict limits, automatic batch anchoring. 107 tests with mocks. **Hunter: fund the fee wallet, set up Railway, first live runs (sponsor/README.md)**. Phase 2 (licences) after |
| 7 | Second, independent timestamp on Bitcoin (OpenTimestamps) for every batch | Dates no longer depend on Midnight alone; Chinese courts check consistency across chains | Built: the registry stamps every sealed batch and serves `root.bin` and `root.bin.ots`; files checked against the OpenTimestamps project's own parser. veilcore-api branch `ots`. Needs one real stamp from Railway after merge |
| 8 | One-click evidence package (record, proofs, timestamps, plain recompute guide, affidavit template) | What a lawyer or examiner actually receives | Built in the SDK (`buildEvidencePackage`), with `verify.py` that runs on plain Python; tested against tampering. Website button comes with the SDK release |
| 9 | Full data export, so nothing is lost if VeilCore stops | Everledger and TradeLens took their users' data with them | Built in the registry (`GET /api/export`), branch `ots`. Website button comes with the SDK release |
| 10 | Verify timestamp tokens properly (signature, imprint) | Today the SDK only checks one is present (now says so plainly) | Done in the SDK (`fields-v1`): imprint, signed digest, signature (RSA, ECDSA), time-stamping key usage; tested on real OpenSSL tokens and 2,000 corruptions. Chain of trust and EU trusted-list status are reported as not checked |
| 11 | Release checklist: test the offline maintenance key against the current Midnight SDK; check the indexer reads old state after a fork | Midnight issues #1409 and #1605 | Done (`docs/release-checklist.md`) |
| 12 | Full public review of site, docs and repos from every reader's angle | Every claim checked against the code | Done 3 Oct: 23 serious findings fixed (site on `main`, SDK docs live). Founders' items listed separately |
| 13 | A record can commit to its on-chain identity (SPEC 3.6) | Without it, which record an identity's licences and lineage belong to was the holder's word | Done in all three implementations, 100 vectors; the contract repo's own copy fixed in round C |

## Done today from the reviews

- Legal statements corrected (eIDAS Art. 41(2), Italy, US) in SPEC, EVIDENCE and the SDK.
- Website accuracy pass: distinctness tile removed until it is ours, custody wording,
  "no users yet", preprod post, dates, lineage and licences described.
- Three pre-existing input-handling gaps closed in all three implementations (null
  fields, missing required fields, unknown algorithm names).

## Attack round C, 4 October (after the preprod pass)

Four independent attackers, on the claims contract, the record format across all four
implementations (52,000 generated cases), the verifier and operator tool, and the
registry's Bitcoin-timestamp branch.

- **Claims contract circuits: no way found to get a false claim accepted on chain.**
- **Fixed (vc `bdad91a`):** the verifier called any key "a laboratory"; it now says so only
  for keys the verifier lists as trusted, and names every key. The contract repo's copy of
  the record format left out `ledgerIdentity` (so a record's identity could be swapped
  unnoticed). Bounds with scales that are not powers of ten were printed wrong. The
  operator tool now checks a laboratory signature before sending anything, says when a
  slot is empty, and never echoes a wrong file's contents.
- **Fixed on the registry branch (`ots`, not yet live):** the data export could be used to
  overload the service; one bad timestamp server could corrupt a batch's Bitcoin proof; a
  pending Bitcoin proof was presented as final. Needs Hunter's go, and two Railway
  settings, before it goes live.
- **Format gaps, all in the shared specification, to fix in all implementations together
  (not blockers for mainnet: none lets a record be forged):**
  1. Text normalisation depends on each runtime's Unicode version (Python 3.11 is Unicode
     14; Node and Rust 17), so text using characters added since 2021 can commit
     differently. Fix: pin a Unicode version and refuse unassigned characters.
  2. No maximum nesting depth (Rust stops at 128 levels, Python at about 400). Fix: a
     limit in the spec, enforced everywhere.
  3. Duplicate JSON keys are accepted (last one wins) everywhere. Fix: refuse them.
  4. The required nonce is not enforced by any implementation. Fix: enforce it, or say
     plainly that it is the sealer's job.
  5. Comparable-value formats are enforced when sealing typed values, not on raw sealing;
     without a laboratory's signature a dishonest holder can inflate a distinctness count.
     Already true in spirit (lab-signed claims are the strong form); to be stated in SPEC 4.5.

## Attack round D, 4 October (everything else)

Website, fee-paying demo service, SDK, registry, operator tool, supply chain; see
`docs/security-pass-4oct-roundD.md`. Main contract: nothing found. All findings fixed and
independently re-checked. What changes for the mainnet deploy:

1. Re-run the preprod smoke test on this build first (the join check is new and has not
   run against a live indexer).
2. First run of this tool version: it finds the old `bboard-cli/midnight-level-db` store
   and asks; type MOVE, confirm it works, then delete the old folder (and its backups).
3. The maintenance key is never saved on the computer; "Finish a deploy" asks for the
   paper copy.
4. Write down the `Deploy transaction id` the tool prints, next to the address.
5. Mainnet joins are refused until the address is pinned in the code
   (`MAINNET_VEILCORE_ADDRESS`) after the deploy.
6. Registry `ots` must go live before the website is redeployed (the site now saves
   disclosure choices to the registry, and the registry fix for `profile` is on `ots`).

## Deploy day, claims contract (added 5 October)

1. **Before:** the claims contract's fingerprints made on Hunter's Mac and committed
   (runbook C0: `cd contract && npm run compact && npm run fingerprints:claims`), checked by
   Claude against an independent build of its ZKIR and contract code, and copied into the
   deployment record. Until then the CLI refuses a mainnet claims deploy, join or finish.
2. **On the day:** the main contract first (runbook C, steps 1-21), then in the same run
   option 34 (steps 23-31). No paper key: the claims deploy ends with an empty committee.
3. **Write down:** the claims contract address and the `Claims deploy transaction id`,
   next to the main contract's.
4. **After:** Claude pins the address (`MAINNET_CLAIMS_ADDRESS` in `api/src/deploy-guard.ts`)
   and puts both in the deployment record; until then joining it on mainnet is refused.

## Open design question

**Claims are read from event cells, per transaction, through the indexer.** That keeps
state from growing with use, but it means a claim is checked through Midnight's indexer
and transaction decoding, which broke for old state after the 28 September fork
(indexer #1605). The alternative, keeping every claim in contract state, grows state with
every claim. Recommendation: keep event cells, and put each claim's raw transaction in the
evidence package so it can be checked from the transaction itself; revisit with Midnight
once #1605 is resolved.

## Honest limits that stay

- Distinctness needs one party that holds both marker sets (the breeder or a lab that
  tested both). Two parties who will not show each other their markers need a different
  tool (multi-party computation).
- A claim is about a record as sealed; whether it was later corrected is checked
  separately.
- No independent security audit yet. The reviews above are our own.
