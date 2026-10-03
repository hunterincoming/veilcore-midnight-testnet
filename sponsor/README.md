# VeilCore sponsor

A small service that pays the Midnight network fee (DUST) for a few VeilCore calls made
from the website demo, so a visitor needs no wallet and no crypto. It also anchors the
registry's batch roots on chain on a schedule, replacing the manual operator step.

**Status:** built and unit-tested; not yet run against preprod. Test networks only: it
refuses to start on mainnet.

## What it does, and what it can see

- The visitor's browser builds the transaction, makes the zero-knowledge proof itself and
  seals it (binds it). Sealed means nobody can change it afterwards, this service
  included. The record secret never leaves the browser.
- The browser sends the sealed transaction here. The service checks it is one of the
  allowed VeilCore calls and nothing else, adds its own fee payment in a separate part,
  and submits it. It sees only what the network will publish anyway.
- Allowed calls: `anchor`, `proveOwnership`, `pairDna`. Never `anchorBatch` or
  `sealRevocations` from the public endpoint (only this service's own job calls those),
  never a deploy, a maintenance update, or anything that moves tokens.
- Limits: a little proof of work per request, a cap per network address (3 an hour, 10 a
  day), a cap per browser per call type (anchor 3, pairDna 5, proveOwnership 20 a day), a
  daily DUST budget, and a queue of at most 20. When any of them is hit, the site says so.
- Logs hold counters and outcomes only. Never request bodies, tickets or secrets.

## The anchoring job

Every 5 minutes it checks the registry. When records are waiting and either 25 or more are
pending or an hour has passed, it:

1. seals them into a batch on the registry,
2. calls `anchorBatch(root)` on the contract, paid by this service's wallet,
3. reads the contract state right after that transaction and checks `lastBatchRoot` is
   the batch root and `batchSeq` went up,
4. only then tells the registry where the batch was anchored.

It saves each attempt before sending, so after a restart it looks the transaction up
instead of sending a second one (which would pay twice and write two roots). Three
failures in a row raise an alert on `/sponsor/status` and in the log.

## Routes

| Route | What |
|---|---|
| `GET /sponsor/status` | Synced or not, queue depth, budget left today, anchoring job state |
| `GET /sponsor/challenge` | A proof-of-work challenge |
| `POST /sponsor` | `{ tx, ticket, challenge, nonce }` → `{ txId }` or a refusal with a plain reason |
| `GET /health` | `{ ok: true }` |

## Settings (environment variables)

Required:

| Variable | What to put |
|---|---|
| `SPONSOR_SEED` | The sponsor wallet's 64-character hex seed. A wallet made only for this. |
| `SPONSOR_FORBIDDEN_ADDRESSES` | The deployer wallet's addresses (`mn_addr_preprod1…` and `mn_dust_preprod1…`), comma-separated. The service refuses to start if its own wallet is one of them. |
| `VEILCORE_CONTRACT_ADDRESS` | The demo contract's address on preprod (64 hex characters). |
| `PROOF_SERVER_URL` | The proof server this service uses for its own fee payments and for `anchorBatch` (see step 4 below). Nothing secret of a visitor's is ever sent to it. |
| `STATE_DIR` | Where the Railway volume is mounted, e.g. `/data`. Holds sync progress, the day's budget and the anchoring attempt. |
| `ALLOWED_ORIGINS` | `https://veilcore.org,https://www.veilcore.org` (the default) |

For the anchoring job (it stays off without these two):

| Variable | What to put |
|---|---|
| `REGISTRY_URL` | `https://veilcore-api-production.up.railway.app` |
| `REGISTRY_OPERATOR_TOKEN` | The same value as `VEILCORE_OPERATOR_TOKEN` on the registry service |

Optional, with defaults: `SPONSOR_NETWORK` (preprod), `MAX_FEE_DUST` (5),
`DAILY_BUDGET_DUST` (50), `POW_DIFFICULTY` (18), `QUEUE_DEPTH` (20),
`LIMIT_PER_NETWORK_HOUR` (3), `LIMIT_PER_NETWORK_DAY` (10), `LIMIT_REQUESTS_PER_MINUTE` (30),
`ANCHOR_EVERY_MINUTES` (60), `ANCHOR_AT_PENDING` (25), `ANCHORER_ENABLED` (set `0` to
turn the job off), `TRUST_PROXY_HOPS` (1 on Railway), `INDEXER_URL`, `INDEXER_WS_URL`,
`NODE_WS_URL`, `POW_SECRET`, `VEILCORE_ARTIFACTS_DIR`.

**Never** set anything holding the maintenance key or its password here
(`VEILCORE_PRIVATE_STATE_PASSWORD` or any variable named like `*MAINTENANCE*`,
`*SIGNING_KEY*`, `*AUTHORITY*`). The service refuses to start if one is present, and it
also refuses if the seed you gave it is the contract's maintenance key.

## Setting it up on preprod (for Hunter)

Do these in order. Each one says how you know it worked.

**1. Build the contract with its keys (on your Mac).**
`cd contract && npm run compact`. This takes a while the first time; it downloads public
parameters. It worked when `contract/src/managed/veilcore/keys/` has files in it.

**2. Deploy a demo contract on preprod** with the operator tool and your usual deployer
wallet (`cd bboard-cli && npm run preprod-remote`, then Deploy). Write down the contract
address it prints. This is the contract the website demo and the sponsor will use. Keep
the maintenance key the tool shows you offline, as always. It never goes on Railway.

**3. Make the sponsor wallet** (a new wallet, only for this):
run `npm run preprod-remote` again in `bboard-cli`, and choose **1 (create a new wallet)**.
- It shows the new seed once. Save it in your password manager as "VeilCore sponsor seed".
- It prints "Using unshielded address: mn_addr_preprod1…". Copy that address.
- Go to the preprod faucet (https://midnight-tmnight-preprod.nethermind.dev/), paste the
  address, request tNIGHT.
- Wait in the tool. When the tNIGHT arrives it registers it for DUST by itself and prints
  a DUST balance. When it shows the main menu, choose exit.

Also note your deployer wallet's two addresses: run the tool with the deployer wallet
(option 2 or 3) and copy "Using unshielded address: …" and "This wallet's DUST address: …".
Those go in `SPONSOR_FORBIDDEN_ADDRESSES`.

**4. On Railway, add a proof server** in the same project: New → Docker Image →
`midnightntwrk/proof-server:8.0.3`, start command `midnight-proof-server -v`, name it
`proof-server`. Don't give it a public domain. Its private address is
`http://proof-server.railway.internal:6300`.

**5. Stage the sponsor** (on your Mac, from the repo root):
`npm run stage -w sponsor`. It builds the service and makes a folder next to the repo,
`veilcore-sponsor-deploy`, with the service and the compiled contract. (The compiled
contract is not in git, which is why this step exists.) It worked when it prints
"Staged …" and the next command.

**6. Create the sponsor service on Railway:** New → Empty Service, name it
`veilcore-sponsor`. Then:
- Variables: add every required one from the table above, plus the two for the anchoring
  job. `PROOF_SERVER_URL=http://proof-server.railway.internal:6300`, `STATE_DIR=/data`.
- Volume: add one, mounted at `/data`.
- Networking: generate a public domain. Copy it (e.g.
  `https://veilcore-sponsor-production.up.railway.app`).
- Deploy from your Mac: `railway link` (choose the project and `veilcore-sponsor`), then
  the command step 5 printed:
  `railway up ../veilcore-sponsor-deploy --path-as-root --service veilcore-sponsor`.

It worked when the deploy log shows `sponsor wallet` with your sponsor addresses, then
`listening`, and opening `<domain>/sponsor/status` shows `"synced": true` (the first sync
can take a long time; it resumes from the volume after that).

If the log says it cannot reach the proof server: Railway's private network may need the
proof server to listen on IPv6. Give the proof server a public domain instead and set
`PROOF_SERVER_URL` to it (the proof server then also takes requests from strangers; on a
test network that only costs CPU).

**7. First anchoring run.** Seal a record on the site (any record), then wait. Within an
hour (or set `ANCHOR_EVERY_MINUTES=5` for the first test) the log shows
`anchoring: anchored B-… in …`. Open that record's page: Settlement shows "Anchored on
Midnight preprod (test network)". This is the first `anchorBatch` ever run on preprod.
The log line `anchoring: recorded` shows `paidFeesSpecks`, the fee it cost (10^15 SPECKs
is one DUST).

**8. Turn the site on** (only after 7 works): build and deploy the site with
`VITE_REAL_CHAIN=1`, `VITE_REAL_CHAIN_CONTRACT_ADDRESS=<contract from step 2>` and
`VITE_SPONSOR_URL=<sponsor domain from step 6>` exported in the same terminal, after
running `node bboard-ui/scripts/fetch-params.mjs` once. The security policy picks the
sponsor and the indexer up from the same variables. Then on a laptop: log a cultivar,
make the record keys, download the backup, anchor. Then on a phone. Note how long
"Proving on your device" takes on each; that decides whether phones are supported.

**9. Set the real limits** from what you saw: the fee of each call (explorer) times 2 is
`MAX_FEE_DUST`; keep `DAILY_BUDGET_DUST` well under what the wallet's tNIGHT generates in
a day.

## Running the tests

`npm test -w sponsor` (no network needed). `npm run typecheck -w sponsor`.

## Why the code looks the way it does

It uses Midnight's own wallet and ledger APIs: `balanceFinalizedTransaction` with
`tokenKindsToBalance: ['dust']` adds a separate fee transaction and merges it with the
visitor's sealed one, and a merge refuses a second contract call, so the visitor's call
cannot be altered. See `docs/` and the design notes for the reasoning.
