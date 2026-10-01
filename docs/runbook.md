# Operator runbook

**For running the VeilCore CLI on a Mac · last updated 1 October 2026**

Three jobs, in this order: a rehearsal on a local chain, the smoke test on preprod, then
the mainnet deploy. Every step, prompt and menu number below comes from the code in
`bboard-cli/src/`. Anything marked **CHECK WITH CLAUDE BEFORE MAINNET** could not be
confirmed from the code.

---

## Safety rules

1. **Never paste a secret anywhere but the CLI prompt that asks for it.** Not into a chat
   (including Claude), an email, a notes app or a document. Secrets are: the wallet
   recovery phrase, a wallet seed, the private-state password, the Blockfrost project id,
   and the maintenance authority key. When the CLI asks for one, nothing shows as you
   paste or type. That is normal. Press Enter.
2. **The mainnet recovery phrase is only ever typed into `npm run mainnet`.** Never on the
   local chain, never on preprod. Preprod uses a separate test wallet.
3. **Never register NIGHT for DUST again, from any app or tool.** The CLI never does it on
   mainnet. Doing it again is what made duplicate registrations before.
4. **Keep the private-state password in your password manager.** You need the same one
   every time you run on the same network: it unlocks saved sync progress, saved
   challenges and, during a deploy, the maintenance key. It cannot be recovered.
5. **Write the maintenance authority key on paper.** It controls the contract. It is shown
   once and then removed from the computer.
6. **Main menu option 33 retires the maintenance authority, permanently. Option 32 shows
   your record secret on screen.** Do not mix them up.
7. When a run is done, close the Terminal window (Cmd+W) so secrets shown on screen do not
   sit in its scrollback.
8. **Contract addresses and transaction ids are not secrets.** Those are fine to share.

## Before any run

1. Docker Desktop is installed and running (the CLI starts the proof server in Docker; the
   local chain also runs in Docker).
2. Node 24 is installed (`node --version` shows v24).
3. In Terminal, from the repository folder, packages are installed:
   `npm install --legacy-peer-deps`
4. The contract is compiled: the folder `contract/src/managed/veilcore` exists. If not:
   `cd contract && npm run compact` (needs the Compact toolchain; see README.md).
   The contract changed on the evening of 1 October (state bounds), so
   `docs/fingerprints.md` must be regenerated from a build of it on the Mac (compiler
   0.31.1) before mainnet; the earlier hashes no longer match. Do not rebuild with a
   different compiler; the mainnet deploy checks the hashes again and refuses if they
   differ.

The password rule (the CLI checks it in the first second): 16 or more characters; at
least 3 of capital letters, small letters, numbers and symbols; no character more than
3 times in a row; no run of 4 in order like `1234` or `abcd`.

---

## A. Rehearsal on a local chain

Costs nothing. The chain is new every run and thrown away at the end.

1. In Terminal, from the repository folder: `cd bboard-cli`
2. Run `unset MN_TEST_ENVIRONMENT` (if that variable were set, the "local" run would go to
   another network).
3. Run `npm run standalone`
4. **Private-state password:** paste it, press Enter. Then the same password again.
5. Wait while the local chain starts. There is no wallet question: the local chain has a
   built-in funded wallet.
6. The deploy menu appears. Type `3` and press Enter (Run the full smoke test).
7. Wait. It prints `PASS 1.` up to `PASS 26.`
8. **Passed:** the last lines say `SMOKE TEST PASSED: 26 checks passed.` and `Smoke test passed.`
   The program then stops the local chain and exits.
9. **Failed:** it says `SMOKE TEST FAILED. Do not deploy to mainnet until this passes.`
   Copy the lines just above it (they hold no secrets) and send them to Claude.

## B. Smoke test on preprod

Preprod is Midnight's test network. Use the **test wallet only**.

1. `cd bboard-cli`, then `npm run preprod-remote`
2. **Private-state password:** paste, Enter, then again. Use the same one every preprod
   run, or the saved sync progress cannot be read and the sync starts from the beginning.
3. The wallet menu appears:
   - Have a test wallet seed: type `2`, paste the hex seed (nothing shows), Enter. No
     `0x` at the start.
   - No test wallet yet: type `1`. A new seed is shown once. Write it down, then press
     Enter. This wallet starts empty: see step 5.
   - Never use option `3` with the mainnet recovery phrase here.
4. It shows `This wallet's DUST address`, then syncs. **The first sync can take an hour or
   more.** Progress is saved every 2 minutes, encrypted with your password, under
   `~/.veilcore/wallet-state`. After a stop, run again with the same password and seed:
   it says `Resuming from saved sync progress.`
5. It shows `Using unshielded address: … waiting for funds...` and waits until the wallet
   has test NIGHT. A new wallet needs test NIGHT from the preprod faucet,
   `https://midnight-tmnight-preprod.nethermind.dev/` (the address in the code).
   **CHECK WITH CLAUDE** how to use the faucet if you have not before.
6. On preprod only, the CLI registers test NIGHT that is not yet registered for DUST.
   That is expected here. (It never does this on mainnet.)
7. The deploy menu appears. Type `3`, Enter.
8. Wait, about 30 to 45 minutes. It prints `PASS 1.` up to `PASS 26.`
9. **Passed:** `SMOKE TEST PASSED: 26 checks passed. Contract <address>`. Copy that line and
   send it to Claude. This is the result mainnet waits on.
10. **Failed:** copy the lines above `SMOKE TEST FAILED` and send them to Claude. Do not go on
    to mainnet.

---

## C. Mainnet deploy day

### Have ready

- The preprod smoke test has passed on this build (section B).
- **CHECK WITH CLAUDE BEFORE MAINNET:** deployment record revision 4 is filed and names
  the fingerprints in `docs/fingerprints.md`. The CLI refuses to deploy until you declare
  revision 4 (step 6), but it cannot check that the record was really filed.
- The 24-word recovery phrase of the wallet whose NIGHT generates your DUST.
- That wallet's DUST address (starts `mn_dust1`), from your wallet app.
- A Blockfrost project id for **Midnight Mainnet** (from blockfrost.io).
- Paper and pen for the maintenance key and the contract address.
- Time: the wallet sync can take hours.

### Steps

1. Open Terminal and go to the repository folder.
2. Run `git status`. `docs/fingerprints.md` must **not** be listed as changed. If it is,
   stop and ask Claude. (The CLI checks this too, and stops before sending anything.)
3. `cd bboard-cli`
4. Set the Blockfrost project id without it showing or landing in your shell history:
   run `read -s VEILCORE_BLOCKFROST_PROJECT_ID`, paste the id, press Enter (nothing shows).
   Then run `export VEILCORE_BLOCKFROST_PROJECT_ID`.
5. Optional, saves a paste later: `export VEILCORE_EXPECTED_DUST_ADDRESS=mn_dust1…` with your
   DUST address. It is not a secret.
6. `export VEILCORE_DEPLOYMENT_RECORD_REVISION=4` (only once revision 4 is filed).
7. `npm run mainnet`
8. **Private-state password:** paste, Enter, then again. This protects the mainnet keys on
   this Mac. Save it in your password manager now. You need it again if the deploy is
   interrupted (see below).
9. It connects. You should see `Connected to the mainnet indexer (Blockfrost): block …`
   and `Connected to the mainnet node RPC (Blockfrost)`. An error saying `HTTP 403` means
   the Blockfrost project id is wrong: start again from step 4.
10. The wallet menu appears. Type `3`. Type or paste the 24 words, separated by spaces
    (nothing shows), Enter. (Option 1 is refused on mainnet.)
11. It shows `This wallet's DUST address: …`. If you skipped step 5, it asks you to paste
    the DUST address your wallet app shows. If they differ it stops: `That is not this
    wallet.` Nothing was sent. Check you used the right phrase.
12. `DUST address matches. Syncing with mainnet`. Wait. Progress is saved every 2 minutes,
    so a stop does not lose the whole sync.
13. It shows `DUST available for fees: …`. If it says `This wallet has no DUST`, it stops
    and nothing was sent. Do **not** register NIGHT for DUST again. Ask Claude.
14. The deploy menu appears. Type `1` (Deploy a new VeilCore contract).
15. It checks the build: `All … build artefacts match the committed fingerprints`. If you
    see an error instead, nothing was sent. Stop and send the error to Claude.
16. It checks the deployment record setting. If it says `Refusing to deploy veilcore`,
    step 6 was missed. Nothing was made or sent. Do step 6 and start again from step 7.
17. `Keep a maintenance authority? (Y/n)`: press **Enter** (keep). design.md says VeilCore
    keeps it for launch and retires it on a published date. Do not type `n`.
18. `Signing key (… blank to generate one)`: press **Enter**. The key appears under
    `MAINTENANCE AUTHORITY SIGNING KEY`. **Write it on paper, all 64 characters, and check
    it twice.** Then type `WRITTEN` and press Enter. Nothing is sent until you do. The key
    is removed from this Mac when the deploy finishes.
19. The deploy runs. Early on, a log line contains `contractDeployed` and the
    `contractAddress`. **Copy that address onto paper as soon as it appears.** Then it
    prints `adding circuit key 1 of …` and so on, one transaction each.
20. Done when you see `Deployed VeilCore contract at address: …`. Copy the address again
    and check it matches.
21. The main menu appears. Optional: type `30` to see `Protocol version 1.` Type `0` to exit.
22. Close the Terminal window.

### Write down afterwards

- The contract address (also in the newest file in `bboard-cli/logs/mainnet/`).
- The date and time of the deploy.
- That the maintenance key is on paper, where it is kept, and that no digital copy exists.
- Send Claude the contract address. It is public.

### If the deploy stops partway

The contract can be on chain with only some circuit keys. Do **not** choose `1` again:
that deploys a second contract.

1. Find the contract address: on your paper (step 19), or in the newest file in
   `bboard-cli/logs/mainnet/` on the `contractDeployed` line.
2. Run steps 1 to 13 again, with the **same password** and the **same recovery phrase**.
   The maintenance key stays on this Mac until the deploy finishes, and only that
   password and wallet open it.
3. At the deploy menu, type `4` (Finish a deploy that stopped partway). Paste the address.
4. It adds the missing keys. When asked `Retire the maintenance authority now? Type
   RETIRE, or Enter to keep it`, press **Enter**.
5. It says `Deploy finished: every circuit key is on chain at …`. Then step 21.

**CHECK WITH CLAUDE BEFORE MAINNET:** what to do if it stops before any `contractDeployed`
line appeared. The code suggests nothing was deployed and starting over with `1` is
safe, but confirm before spending fees.

### Sealing after licence activations

Once licences are being countersigned, join the contract and run main menu option **15**
("Seal waiting revocations") regularly, for example once an hour: it now also seals when
only activations changed the licence tree, which keeps the tree's root history from
growing. It says when the next seal is possible if it is too soon (at most one per 10
minutes).

### Retiring the maintenance authority later

Only on the date published in the deployment record. Run `npm run mainnet` (steps 1 to
13; step 6 is not needed), choose `2` (Join), paste the contract address, then main
menu option **33** (not 32). Type `RETIRE`, then type the key from your paper (nothing
shows). This cannot be undone.
