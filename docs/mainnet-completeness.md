# What VeilCore needs before mainnet

Status as of 3 October 2026. Owner: Claude (CTO work) unless marked. Decisions are for
Hunter and Mako. This list replaces "is it ready?" with what is done and what is not.

## Already in the main contract (frozen, tested, fingerprinted)

Seal and date a record (one or in batches) · prove you hold it · pair a DNA report ·
change or recover a key · licences (issue, countersign, transfer, revoke, prove privately)
· lineage both holders confirm · royalties and obligations that follow offspring.

## Being added

| # | What | Why it matters | Status |
|---|---|---|---|
| 1 | **Claims contract**: prove one value, a bound, distinctness, or an unchanged correction without showing the rest; lab-signed versions | The examiner and certifier problems (USDA PVPO, AOSCA ACR) | Built, 34 tests + 28-test attack suite, two attack rounds fixed, mutation testing running. Branch `claims-contract` |
| 2 | **Field sets in the record format** (SPEC 4.5) in TypeScript, Python, Rust | So any registry can seal records the claims contract can prove | Done: 95 shared test vectors, all three agree. Branches `fields-v1` |
| 3 | Prove the two heavy claims (distinct, unchanged) on a real proof server | They are 8x bigger than anything in the main contract | **Hunter**, on the Mac: one command, to come |
| 4 | Operator tool: deploy the claims contract, make claims, read them back; smoke test covers it | Nothing ships that has not run end to end on preprod | Built on `claims-contract`: menu options 34-40, claims verifier, smoke test 37 checks with the claims phase. Tested locally without proofs; **needs a preprod smoke run (Hunter)** |
| 5 | Deploy the claims contract with **no** maintenance authority, provably (an empty committee, not a discarded key) | Otherwise every claim depends on trusting us | Built and tested against the real ledger code locally; the claims deploy does it by default. **Decision to confirm: Hunter + Mako** (recommended) |
| 6 | Website demo uses the real test-network contracts, VeilCore pays the network fees | Today licensing and settlement in the demo are simulated | Planned |
| 7 | Second, independent timestamp on Bitcoin (OpenTimestamps) for every batch | Courts in China and France leaned on it; dates no longer depend on Midnight alone | Planned |
| 8 | One-click evidence package (record, proofs, timestamps, plain recompute guide, affidavit template) | What a lawyer or examiner actually receives | Planned |
| 9 | Full data export, so nothing is lost if VeilCore stops | Everledger and TradeLens took their users' data with them | Planned |
| 10 | Verify timestamp tokens properly (signature, imprint) | Today the SDK only checks one is present (now says so plainly) | Planned |
| 11 | Release checklist: test the offline maintenance key against the current Midnight SDK; check the indexer reads old state after a fork | Midnight issues #1409 and #1605 | Planned |
| 12 | Full public review of site, docs and repos from every reader's angle | Every claim checked against the code | After 4-9 |

## Done today from the reviews

- Legal statements corrected (eIDAS Art. 41(2), Italy, US) in SPEC, EVIDENCE and the SDK.
- Website accuracy pass: distinctness tile removed until it is ours, custody wording,
  "no users yet", preprod post, dates, lineage and licences described.
- Three pre-existing input-handling gaps closed in all three implementations (null
  fields, missing required fields, unknown algorithm names).

## Honest limits that stay

- Distinctness needs one party that holds both marker sets (the breeder or a lab that
  tested both). Two parties who will not show each other their markers need a different
  tool (multi-party computation).
- A claim is about a record as sealed; whether it was later corrected is checked
  separately.
- No independent security audit yet. The reviews above are our own.
