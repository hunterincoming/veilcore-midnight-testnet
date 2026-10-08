# Royalties contract: the preprod test run (Hunter, about 1 to 1.5 hours)

The first live run of the royalties contract, on preprod, with two wallets: one plays the
breeder, one the grower. It tests the thing no test here can: that a payment goes from one
real wallet, through the contract, to another real wallet, in one transaction. Nothing here
touches mainnet or real money.

**You need:** Docker running; the Mac; your preprod private-state password; the preprod test
wallet (seed 2) for the breeder; a second preprod wallet for the grower (step 4 makes one if
you don't have one); a scrap of paper; any small file to stand in for licence terms (a text
file on your Desktop is fine).

Two Terminal windows run side by side. Window A is the breeder, window B the grower. Window
B uses its own folder for saved state, so the two don't collide.

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
   The compile makes the royalties contract's keys. It downloads some files the first time.
   It should end without an error.
2. Make a terms file: `echo "TEST licence terms, preprod only" > ~/Desktop/test-terms.txt`

## Breeder, window A

3. `npm run preprod-remote`. Password, wallet menu `2`, paste seed 2. Wait for the sync.
   - When it asks deploy or join: **join** `72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73`
     (the practice contract from 7 October).
   - Main menu `1`: anchor a record. Follow the prompts. Write the recovery secret on the
     scrap paper (test only).
   - Main menu `50`: deploy the royalties contract. Type `yes`. **Write down the address it
     prints.** About 10 to 20 minutes.
   - Main menu `53`: post an offer.
     - Terms file: `~/Desktop/test-terms.txt`
     - Token: Enter (NIGHT)
     - Price: `1`
     - Royalty per unit: `0.1`
     - How many: `3`
     - Days: `30`
     - Revoke: `y`
     - Wallet: Enter
     - Then `yes`.
   - **Write down the offer id and the admin secret** on the scrap paper.

## Grower, window B

4. Open a second Terminal window:
   ```
   mkdir -p ~/veilcore-grower
   cd ~/Desktop/veilcore/bboard-cli
   HOME=~/veilcore-grower npm run preprod-remote
   ```
   Password: any new one for this test (16+ characters).
   - Wallet: `2` and a second seed if you have one. If not, `1` makes a new wallet. Write its
     seed on the scrap paper, then send it tNIGHT from the preprod faucet at the address it
     shows, and wait until it says it has funds and DUST.
   - **Write down the NIGHT balance it shows**, for checking later.
   - Join the same main contract (`72fe…` as above).
   - `51`: join the royalties contract (the address from step 3).
   - `54`: list offers. You should see yours: price 1 NIGHT, royalty 0.1, 3 left.
   - `55`: buy. Paste the offer id, then `yes`. **Write down the licence key it prints.**
   - `56`: pay a royalty. Offer id, period `TEST-1`, units `10`, then `yes`. It sends 1 NIGHT.

## Breeder again, window A

5. A proof can't be made straight after your own purchase, because it would point at that
   purchase. So the breeder makes one more sale and payment first. That also tests a second
   buyer:
   - `55`: buy one licence from your own offer.
   - `56`: pay a royalty: period `TEST-1`, units `3`.
   - `59`: make a licence request.
     - Offer id: as before.
     - Period: `TEST-1`
     - At least `5` units
     - Scope: Enter
     - File: `~/Desktop/request.json`

## Grower, window B

6. `60`: answer the request. File `~/Desktop/request.json`; at the units question, press Enter.
   **Copy the transaction id it prints.**

## Breeder, window A

7. `61`: check the answer. File `~/Desktop/request.json`, then the transaction id. Expect
   `ACCEPTED`.
8. `63`: revoke the grower's licence. Paste the licence key from step 4, press Enter at the
   admin secret (this computer posted the offer), then `yes`.
9. `64`: seal. If it says "possible from" a time, wait until then and run `64` again until it
   says `Sealed`.
10. `59` again: a new request (same answers, file `~/Desktop/request2.json`).

## Grower, window B

11. `60` with `~/Desktop/request2.json`. Expect it to be **refused** (the licence is revoked).
12. `0` to exit. Write down the NIGHT balance shown the next time it starts, or check it in
    Lace.

## Breeder, window A

13. `0` to exit. Close both windows. Shred the scrap paper. You can delete `~/veilcore-grower`.

## Paste back to Claude

- The royalties contract address and the offer id.
- The last 30 lines of each window after steps 4, 6, 7 and 11.
- The grower's NIGHT balance before and after. It should be about 2 NIGHT lower: 1 for the
  licence and 1 for the royalty, plus fees in DUST, not NIGHT.

Nothing in those is secret. Do not paste the admin secret, the wallet seeds or the recovery
secret.

## If something goes differently

- **Deploy stops partway (step 3):** don't choose `50` again. Restart, join the main contract,
  choose `52`, and give it the address.
- **Buy or pay fails with a balance or "imbalanced" error:** stop and paste the last 30 lines.
  That is the payment path this run exists to test.
- **Step 6 refused with "Nobody else has bought or changed a licence since your purchase":**
  step 5 didn't land yet. Wait a minute and try again.
- **Any other error:** stop and paste the last 30 lines.
