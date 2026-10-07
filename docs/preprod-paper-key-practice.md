# Practice: the real deploy, with a paper key, on preprod

Item R1 in `docs/mainnet-completeness.md`. The smoke test deploys with a key handed straight
to the code, so the steps you will do on mainnet day have never run on a live network:
making the key, writing it on paper (two sheets), typing it back, finishing a deploy that
stopped, and using the key from paper afterwards. This runs exactly those steps on preprod,
with the test wallet. Nothing here touches mainnet or costs real money.

**Time:** about 45 minutes, most of it waiting. **You need:** Docker running, the preprod
test wallet (seed 2), your preprod private-state password, two scrap sheets of paper and a
pen. Write **PRACTICE, PREPROD, NOT REAL** at the top of both sheets, so they can never be
mistaken for the mainnet key. Shred them at the end.

## Steps

1. Terminal:
   ```
   cd ~/Desktop/veilcore
   git pull
   npm ci
   cd bboard-cli
   npm run preprod-remote
   ```
2. Private-state password (twice), then wallet menu `2`, paste seed 2. Wait for the sync and
   `DUST available`.
3. Deploy menu: type `1` (Deploy a new VeilCore contract).
4. `Keep a maintenance authority? (Y/n)`: press **Enter**.
5. `Signing key (… blank to generate one)`: press **Enter**. The key appears in groups of 8.
   - Write it on **both** sheets. Check the second sheet against the screen, group by group.
   - Type `WRITTEN`, Enter, then type the key back from the **second** sheet (the one you
     did not just check). This tests that the copy for Mako is right, not only yours.
6. It prints `Contract address: …`. Write it on a sheet.
7. **Stop it on purpose.** When you see `adding circuit key 2 of 16` (or any number), press
   Ctrl+C three times. It stops. That is the point: mainnet day may be interrupted too.
   Write down the last `adding circuit key …` number you saw.
8. Start again: `npm run preprod-remote`, same password, `2`, seed 2.
9. Deploy menu: type `4` (Finish a deploy that stopped partway). Paste the address from
   your sheet. Type the key from your paper (nothing shows). It adds the missing keys.
10. `Retire the maintenance authority now? Type RETIRE, or Enter to keep it`: press
    **Enter**. Expect `Deploy finished: every circuit key is on chain.`
11. Main menu: type `30`. Expect `Protocol version 1.`
12. **Use the key once more, from paper.** Main menu: type `33` (this practice contract
    only, never on mainnet). Type `RETIRE`, then the key from your paper. Expect
    `Retired provably`. This proves the paper key really controls the contract.
13. `0` to exit. Close the Terminal window (Cmd+W). Shred both practice sheets.

**Paste back to Claude:** the contract address, and the last 30 lines of the output. Nothing
in them is secret (the key is never printed in the log).

## If something goes differently

- Step 7: if it finished before you pressed Ctrl+C, skip to step 11 and do 12. Tell Claude;
  we decide whether to repeat the interruption.
- Step 9 asks `Deploy transaction id`: paste it from the log of the stopped run, the line
  `deploy transaction submitted (…)` in the newest file in `bboard-cli/logs/preprod-remote/`.
- Any error: stop and send Claude the last 30 lines. Do not choose `1` again.

## Run of 7 October 2026 (Hunter, on main after `4e051cc`)

**Passed.** Practice contract `72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73`
on preprod, test wallet seed 2.

- Option 1 with a generated key: written on two sheets, `WRITTEN`, typed back from the second
  sheet and accepted. Deploy finished, every circuit key on chain (08:00).
- The deploy finished before the planned Ctrl+C, so the interruption itself was not
  practised. Option 4 was then run on the finished contract with the key typed from the first
  sheet: accepted, nothing missing to add, authority kept. Adding keys after a real
  interruption is the one part not run live here.
- Option 33 with the key from the first sheet: lower-case `retire` was refused ("Not
  retired."); `RETIRE` then retired it provably, transaction
  `0081bdbc410b9713dd8235ba20ad78ad6849552ff9a2d9470e0c43ca9ddc77a54c`, block 2876308 (08:21):
  "the chain shows an empty committee (threshold 1), which no key can satisfy".

So both paper copies of a generated key are proven to work, and the key from paper controls
the contract. Practice sheets to be shredded.
