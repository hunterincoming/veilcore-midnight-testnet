# What VeilCore needs before mainnet

Status as of 4 October 2026. Owner: Claude (CTO work) unless marked. Decisions are for
Hunter and Mako. This list replaces "is it ready?" with what is done and what is not.

## Already in the main contract (frozen, tested, fingerprinted)

Seal and date a record (one or in batches) · prove you hold it · pair a DNA report ·
change or recover a key · licences (issue, countersign, transfer, revoke, prove privately)
· lineage both holders confirm · royalties and obligations that follow offspring.

## Being added

| # | What | Why it matters | Status |
|---|---|---|---|
| 1 | **Claims contract**: prove one value, a bound, distinctness, or an unchanged correction without showing the rest; a laboratory's signature on a record as its own claim | The examiner and certifier problems (USDA PVPO, AOSCA ACR) | Built, two attack rounds fixed, mutation tested. Layout revised 4 Oct so every circuit fits a laptop (item 3). Branch `claims-contract` |
| 2 | **Field sets in the record format** (SPEC 4.5) in TypeScript, Python, Rust | So any registry can seal records the claims contract can prove | Done: 99 shared test vectors, all three agree, and the compiled contract recomputes them. Branches `fields-v1` |
| 3 | Prove the two heavy claims (distinct, unchanged) on an ordinary computer | A holder who cannot prove on their own machine has to hand their values to someone else | 3-4 Oct on Hunter's 16 GB Mac: at k=19, distinct passed at ~8 GB, unchanged crashed the proof server (out of memory). **Fixed by a leaner record layout: both now k=17, every claim k=17 or less** (claims-design.md, Size). **Hunter: re-run the local smoke test (37 checks) and record peak memory** |
| 4 | Operator tool: deploy the claims contract, make claims, read them back; smoke test covers it | Nothing ships that has not run end to end on preprod | Built on `claims-contract`: menu options 34-40, claims verifier, smoke test 37 checks with the claims phase. Local run with real proofs passed checks 27-32 on the old layout; **needs the local re-run, then a preprod smoke run (Hunter)** |
| 5 | Deploy the claims contract with **no** maintenance authority, provably (an empty committee, not a discarded key) | Otherwise every claim depends on trusting us | Built and tested against the real ledger code locally; the claims deploy does it by default. **Decision to confirm: Hunter + Mako** (recommended) |
| 6 | Website demo uses the real test-network contracts, VeilCore pays the network fees | Today licensing and settlement in the demo are simulated | Phase 1 built on branch `demo-real` behind `VITE_REAL_CHAIN=1`: proofs made in the visitor's browser, a separate fee-paying service (`sponsor/`) with strict limits, automatic batch anchoring. 107 tests with mocks. **Hunter: fund the fee wallet, set up Railway, first live runs (sponsor/README.md)**. Phase 2 (licences) after |
| 7 | Second, independent timestamp on Bitcoin (OpenTimestamps) for every batch | Dates no longer depend on Midnight alone; Chinese courts check consistency across chains | Built: the registry stamps every sealed batch and serves `root.bin` and `root.bin.ots`; files checked against the OpenTimestamps project's own parser. veilcore-api branch `ots`. Needs one real stamp from Railway after merge |
| 8 | One-click evidence package (record, proofs, timestamps, plain recompute guide, affidavit template) | What a lawyer or examiner actually receives | Built in the SDK (`buildEvidencePackage`), with `verify.py` that runs on plain Python; tested against tampering. Website button comes with the SDK release |
| 9 | Full data export, so nothing is lost if VeilCore stops | Everledger and TradeLens took their users' data with them | Built in the registry (`GET /api/export`), branch `ots`. Website button comes with the SDK release |
| 10 | Verify timestamp tokens properly (signature, imprint) | Today the SDK only checks one is present (now says so plainly) | Done in the SDK (`fields-v1`): imprint, signed digest, signature (RSA, ECDSA), time-stamping key usage; tested on real OpenSSL tokens and 2,000 corruptions. Chain of trust and EU trusted-list status are reported as not checked |
| 11 | Release checklist: test the offline maintenance key against the current Midnight SDK; check the indexer reads old state after a fork | Midnight issues #1409 and #1605 | Done (`docs/release-checklist.md`) |
| 12 | Full public review of site, docs and repos from every reader's angle | Every claim checked against the code | Done 3 Oct: 23 serious findings fixed (site on `main`, SDK docs live). Founders' items listed separately |
| 13 | A record can commit to its on-chain identity (SPEC 3.6) | Without it, which record an identity's licences and lineage belong to was the holder's word | Done in all three implementations, 99 vectors |

## Done today from the reviews

- Legal statements corrected (eIDAS Art. 41(2), Italy, US) in SPEC, EVIDENCE and the SDK.
- Website accuracy pass: distinctness tile removed until it is ours, custody wording,
  "no users yet", preprod post, dates, lineage and licences described.
- Three pre-existing input-handling gaps closed in all three implementations (null
  fields, missing required fields, unknown algorithm names).

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
