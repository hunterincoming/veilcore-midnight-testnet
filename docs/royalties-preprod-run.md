# Royalties contract: the preprod test run (Hunter, about 1.5 hours, plus 45 minutes for parts 2 and 3)

The first live run of the royalties contract (protocol 4), on preprod, with two wallets:
window A plays the breeder, window B the grower. Since protocol 4 **no money passes through
the contract by default**: the grower pays the breeder off chain (here we only pretend), and
the breeder **issues** the licence and the royalty credit on chain. This run tests what the
tests here cannot: that issuing, a private settlement, the breeder reading the books and a
presentation all go through on a real network. Part 2 checks that a variety bred from yours
records what it owes you. Part 3 (optional) checks the on-chain payment path that an offer can
still opt into. Nothing here touches mainnet or real money.

Every prompt below was walked against the menu by a test (`bboard-cli/src/royalties-credit.test.ts`).

**You need:** Docker running; the Mac; your preprod private-state password; the preprod test
wallet (seed 2) for the breeder; a second preprod wallet for the grower (step 4 makes one if
you don't have one); a scrap of paper; a small file to stand in for licence terms.

Two Terminal windows side by side. Window B keeps its saved state in its own folder
(`VEILCORE_HOME`), so the two don't collide. Files the windows hand each other go on the
Desktop: the offer card, the licence card, the top-up request and the licence requests.
Paths starting with `~/` work at every prompt. Every file the program writes must be new: if
one is left from an earlier run, delete it first or pick another name. The program asks
where to write a file BEFORE it sends anything, so a typo costs nothing.

## Once, before starting (about 10 minutes)

1. Window A:
   ```
   cd ~/Desktop/veilcore
   git fetch
   git checkout feat/breeder-credit
   git pull
   npm ci
   cd contract
   compact compile src/veilcore-royalties.compact ./src/managed/veilcore-royalties
   cd ../bboard-cli
   ```
   The compile makes the royalties contract's keys. It downloads some files the first time
   and should end without an error.
2. Make a terms file: `echo "TEST licence terms, preprod only" > ~/Desktop/test-terms.txt`
   and note its fingerprint: `shasum -a 256 ~/Desktop/test-terms.txt` (the first 10
   characters are enough).

## Breeder, window A

3. `npm run preprod-remote`. Password, wallet menu `2`, paste seed 2. Wait for the sync.
   - Deploy or join: **join** `72fe33436d424fcf247919c8e2f0de224175cc55061739be0ebffb2d650f2f73`
     (the practice contract from 7 October).
   - `1`: anchor a record. Write the recovery secret on the scrap paper. It is a test
     record, but treat the secret like a real one: whoever holds it can take the record over.
   - **Write down the NIGHT balance it shows.**
   - `50`: deploy the royalties contract. Type `yes`. **Write down the address.** About 10 to
     20 minutes.
   - `53`: post an offer. Terms file `~/Desktop/test-terms.txt`; token Enter (NIGHT); list
     price `1`; royalty per unit `0.1`; how many `3`; days `30`; revoke `y`; "Also take
     payment THROUGH the contract?" **Enter (no)**; offer card `~/Desktop/offer-card.json`;
     `yes`. There is no wallet question: an offer paid off chain names no wallet.
   - It shows the **admin secret** first, then writes the card, and says the credit issuer
     key is kept on this computer. **Write down the offer id and the admin secret** on the
     scrap paper.

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
   - `54`: list offers. Expect yours: "list price 1.000000 NIGHT", "rate in the offer card
     (private)", "payment: off chain; the breeder issues licences and credit", "no wallet
     (paid off chain)", 3 left.
   - `84`: ask for a licence. Offer card `~/Desktop/offer-card.json`. It shows the offer, the
     rate 0.1 from the card, and the terms fingerprint (**check it matches step 2**). Licence
     card `~/Desktop/licence-card.json`; `yes`. **No transaction is sent:** in real life you
     now hand the breeder this card with your payment.

## Breeder, window A

5. `82`: issue a licence. Licence card `~/Desktop/licence-card.json`. Admin secret: Enter.
   `yes`. Expect `Issued.` and "No money moved through the contract".

## Grower, window B

6. - `63`: expect "licence …: live".
   - `60`: ask for credit. Offer id; file `~/Desktop/topup.json`. **Write down the code
     fingerprint it shows** (8 characters). The request names the offer, not the royalty
     rate. In real life you now pay the breeder for royalties and hand them this file.

## Breeder, window A

7. The breeder issues the grower's credit, then takes a licence and credit of its own, so
   the grower's settlement is not the newest of its kind:
   - `83`: issue credit. File `~/Desktop/topup.json`. It shows the offer and the code
     fingerprint: **check it is the one window B showed**. Amount `1`. It says that on chain
     this shows only that some offer's issuer issued some credit. `yes`. It then says your
     own offer is still the newest on chain and asks whether to send anyway: `yes` (expected:
     yours is the only offer on this contract). Expect `Issued.` and "Issued on this offer
     from this computer so far: 1.000000 NIGHT in 1 issuance(s)".
   - `84`: offer card `~/Desktop/offer-card.json`, licence card
     `~/Desktop/breeder-licence.json`, `yes`.
   - `82`: licence card `~/Desktop/breeder-licence.json`, admin secret Enter, `yes`.
   - `60`: offer id, file `~/Desktop/breeder-topup.json`.
   - `83`: file `~/Desktop/breeder-topup.json`, amount `0.3`, `yes`, and `yes` again to send
     anyway.
   - `61`: offer id, `0.3`.

## Grower, window B

8. - `61`: record credit issued or paid for you: offer id, `1`. Expect "Your credit:
     1.000000 NIGHT".
   - `62`: settle. Offer id, period `TEST-1`, units `5`, `yes`. Expect `Settled`. (5 × 0.1 =
     0.5 is spent from credit; no money moves.)
   - `63`: expect credit 0.500000 NIGHT, "licence …: live" and "settled TEST-1: 5".

## Breeder, window A

9. - `55`: read your licensees' settlements. Cards `~/Desktop/licence-card.json`, periods
     `TEST-1`. **Expect `period TEST-1  units 5`.** This is the breeder reading private books.
     Then its own books: "the licences read settled 5 unit(s), worth 0.500000 NIGHT; this
     computer issued 1.300000 NIGHT of credit on it (2 issuance(s))", and no WARNING.
   - `66`: make a licence request. Offer id; period `TEST-1`; at least `3`; "accept a licence
     that has ended since?" Enter (no); "one-off scope?" Enter (no: your usual scope); file
     `~/Desktop/request.json`.

## Grower, window B

10. `64`: answer it, file `~/Desktop/request.json`. It shows what the verifier asks; `yes`.
    It will then say your own settlement is still the newest and ask whether to send anyway:
    type `yes` (this tests that prompt). **Copy the transaction id it prints.**

## Breeder, window A

11. `67`: check the answer. File `~/Desktop/request.json`, then the transaction id. Expect
    `ACCEPTED`, with "The variety's pedigree matches the VeilCore contract".
12. `57`: revoke the grower's licence. The licence key is the `licence` line in
    `~/Desktop/licence-card.json` (open it in TextEdit). Admin secret: Enter. `yes`.
13. If it said `Revoked and sealed`, skip this. Otherwise run `68` until it says `Sealed`
    (if it says "possible from" a time, wait until then: a revocation is sealed at most once
    an hour, so it can be up to an hour).
14. `66` again: same answers, file `~/Desktop/request2.json`.

## Grower, window B

15. `64` with `~/Desktop/request2.json`, `yes`. Expect it to be **refused** (no live
    licence). This refusal comes from the grower's own client, which sees the revocation; the
    contract's own refusal of a revoked licence is covered by the tests, not by this run.

If you are doing part 2 or part 3, do them now (below), then come back to step 16.

16. `0` to exit. Start once more the same way, read the NIGHT balance, then `0`.

## Breeder, window A

17. `0` to exit (after reading its NIGHT balance once more, the same way). Close both
    windows. Shred the scrap paper. Delete `~/veilcore-grower` and the Desktop files from
    this run.

## Part 2: a variety bred from yours records what it owes you (about 30 minutes, optional)

Do this after step 15, before exiting either window. The grower now plays the breeder of a
new variety bred from yours. The breeder's variety (window A) is the parent. Everything is
paid off chain: watch that what the new variety owes you is written down on chain.

- **Window B:** `1` (anchor your record: the new variety; write its recovery secret on the
  scrap paper). **Write down the "Anchored record".**
- **Window A:** `31` (show your record). **Write down "Your record".** Then `69` (offer terms
  for varieties bred from yours): token Enter; fee `0.1`; share `10`; generations `2`; days
  `30`; wallet Enter; the new variety's record: window B's record; file
  `~/Desktop/terms.json`.
- **Window B:** `16` (propose a parent) with window A's record. Then `70` (propose a link)
  with `~/Desktop/terms.json`. It shows the parent record (**check it is window A's**), the
  token (NIGHT) and the terms; `yes`.
- **Window A:** `71` (confirm the new variety's link) with window B's record. It shows the
  terms; `yes`. Then `17` (confirm a child) with window B's record.
- **Window B:** `72` (make your variety's ancestors final). Before asking, it shows the chart:
  "parent …: 10% + fee 0.100000 NIGHT to …", and no "STOP" lines. `yes`. Then `53` (post an
  offer): terms file `~/Desktop/test-terms.txt`; token Enter; list price `1`; royalty `0.1`;
  how many `3`; days `30`; revoke `y`; on chain Enter (no); offer card
  `~/Desktop/offer-card-2.json`; `yes`. **Write down the offer id and its admin secret.**
- **Window A:** `84` (ask for a licence) with `~/Desktop/offer-card-2.json`, licence card
  `~/Desktop/licence-card-2.json`, `yes`.
- **Window B:** `82` (issue a licence) with `~/Desktop/licence-card-2.json`. Before asking,
  it says the variety's ancestors take a share and that issuing records on chain what you
  owe them: "parent …: 10% (about 0.100000 NIGHT) + fee 0.100000 NIGHT to …". Admin secret
  Enter; `yes`. No money moves.
- **Window A:** `60` (ask for credit) with offer id 2, file `~/Desktop/topup-2.json`.
- **Window B:** `83` (issue credit) with `~/Desktop/topup-2.json`; check the fingerprint;
  amount `1`. It says this issuance names the offer and the amount on chain, and records
  "parent …: 10% (about 0.100000 NIGHT)". `yes` (no "send anyway" here).
- **Window A:** `85` (what varieties bred from yours owe you), Enter for your own record.
  Expect "variety …, offer …: 0.300000 NIGHT (1 licence(s), 1 credit issuance(s))": 0.1
  share and 0.1 fee for the licence, 0.1 share of the credit.
- **Window B:** `73` (show a variety's pedigree chart) with your own record. Expect
  "Pedigree: matches the VeilCore contract." and "Recorded as owed to its ancestors … parent
  …: 0.300000 NIGHT (1 licence(s), 1 credit issuance(s))".

## Part 3: an offer that takes payment on chain (about 15 minutes, optional)

The path an offer can opt into: money moves through the contract, from one wallet to
another, in one transaction.

- **Window A:** `53`: terms file `~/Desktop/test-terms.txt`; token Enter; list price `1`;
  royalty `0.1`; how many **`2`** (so it is not taken for a repeat of step 3's offer); days
  `30`; revoke `y`; "Also take payment THROUGH the contract?" **`y`**; wallet Enter; offer
  card `~/Desktop/offer-card-3.json`; `yes`. **Write down the offer id.**
- **Window B:** `58` (buy a licence) with `~/Desktop/offer-card-3.json`. It shows the offer,
  the breeder's record and wallet, the terms fingerprint, the rate 0.1 and "in all, this
  sends from this wallet: 1.000000 NIGHT". Licence card `~/Desktop/licence-card-3.json`;
  `yes`.
- **Window B:** `59` (top up your own credit): offer id 3, `0.5`. It warns that this is the
  only royalty offer paid to that wallet, so the top-up shows which offer it is for:
  expected here. `yes` to go on despite it, then `yes`.

## Paste back to Claude

- The royalties contract address and the offer id(s).
- The last 30 lines of each window after steps 4, 5, 7, 8, 9, 10, 11 and 15.
- Both NIGHT balances before and after. **Without part 3, neither should change** (fees are
  paid in DUST): that is the point of protocol 4. With part 3, expect the grower about
  1,500,000 lower (in the smallest unit) and the breeder about 1,500,000 higher: 1 NIGHT for
  the licence and 0.5 for the top-up.
- If you did part 2: the last 30 lines of window B after `82` and `83`, and of window A
  after `85`.
- If you did part 3: the last 30 lines of window B after `58` and `59`.

Nothing in those is secret. Do not paste the admin secrets, the wallet seeds, the recovery
secrets, or the card files (the offer card holds the private rate; the licence card lets
anyone read that licence's settlements; a presentation card lets anyone answer as that
licence).

## Not covered by this run

- Naming a new credit issuer (86) and a private issuance whose proof is voided by a seal and
  proved again: the tests cover them, this run does not.
- A purchase or top-up that fails on chain (say, two buyers racing for the last licence):
  that the payer's transfer fails with it. That needs two wallets submitting at once and is
  a separate check before mainnet.
- Presentation cards (79 and 80), lowering a link's terms (81) and moving a payee (74): the
  tests cover them, this run does not.

## If something goes differently

- **Deploy stops partway (step 3):** don't choose `50` again. Restart, join the main
  contract, choose `52`, and give it the address.
- **82 or 83 says it is already on chain:** an issuance that timed out did land. Nothing to
  do; check with `63` in window B.
- **84 says this computer already holds a licence from that offer:** answer `no`, and write
  the card again with `78` if you need it.
- **60 says this client holds no live licence:** step 5 hasn't landed yet, or was skipped.
- **Part 3, buy or top-up fails with a balance or "imbalanced" error:** stop and paste the
  last 30 lines. That is the payment path part 3 exists to test.
- **A settle says it may already have been done:** a timeout came after it landed. Answer
  `no`, check with `63`, and tell Claude.
- **Step 8 settle says your own credit note or licence is still the newest:** step 7 hasn't
  landed yet. Wait a minute and try again (answer `no` to "send anyway").
- **"Cannot write in …" or "already exists":** nothing was sent. Fix the path or delete the
  old file, and choose the option again.
- **Any other error:** stop and paste the last 30 lines.
