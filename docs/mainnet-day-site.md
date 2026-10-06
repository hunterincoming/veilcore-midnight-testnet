# Mainnet day: the website

**For Hunter, on the Mac, after both contracts are deployed (runbook section C).** One
command puts veilcore.org into mainnet mode. It refuses to run until the contracts and the
registry are really on mainnet, so it cannot announce mainnet early.

## What changes on the site

- Everywhere it said "test network", it now says records are dated on Midnight's main
  network, in batches. The header chip says **Main network**.
- The home page shows both contract addresses in full, with a link to the Midnight explorer.
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

## The commands

Open Terminal. Paste these one line at a time. Nothing here is a secret.

1. `cd ~/Desktop/veilcore`
2. `git checkout main`
3. `git pull`
4. `npm ci` (a few minutes)
5. `npm run deploy:mainnet`

It first prints three lines:

```
Main contract pinned: <the main address>
Claims contract pinned: <the claims address>
Registry https://veilcore-api-production.up.railway.app anchors on mainnet to the same contract. Building the mainnet site.
```

Check the first address against your paper. Then it builds and deploys (a few minutes) and
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
| Anything about Vercel or `alias` | The site may be built but not switched. Send Claude the last 20 lines. |

## Check it on your phone

Open **veilcore.org** (pull down to refresh; if it still looks old, open it in a private tab).

1. Home page, under the buttons: *"Now on Midnight's main network: records are dated there, in batches."*
2. Scroll to **Straight about where we are**: the second box says **Main network**, and below
   the boxes are the two contract addresses. They match your paper.
3. Tap **Try the demo**, then **Create a record** (answer the "Which describes you?" question
   if it appears). The chip at the top says **Main network** (not "Demo" or "Test network").
4. Open **Demo privacy** at the bottom: it says *"Dated on Midnight's main network"*.

If any of these still say "test network", send Claude a screenshot.

## Afterwards

- From now on, publish site changes with `npm run deploy:mainnet`, never `npm run deploy:prod`.
  `deploy:prod` still builds the test-network version and would put the old wording back.
- To update the claims line after the claims contract is pinned later: `git pull`, then
  `npm run deploy:mainnet` again.
- Records already dated on Preview before the switch keep saying so on their own pages. That
  is correct: each record shows the network its batch was actually anchored on.
