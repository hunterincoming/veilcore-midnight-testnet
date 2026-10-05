# Operator runbook

**For running the VeilCore CLI on a Mac · last updated 4 October 2026 (round D changes)**

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
   challenges and your private state (your record secret). It cannot be recovered.
5. **Write the maintenance authority key on paper.** It controls the contract. It is shown
   once and is **never stored on the computer**, not even during the deploy. Whenever the
   CLI needs it again (finishing a deploy, retiring), you type it from the paper.
6. **Main menu option 33 retires the maintenance authority, permanently. Option 32 shows
   your record secret on screen.** Do not mix them up.
7. When a run is done, close the Terminal window (Cmd+W) so secrets shown on screen do not
   sit in its scrollback.
8. **Contract addresses and transaction ids are not secrets.** Those are fine to share.
9. **Field-set files are private.** They hold a record's hidden values and its field
   secret. Treat them like a secret: never paste one into a chat or an email. The CLI
   reads them from disk and never prints what is inside.

## Before any run

1. Docker Desktop is installed and running (the CLI starts the proof server in Docker; the
   local chain also runs in Docker).
2. Node 24 is installed (`node --version` shows v24).
3. In Terminal, from the repository folder, packages are installed:
   `npm ci`
4. The contracts are compiled: the folders `contract/src/managed/veilcore` and
   `contract/src/managed/veilcore-claims` exist. If not:
   `cd contract && npm run compact` (compiles both; needs the Compact toolchain; see README.md).
   `docs/fingerprints.md` was regenerated for the state-bounds build (`e89a387`). Do not
   regenerate it. The CLI checks the local build against it when you pick 1, 2 or 4 on
   mainnet, and refuses if they differ. Do not rebuild with a different compiler (use
   0.31.1).

The password rule (the CLI checks it in the first second): 16 or more characters; at
least 3 of capital letters, small letters, numbers and symbols; no character more than
3 times in a row; no run of 4 in order like `1234` or `abcd`.

### Where private state is kept (new on 4 October)

The CLI now keeps its private state (your record secret, per network) in
`~/.veilcore/<network>/private-state`, a folder only your user account can read. It used
to be `bboard-cli/midnight-level-db`, inside the repository, readable by anyone on the Mac
and picked up by Time Machine and iCloud. That old folder can still hold a copy of a
maintenance key from an earlier preprod run, even one the CLI said it removed.

**The first time you run this version on a Mac that has the old folder**, right after the
password it says `Found a private-state store from an older version of this program in …`
and asks:

`Type MOVE to copy your private state there now (recommended), or press Enter to use the old folder for this run only`

1. Type `MOVE` and press Enter. It copies your private state to the new place, leaves out
   any maintenance key and any one-call secret, and says how many entries it copied. It
   does not change or delete the old folder.
2. Carry on as normal. Once you have checked that the run works with the new store (option
   31 shows the record you expect), **delete the old folder securely**: in Terminal, from
   the repository folder, `rm -rf bboard-cli/midnight-level-db`. Then remove it from any
   backup: in Time Machine, find the folder, right-click, "Delete All Backups of
   midnight-level-db"; if your Desktop or Documents sync to iCloud and the repository is
   there, delete it in iCloud too. **CHECK WITH CLAUDE** if FileVault is off on this Mac.
3. Until you delete it, the CLI reminds you on every run. It never deletes it for you.

Pressing Enter instead uses the old folder for that run only, as before, and asks again
next time.

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
7. It asks `Also run the claims contract phase (11 more checks)? (y/N)`. Type `y` and press
   Enter. (Enter on its own runs the main contract only, as before: 26 checks.)
8. Wait. It prints `PASS 1.` up to `PASS 26.`, then `Main contract phase passed (26 checks).
   Now the claims contract.`, then `PASS 27.` up to `PASS 37.`
9. **Passed:** the last lines say `SMOKE TEST PASSED: 37 checks passed.` and `Smoke test passed.`
   The program then stops the local chain and exits.
10. **Failed:** it says `SMOKE TEST FAILED. Do not deploy to mainnet until this passes.`
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
7. The deploy menu appears. Type `3`, Enter. At `Also run the claims contract phase (11
   more checks)? (y/N)`, type `y`, Enter.
8. Wait, about 30 to 45 minutes for the main contract. It prints `PASS 1.` up to `PASS 26.`
   The claims phase then deploys a second, test-only contract and prints `PASS 27.` up to
   `PASS 37.` It takes longer per step than the main phase: two of its proofs (distinct and
   unchanged) are about eight times bigger than anything in the main contract.
   **CHECK WITH CLAUDE** if the proof server stops or runs out of memory during those two.
9. **Passed:** `SMOKE TEST PASSED: 37 checks passed. Contract <address>, claims contract
   <address>`. Copy that line and send it to Claude. This is the result mainnet waits on.
   PASS 28 is the one to look for: it says the chain shows the claims contract's maintenance
   authority as an empty committee, so nobody can change it.
10. **Failed:** copy the lines above `SMOKE TEST FAILED` and send them to Claude. Do not go on
    to mainnet.
11. **`custom error 171` (OutOfDustValidityWindow):** the network refused the deploy because
    the preprod indexer was behind the chain. Nothing was created and nothing was spent.
    Wait (an hour, or until Midnight says preprod is healthy) and run again. Lots of
    `Wallet.Sync` errors during the sync are the same lag; the wallet reconnects by itself.

---

## C. Mainnet deploy day

### Have ready

- The preprod smoke test has passed on this build (section B). The 4 October round D
  changes are a new build, so run it again: it is the first time the new starting-state
  check in Join, and the new store location, meet a real chain.
- `git log -1` shows the latest commit.
- A zero-spend mainnet rehearsal has been done: steps 1 to 13, then 5 (Exit) at the
  deploy menu.
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
10. The wallet menu appears. Type `3`, press Enter, wait for the phrase prompt
    (`Recovery phrase:`), then paste the 24 words, separated by spaces (nothing shows),
    and press Enter. Never paste the phrase at `Which would you like to do?`. (Option 1
    is refused on mainnet.)
11. It shows `This wallet's DUST address: …`. If you skipped step 5, it asks you to paste
    the DUST address your wallet app shows. If they differ it stops: `That is not this
    wallet.` Nothing was sent. Check you used the right phrase.
12. `DUST address matches. Syncing with mainnet`. Wait. Nothing shows while it syncs
    until `Sync complete`. Do not press Ctrl+C. Progress is saved every 2 minutes, so a
    stop does not lose the whole sync.
13. It shows `DUST available for fees: …`. The number is printed in DUST's smallest unit,
    so it looks large. If it says `This wallet has no DUST`, it stops and nothing was
    sent. DUST is generated over time by the NIGHT already registered; do **not**
    register NIGHT for DUST again. Ask Claude.
14. The deploy menu appears. Type `1` (Deploy a new VeilCore contract).
15. It checks the build: `All … build artefacts match the committed fingerprints`. If you
    see an error instead, nothing was sent. Stop and send the error to Claude.
16. It checks the deployment record setting. If it says `Refusing to deploy veilcore`,
    step 6 was missed. Nothing was made or sent. Do step 6 and start again from step 7.
17. `Keep a maintenance authority? (Y/n)`: press **Enter** (keep). design.md says VeilCore
    keeps it for launch and retires it on a published date. Do not type `n`.
18. `Signing key (… blank to generate one)`: press **Enter**. The key appears under
    `MAINTENANCE AUTHORITY SIGNING KEY`, in groups of 8. **Write it on paper, all 64
    characters.** Type `WRITTEN` and press Enter, then type the key back from your paper
    (nothing shows; spaces are fine). If it doesn't match, fix the paper and type it again
    (type `SHOW` to see the key again). Nothing is sent until it matches. The key is
    never written to this Mac: the deploy holds it in memory and drops it when it ends.
19. The deploy runs. First it prints `Contract address: …` on its own line, before
    anything is sent. **Copy that address onto paper now.** The `contractDeployed` line
    comes after the first transaction is confirmed. Then it prints `adding circuit key 1 of 16` (if the first
    transaction carried 8 keys) and so on, one transaction each.
20. Done when you see `all 24 circuit keys are on chain`, then `Deployed. Every circuit
    key is on chain.` and `Contract address: …`. Copy the address again and check it
    matches.
21. The main menu appears. Optional: type `30` to see `Protocol version 1.` Type `0` to exit.
22. Close the Terminal window.

### Write down afterwards

- The contract address (also in the newest file in `bboard-cli/logs/mainnet/`).
- The date and time of the deploy.
- That the maintenance key is on paper, where it is kept, and that no digital copy exists.
- Send Claude the contract address. It is public. **Joining the contract on mainnet
  (deploy menu option 2) is refused until that address is written into the code**
  (`MAINNET_VEILCORE_ADDRESS` in `api/src/deploy-guard.ts`, committed, and the same
  address in the deployment record). Claude makes that change from the address you
  send; pull it before the next mainnet run. The CLI says this at the end of the deploy.

### If the deploy stops partway

The contract can be on chain with only some circuit keys. Do **not** choose `1` again:
that deploys a second contract.

1. Find the contract address: on your paper (step 19), or in the newest file in
   `bboard-cli/logs/mainnet/` on the `contractDeployed` line.
2. Run steps 1 to 13 again, with the **same password** and the **same recovery phrase**.
3. At the deploy menu, type `4` (Finish a deploy that stopped partway). Paste the address.
   It says `The maintenance key is not kept on this computer. Type it from your paper
   copy.` Type the key from your paper (nothing shows; spaces are fine), Enter. This
   works before the address is pinned in the code: it is your own deploy.
4. It adds the missing keys. When asked `Retire the maintenance authority now? Type
   RETIRE, or Enter to keep it`, press **Enter**.
5. It says `Deploy finished: every circuit key is on chain.` and `Contract address: …`.
   Then step 21.

If the screen says `The contract IS on chain at …`, that is this case: use `4` as above.
If it says `The network refused the deploy`, nothing was created and nothing was spent:
send Claude that line before trying again.

**If it seems frozen:** a key transaction normally takes under a minute. Ctrl+C is
refused during a transaction. If nothing has changed for 15 minutes, press Ctrl+C three
times: it stops. The address is on your paper and in the log; the key is on your paper.
Then follow the steps above with `4`.

If it stopped before any `contractDeployed` line, send Claude the end of the newest log
in `bboard-cli/logs/mainnet/` before doing anything. Do not start over with `1` without
checking.

### Sealing after licence activations

Once licences are being countersigned, join the contract and run main menu option **15**
("Seal waiting revocations") regularly, for example once an hour: it now also seals when
only activations changed the licence tree, which keeps the tree's root history from
growing. It says when the next seal is possible if it is too soon (at most one per 10
minutes).

### Retiring the maintenance authority later

Only on the date published in the deployment record. Run `npm run mainnet` (steps 1 to
13; step 6 is not needed), choose `2` (Join), paste the contract address (it must be the
pinned one), then main menu option **33** (not 32). Type `RETIRE`, then type the key from
your paper (nothing shows). This cannot be undone. The authority is replaced by an empty
committee, so anyone reading the contract can see that nobody can change it; it says
`Retired provably` when the chain shows that.

### If a secret change reports an error (options 4, 5, 6)

A rotation (4), a recovery (5) or a recovery-secret replacement (6) can land on chain
even when the CLI reports an error (a dropped connection while confirming). The CLI
checks the chain twice, 30 seconds apart, before it believes it landed. Either way:

- **Keep every secret it showed you, old and new, until you have checked.** Do not throw
  any away because of one message.
- Option **31** shows whether this client's record secret is current (`Current: yes`).
- Option **41** switches this client to a record secret you hold (it checks on chain
  first, and refuses one that was rotated away).
- Option **42** checks whether a recovery secret is the current one. Nothing is sent.

### Checking a licence presentation (option 27)

A presentation shows the licence was live **when it was presented**, not now. Option 27
now shows the block and time it landed, and refuses one older than an hour, or one that
landed before you issued the challenge. Ask the licensee to present again.

### Joining on mainnet

Option 2 on mainnet only accepts the contract address pinned in the code, and only after
checking the contract started from VeilCore's own starting state (another contract can
carry the same circuits with forged records). Matching circuit keys show the code; the
address is what says which contract is VeilCore's.

---

## D. The claims contract (test networks)

The claims contract is a second contract. A holder uses it to prove one fact about a
record they sealed (a value, that a number is at least or at most a bound, that two
records differ, that a correction changed only some values) without showing the rest.
Its options are 34 to 40 on the main menu, after you have deployed or joined the main
contract. **It is not deployed on mainnet yet**: option 34 refuses there, because it is
not in a filed deployment record and its keys have no committed fingerprints.

### Deploy it

1. At the main menu, type `34`. It explains what happens; type `yes`.
2. It deploys, adds its five circuit keys, then replaces its maintenance authority with
   an **empty committee**. You do not write any key down: there is none to keep. Anyone
   reading the contract can see that nobody can change it.
3. Done when you see `Claims contract ready at …: all 5 circuit keys on chain, maintenance
   authority an empty committee`. Copy the address.
4. If it stops partway, do not choose `34` again. Run again with the same password and
   wallet, choose `36` (Finish a claims deploy), and paste the address.

To use a claims contract someone else deployed, choose `35` and paste its address. If it
says `WARNING: it still has a maintenance authority`, do not rely on its claims.

### Make a claim

You need the record's **field-set file** (JSON): the published schema document, the 16
values, the field secret and the digest of the record's committed JSON. The SDK writes it
when the record is sealed.

1. Type `37`. Choose the kind: `v` (value), `b` (bound on a number), `d` (distinct) or `u`
   (unchanged correction).
2. Give the path to the field-set file. For `d`, also the reference record's file; for
   `u`, the original first, then the correction's.
3. For `v`, `b` and `d`: the path to a **laboratory attestation file** if a laboratory
   signed the record, or press Enter for none. Every signature in it is checked here
   first: a wrong entry stops the claim before anything is sent. The laboratory's
   signature is published as its own claim on each record (one more transaction each,
   after the claim).
4. Answer the questions (which slot, `l` or `m` for at least or at most, the bound in the
   schema's unit). Before a value or a bound it shows what this run has already published
   about that slot, and it warns if the slot is empty. The question that sends it names
   the slot's path and type: check it. **A value claim publishes the value, permanently.
   Every bound is public too; several bounds narrow the hidden number.**
5. Type `yes` to send it. Anything else sends nothing.
6. It shows `Give the verifier this transaction id: …` as soon as the claim lands, then
   each attested claim's id as it lands (or that it failed, and what did land), and the
   claim in plain words. Send the verifier all of the ids. Without a list of trusted keys
   the claim names the signing key and says it is not checked against a laboratory's
   published key: that is for the verifier to decide.

### Check a claim (as a verifier)

Type `38`, paste the transaction id, give the schema document's file (from whoever
published the schema, not from the prover) or press Enter to skip, and paste the
laboratory's attested claim ids if you were given any. Then give a JSON file of the
laboratory keys you trust (`[{"x": "...", "y": "..."}]`, decimal strings, as the
laboratory published them), or press Enter for none. Only with that file, and only when
every signing key is in it, does the claim say "on values a laboratory signed"; otherwise
it names the key and says it is not checked. It shows the claim in plain words, each
check made (`ok` or `FAILED`), and a list of `to check:` lines this tool cannot check for
you, such as whether the record is anchored.

### Other options

- `39` signs records as a laboratory and writes an attestation file. The secret is read
  as decimal digits, or as hex when it starts with `0x` (or contains a letter a-f). Press
  Enter at the secret to make a **test** key (shown once on screen, with `0x`). On mainnet
  a laboratory uses its own key.
- `40` shows a field-set file's schema id, `fieldSetRoot` and record commitment. Those are
  public.
