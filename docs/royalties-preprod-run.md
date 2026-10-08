# Royalties contract: the preprod test run (Hunter, about 1.5 hours)

The first live run of the royalties contract (version 2), on preprod, with two wallets:
window A plays the breeder, window B the grower. It tests what no test here can: that a
purchase and a top-up move real money from one wallet, through the contract, to another, in
one transaction, and that a private settlement and a presentation go through on a real
network. Nothing here touches mainnet or real money.

**You need:** Docker running; the Mac; your preprod private-state password; the preprod test
wallet (seed 2) for the breeder; a second preprod wallet for the grower (step 4 makes one if
you don't have one); a scrap of paper; a small file to stand in for licence terms.

Two Terminal windows side by side. Window B keeps its saved state in its own folder
(`VEILCORE_HOME`), so the two don't collide. Files the windows hand each other go on the
Desktop: the offer card, the licence card, the top-up request and the licence requests.

## Once, before starting (about 10 minutes)

1. Window A:
   ```
   cd ~/Desktop/veilcore
   git fetch
   git checkout royalties-v1
   git pull
   npm ci
   cd contract
   compact compile src/veilcore-royalties.compact ./src/managed/veilcore-royalties
   cd ../bboard-cli
   ```
   The compile makes the royalties contract's keys. It downloads some files the first time
   and should end without an error.
2. Make a terms file: `echo "TEST licence terms, preprod only" > ~/Desktop/test-terms.txt`

## Breeder, window A

3. `npm run preprod-remote`. Password, wallet menu `2`, paste seed 2. Wait for the sync.
   - Deploy or join: **join** `72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73`
     (the practice contract from 7 October).
   - `1`: anchor a record. Write the recovery secret on the scrap paper (test only).
   - `50`: deploy the royalties contract. Type `yes`. **Write down the address.** About 10 to
     20 minutes.
   - `53`: post an offer. Terms file `~/Desktop/test-terms.txt`; token Enter (NIGHT); price
     `1`; royalty per unit `0.1`; how many `3`; days `30`; revoke `y`; wallet Enter; `yes`;
     offer card `~/Desktop/offer-card.json`.
   - **Write down the offer id and the admin secret** on the scrap paper.

## Grower, window B

4. A second Terminal window:
   ```
   mkdir -p ~/veilcore-grower
   cd ~/Desktop/veilcore/bboard-cli
   VEILCORE_HOME=~/veilcore-grower npm run preprod-remote
   ```
   Password: any new one for this test (16+ characters). If it asks you to type MOVE for an
   old store, don't: press Ctrl+C and tell Claude.
   - Wallet: `2` with a second preprod seed that has tNIGHT, if you have one. If not, `1`
     makes one: write its seed on the scrap paper, send it tNIGHT from the preprod faucet,
     and allow about 10 minutes after the funds arrive before it can pay fees.
   - **Write down the NIGHT balance it shows.**
   - Join the same main contract (`72fe…`), then `51`: join the royalties contract (step 3's
     address).
   - `54`: list offers. Expect yours: price 1 NIGHT, "rate in the offer card (private)", 3 left.
   - `58`: buy. Offer card `~/Desktop/offer-card.json`. It shows the rate 0.1 from the card.
     `yes`. Licence card: `~/Desktop/licence-card.json`.
   - `60`: make a top-up request. Offer id; file `~/Desktop/topup.json`.
   - `59`: top up your own credit: offer id, `0.5`, `yes`.

## Breeder, window A

5. The breeder pays the grower's top-up request (playing a grain buyer), then makes a
   purchase and top-up of its own, so the grower's settlement is not the newest of its kind:
   - `65`: pay a top-up request. File `~/Desktop/topup.json`, amount `1`, `yes`.
   - `58`: buy one licence from your own offer, card `~/Desktop/offer-card.json`, `yes`,
     licence card `~/Desktop/breeder-licence.json`.
   - `59`: top up your own credit: offer id, `0.3`, `yes`.

## Grower, window B

6. - `61`: record credit someone paid: offer id, `1`. Expect "credit 1.500000 NIGHT".
   - `62`: settle. Offer id, period `TEST-1`, units `5`, `yes`. Expect `Settled`. (5 × 0.1 =
     0.5 is spent from credit; no money moves.)
   - `63`: show credit and settlements. Expect credit 1.000000 and "settled TEST-1: 5".

## Breeder, window A

7. - `55`: read your licensees' settlements. Cards `~/Desktop/licence-card.json`, periods
     `TEST-1`. **Expect `period TEST-1  units 5`.** This is the breeder reading private books.
   - `66`: make a licence request. Offer id; period `TEST-1`; at least `3`; "one-off scope?"
     Enter (that means no: your usual scope); file `~/Desktop/request.json`.

## Grower, window B

8. `64`: answer it, file `~/Desktop/request.json`. It will say your own settlement is still
   the newest and ask whether to send anyway: type `yes` (this tests that prompt). **Copy the
   transaction id it prints.**

## Breeder, window A

9. `67`: check the answer. File `~/Desktop/request.json`, then the transaction id. Expect
   `ACCEPTED`.
10. `57`: revoke the grower's licence. The licence key is the `licence` line in
    `~/Desktop/licence-card.json` (open it in TextEdit). Admin secret: Enter. `yes`.
11. If it said `Revoked and sealed`, skip this. Otherwise run `68` until it says `Sealed`
    (if it says "possible from" a time, wait until then).
12. `66` again: same answers, file `~/Desktop/request2.json`.

## Grower, window B

13. `64` with `~/Desktop/request2.json`. Expect it to be **refused** (no live licence). This
    refusal comes from the grower's own client, which sees the revocation; the contract's own
    refusal of a revoked licence is covered by the tests, not by this run.
14. `0` to exit. Start once more the same way, read the NIGHT balance, then `0`.

## Breeder, window A

15. `0` to exit. Close both windows. Shred the scrap paper. Delete `~/veilcore-grower` and the
    Desktop files from this run.

## Paste back to Claude

- The royalties contract address and the offer id.
- The last 30 lines of each window after steps 4, 6, 7, 8, 9 and 13.
- The grower's NIGHT balance before and after. Expect about 1,500,000 lower (in the smallest
  unit): 1 NIGHT for the licence and 0.5 for its own top-up. Fees are paid in DUST.

Nothing in those is secret. Do not paste the admin secret, the wallet seeds, the recovery
secret, or the card files (the offer card holds the private rate; the licence card lets
anyone read that licence's settlements).

## Not covered by this run

- A purchase or top-up that fails on chain (say, two buyers racing for the last licence):
  that the payer's transfer fails with it. That needs two wallets submitting at once and is
  a separate check before mainnet.

## If something goes differently

- **Deploy stops partway (step 3):** don't choose `50` again. Restart, join the main
  contract, choose `52`, and give it the address.
- **Buy or top-up fails with a balance or "imbalanced" error:** stop and paste the last 30
  lines. That is the payment path this run exists to test.
- **Step 6 settle says your own purchase or credit note is still the newest:** step 5 hasn't
  landed yet. Wait a minute and try again (answer `no` to "send anyway").
- **Any other error:** stop and paste the last 30 lines.
