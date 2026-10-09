# No-wallet test run on preprod (Hunter, about 2 hours, most of it waiting)

What this proves, for the first time on a real network: someone with **no wallet, no
crypto and no command line** can put a record on chain, date a DNA pairing and prove they
hold the record, from a normal browser, with VeilCore paying the fee. And that VeilCore's
records get dated on chain **by themselves**, with nobody running a command.

Everything here is preprod (test network, test tokens). Nothing touches mainnet, the
mainnet registry, the 1AM wallet or real money. The sponsor service refuses mainnet, and
it refuses any registry that does not say it anchors on preprod.

**You need:** the Mac with Docker running; the Railway account; your password manager; a
small PDF to stand in for a DNA report; about 2 hours (the wallet sync and the first
anchoring are slow).

**Never paste to Claude or anyone:** the sponsor seed, the preprod registry's operator
token, the sponsor's status token, the record-keys backup file. Everything this asks you to
paste back is public.

## Part 1: the sponsor wallet (Mac, about 20 minutes, mostly waiting)

A brand-new test wallet that only pays fees. It is not the 1AM wallet: the rule about
never re-registering NIGHT for DUST is about that mainnet wallet and does not apply here.

1. ```
   cd ~/Desktop/veilcore
   git fetch
   git checkout feat/no-wallet
   git pull
   npm ci
   cd bboard-cli
   npm run preprod-remote
   ```
   Your preprod password, then wallet menu **1 (create a new wallet)**.
2. It shows the new seed once (64 characters). Save it in your password manager as
   **"VeilCore sponsor seed (preprod)"**, then press Enter.
3. Copy the line **"Using unshielded address: mn_addr_preprod1…"**. Paste it into the
   preprod faucet (https://midnight-tmnight-preprod.nethermind.dev/) and request tNIGHT.
4. Wait in the tool. When the tNIGHT arrives it registers it for DUST by itself and shows a
   DUST balance. When it asks deploy or join: **2 (join)** the practice contract from
   7 October, `72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73`, then `0`
   to exit.
5. Run it once more with your **usual preprod wallet** (option 2, seed 2) only to copy its two
   addresses: "Using unshielded address: …" and "This wallet's DUST address: …". Then `5`
   (exit) at the deploy-or-join question.
   They go in a setting below so the sponsor can never run as your own wallet.

## Part 2: three services on Railway (about 30 minutes)

All three go in the same Railway project as the registry. None of them touches the
production registry.

**A. A proof server.** New → Docker Image → `midnightntwrk/proof-server:8.0.3`. Start command
`midnight-proof-server -v`. Name it `proof-server`. No public domain. (If you already ran
the Docker digest command from this morning, use `midnightntwrk/proof-server:8.0.3@sha256:<digest>`.)

**B. A preprod registry** (a second copy of the registry, for test records only). New →
GitHub repo → `veilcore-api`. Name it `veilcore-api-preprod`. Then:
- Volume: add one, mounted at `/data`.
- Networking: generate a public domain, and copy it.
- Variables:
  - `DB_PATH=/data/veilcore.db`
  - `VEILCORE_OPERATOR_TOKEN=` a new random value: run `openssl rand -hex 32` on the Mac and
    paste the result. Save it in your password manager as "preprod registry operator token".
    It must not be the production one.
  - `VEILCORE_ANCHOR_NETWORK=preprod`
  - `VEILCORE_ANCHOR_CONTRACT=72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73`
  - `PUBLIC_BASE=` the domain you copied, starting with `https://`
  - `TRUST_PROXY_HOPS=1`
- **It worked when** opening `<that domain>/.well-known/veilcore-registry` shows `"network":
  "preprod"` and the 72fe… address under `anchors`.

**C. The sponsor.** On the Mac, first check the contract was compiled with its keys:
```
ls ~/Desktop/veilcore/contract/src/managed/veilcore/keys | head -3
```
It should list files such as `anchor.prover`. If it lists nothing or says "No such file",
run `cd ~/Desktop/veilcore/contract && npm run compact` first (slow the first time). Then,
from the repository folder:
```
cd ~/Desktop/veilcore
npm run stage -w sponsor
```
It worked when it prints "Staged …" and a `railway up` command. Then on Railway: New →
Empty Service, name it `veilcore-sponsor`. Volume at `/data`, a public domain (copy it), and
these variables:
- `SPONSOR_SEED=` the sponsor seed from Part 1
- `SPONSOR_FORBIDDEN_ADDRESSES=` your usual wallet's two addresses from Part 1, step 5,
  separated by a comma
- `VEILCORE_CONTRACT_ADDRESS=72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73`
- `PROOF_SERVER_URL=http://proof-server.railway.internal:6300`
- `STATE_DIR=/data`
- `ALLOWED_ORIGINS=http://localhost:4173`
- `REGISTRY_URL=` the **preprod** registry's domain from B. Never the production one: the
  sponsor checks and refuses it, but don't make it.
- `REGISTRY_OPERATOR_TOKEN=` the preprod registry token from B
- `ANCHOR_EVERY_MINUTES=5` (for this test only)
- `LIMIT_PER_NETWORK_HOUR=10` and `LIMIT_PER_NETWORK_DAY=30` (for this test only: the
  normal limit is 3 an hour, and this run makes 3 calls plus any retry)
- `SPONSOR_STATUS_TOKEN=` another `openssl rand -hex 32`

Then, on the Mac: `railway link` (pick the project and `veilcore-sponsor`), then the
`railway up …` command the stage step printed. If the Mac says `railway: command not found`:
`npm install -g @railway/cli`, then `railway login`, then try again.

**It worked when** the sponsor's deploy log shows `sponsor wallet` with the sponsor's
addresses, then `listening`, and `<sponsor domain>/sponsor/status` shows `"synced": true`.
The first sync can take a long time.

- If the log says **"anchorBatch key … is not the one on chain"**: your Mac's contract build
  is not the one 72fe… was deployed from. Tell Claude; the fix is a fresh demo contract.
- If it **cannot reach the proof server**: give the proof server a public domain and set
  `PROOF_SERVER_URL` to it. Anyone could then use it to make proofs (test network, costs
  only CPU); remove that domain after the run.

## Part 3: the website on your Mac (about 20 minutes)

1. The proving parameters, checked:
   ```
   cd ~/Desktop/veilcore/bboard-ui
   node scripts/fetch-params.mjs --pin
   ```
   It prints two SHA-256 values and writes them to `scripts/params.sha256.json`. Compare
   them with the copies the Compact compiler already downloaded:
   ```
   find ~ -name "bls_midnight_2p1[34]" -not -path "*/veilcore/*" 2>/dev/null | xargs shasum -a 256
   ```
   **The values must match.** If they don't, stop and tell Claude. If the `find` line
   prints nothing, the compiler keeps them somewhere else: tell Claude, don't skip it. Don't
   commit `scripts/params.sha256.json` yourself: paste the two values back and Claude
   commits them.
2. Build and start the site in test mode. The settings go on the build line itself, not
   `export`, so nothing stays in the terminal for a later deploy (a mainnet build refuses
   them anyway). Replace the two `<…>` with the domains, keep it all on one line:
   ```
   VITE_REAL_CHAIN=1 VITE_REAL_CHAIN_CONTRACT_ADDRESS=72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73 VITE_SPONSOR_URL=https://<sponsor domain> VITE_API_BASE=https://<preprod registry domain> npm run build
   npx vite preview --port 4173
   ```
   When you are done with the whole run, close this terminal window.
3. Open **http://localhost:4173** in Chrome. Time each step with your phone's stopwatch.

## Part 4: the test itself (about 30 minutes)

In Chrome at http://localhost:4173:

1. **Log a record** (any made-up cultivar). Note "Sealed …".
2. **Make the record keys and download the backup.** Keep the file somewhere safe; it is
   secret.
3. **Anchor it on chain.** Write down how long "Proving on your device" takes, and the
   transaction it shows.
4. **Pair a DNA report:** pair the small PDF, then **"Date the pairing"**. Then **"Download
   the evidence file"**. It should ask you to download the keys backup again: do it.
5. **Prove possession,** playing both sides. Open the record's verify page in a second tab;
   under "Ask the holder to prove they hold this record", make a challenge and copy it. In
   the first tab, paste it into "The checker's challenge" on the record's certificate step
   and send. Copy the transaction id it gives you into "The holder's transaction id" in the
   second tab. Expect it accepted.
6. **Wait for the batch:** within 5 to 10 minutes, the sponsor log shows `anchoring: anchored
   B-…`, and the record's page shows it anchored on Midnight preprod.
7. **Check the pairing with the command-line tool**, which shares no code with the site:
   ```
   cd ~/Desktop/veilcore/bboard-cli
   npm run preprod-remote
   ```
   Your usual preprod wallet, join 72fe…, then option **44 (Check a DNA pairing)** with the
   evidence file and the PDF. Expect it accepted.
8. **Restore test:** on the record's page, remove its keys from this browser (it warns
   you; you have the backup), then restore them from the **newest** backup file. The anchor,
   the pairing and "Download the evidence file" should all be back.

## Paste back to Claude

- The times from Part 4, steps 3, 4 and 5.
- The transaction ids the site showed (anchor, pairing, proof).
- The last 30 lines of the sponsor's deploy log after Part 4, step 6.
- What step 7 printed.
- The two SHA-256 values from Part 3, step 1, and whether they matched.
- Anything that looked wrong or confusing, in your own words. That matters as much as the
  rest: students will see the same screens.

Do **not** paste the sponsor seed, either operator token, the status token or the
record-keys backup.

## Not covered by this run

- **Phones.** This run is on your laptop. A phone needs the site hosted on a test address
  (not localhost); that is the next run once this one passes.
- **Mainnet.** The sponsor and the site both refuse it. Turning it on is a separate
  decision for you and Mako: a funded mainnet fee wallet, the mainnet registry's own
  settings, and real fees.
- **Many users at once.** The limits (3 calls an hour per network address, a daily fee
  budget) are tested in code, not under load.

## If something goes differently

- **"This site's proving files are not the ones the contract on the network uses":** your
  Mac's contract build does not match 72fe…. Nothing was sent. Tell Claude.
- **"Could not reach the Midnight network or the sponsor":** check the sponsor's status page;
  wait a few minutes and try again. Nothing was sent.
- **"The transaction WAS sent (…)":** don't retry straight away. Paste the id to Claude.
- **The sponsor's status shows `wrong-registry`:** `REGISTRY_URL` points at a registry that
  does not anchor on preprod at 72fe…. Check variable B, `VEILCORE_ANCHOR_*`.
- **Any other error:** stop and paste the last 30 lines.
