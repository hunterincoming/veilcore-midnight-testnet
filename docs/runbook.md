# Operator runbook

**For running the VeilCore CLI on a Mac · last updated 6 October 2026 (website step on mainnet day: docs/mainnet-day-site.md)**

Four jobs, in this order: a rehearsal on a local chain, the smoke test on preprod, the
claims contract fingerprints (once; done 5 October), then the mainnet deploy of both
contracts. Every step, prompt and menu number below comes from the code in
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
   CLI needs it again (finishing a deploy, retiring), you type it from the paper. As the
   tool stands, the deploy makes one key; you write it on two sheets, one per founder
   (decided 6 and 7 October; step 18).
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
   `docs/fingerprints.md` holds two tables. The main contract's, at the top, was made for
   the state-bounds build (`e89a387`): never regenerate it. The claims contract's, at the
   bottom, was made once, on 5 October (section C0; committed in `765cab1`): do not
   regenerate it either. On mainnet the CLI checks the local build
   against them (the main contract when you pick 1, 2 or 4; the claims contract when you
   pick 34, 35 or 36) and refuses if they differ. Do not rebuild with a different compiler
   (use 0.31.1).

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

**If the copy is interrupted** (Ctrl+C, a crash, the Mac shutting down): to copy, the CLI
first makes a temporary full copy of the old folder, and that copy can hold an old
maintenance key. It is made in the Mac's temporary folder (private to your account, not
in your home folder, not backed up by Time Machine) and deleted as soon as the copy ends,
however it ends. If the program was killed outright, the next run deletes what was left
and says so, starting `Removed …: a scratch copy of an older private-state store`; it then
asks `Type MOVE …` again. Your old folder is unchanged either way. (A version before 4
October made that temporary copy inside `~/.veilcore/<network>/`; the next run deletes
that too, with the same message. If you see it, and Time Machine ran in between, delete
the backups of that folder as in step 2.)

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

## C0. Claims contract fingerprints (once, before mainnet)

**Done 5 October 2026.** Built on Hunter's Mac at `c75c155`, committed in `765cab1`.
Claude's separate build (without keys) matched all 5 ZKIR files and `contract/index.js`.
Do not run this section again. It is kept as the record of how the table was made.

**Why:** a mainnet deploy only uses keys whose fingerprints are written in
`docs/fingerprints.md` and committed. The main contract's are there. The claims contract's
are not yet: making its keys needs files Claude cannot download, so this runs on your Mac.
Until it is done, the CLI refuses to deploy or join the claims contract on mainnet (the
main contract is not affected).

**When:** after Claude says the "claims contract on mainnet" change is merged, and before
the zero-spend mainnet rehearsal. Docker is not needed. You need the internet and Node 24.
Allow half an hour; almost all of it is waiting.

**Steps.** Open Terminal and paste these one line at a time. Nothing here is a secret.

1. `cd ~/Desktop/veilcore`
2. `git checkout main`
3. `git pull`
4. `npm ci` (reinstalls packages; a few minutes)
5. `cd contract`
6. `npm run compact`
   This builds both contracts with their keys. It prints a line per circuit and can sit
   quietly for minutes on the big claims circuits (`proveDistinct`, `proveUnchanged`).
   Expect anywhere from a few minutes to about twenty. If it stops with an error, copy the
   last 20 lines to Claude.
7. `npm run fingerprints:claims`
   It prints a table of 21 lines (10 keys, 10 ZKIR files, `contract/index.js`) and then
   `Written to docs/fingerprints.md (21 claims contract artefacts; the other table is
   unchanged)`. It first checks that your fresh build of the **main** contract still
   matches its table; if it says `this build of the MAIN contract does not match`, it wrote
   nothing: stop and send Claude the whole output.
8. `npm run fingerprints:check`
   Two lines, both must say `all … artefacts match`:
   `main contract: all 97 artefacts match docs/fingerprints.md.`
   `claims contract: all 21 artefacts match docs/fingerprints.md.`
9. `cd ..`
10. `git status`. Only `docs/fingerprints.md` should be listed as modified. If anything
    else is, stop and ask Claude.
11. `git add docs/fingerprints.md`
12. `git commit -m "Claims contract fingerprints"`
13. `git push`
14. `git log -1 --oneline` (shows the commit you just made)

**Paste back to Claude:** the whole output of step 7 (the table), the two lines from step
8, and the line from step 14. Claude checks the ZKIR and contract-code lines against its
own independent build and puts the table in the deployment record.

Do not run `npm run fingerprints` (without `:claims`): that rewrites the main contract's
table, which must stay as it is.

---

## C. Mainnet deploy day

### Have ready

- The claims contract fingerprints are committed and pushed (section C0; done 5 October,
  `765cab1`), and `cd contract && npm run fingerprints:check` says both contracts match.
- The preprod smoke test has passed on this build (section B). Done 5 October: 37 of 37 on
  `d9d563f`, the round D tool (`docs/preprod-run-5oct.md`). If anything in `bboard-cli`,
  `api` or `contract` changes after that (other than wording), run it again.
  Changed since: smoke check 27's wording (`c75c155`) and the pin check in option 4
  (`799c765`, a refusal that applies only on mainnet once the address is pinned), which the
  paper-key practice runs (`docs/preprod-paper-key-practice.md`). Neither needs a new smoke run.
- The paper-key practice on preprod has been done (`docs/preprod-paper-key-practice.md`).
  Done 7 October.
- `git log -1` shows the latest commit.
- A zero-spend mainnet rehearsal has been done: steps 1 to 13, then 5 (Exit) at the
  deploy menu. Done 7 October (sync about 10 minutes; the deploy wallet is the 1AM wallet
  whose DUST address matched).
- Both founders have decided the maintenance key question (`docs/maintenance-policy.md`,
  approved 6 and 7 October): one key, two paper copies, no retirement date, the claims
  contract with none. Done.
- Deployment record revision 4 filed 7 October: midnight-improvement-proposals pull
  request #373. Earlier wording, kept for the record: deployment record revision 4 is filed and names
  the fingerprints in `docs/fingerprints.md`. The 16 September correction promised it
  would be filed before any mainnet deployment. The CLI refuses to deploy until you
  declare revision 4 (step 6), but it cannot check that the record was really filed.
- **CHECK WITH CLAUDE BEFORE MAINNET:** the fixes made after the round D re-check
  (`8de6f2a`, `abc1fc9`) and the claims mainnet gate (`5a980b3`) have had one fresh-session AI
  review (`docs/mainnet-completeness.md`).
- The 24-word recovery phrase of the wallet whose NIGHT generates your DUST.
- That wallet's DUST address (starts `mn_dust1`), from your wallet app.
- A Blockfrost project id for **Midnight Mainnet** (from blockfrost.io).
- Paper and pen for the maintenance key (two sheets if the two-copy proposal is adopted)
  and the two contract addresses.
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
   the Blockfrost project id is wrong: start again from step 4. Around here it also checks
   both builds: `All … build artefacts match the committed fingerprints` (main contract)
   and `Claims contract: all 21 build artefacts match the committed fingerprints.` If the
   claims line is a warning instead, stop (Ctrl+C) and do section C0 first.
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
17. `Keep a maintenance authority? (Y/n)`: press **Enter** (keep). Do not type `n`. Why
    keep it: Midnight network upgrades can require a verifier-key update that only the
    authority can make, and it is how a wrong circuit gets fixed. There is no plan to
    retire it on a date (`docs/maintenance-policy.md`, approved by both founders 6 and 7
    October; `docs/design.md` says the same).
18. `Signing key (… blank to generate one)`: press **Enter**. The key appears under
    `MAINTENANCE AUTHORITY SIGNING KEY`, in groups of 8. **Write it on paper, all 64
    characters.** Type `WRITTEN` and press Enter, then type the key back from your paper
    (nothing shows; spaces are fine). If it doesn't match, fix the paper and type it again
    (type `SHOW` to see the key again). Nothing is sent until it matches. The key is
    never written to this Mac: the deploy holds it in memory and drops it when it ends.
    - **Second copy (decided by both founders, 6 and 7 October).** While the key is on screen,
      and **before** typing `WRITTEN`, write it on a second sheet too, and check that sheet
      against the screen, group by group (the CLI checks only the copy you type back). One
      sheet is Hunter's, one is Mako's, kept in different places. Never photograph, scan,
      email, message or type it anywhere to get it to Mako: his copy goes to him by hand.
19. The deploy runs. First it prints `Contract address: …` on its own line, before
    anything is sent. **Copy that address onto paper now.** The `contractDeployed` line
    comes after the first transaction is confirmed. Then it prints `adding circuit key 1 of 16` (if the first
    transaction carried 8 keys) and so on, one transaction each.
20. Done when you see `all 24 circuit keys are on chain`, then `Deployed. Every circuit
    key is on chain.` and `Contract address: …`. Copy the address again and check it
    matches. Earlier, after the first transaction, it also printed `Deploy transaction
    id: …`. Copy that too (it is public); see "How joining checks the contract" below.
21. The main menu appears. Optional: type `30` to see `Protocol version 1.` Do **not** exit
    yet: the claims contract is next, in the same run.

### Then the claims contract (same run, right after the main contract)

The claims contract has no maintenance key: the deploy ends by locking it so nobody,
including us, can ever change it. There is nothing to write on paper except its address.

22. At the main menu, type `34` (Deploy the claims contract).
23. It checks the deployment record setting and the claims build (`All 21 claims build
    artefacts match the committed fingerprints (docs/fingerprints.md).`). If it says
    `Refusing to deploy the claims contract`, nothing was made or sent: send Claude that
    line.
24. It explains what happens and asks `Deploy a claims contract now? Type yes to send it`.
    Type `yes`, Enter.
25. It prints `Contract address: …` before anything is sent. **Copy it onto paper, marked
    "claims".** It is a different address from the main contract's.
26. Then `Claims deploy transaction id: …`. Copy that too (it is public).
27. All 5 claims circuit keys normally fit in the deploy itself, so it goes straight on
    (if the network refused that size, it first adds the rest, `adding circuit key 1 of
    …`). Then `retiring the maintenance authority provably`. A few minutes in all.
28. Done when you see `Claims contract ready at …: all 5 circuit keys on chain,
    maintenance authority an empty committee (nobody can change it).` and `Claims contract
    address: …`. Check the address matches your paper.
29. A warning follows: joining it on mainnet (35) is refused until its address is pinned in
    the code. That is expected.
30. Type `0` to exit. Close the Terminal window.

If the claims deploy stops partway: do **not** choose `34` again, and nothing is urgent:
nobody relies on the claims contract yet. Send Claude the main contract's address and the
claims address (from your paper or the log). Once Claude has pinned the main contract's
address and you have run `git pull`, run `npm run mainnet` again (steps 1 to 13, **same
password** and phrase), choose `2` (Join) with the main contract's address, then at the
main menu choose `36` (Finish a claims deploy) and paste the claims address. Nothing is
typed from paper: the temporary key it needs stays in this Mac's encrypted private state
until the claims deploy finishes, and is deleted then.

### Write down afterwards

- The contract address (also in the newest file in `bboard-cli/logs/mainnet/`).
- The deploy transaction id (the `Deploy transaction id: …` line; also in the log). It
  goes in the deployment record next to the address.
- The claims contract address and its deploy transaction id (the `Claims deploy
  transaction id: …` line; both also in the log).
- The date and time of the deploy.
- That the maintenance key is on paper, where each copy is kept (one, or one per founder
  if the two-copy proposal is adopted), and that no digital copy exists.
- Send Claude both addresses and both deploy transaction ids. They are public. **Joining
  either contract on mainnet is refused until its address is written into the code**
  (`MAINNET_VEILCORE_ADDRESS` and `MAINNET_CLAIMS_ADDRESS` in `api/src/deploy-guard.ts`,
  committed, and the same addresses in the deployment record). Claude makes that change
  from what you send; `git pull` before the next mainnet run. The CLI says this at the
  end of each deploy.

### Then the website

Once Claude has pinned both addresses and the registry anchors on mainnet (Railway:
`VEILCORE_ANCHOR_NETWORK=mainnet`, `VEILCORE_ANCHOR_CONTRACT` = the main contract address),
put veilcore.org into mainnet mode with `npm run deploy:mainnet`. The exact steps, what it
refuses and why, and what to check on your phone are in **`docs/mainnet-day-site.md`**. It
will not build until both conditions are true, so it cannot announce mainnet early. After
this, always publish the site with `deploy:mainnet`; `deploy:prod` refuses once the registry
anchors on mainnet.

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

If, after adding the keys, it says `Could not check how the contract at … started` and
asks `Deploy transaction id (hex; Enter to stop)`: paste the id from the stopped run's
log (the line `deploy transaction submitted (…)`) and press Enter. This only happens if
someone used the contract between the two runs. It is not a sign anything is wrong.

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

Not planned, and there is no retirement date. Under `docs/maintenance-policy.md` (approved
by both founders, 6 and 7 October) the main contract keeps its authority, because Midnight
network upgrades can require verifier-key updates, and a retired authority could not make
them. Retiring stays possible only if both founders decide it in writing, it has been
announced as that policy says, and a new revision of the deployment record says so. It
cannot be undone.

How, if that decision is ever made: run `npm run mainnet` (steps 1 to
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

Option 2 on mainnet only accepts the contract address pinned in the code. Matching
circuit keys show the code; the address is what says which contract is VeilCore's
(another contract can carry the same circuits with forged records).

### How joining checks the contract (changed 4 October)

Before joining, the CLI checks that the contract started from VeilCore's own empty
starting state, by reading the contract's **deploy transaction** and comparing what it
started with against this build. In plain words, what happens:

- **Usually** the indexer leads straight to the deploy transaction, the check runs, and the
  log says `Starting state checked: deploy transaction … carries the VeilCore
  constructor's state.` Nothing to do.
- **If the contract's most recent action is a maintenance change** (a circuit key added or
  replaced with the maintenance key), the indexer cannot lead back to the deploy. Then:
  - if nobody has used the contract yet (just deployed, or "Finish a deploy"), its records
    are still exactly the empty starting state, which is checked directly. Nothing to do;
  - **on mainnet**, at the pinned address, the CLI joins and the log says `Starting state
    not re-checked: …`. The pin is the authority there: it is the address from your own
    deploy, written into the code and the deployment record;
  - on a test network, it says `Could not check how the contract at … started. … This is
    NOT a finding that the contract is forged` and asks for the deploy transaction id.
    Paste the id (the deployer's `Deploy transaction id: …` line) and it checks from that
    transaction. Enter stops, with nothing written.
- **It only ever says a contract `is not a genuine VeilCore deployment`** after reading its
  actual deploy transaction. Do not use a contract it says that about; send Claude the
  message.

Before this change the CLI asked the indexer for the "deploy state" through midnight-js,
which, after a maintenance change, hands back the contract's *current* state instead. Once
records existed, the real VeilCore contract would then have been refused as forged after
any key change. That can no longer happen.

---

## D. The claims contract (test networks)

The claims contract is a second contract. A holder uses it to prove one fact about a
record they sealed (a value, that a number is at least or at most a bound, that two
records differ, that a correction changed only some values) without showing the rest.
Its options are 34 to 40 on the main menu, after you have deployed or joined the main
contract. This section is for test networks. On mainnet, option 34 is part of deploy day
(section C), and is refused unless the claims build matches its committed fingerprints
(section C0), the deployment record revision is declared, and the deploy ends with no
maintenance authority. Options 35 and 36 on mainnet check the build too, and 35 only
accepts the claims address pinned in the code.

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
