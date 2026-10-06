# What VeilCore needs before mainnet

Status as of 5 October 2026, evening. Owner: Claude (CTO work) unless marked. Decisions are
for Hunter and Mako. Nothing here is marked done unless a commit, a run record or a file
shows it. The blocker, recommended and mainnet-day lists come from an independent audit on
the evening of 5 October (kept outside the repo).

## Where things stand

- **Main contract:** frozen at `ceb3a16`, fingerprints in `e89a387`. Unchanged by round D.
- **Claims contract:** source last changed in `cd30c11`; built and fingerprinted on
  Hunter's Mac at `c75c155`, committed in `765cab1`. An independent build matched its 5 ZKIR
  files and `contract/index.js`.
- **Operator tool:** preprod smoke test 37 of 37 on 5 October, both contracts, on `d9d563f`
  (`docs/preprod-run-5oct.md`).
- **Registry:** round D fixes live on Railway from `veilcore-api` `main` `a9a9611` (5 October,
  about 07:30). Still on SDK 0.13.0. Still anchoring to the test network (its `/.well-known`,
  5 October).
- **Website:** round D fixes live since 5 October, about 07:57 (`b274acd`). The copy rewrite
  (`ea4302c` to `149484e`) is being deployed on the evening of 5 October. Still on SDK 0.13.0.
- **SDK:** 0.15.0 on npm since 5 October, 23:55 UTC, from `veilcore-sdk` `db91cc7`.
- **Partner kit:** `@veilcore/contracts` built on branch `partner-kit` (6 October), not yet
  run on a live network (see "Partner integration kit" below).
- **Neither contract is on mainnet.** Deployment record revision 4 is not filed.

## Blockers: before the mainnet deploy

| # | What | Status |
|---|---|---|
| B1 | **Founders' decisions** (Hunter + Mako). (a) Who holds the main contract's maintenance key: the proposal is one key, two paper copies, one per founder, later a two-of-three committee with an independent holder when we move to midnight-js 5; the alternative is real joint control (two signatures) before launch, which is new code, a new review and a preprod run first. (b) No retirement date for the main contract, and custody by independent parties instead of relinquishment as the end state. (c) The claims contract with no maintenance authority (item 5 below). (a) and (b) change what the filed 13 September record promised ("held jointly, not by one person and not in a file on a laptop"; relinquishment "the intended end state"), so both founders have to approve them. Full proposal: `docs/maintenance-policy.md` | **Open.** The policy says "PROPOSED … Not in force until both founders approve it". Three DECISION NEEDED markers in `docs/deployment-record-revision-4.md`. If (a) is two copies, runbook step 18's second-copy step applies and Mako's copy has to reach Japan without being photographed, scanned, emailed or typed anywhere. If (a) is real joint control, code has to be written first |
| B2 | **File deployment record revision 4 upstream** (`midnightntwrk/midnight-improvement-proposals`, `deployments/veilcore.md`) before any mainnet deploy. The filed 16 September correction promised it "will be filed before the deploy key is used and before any mainnet deployment is requested" | **Open.** Upstream (fetched 5 October) still ends at the 13 September revision and the 16 September correction. The local draft was brought up to date on 5 October evening: paragraphs the code contradicted fixed, round D and the 4 and 5 October preprod runs added, claims fingerprint table copied in, slots for both mainnet addresses and transaction ids. Still needs: B1's three decisions, the filing date, both founders' read. The CLI only checks `VEILCORE_DEPLOYMENT_RECORD_REVISION=4`; it cannot see whether the record was filed |
| B3 | **Zero-spend mainnet rehearsal** (runbook C, steps 1 to 13, then 5 to exit; `docs/release-checklist.md` section 6). The only live test of the mainnet wallet restore, DUST check, Blockfrost and both fingerprint checks before money moves. Hunter | **Not done.** No record of it |
| B4 | **Runbook matches the policy and the code** | **Corrected 5 October evening:** step 17 gives the policy's reasons (network upgrades, fixes; no retirement date); the "retire on the published date" section replaced; a second-copy step added to step 18, marked pending B1; the claims build message corrected; claims steps renumbered 22 to 30. Needs Mako's read. Final only once B1 is decided |
| B5 | **One independent review of the latest operator-path code**: `5a980b3` (claims mainnet deploy guard, address pins, fingerprint gating), `8de6f2a` (join reads the deploy transaction), `abc1fc9` (`?fp=` links). `docs/release-checklist.md` section 3 asks for a re-check of the fixes themselves. The mainnet-only branches (fingerprint refusals, empty-pin refusals, the claims "authority kept" refusal, `Starting state not re-checked` at the pin) cannot run on preprod and are covered only by unit tests from the same author. One focused review under the "only a HIGH reopens code" stop rule closes it | **Not done** |

## Strongly recommended before the deploy

| # | What | Status |
|---|---|---|
| R1 | **Run the real mainnet deploy path once on preprod.** The smoke test deploys the main contract with a key passed straight to the API (`bboard-cli/src/smoke.ts`), so deploy option 1's paper-key prompts (generate, WRITTEN, type back), finishing with option 4 from paper, and option 33 on the main contract have never run on a live network. One preprod option-1 deploy with a generated paper key, interrupted, finished with option 4, then the authority read back (one key). Hunter, with Claude | **Not done** |
| R2 | **Claims fingerprints in the deployment record** | **Done 5 October evening:** the 21 rows from `docs/fingerprints.md` (built at `c75c155`, committed `765cab1`) copied into revision 4. An independent build matched the 5 `.zkir` files and `contract/index.js`; keys and `.bzkir` could not be checked that way (no key generation) |
| R3 | **Round D summary up to date** (`docs/security-pass-4oct-roundD.md`) | **Done 5 October evening:** registry and site status, what came after the re-check and has not been independently reviewed, and the Still open list (including the two registry Lows and the SDK 0.15 move) |
| R4 | **One real Bitcoin timestamp from the live registry** (item 7): a `root.bin.ots` exists for a batch sealed since the 5 October deploy, and upgrades and verifies with the official client | **Not confirmed** |

## Mainnet day (open until the day, by design)

| # | What |
|---|---|
| M1 | **Pin both addresses.** `MAINNET_VEILCORE_ADDRESS` and `MAINNET_CLAIMS_ADDRESS` in `api/src/deploy-guard.ts` are empty on purpose. After the deploy Claude sets them in a reviewed commit and Hunter runs `git pull`. Until then every mainnet join is refused |
| M2 | **Registry to mainnet.** `VEILCORE_ANCHOR_NETWORK` and `VEILCORE_ANCHOR_CONTRACT` on Railway still name `preview` and `f75d42dc…` (27 September, before the merge). On the day: `mainnet` and the new main contract address. Decide who anchors mainnet batches: the demo service's anchorer is not deployed, so today it is by hand (CLI option 29, then the operator's `POST /batches/:id/anchor`) |
| M3 | **Website to mainnet.** Built (branch `site-mainnet`, 6 October): the site's network wording comes from the build mode, not hand edits. `npm run deploy:mainnet` builds `--mode mainnet` and refuses unless `MAINNET_VEILCORE_ADDRESS` is pinned and the registry's `/.well-known` anchors on mainnet at that address; the site shows both addresses. Hunter runs it after M1 and M2: `docs/mainnet-day-site.md`. Still on the day: the vendored SPEC/EVIDENCE/INTEGRATING (from the SDK) say test network; the mainnet site shows a note above them until an SDK docs update is vendored |
| M4 | **Publish the deployment details.** Revision 4 is filed before the deploy (B2). After it, fill *Mainnet deployment* in the record (both addresses, both deploy transaction ids, the claims retirement transaction, the date, the pin commit) and file that upstream as an addendum to revision 4 |

## After launch, or not blocking the contract deploy

- **Site and registry to SDK 0.15.0.** Both still use 0.13.0, which accepts small-order
  Ed25519 keys; the site's built-in `/docs/spec` is the 0.13.0 SPEC. The registry's
  `buildBatch` filter for this is already in (`a9a9611`).
- **Two registry Lows from the round D re-check:** small-order Ed25519 keys accepted at
  attester registration (`lineage/attesters.mjs:71`); an uppercase `subjectCommitment`
  accepted (`lineage/attesters.mjs:206`).
- **Round D "Still open"** (`docs/security-pass-4oct-roundD.md`), round C format gaps
  (below), SDK spec gaps (null attestation fields, challenge `state` unsigned), and the
  1024-active-licence test (`SLOW_TESTS=1`), never run to completion.
- **No CI** on `veilcore-sdk`, `veilcore-api` or `veilcore-rs`. The registry deploys `main`
  to Railway with no CI. (This repository's CI and scan pass on `main`, `149484e`.)
- **No branch protection** on any of the four repositories.
- **Dependabot:** `tools/vercel/package-lock.json` (added in round D) audits at 1 critical
  and 24 high, all inside `vercel`'s own dependency tree. Deploy-time tooling, not shipped,
  but counted. No `.github/dependabot.yml`.
- **Proof server pinned by tag** (`midnightntwrk/proof-server:8.0.3`), not by digest.
- **SDK release hygiene:** no `v0.15.0` git tag, no npm provenance. The tarball itself
  rebuilds byte-identical from `db91cc7`.
- **Demo service** (`demo-real`, `762cd6f`): not merged into `main` (46 commits behind on 5 October), not
  deployed; fee wallet unfunded, Railway not set up (item 6, Hunter). The site demo stays
  simulated.
- **Housekeeping:** delete `~/Desktop/old-test-store` (`docs/preprod-run-5oct.md`); tag the
  commit the mainnet deploy runs from (`docs/release-checklist.md` section 6).

## Already in the main contract (frozen, tested, fingerprinted)

Seal and date a record (one or in batches) · prove you hold it · pair a DNA report ·
change or recover a key · licences (issue, countersign, transfer, revoke, prove privately)
· lineage both holders confirm · royalties and obligations that follow offspring.

## Being added

| # | What | Why it matters | Status |
|---|---|---|---|
| 1 | **Claims contract**: prove one value, a bound, distinctness, or an unchanged correction without showing the rest; a laboratory's signature on a record as its own claim | The examiner and certifier problems (USDA PVPO, AOSCA ACR) | Built, two attack rounds fixed, mutation tested. Layout revised 4 Oct so every circuit fits a laptop (item 3). Preprod 37/37 (item 4). **Mainnet gate in code (5 Oct, `5a980b3`, on `main`; not yet independently reviewed, B5):** a mainnet claims deploy is allowed only when the claims build matches its own committed fingerprints, record revision 4 is declared, and the deploy ends with an empty-committee authority; joining on mainnet accepts only `MAINNET_CLAIMS_ADDRESS` (empty until deployed). Claims fingerprints made on Hunter's Mac and committed 5 Oct (`765cab1`). Preprod 37/37 again on 5 Oct (`d9d563f`). Deploys on deploy day right after the main contract (runbook C, steps 22-30) |
| 2 | **Field sets in the record format** (SPEC 4.5) in TypeScript, Python, Rust | So any registry can seal records the claims contract can prove | Done: 100 shared test vectors, all three agree, and the compiled contract recomputes them. Merged to main 4 Oct |
| 3 | Prove the two heavy claims (distinct, unchanged) on an ordinary computer | A holder who cannot prove on their own machine has to hand their values to someone else | **Done 4 Oct.** At k=19 (old layout) the unchanged claim crashed the proof server on Hunter's 16 GB Mac. Leaner layout: every claim k=17 or less. Re-run on the same Mac: all claims back to back, proof server peak 3.7 GB, distinct 8.6 s, unchanged 6.7 s |
| 4 | Operator tool: deploy the claims contract, make claims, read them back; smoke test covers it | Nothing ships that has not run end to end on preprod | **Done 4 Oct.** Menu options 34-40, claims verifier, smoke test 37 checks. Local chain with real proofs 37/37, then **preprod 37/37** (main contract f239e680…, claims contract 175f2357…, maintenance authority provably retired on chain). See docs/preprod-run-4oct.md |
| 5 | Deploy the claims contract with **no** maintenance authority, provably (an empty committee, not a discarded key) | Otherwise every claim depends on trusting us | Built and tested against the real ledger code locally, and on preprod (PASS 28). Since 5 Oct the tool **only** allows this on mainnet: a claims deploy that would keep an authority is refused there. **Decision to confirm: Hunter + Mako** (recommended; B1). If they want an authority on the claims contract instead, that rule has to change first |
| 6 | Website demo uses the real test-network contracts, VeilCore pays the network fees | Today licensing and settlement in the demo are simulated | Phase 1 built on branch `demo-real` behind `VITE_REAL_CHAIN=1`: proofs made in the visitor's browser, a separate fee-paying service (`sponsor/`) with strict limits, automatic batch anchoring. 107 tests with mocks. **Hunter: fund the fee wallet, set up Railway, first live runs (sponsor/README.md)**. Phase 2 (licences) after |
| 7 | Second, independent timestamp on Bitcoin (OpenTimestamps) for every batch | Dates no longer depend on Midnight alone; Chinese courts check consistency across chains | Built: the registry stamps every sealed batch and serves `root.bin` and `root.bin.ots`; files checked against the OpenTimestamps project's own parser. Merged; live on Railway since 5 Oct (`a9a9611`). **Not yet confirmed:** one real stamp from the live registry (R4) |
| 8 | One-click evidence package (record, proofs, timestamps, plain recompute guide, affidavit template) | What a lawyer or examiner actually receives | Built in the SDK (`buildEvidencePackage`), with `verify.py` that runs on plain Python; tested against tampering. Website button comes with the site's move to SDK 0.15 |
| 9 | Full data export, so nothing is lost if VeilCore stops | Everledger and TradeLens took their users' data with them | Built in the registry (`GET /api/export`); live since 5 Oct (`a9a9611`). Website button comes with the site's move to SDK 0.15 |
| 10 | Verify timestamp tokens properly (signature, imprint) | Today the SDK only checks one is present (now says so plainly) | Done in the SDK (`fields-v1`): imprint, signed digest, signature (RSA, ECDSA), time-stamping key usage; tested on real OpenSSL tokens and 2,000 corruptions. Chain of trust and EU trusted-list status are reported as not checked |
| 11 | Release checklist: test the offline maintenance key against the current Midnight SDK; check the indexer reads old state after a fork | Midnight issues #1409 and #1605 | Written into `docs/release-checklist.md` (section 4); the checks themselves run at each release |
| 12 | Full public review of site, docs and repos from every reader's angle | Every claim checked against the code | Done 3 Oct: 23 serious findings fixed (site on `main`, SDK docs live). Founders' items listed separately |
| 13 | A record can commit to its on-chain identity (SPEC 3.6) | Without it, which record an identity's licences and lineage belong to was the holder's word | Done in all three implementations, 100 vectors; the contract repo's own copy fixed in round C |

## Done from the earlier reviews

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
- **Fixed in the registry (live since 5 October, `a9a9611`):** the data export could be used
  to overload the service; one bad timestamp server could corrupt a batch's Bitcoin proof;
  a pending Bitcoin proof was presented as final.
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
`docs/security-pass-4oct-roundD.md`. Main contract: nothing found. The first set of fixes
was independently re-checked; that re-check found new problems, which were fixed afterwards
and have not been re-checked independently (B5). Two registry Lows and the move to SDK 0.15
are still open. What changes for the mainnet deploy:

1. Re-run the preprod smoke test on this build first. **Done 5 Oct, 37/37 on `d9d563f`**
   (`docs/preprod-run-5oct.md`).
2. First run of this tool version: it finds the old `bboard-cli/midnight-level-db` store
   and asks; type MOVE, confirm it works, then delete the old folder (and its backups). On
   5 Oct MOVE refused the old store (it held entries under more than one password), so the
   run used a fresh store; the old folder was moved to `~/Desktop/old-test-store`, still to
   delete. MOVE has not yet completed on a real store.
3. The maintenance key is never saved on the computer; "Finish a deploy" asks for the
   paper copy.
4. Write down the `Deploy transaction id` the tool prints, next to the address.
5. Mainnet joins are refused until the address is pinned in the code
   (`MAINNET_VEILCORE_ADDRESS`) after the deploy.
6. Registry live before the website is redeployed (the site saves disclosure choices to
   the registry, and the registry fix for `profile` came with it). **Done 5 Oct:** registry
   about 07:30, site about 07:57.

## Deploy day, claims contract (added 5 October)

1. **Before:** the claims contract's fingerprints made on Hunter's Mac and committed
   (runbook C0). **Done 5 Oct:** built at `c75c155`, committed `765cab1`, matched by an
   independent build of its ZKIR and contract code, and copied into the deployment record.
2. **On the day:** the main contract first (runbook C, steps 1-21), then in the same run
   option 34 (steps 22-30). No paper key: the claims deploy ends with an empty committee.
3. **Write down:** the claims contract address and the `Claims deploy transaction id`,
   next to the main contract's.
4. **After:** Claude pins the address (`MAINNET_CLAIMS_ADDRESS` in `api/src/deploy-guard.ts`)
   and puts both in the deployment record (M1, M4); until then joining it on mainnet is
   refused.

## Partner integration kit (added 6 October)

Founder's requirement: when mainnet is announced, a lab, registry, seed certifier or
software vendor can integrate VeilCore's contracts into their own systems. Built on branch
`partner-kit`: the package `@veilcore/contracts` (`partner-kit/`), `docs/PARTNERS.md`, and
three runnable examples (lab, breeder licence, claims).

| # | What | Status |
|---|---|---|
| P1 | Package: connect, join (mainnet: pinned addresses only), every partner operation on both contracts, wallet-free checks; no deploy or maintenance reachable | **Built, reviewed, fixed.** Independent review 6 Oct (`review-partner-kit.md`): one blocker (the example's refusal check read only the top error; midnight-js wraps the refusal two causes deep, so partner-check would have failed at check 18 after ~10 transactions) and four mediums, fixed on `partner-kit-fixes`. 56 tests, including the reviewer's experiment through real midnight-js as a regression test, and a chain stand-in that now throws exactly what midnight-js throws |
| P2 | First live run: `npm run partner-check` on preprod (wallet seed 2): checks all 87 key files against the record first (stops before any transaction if one differs), then 23 checks through the public package only | **Not done.** Hunter, on the Mac |
| P3 | Keys published: `npm run keys:stage -w @veilcore/contracts` on the Mac that built them, then every file in `partner-kit/zk-release/` uploaded to ONE GitHub release tagged `zk-r4` (the package's default keys URL). Every client checks every file against the fingerprints, so the host need not be trusted | **Not done.** Until then partners must build the keys themselves. **Decision:** host there, or elsewhere (then change `DEFAULT_KEYS_URL`) |
| P4 | npm: create the `@veilcore` organisation on npmjs.com (the scope does not exist yet; the name `@veilcore/contracts` is free), set `"private": false`, publish from a tagged commit | **Not done.** Decision: scope `@veilcore` (recommended) or unscoped `veilcore-contracts` (also free) |
| P5 | Mainnet day: the package takes `MAINNET_VEILCORE_ADDRESS` / `MAINNET_CLAIMS_ADDRESS` from `api/src/deploy-guard.ts`, so pinning them (M1) pins the package too; rebuild and publish after M1 | Waits on M1 |
| P6 | Local chain for partners (`partner-kit/local`, `local:deploy`) | Written; not run here (no Docker in this environment). First run: Hunter or CI |
| P7 | Fee sponsorship (VeilCore pays a partner's fees) | **Not offered**, said so in PARTNERS.md. v1 is the partner's own DUST, or VeilCore operating on their behalf |

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
- No independent security audit yet. The reviews above are AI reviews we directed, not a
  paid audit.

## Partner kit: publishing (decided 6 Oct)

- **npm name:** `@veilcore/contracts`. Hunter creates the free npm organisation `veilcore`
  (npmjs.com, Add Organization, free plan), which also reserves the name. Then the package's
  `"private": true` comes off and it is published from the Mac like the SDK.
- **Proving key files:** a GitHub release tagged `zk-r4` on the public repo
  `hunterincoming/veilcore-midnight-testnet`. On the Mac: `npm run keys:stage -w @veilcore/contracts`,
  then upload every file it produces to that release. The kit checks every file against the
  committed fingerprints, so a wrong file is refused.
- **Managed option at launch:** ~~dating only~~ changed later on 6 Oct: **VeilCore-run**, custody
  with an exit (docs/MANAGED.md). VeilCore holds a partner's record, licence and claim secrets
  in a store of that partner's own, and by default NOT their recovery secrets (the partner keeps
  one master sheet). Three options at launch: VeilCore-run, the partner kit, website
  self-custody after launch (docs/PARTNERS.md). See "VeilCore-run" below for what is open.
- **Maintenance key:** one key, two paper copies (Hunter, Mako). Hunter approved 6 Oct;
  Mako to confirm. The policy stays PROPOSED until he does, and the site says so.

## VeilCore-run (managed service v1, added 6 October)

Built on branch `managed`: `veilcore-run/` (custody stores, operator CLI `npm run managed`,
exit), `docs/MANAGED.md`, `docs/legal/managed-service-agreement-DRAFT.md`. Uses only the
partner kit's public exports (a test checks). 30 tests on the kit's chain stand-in; not run on
a live network.

| # | What | Status |
|---|---|---|
| R1 | Per-partner encrypted store (scrypt N=2^17 + AES-256-GCM, 0700/0600, own password), export bundle to the partner's passphrase, printable sheet | **Built, tested** |
| R2 | Operator CLI: every partner operation, per-partner audit log (hash-chained, no secrets) | **Built, tested on the stand-in.** First live run on preprod: Hunter (one partner, `anchor`, `prove-ownership`, `export`, `exit --mode assisted`) |
| R3 | Exit: self, and assisted (VeilCore installs the partner's recovery commitment, then rotates to a secret only the bundle holds); retire; purge | **Built, tested on the stand-in** |
| R4 | Agreement | **Draft only.** Must be reviewed by a lawyer before any partner signs. Fees and governing law blank |
| R5 | Decision: offer custody mode (VeilCore holds recovery secrets) at all, or partner-held recovery only | **Open.** Recommendation in MANAGED.md: partner-held; custody only with the risk in writing |
| R6 | The operations computer (dedicated, FileVault, no cloud backup of `~/.veilcore/managed`), and its offline encrypted backup | **Not done.** Hunter |
| R7 | Independent security review of `veilcore-run/` | **Not done** |

