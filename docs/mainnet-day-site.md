# Mainnet day: the website

**For Hunter, on the Mac, after both contracts are deployed (runbook section C).** One
command puts veilcore.org into mainnet mode. It refuses to run until the main contract's
address is pinned and the registry is set to anchor on mainnet at that same address. It
does not look the contract up on the chain: checking that the address on your paper is
the one pinned is your step (below).

## What changes on the site

- Everywhere it said "test network", it now says we anchor records on Midnight's main
  network in batches, by hand for now (nothing anchors them automatically yet; see the
  registry README, "Anchoring a batch on mainnet"). The header chips say **Web demo** and
  **Main network**. The dated update posts still say the runs were on Midnight's preprod
  test network, because they were.
- The home page shows both contract addresses in full, with a link to midnightexplorer.com
  (an explorer run by TexLabs, not by Midnight).
- Who can change the contract: the site says the maintenance policy is "proposed, not
  decided" until `docs/maintenance-policy.md` itself says `**Status: APPROVED`. The build
  reads that line; nobody edits the site's wording for it. Once the claims contract is
  pinned, the same box adds that the claims contract has no maintenance key.
- Still labelled, because it is still true: licenses and lab agreements in the web demo are
  simulated, and a DNA report pairing on the site is saved but not dated. Visitors still send
  no transactions themselves.
- If the claims contract is not pinned yet, the site says it is not on the main network yet.
  Run the command again once it is, and that line updates.

Nothing in the site's code is edited by hand. The wording comes from the build mode.

## Before you start (in this order)

1. Both contracts are deployed and you sent Claude both addresses (runbook section C,
   "Write down afterwards").
2. Claude has pinned them in a commit (`MAINNET_VEILCORE_ADDRESS` and `MAINNET_CLAIMS_ADDRESS`
   in `api/src/deploy-guard.ts`). Wait for Claude to say it is pushed.
3. The registry is switched to mainnet. On Railway, in the veilcore-api service's variables:
   - `VEILCORE_ANCHOR_NETWORK` = `mainnet`
   - `VEILCORE_ANCHOR_CONTRACT` = the main contract address (from your paper)
   Save, and wait until Railway shows the new deployment as active (a minute or two).
4. The maintenance policy. If both founders have approved it, Claude changes the first
   line of `docs/maintenance-policy.md` to `**Status: APPROVED, <date>` in a commit, and
   the site then says it is approved. If not, leave it: the site says "proposed, not
   decided", which is true. Either way it is your call, not something to rush for launch.

## The commands

Open Terminal. Paste these one line at a time. Nothing here is a secret.

1. `cd ~/Desktop/veilcore`
2. `git checkout main`
3. `git pull`
4. `npm ci` (a few minutes)
5. `npm run deploy:mainnet`

It first prints four lines:

```
Main contract pinned: <the main address>
Claims contract pinned: <the claims address>
Maintenance policy: PROPOSED. The site will say it is proposed, not decided.
Registry https://veilcore-api-production.up.railway.app anchors on mainnet to the same contract. Building the mainnet site.
```

Check the first address against your paper. The policy line says `APPROVED` instead only if
the policy file says so (step 4 above). Then it builds and deploys (a few minutes) and
ends with `Deployed https://…` and two `alias` lines for veilcore.org and www.veilcore.org.

### If it says NOT DEPLOYED

Nothing was built or published, and the live site is unchanged. The message says what is
missing. The usual ones:

| It says | What to do |
|---|---|
| `The main contract address is not pinned yet` | Claude hasn't pinned it, or you skipped `git pull`. Do step 3 again, then step 5. |
| `The registry does not anchor on mainnet yet (it says: preview)` | Railway still has the old settings. Do "Before you start" step 3, wait for the redeploy, then step 5. |
| `The registry anchors on mainnet to …, but the pinned main contract is …` | The two addresses differ. Do not deploy. Send Claude both lines. |
| `Could not read the registry` | Check your internet, and that veilcore-api is running on Railway. Try again. |
| `The status line of docs/maintenance-policy.md reads …` | The policy's first line was changed to something the site can't read. Send Claude the line. |
| Anything about Vercel or `alias` | The site may be built but not switched. Send Claude the last 20 lines. |

## Check it on your phone

Open **veilcore.org** (pull down to refresh; if it still looks old, open it in a private tab).

1. Home page, under the buttons: *"Now on Midnight's main network: we anchor records there in batches, by hand for now."*
2. Scroll to **Straight about where we are**: the second box says **Main network**, and below
   the boxes are the two contract addresses. They match your paper. Under them, "Who can
   change the contract" says *"proposed, not decided"* (or *"Both founders have approved"*
   if you did step 4).
3. Tap **Try the demo**, then **Create a record** (answer the "Which describes you?" question
   if it appears). The chips at the top say **Web demo** and **Main network** (not "Test network").
4. Open **Demo privacy** at the bottom: it says *"Dated on Midnight's main network"*.

If any of these still say "test network", send Claude a screenshot.

## Afterwards

- From now on, publish site changes with `npm run deploy:mainnet`. `npm run deploy:prod`
  builds the test-network version, so it now refuses once the registry anchors on mainnet
  (`NOT DEPLOYED. The registry anchors on mainnet now … Use npm run deploy:mainnet
  instead.`). If you see that, nothing was changed; run `npm run deploy:mainnet`.
- New records stay unanchored until someone anchors a batch (registry README, "Anchoring a
  batch on mainnet": seal, CLI option 29, then one curl). The site says this is done by
  hand; decide with Mako how often, so "a while" stays short.
- To update the claims line after the claims contract is pinned later: `git pull`, then
  `npm run deploy:mainnet` again.
- Records already dated on Preview before the switch keep saying so on their own pages. That
  is correct: each record shows the network its batch was actually anchored on.
