# The website does real transactions: where it is, and the plan

**Written 6 October 2026, after merging the phase 1 branch (`demo-real`) into main's current
code on the `real-chain` branch. Nothing here changes veilcore.org: every part of it is behind a
build flag that veilcore.org is not built with.**

## In plain English

The goal: someone opens the VeilCore website and does the real thing on Midnight, from their own
browser, with no wallet and no crypto. Their secrets stay in their browser (and on a sheet of
paper they keep). VeilCore pays the network fee through a small service of its own, the
"sponsor", which can pay for a visitor's transaction but cannot change it or see their secrets.

**Phase 1 is built.** On a test network, a visitor can put a record on chain, publish its DNA
report's fingerprint, and prove to someone that they hold it. It is not switched on anywhere yet.
This session brought it up to date with everything that changed on main (the round D fixes,
mainnet mode, the copy rewrite, the partner kit, VeilCore-run) and fixed one thing that would have
stopped it working on the real site (below, "What changed in this merge").

**To run phase 1 for real** takes about a week of setup, mostly Hunter's: a demo contract on
preprod, a sponsor wallet with test DUST, two services on Railway, the site on its own address
(`try.veilcore.org` or similar, never veilcore.org itself), and a test registry for it. Then
measure on a laptop and a phone. Section 2 is the checklist.

**Phase 2** brings the rest of what VeilCore does into the browser: licences, parentage,
obligations, claims, and taking a record back with the recovery secret. The biggest decision is
how a non-technical person keeps their secrets: the plan is one master secret on one printed
sheet (the same scheme VeilCore-run uses), from which everything can be recovered. Everything in
the main contract is small enough to prove on a phone (measured: at most k=14). The two biggest
claims (k=17) are probably too heavy for a phone, so those are proved on a laptop, or by
VeilCore-run for someone who accepts handing over those values. Rough effort: 6 to 10 weeks with
the independent reviews, then a separate mainnet step. Section 9 has the order.

---

## 1. What phase 1 does now

Behind `VITE_REAL_CHAIN=1`, on a test network only:

| Step on the site | Circuit | k | What becomes public |
|---|---|---|---|
| "Anchor this record" (record page, wizard step 1) | `anchor(recoveryCommitment)` | 14 | the record's on-chain identity `commit(record secret)` and a commitment to its recovery secret |
| "Also publish this pairing" (wizard step 2, optional, warned) | `pairDna(dnaCommitment)` | 13 | the DNA report's fingerprint, next to the identity, permanently |
| "Prove you have held this record" (certificate) | `proveOwnership(challenge)` | 13 | that the identity's secret holder answered this verifier's challenge |
| "Ask the holder to prove" (verify page, `?chain=…&anchorTx=…`) | none: reads the chain | | nothing; the verifier's page checks the answer |

How a call runs (`bboard-ui/src/veilcore/chain/actions.ts`): read the contract from Midnight's
public indexer and refuse a contract with a circuit this build does not know; run the circuit
locally against that state (so a call the contract would refuse is refused before anything is
sent); prove it in a web worker with Midnight's own WebAssembly prover (`prover.worker.ts`);
seal (bind) it, which fixes it for good; send the sealed bytes, a small proof of work and a random
per-browser ticket to the sponsor; wait for the network to include it. The browser uses
throwaway keys for the call itself: VeilCore's circuits use no coins.

Secrets in phase 1 (`record-keys.ts`): a random record secret and recovery secret per record, in
this browser's localStorage under their own key, never on a record (records go to the registry).
The site asks for a backup file (one JSON file per record, marked SECRET) before it will anchor,
warns before anything would lose them, and can restore from the file.

The sponsor (`sponsor/`): pays only for `anchor`, `proveOwnership` and `pairDna` on the one
configured contract, refuses anything else it cannot read (fail closed), adds its fee in a
separate part it merges in (a merge refuses a second contract call, so it cannot change the
visitor's call), and limits: proof of work (difficulty 18), 3 an hour and 10 a day per network
address, a per-ticket friendly cap (anchor 3, pairDna 5, proveOwnership 20 a day), a daily DUST
budget (default 50) and a per-transaction fee cap (default 5 DUST), a queue of 20. It also has a
batch-anchoring job (see the warning in 2.4). It refuses to start on mainnet.

The verifier's check (`ownership-check.ts`): the challenge is made in the checker's tab and used
once; the answer is judged by **the partner kit's own `checkOwnership`** (section 7), the same
function a lab or registry calls.

## What changed in this merge (6 October)

- **Main's pages are untouched.** Phase 1 used to edit the site's pages directly, with
  `{REAL_CHAIN && <Panel/>}`. That leaves traces in the bundle even when the flag is off, so it
  could not be byte for byte the site. Now the pages are exactly main's, and a real-chain build
  adds each panel at a named place at build time (`bboard-ui/real-chain/slots.mjs`: seven slots,
  each tied to one exact line of a page). If a page changes so a slot no longer fits, the
  real-chain build stops and names the slot; `npm run typecheck` also typechecks the pages with
  the slots applied, so a renamed variable is caught on main's CI, not on deploy day.
- **Checked byte for byte:** a build without the flag is identical to main's build, every file,
  in preprod mode and in mainnet mode (`npm run real-chain:compare -w bboard-ui` builds both from a
  fresh checkout of main and compares; `src/real-chain-build.test.ts` checks the build carries
  none of the chain code and, given main's build, that they are identical).
- **Fixed: the proving worker would have been blocked on the real site.** Round D turned on
  Trusted Types (`require-trusted-types-for 'script'`), and starting a Worker from a plain URL is
  a Trusted Types sink. Phase 1 started its worker that way, so every proof would have failed with
  a TypeError. The worker now starts through a policy named `veilcore-worker` that passes only
  this build's own worker URL, and only a real-chain deploy's policy allows that name. A headless
  Chromium test, under the exact headers `scripts/vercel-config.mjs` makes, starts the worker,
  runs a job in it, and confirms a plain-URL worker or another policy name is refused.
- **Proving files are checked** against VeilCore's published fingerprints (the partner kit's
  table) before the prover uses them.
- **Guards:** `deploy:prod` and `deploy:mainnet` refuse to run while `VITE_REAL_CHAIN` is set;
  the build refuses the flag in mainnet mode and refuses it if it is written in
  `bboard-ui/.env.<mode>` (the files veilcore.org is built from); the proving parameters moved
  out of `public/` so only a real-chain build ships them.
- Verify links made by the holder now carry the record fingerprint (`?fp=`, round D) as well as
  `chain` and `anchorTx`; the verifier's panel shows only when the registry found the record and
  the fingerprint does not contradict it.
- The phase 1 tests run per file with their own settings (no shared test config), so the site's
  own tests, which run real builds, never see the flag.

## 2. Running phase 1 live (preprod)

The order matters; each step says how you know it worked. `sponsor/README.md` has the
click-by-click version of steps 1 to 6.

1. **Compile the contract with keys** (`cd contract && npm run compact`), on a machine that can
   download Midnight's parameters. The site's build copies `keys/` and `zkir/` from it.
2. **Deploy a demo contract on preprod** with the operator tool and the usual deployer wallet.
   Not the registry's contract. Its maintenance key stays offline as always.
3. **Sponsor wallet:** a new wallet made only for this. tNIGHT from the preprod faucet; the CLI
   registers it for DUST. Save the seed in the password manager. The deployer wallet's two
   addresses go in `SPONSOR_FORBIDDEN_ADDRESSES`.
4. **Railway:** a proof server pinned by digest (private network only), and the sponsor service
   (staged with `npm run stage -w sponsor`, a volume at `/data`). Required variables:
   `SPONSOR_SEED`, `SPONSOR_FORBIDDEN_ADDRESSES`, `VEILCORE_CONTRACT_ADDRESS` (the demo contract),
   `PROOF_SERVER_URL`, `STATE_DIR=/data`, `ALLOWED_ORIGINS=https://try.veilcore.org`,
   `TRUST_PROXY_HOPS=1`, `SPONSOR_STATUS_TOKEN` (64 random hex), **`ANCHORER_ENABLED=0`**. Works
   when `/sponsor/status` says `"synced": true`.
5. **A registry for the test site.** The real-chain site saves records to a registry like the main
   site does. Since main's registry anchors on mainnet, a test-network site pointed at it would
   say "test network" about records the registry dates on mainnet (the same reason
   `deploy:prod` now refuses to run). So either run a second registry service for the test site
   (same code, its own database and operator token) or decide, in writing, that the test site
   uses the main registry and its copy says so. **Open decision for Hunter and Mako.**
6. **The site, on its own address.** Never `deploy:prod` or `deploy:mainnet` (both refuse). From
   the repository folder, in one terminal:

   ```sh
   npm run real-chain:params -w bboard-ui      # once: the public proving parameters
   export VITE_REAL_CHAIN=1
   export VITE_REAL_CHAIN_CONTRACT_ADDRESS=<demo contract, 64 hex>
   export VITE_SPONSOR_URL=<sponsor's Railway domain>
   export VITE_API_BASE=<the registry from step 5>
   (cd bboard-ui && npm run build)
   rm -rf .vercel/output && mkdir -p .vercel/output/static && cp -r bboard-ui/dist/* .vercel/output/static/
   node scripts/vercel-config.mjs              # the policy now allows the indexer, the sponsor and the worker
   npm ci --prefix tools/vercel --include=dev --ignore-scripts --no-audit --no-fund
   URL=$(./tools/vercel/node_modules/.bin/vercel deploy --prebuilt)      # no --prod
   ./tools/vercel/node_modules/.bin/vercel alias set $URL try.veilcore.org
   ```

   Before the first alias, add `try.veilcore.org` to the Vercel project's domains and the DNS
   record Vercel asks for, as was done for veilcore.org. Worth turning into one
   `deploy:real-chain` script with its own preflight once it has been done by hand once.
7. **Try it:** laptop first (log a cultivar, make the keys, download the backup, anchor, publish
   a pairing, answer a challenge from a second browser), then a phone. Write down the proving
   time and whether the phone kept up. That decides phone support (section 6).
8. **Set the real limits** from what the explorer says each call cost: `MAX_FEE_DUST` about twice
   the largest fee seen; `DAILY_BUDGET_DUST` well under what the wallet's tNIGHT generates a day.

### 2.4 Two warnings

- **Leave the sponsor's batch-anchoring job off after the mainnet launch** (`ANCHORER_ENABLED=0`,
  no `REGISTRY_URL`, no `REGISTRY_OPERATOR_TOKEN`). It was written to anchor the registry's
  batches on preprod; after launch the operator anchors them on mainnet, and a preprod anchor
  would put test-network dates on mainnet records. Worth a code guard too: refuse to anchor when
  the registry's `/.well-known/veilcore-registry` lists a mainnet anchor (as the site's preflight
  already reads it).
- **The proving parameters are not pinned.** `fetch-params.mjs` downloads them from Midnight's
  public bucket and prints their SHA-256, but does not check it against anything. Before go-live:
  record the hashes once (and compare with the copy `compact` caches), pin them in the script, and
  check them in the worker like the keys.

### 2.5 Abuse limits for go-live

Start tight and loosen with evidence: the defaults above, `POW_DIFFICULTY` raised if the logs show
scripted traffic, `/sponsor/status` checked daily the first week (the operator view shows the
budget and counters). The per-ticket cap is only a friendly message (a script makes a new ticket
per request); the network-address cap and the DUST budget are what actually limit abuse, and the
budget is shared with any anchoring job. A kill switch exists already: stop the Railway service,
and the site says the sponsor is not answering.

## 3. Phase 2: what moves into the browser

Every main-contract circuit is k=13 or k=14 (measured today with `Zkir.getK` on the compiled
circuits), the same size as phase 1's. The claims circuits are 13 to 17.

| Feature | Circuits (who calls) | k | Secrets the browser needs |
|---|---|---|---|
| **Keep and take back** | `rotateRecordSecret` (holder), `recoverRecordSecret` (whoever holds the recovery secret), `replaceRecoveryCommitment` | 14 | record secret; recovery secret only at the moment of recovery |
| **Licences** | `issueLicense` (issuer), `countersignLicense` (licensee), `proveLicense` (licensee, to a verifier's challenge), `revokeLicense` (issuer), `proposeTransfer` / `withdrawTransfer` (licensee), `approveTransfer` (issuer) | 14 | issuer: record secret. Licensee: licence secret, and the Merkle path of their licence, recomputed from the chain each time |
| **Parentage** | `proposeParent` (child's holder), `confirmParent` (parent's holder), `withdrawParent` | 13 | record secret of whichever side acts |
| **Obligations** | `proposeObligation` (beneficiary), `encumberOwnRecord` (holder), `acceptObligation` / `rejectObligation` (holder), `withdrawObligation` (beneficiary), `discharge` (beneficiary) | 14 | record secret; the obligation's terms and salt (private, needed later to show what was agreed) |
| **Claims** (claims contract) | `proveAttested` 13, `proveValue` 15, `proveRange` 16, `proveDistinct` 17, `proveUnchanged` 17 | 13-17 | the record's hidden field values and salts; for labs, the lab's signing key |
| Never from the browser | `anchorBatch`, `sealRevocations` (VeilCore's own job), deploys, maintenance | | |

Two-party steps (licence issue then countersign, parentage propose then confirm, obligation
propose then accept) need a hand-off between two people. Use what the site already does for
challenges: a link or QR code carrying only public values (a commitment, a record identity),
never a secret, and a page for the other side that reads the pending state from the chain.

`proveLicense` needs the licence's current Merkle path in the active-licence tree. The browser
recomputes it from the contract state each time (the tree changes with every issue and
revocation, and VeilCore's `sealRevocations` job moves the accepted roots), so a presentation can
fail with "the path is stale" between a revocation and the next seal; the screen has to say so in
plain words and retry.

## 4. Where the secrets live, and how a non-technical person keeps them

Phase 1's one-JSON-file-per-record backup does not scale: a grower with forty records will not
keep forty files. Phase 2 adopts the scheme VeilCore-run already uses for partners
(`veilcore-run/src/partner-keys.ts`, reviewed 6 October), so a holder can move between the
website and VeilCore-run without new paperwork:

- **One master secret, made in the browser, printed on one sheet.** 32 random bytes, printed as
  16 groups of four characters with a four-character check (`veilcore-run/src/sheet.ts`), plus a
  QR code of the same, on a print-only page. The site asks the holder to type back two groups
  before it goes on, and never shows the master again. It is not stored in the browser.
- **Recovery secrets come from the master** (`HMAC-SHA256(master, "veilcore-run/v1/recovery/" + i)`).
  At setup the browser works out a pool of recovery commitments (public) and then forgets the
  master; each new record takes the next commitment from the pool. With the sheet alone the
  holder can find every one of their records on chain (each anchored record names its recovery
  commitment) and take it back to a new record secret, even with the browser gone and VeilCore
  gone.
- **Record secrets** are operational: random per record, kept in the browser, and in an
  encrypted backup file. Losing them is an inconvenience (recover with the sheet), not a loss.
  Someone who steals them can act as the holder until the holder recovers; recovery outranks the
  record secret and takes the record back in one transaction.
- **Licence secrets** for licences the holder receives: from the master
  (`"veilcore-run/v1/licence/" + j`), so they too come back from the sheet.
- **Obligation terms and salts, and claim values and salts:** the salts from the master; the
  terms and values are the holder's own content and live in the encrypted backup file (and, for
  values, in the sealed record file they already keep).
- **Backup file:** one file, encrypted under a passphrase the holder chooses (scrypt and
  AES-GCM, as VeilCore-run's boxes are), with everything except the master. "Download a backup"
  replaces the per-record files; phase 1's files are imported once.
- **In the browser:** the operational secrets in IndexedDB, encrypted at rest under a key the
  site keeps for the session after the holder unlocks it (the passphrase, or a passkey where the
  browser supports the PRF extension). Any script running on the page can read whatever is
  unlocked, which is why the site's CSP and Trusted Types matter so much for this feature; they
  are part of the security review, not decoration.
- **Plain-language screens:** what the sheet is for ("this paper gets your records back if this
  computer is lost; anyone who has it can take them"), when the site needs it (only to recover or
  to make more pool entries), and a check-your-sheet step every few months.

Migration from phase 1: keys made in phase 1 keep working; the site offers to rotate each record
to a fresh secret and move its recovery commitment to one from the pool
(`replaceRecoveryCommitment`, k=14, sponsored), after which the old per-record file is not needed.

## 5. Reusing the partner kit in the browser

**Reused now** (imported by module path, not through the package):

- `partner-kit/src/verify.ts`'s `checkOwnership`: the website's verifier judges an answer exactly
  as a partner's code would (tested against a stand-in indexer).
- `partner-kit/src/fingerprints.ts`: the browser prover checks every key and circuit file
  against it.

**What blocks the package itself in a browser** (`@veilcore/contracts` is one ES module built for
Node, so importing it loads everything):

- `commitments.ts`: `node:crypto` (`createHash`, `randomBytes`) and `Buffer`.
- `keys.ts`: `node:fs`, `node:os`, `node:path`, `node:crypto` (an on-disk key cache).
- `private-state.ts`: LevelDB through `bboard-cli/src/private-store.ts`, and the filesystem.
- `wallet.ts`, `wallet-progress.ts`: the wallet SDK, `node:crypto`, the filesystem.
- `connect.ts`: imports `keys.ts`, and proves through an HTTP proof server (a browser proves in
  its own worker instead).
- `VeilCore` (`veilcore.ts`): imports `commitments.ts`, and `api/src/veilcore-api.ts`, which
  imports `deploy-fragments.ts` (`node:util`).

**Recommended first step of phase 2:** a `@veilcore/contracts/browser` entry: commitments with
WebCrypto and `@noble/hashes`, a `Connection` built from the caller's own providers (the browser's
worker prover, the sponsor as wallet, in-memory private state), a fetch-and-fingerprint key
source (what `zk-material.ts` does now), and `deploy-fragments.ts` without `node:util`. Then the
website's calls become `VeilCore.join(connection)` and the kit's own methods, instead of growing
`actions.ts` by twenty circuits, and the kit's join checks (no unknown circuit, circuit keys on
chain match the fingerprints, the contract started from VeilCore's constructor) protect the
website too. It also gives partners' developers a browser build.

## 6. Proving cost in a browser

**Measured** (`docs/claims-design.md`, 16 GB laptop, Midnight's native proof server, 4 Oct):
`proveDistinct` (k=17) 8.6 s, `proveUnchanged` (k=17) 6.7 s, `proveAttested` (k=13) 0.7 s; the
server's memory rose about 1.2 GB for the claims (3.7 GB peak over 2.5 GB idle).

**Not measured yet: the browser.** The proving parameters could not be downloaded in this
session, so these are estimates, to be replaced by step 7 of section 2:

- The browser runs the same prover compiled to WebAssembly, single-threaded (the site is not
  cross-origin isolated, so no WebAssembly threads). Expect it several times slower than the
  native server, which uses every core: roughly 5 to 20 times.
- Memory roughly doubles with each step of k (claims-design). k=13/14 is an eighth or less of
  k=17: a few hundred MB at most. k=17 is around 1 to 2 GB inside a 32-bit WebAssembly heap
  (4 GB ceiling).

| | Laptop browser (estimate) | Phone browser (estimate) |
|---|---|---|
| Main contract, k=13/14 (phase 1 and all of phases 2.1 to 2.4) | a few seconds to ~15 s | ~10 s to a minute; fine if the tab stays open |
| `proveAttested` k=13, `proveValue` k=15 | seconds | probably fine; measure |
| `proveRange` k=16 | tens of seconds | borderline; measure |
| `proveDistinct`, `proveUnchanged` k=17 | ~45 s to 3 min, 1-2 GB | **assume not supported**: mobile Safari ends tabs well below that |

**Proposal:**

1. Phones do everything up to k=14, and claims up to whatever the measurement allows.
2. k=17 claims run in the browser on a laptop or desktop. On a phone the site says so and offers
   to continue on a computer (a link carries only public values; the computer needs the holder's
   backup file and sealed record, which they bring themselves).
3. For someone with no computer: **VeilCore-run proves it for them**, with a screen that says
   plainly what that means: VeilCore sees the hidden values that claim is about. That is the
   VeilCore-run trust model (custody with an exit), chosen per claim, never by default. A
   VeilCore-hosted proof server for website visitors is not offered: a proof server receives every
   private input (the partner kit warns about this too).
4. Measure before building claims (one day): a bench page in a real-chain build that proves each
   circuit with stand-in values, run in desktop Chrome, Firefox and Safari, on a mid-range Android
   and an iPhone, recording time and peak memory. Gate: a circuit is offered on phones only if it
   finishes on both phones, under a minute, without the tab being killed.

## 7. Sponsor policy for phase 2

- **Which circuits:** the allow-list grows by milestone: 2.1 adds `rotateRecordSecret`,
  `recoverRecordSecret`, `replaceRecoveryCommitment`; 2.2 the six licence circuits and
  `proveLicense`; 2.3 the three parentage circuits; 2.4 the six obligation circuits; 2.5 the claims
  contract (a second configured contract address, with its own allow-list). `anchorBatch`,
  `sealRevocations`, deploys and maintenance stay refused whatever the configuration says.
- **Limits per circuit**, not one global count: cheap and harmless ones (`proveOwnership`,
  `proveLicense`) higher; ones that fill shared state lower. The contract already bounds what one
  identity can fill (32 pending licences per issuer, 8 pending obligations per beneficiary, 16
  open obligations per record, 16 rotations and 16 recoveries), so fee drain, not state, is the
  risk. Where the sealed transaction's public part names the record identity, cap per identity
  as well as per network address (to confirm against what a sealed call exposes).
- **Recovery is always paid**, even over the visitor's daily cap: a holder taking a stolen record
  back must not be stopped by a quota a thief used up. It stays inside the global budget.
- **Mainnet** is its own decision: a sponsor wallet on mainnet whose NIGHT is registered for DUST
  once (the runbook's rule: never register the same NIGHT twice), a budget that is what that NIGHT
  generates, `PARTNERS.md` updated (it says fee sponsorship is not offered), terms of use for paying
  strangers' fees, and an alert before the budget runs out. The sponsor code refuses mainnet today;
  lifting that is part of the mainnet gate, with its own review.

## 8. Security review gates

Nothing goes live without its gate. Each is an independent review (as in rounds A to D) plus the
fixes, then a re-check.

- **G0, before phase 1 is live (preprod):** this merged branch, sponsor included (round D fixes
  and the Trusted Types change); the parameters pinned; the sponsor's anchoring job off or
  guarded; a scripted abuse test against the staging sponsor (proof of work, caps, budget, queue);
  the real-chain site checked in Chromium, Firefox and Safari under its real headers.
- **G1, secrets in the browser (start of phase 2):** the master secret, sheet, pool, encrypted
  backup and at-rest encryption; a cryptography review of the derivation and encryption; a
  usability test with two non-technical people (can they make the sheet, lose the browser, and get
  their records back with only the sheet?).
- **G2, each feature milestone:** an attack review of the client calls, the hand-off links and the
  sponsor's new allow-list (griefing, fee drain, a hand-off link that leaks a secret or lets the
  wrong person act).
- **G3, claims:** the measurement gate above, and a review of the "continue on a computer" and
  VeilCore-run paths (what each reveals, and to whom).
- **G4, mainnet:** a full review of the website and the sponsor as one system, a preprod rehearsal
  with mainnet settings, the incident-response plan updated (sponsor key compromise, budget
  exhausted, site compromise), Mako's sign-off.

The sponsor also needs to be in CI (`npm run typecheck -w sponsor` and its tests, one file at a
time), as the site's own tests should be; neither is today.

## 9. Order and effort

Rough working days for building, then calendar time for review rounds. At the pace of the last two
weeks; reviews and Hunter's setup steps are the long poles, not the code.

| Step | What | Build | With review |
|---|---|---|---|
| 0 | Phase 1 live on preprod (section 2), G0 | 1-2 days of fixes + Hunter's setup | ~1 week |
| 1 | Measurement bench, real numbers for section 6 | 1 day | |
| 2.0 | Partner kit browser entry; master secret, sheet, pool, encrypted backup; phase 1 migration; G1 | 5-7 days | ~2 weeks |
| 2.1 | Rotate, recover, replace recovery. **Closes R8 in the mainnet completeness list**: a lab with no developer can take its records back from VeilCore-run through the website | 2-3 days | ~1 week |
| 2.2 | Licences (issue, countersign, prove, revoke, transfer), hand-off links, stale-path handling | 5-8 days | ~2 weeks |
| 2.3 | Parentage | 2-3 days | with 2.4 |
| 2.4 | Obligations, terms and salts in the backup | 3-5 days | ~1.5 weeks for 2.3 and 2.4 |
| 2.5 | Claims: k up to 16 in the browser, k=17 on a computer, VeilCore-run option; G3 | 5-8 days | ~2 weeks |
| 3 | Mainnet: sponsor on mainnet, veilcore.org itself real-chain, G4 | 3-5 days | 1-2 weeks |

**Total: about 6 to 10 weeks to have phase 2 on preprod, and 2 more for mainnet.** Steps 2.3 and
2.4 can run beside 2.2 once 2.0 is done. If time is short, 2.0 and 2.1 alone are the valuable
core: real self-custody with paper recovery, and the lab exit path.

## 10. Open decisions

1. The test site's registry (section 2, step 5).
2. The test site's address (`try.veilcore.org` is a placeholder).
3. Phones: decided by the measurement, not now.
4. Whether website holders and VeilCore-run partners share one master format (recommended: yes,
   it is what makes moving between them free).
5. Whether VeilCore-run's "prove a claim for you" is offered to website users at all, and on what
   terms.
