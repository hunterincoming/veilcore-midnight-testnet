# Royalties contract: design, sources and limits

**Status: DRAFT, protocol 3, 8 October 2026. Not deployed anywhere.** Contract:
`contract/src/veilcore-royalties.compact`. Client: `api/src/royalties-api.ts`. Menu: options
50 to 81 in `bboard-cli`. Royalties on offspring (protocol 3) have their own design:
`docs/royalties-offspring-design.md`. Tests: `contract/src/test/royalties*.test.ts` (the contract),
`bboard-cli/src/royalties-journey.test.ts` (the real client, end to end, on the simulator) and
`bboard-cli/src/royalties-attacks.test.ts` (each attack on the client, run against the fix).
The two live mainnet contracts are not changed by any of this.

Roadmap stage 2: breeders sell licences on chain, and royalties are paid on chain.

## In one paragraph: public money, private books

A breeder posts an **offer**: the licence price, the token, the wallet that gets paid, how
many licences, when they end, whether they can be revoked, and a fingerprint of the terms.
The royalty rate is not published; the chain holds only a commitment to it, and the rate is
on an **offer card** the breeder hands licensees with the terms. A grower **buys** a licence:
the price goes straight to the breeder's wallet in the same transaction, and the grower hands
the breeder a **licence card** that lets the breeder read that licence's settlements and
nothing more. Royalties are **prepaid** as credit: the grower, or a grain buyer or processor
holding the grower's **top-up request**, pays an amount straight to the breeder's wallet. Each
period the grower **settles** privately against that credit. Settling moves no money and
publishes nothing that says which variety, which grower, which period, how many units or at
what rate. The breeder reads all of that for their own licensees with the licence cards. A
buyer or regulator asks for a **presentation**: "a live licence from this offer, and this
period settled for at least N units". A licensee can hand a **presentation card** to someone
who answers buyers for them (a seed company's growers, say): it can never spend, but it
reads every settlement of that licence, now and later, and nothing takes it back short of
ending the licence.

Money only moves in public, in two places, payer to breeder, with the contract holding
nothing. The books are private. That is the answer to "why are the payments public on a
privacy chain": the payment of money is public because Midnight's private token path is
clumsy in contracts today, and what a payment would give away (variety, volumes, growers)
is kept out of the payment and moved into the private settlement.

## Circuits

| Circuit | Who | What it does | Rows |
|---|---|---|---|
| `postOffer` | record holder | Posts an offer, run from then on by its own admin key. A rate commitment must open to a rate above zero. | 35,039 |
| `closeOffer`, `changeOfferAdmin` | offer admin | Stop new sales; hand the offer to a new key. | |
| `buyLicense` | anyone | Pays the price (and any ancestors' shares and fees) and issues the licence, in one call. Sales are counted in counters, so two buyers at once do not conflict. | 38,905 |
| `topUp` | anyone | Pays an amount to the breeder; creates a credit note only the licensee can spend. Proves the offer without naming it. Until 30 days after the offer ends. | 26,753 |
| `settle` | licensee | Spends a note, proves units × rate ≤ its value, keeps the change, records a unique receipt, a numbered lookup tag and the units masked for the breeder. | 102,942 |
| `mergeNotes` | licensee | Joins two credit notes into one. | 69,023 |
| `proveLicense` | licensee or delegate | A licence live at the verifier's time, and optionally a settled period ≥ N units; or that period settled under a licence since ended. Needs only the presentation key. | 51,485 |
| `revokeLicense` | offer admin | Only if the offer said revocable, and only before it ends. Tracked per offer. | |
| `clearEnded`, `removeEnded` | anyone | Tidy up ended licences (30 days after the end, at the earliest) and ended offers. | |
| `sealRevocations` | anyone | Retires old licence roots so revoked licences stop proving; every tree's at most daily. Every 600 s at most. | |

Measured with `zkir mock-compile` from compiler 0.31.1 on 8 October 2026. The limit for
anything a holder proves is 2^17 = 131,072 rows. `settle` uses 79% of it (it was 96%
until each key was hashed once instead of up to three times; the hashes and what they
prove are unchanged). Nearly all of its cost is about 20 SHA-256 hashes (`persistentHash`,
about 4,400 rows each); Merkle paths are cheap (about 3,000 rows for depth 32). The
cheaper hash (`transientHash`, about 600 rows) is not used for anything stored, because
Midnight's docs say it may change between upgrades and this contract cannot be changed.
That leaves room for about six more hashes in `settle`. Proving time on a laptop is still
to be measured.

## How the privacy works

Each piece is a known construction, not an invention:

- **Credit notes are Zcash-style.** A note commits to a top-up code (from the licensee's
  spending key), the offer and the amount. Spending it publishes a nullifier made from the
  licensee's nullifier key and the note, so nobody can link a spend to its note, and nobody
  can spend twice. Change goes into a fresh note. (Zcash protocol spec, Sapling.)
- **Offers are proved by Merkle path**, so a top-up or settlement proves "one of the offers
  on this contract" without saying which. Same pattern as zk-creds
  ([eprint 2022/878](https://eprint.iacr.org/2022/878)).
- **Per-offer keys.** From one licence secret the licensee derives, for that offer only, a
  spending key, a presentation key, and from that a viewing key, so a breeder holding one
  licence card learns nothing about the licensee's other licences. The presentation key
  proves the licence and its settlements and never spends (the nullifier key comes from the
  licence secret alone). (Zcash's viewing keys are the model.)
- **The breeder reads units with the viewing key.** Each settlement publishes its units plus a
  pad made from the viewing key and that settlement's change note (unique every time). The
  contract keeps every settlement in a map, so the breeder's client scans it with each
  licence card and misses none. Each settlement also carries a numbered tag only the viewing
  key can make (the licence's 1st, 2nd, 3rd...), unique on chain, so the breeder sees a
  skipped number. Whoever lacks the viewing key sees a random field element.
- **Receipts** bind the viewing key, the period, the offer, the units and the settlement's
  change note, so a licensee cannot prove more units than they settled or borrow someone
  else's settlement, and no two settlements share a receipt.

## What is public, and what can still link

Public: who pays at a licence purchase and a top-up, the breeder's wallet, the token, the
amount, the offer at a purchase, and which circuit each transaction calls. Fees are paid in
DUST, which Midnight's docs call shielded, but they do not say whether a fee payment can be
tied to the wallet behind it; that is to be confirmed against the ledger spec before we claim
either way. A top-up shows a rounded "open until" time (always the start of the day after
tomorrow, UTC) so it names no offer. Top-ups run until 30 days after an offer ends (its last
season can be paid for) and close one to two days before that, for the same reason. A
breeder with one royalty offer per wallet and token gets no cover from that, and the
client says so before paying.

Not public: at a settlement, the offer, the licensee, the period, the units and the rate. At
a presentation, the licence and the offer (the verifier knows the offer it asked about).

What can still link, said plainly:

1. **Timing and roots.** Every proof publishes the tree root it used. If your own transaction
   is the newest in that tree and you prove straight after, a watcher can guess the proof is
   yours. By default the client refuses until someone else's transaction of the same kind has
   landed, and offers to send anyway (saying what that risks). Right after the client merges
   two of your notes it always asks, since the merged note is then the newest. Waiting
   for one other transaction hides you among two, not among everyone. **Privacy grows with
   use:** on a quiet contract with three growers, it is weak. That is true of every
   shielded system.
2. **Wallets.** A grower who tops up from the wallet that bought the licence links the two.
   Better: a buyer or processor pays (the top-up request), or a fresh wallet.
3. **Amounts.** Top-up amounts are public. A grower who tops up exactly what each period
   costs publishes units × rate every period, and amounts with a common divisor hint at the
   rate: anyone who knows one of the two learns the other. Top up round amounts, ahead of
   time, not per settlement. The menu says "a round amount hides more".
4. **Presentations.** Whether a period was asked, the time the verifier asked for, and the
   holder tag are public. The holder tag repeats when one licence answers the same verifier
   again (that is the point, see below), and anyone can see the repeat.
5. **Merges** show that two notes had one owner, and a merge right before a settlement
   shows the two were one grower's. A refused presentation tells the verifier something
   about the units, and repeated requests can narrow it.
6. **Period labels can be guessed.** A label is checked, not read back, but whoever holds a
   licence card can test likely labels ("2026-Q4") against its settlements. The card is for
   the breeder only.
7. **Rule 2 is only as strong as the traffic.** Waiting for one other transaction of the same
   kind hides a proof among two. A delegate answering with a presentation card cannot see
   the licensee's own transactions, so its client cannot apply the rule for them.

Units are declared by the licensee. The contract cannot see a harvest. Checking units against
deliveries, DNA tests or audits happens off chain, by the breeder, who can read them. Terms
should include an audit right.

## Decisions, and where they come from

Research on 8 October 2026 looked at how seed and animal royalties are collected today,
on-chain licensing projects, the academic papers, and Midnight's own code.

1. **A licence check can also prove royalties are settled.** NFT royalties (EIP-2981) failed
   because a token stayed valid whether or not anyone paid; OpenSea made them optional in 2023
   ([OpenSea](https://opensea.io/blog/articles/on-creator-fees),
   [EIP-2981](https://eips.ethereum.org/EIPS/eip-2981)). Here a buyer, processor or regulator
   can ask for "settled for this period, at least this many units" before dealing with a
   grower. Same check as Germany's harvest certificate and Argentina's Sembrá Evolución, but
   without sending farm data to a collector, which farmers resist most
   ([top agrar](https://www.topagrar.com/betriebsleitung/news/arger-um-die-erntegut-bescheinigung-landwirte-sauer-auf-stv-20014683.html),
   [Bichos de Campo](https://bichosdecampo.com/que-es-sembra-evolucion-las-principales-semilleras-controlaran-ogm-en-soja-desde-2023-y-un-ano-mas-tarde-detectarian-tambien-todas-las-variedades-sembradas)).
2. **Anyone can pay on the licensee's behalf.** Australia's End Point Royalties are collected
   best when the grain buyer deducts at delivery; compliance is below 75% where growers
   self-declare ([Stock Journal](https://www.stockjournal.com.au/story/8586430/grain-producers-sa-crop-breeders-raise-end-point-royalty-concerns/),
   [AGT](https://agtbreeding.com.au/sourcing-seed/pbr-and-epr)). The payer gets a top-up
   request naming nobody, and the payment does not name the grower.
3. **A flat royalty per unit, kept private.** Same model as EPR (per tonne) and UK Limousin
   semen royalties ([Limousin](https://limousin.co.uk/the-breed/semen-royalty-scheme/explanation/)).
   Rates are commercial terms, so the chain holds only a commitment. A percentage of sale
   price would make growers reveal their prices.
4. **Prepaid credit, settled privately.** Paying per settlement in public would publish units
   × rate for every period. Prepaying decouples the money from the books. This is the Zcash
   model applied to royalties.
5. **An end date.** Royalties collected after patents expired lost Bayer the Intacta case in
   Mato Grosso ([Cultivar](https://revistacultivar.com.br/noticias/tribunal-de-mato-grosso-confirma-sentenca-sobre-cobranca-de-royalties-da-soja-intacta)).
   No sale or top-up after the end. Settling stays possible for at least 30 days after it,
   since it moves no money and closes the books.
6. **Revocability is declared before anyone buys** (EIP-5484
   [link](https://eips.ethereum.org/EIPS/eip-5484)). Revocations are tracked per offer, so a
   verifier waits for a seal only after a revocation on the offer it asked about. Nobody can
   hold up other breeders' presentations by revoking their own licences.
7. **Licences are not tradable.** Tradable royalty rights pulled music-royalty and IP-token
   projects into securities trouble; Molecule keeps revenue rights off its tokens
   ([Molecule](https://molecule.xyz/blog/ipts-a-gain-of-function)).
8. **The contract holds nothing.** Every payment is received and sent on in the same call,
   the lowest-risk pattern in Midnight's deployment rubric (OpenZeppelin's
   `ForwarderUnshielded` for Compact does the same).
9. **Any token.** No stablecoin is on Midnight mainnet yet; USDCx is live on Cardano only
   ([Midnight blog](https://midnight.network/blog/consensus-hk-2026-recap)). Each offer names
   its token, so NIGHT works today and a stablecoin needs no rebuild.
10. **No fee.** We stay the layer, not the marketplace. Any future fee is a decision for both
    founders.
11. **An offer is run by its own admin key**, not the record secret, so a leaked or rotated
    record secret cannot close or revoke anything.
12. **A presentation proves someone holding the licence (or its presentation card)
    answered,** not that the person in front of the verifier holds it. A licensee could
    answer for another grower, and can hand the presentation card on. The defence: the
    client gives each verifier a stable scope per offer, so one licence answering for
    several growers shows the same holder tag each time. A period label matches exactly:
    where the terms charge per delivery, the verifier should ask for that delivery's label,
    or one settled season can vouch for any number of deliveries.
13. **Receipts commit to units**, so stage 3 (genetics as collateral) can prove royalty
    totals later. BBA+ is the reference for private running totals
    ([KIT](https://publikationen.bibliothek.kit.edu/1000077889)).

## Other limits

- **The record is checked off chain.** Ledger 8 has no calls between contracts. The client
  buys only from an offer whose record is the live head of an anchored identity in the main
  contract, and refuses top-ups and a verifier's check for an offer whose record was since
  recovered from theft (or is not anchored); a plain key change only warns, since sold
  licences cannot move. The contract itself does not check, so anyone can post an offer;
  per-offer revocations mean that cannot disturb anyone else. Calls between contracts
  (ledger 9, not on mainnet yet) would let the contract check this itself.
- **Losing the offer admin key is permanent.** Keep it on paper, like the maintenance key.
- **Credit left when a licence ends or is revoked** stays with the breeder, who already holds
  the money. The terms say whether any is refunded.
- **State grows with use.** Notes, nullifiers, receipts and settlements are never pruned; each
  costs its sender a transaction. Ended licences and offers can be cleared by anyone.
- **The breeder's scan grows with use:** every settlement on the contract × every licence
  card. Fine at hundreds of growers; the numbered tags let a client look a licence's
  settlements up directly later.
- **A purchase or settlement that timed out may have landed.** The client refuses to buy a
  second licence from the same offer, or settle the same period again under the same
  licence, unless asked; a top-up of your own that timed out is looked for and recorded.
  One licence per offer per computer is the case the client is built for: with two, a
  top-up request always credits the newer one.
- **A cleared licence still proves until the next daily seal.** Clearing an ended licence
  does not reset the licence tree at once (that would let anyone void proofs in flight at a
  time of their choosing). It matters only for a "last season" presentation, and the
  settlement it shows is real.
- **Tidying is capped:** one run of 68 sends at most 20 transactions (offers cost nothing to
  post, so ended ones could otherwise make whoever tidies pay for many).
- **The simulator is not the chain.** It does not check that a transaction's effects match
  what was proved, and a fee taken from a failed transaction is not modelled. The preprod run
  covers what it can.
- **No refunds or transfers.** Royalties on offspring are built (protocol 3,
  `docs/royalties-offspring-design.md`): a new variety's ancestors are paid their agreed
  share of every licence and split top-up, in the same transaction.
- **No standard terms format yet.** Next: fixed fields in the style of Story's PIL.

## Before mainnet

1. A paid outside audit. The review passes so far were AI agents (see "Reviews").
2. Proving keys generated and fingerprinted, as for the live contracts.
3. The preprod run (`docs/royalties-preprod-run.md`). It confirms with real wallets that a
   purchase and a top-up move money from one wallet to another in one transaction. Still to
   confirm on preprod, separately from that run: when a purchase or top-up fails on chain (a
   race for the last licence, say), the payer's transfer fails with it.
4. A lawyer on money transmission and royalty collection, before real money moves.
5. A new deployment record and filing for this contract. The filed record says no VeilCore
   circuit moves tokens; that stays true of the live contracts, not of this one.
6. Both founders sign off.

## Reviews

All review passes were run by separate AI agents that had not seen the work being reviewed.
None is a human or outside audit.

- **Version 1, rounds 1 and 2:** 1 blocker (a proof could claim more units than were paid),
  2 high, 3 medium, 3 low. All fixed; the attacks are regression tests `A1` to `A7`.
- **Version 2, round 1 (contract):** 1 high (the nullifier construction), 4 medium (offer ids
  reused, mask pads, settling without a live licence, keys shared across offers), 2 low.
  All fixed.
- **Version 2, round 2 (contract):** 1 blocker (an end date read twice, so a proof could use
  two different ones), 2 more. Fixed; regression tests `N1`, `N2`, `N5`.
- **Version 2, round 3 (contract and client together):** no blocker; no way found to settle
  without paying, spend twice, spend another's note, mint credit, use the wrong rate or forge
  a presentation. 1 high: one revocation anywhere stalled every presentation (now per offer;
  contract test `H1`; the client's check is tested on the simulator). 4 medium: the breeder
  could miss a settlement when two were in one transaction (every settlement is now kept;
  test `M1` checks two settlements stay readable, though the simulator runs them as separate
  transactions); a second equal top-up could not be recorded (tested); a top-up near an
  offer's end named the offer (tested); one licence could quietly vouch for many growers (a
  stable scope per verifier, repeat answers flagged, and the limit stated). 5 low, fixed or
  stated above.
- **Version 2, round 4 (checking round 3's fixes):** all hold. 4 low: removing an ended offer
  erased its revocation record, so a revoked answer could later read as accepted (the record
  is now kept, and the verifier refuses to judge an answer for a removed offer); repeat
  holder tags relied on the verifier's memory (now flagged by the client); the "wait for a
  seal" message promised a seal nobody runs automatically (reworded: anyone can seal, menu
  68); doc wording. Fixed.
- **Found by running the real client end to end** (before round 3): one failed purchase made
  credit read zero; a settlement that landed but timed out lost its change; the
  wait-before-proving rule blocked on trees a proof does not use and could block the last
  buyer for good. All fixed.
- **Protocol 3, round 5 (four attackers at once: a Midnight engineer, an economist, a privacy
  researcher, and one on the client and the people running it):** no way found to forge a
  payment or settle without paying. Fixed in the contract: two buyers at once conflicted over
  the offer (sales are now counters); an offer could commit to a rate nobody could open; an
  end date near 2^64 overflowed (capped); the offer tree was too shallow for years of use
  (now depth 32); a revocation after the end cut the 30 days to settle short (refused); anyone
  could void every proof in flight by sealing after a sale (only revocations reset the
  licence tree now); two settlements could share a receipt (now unique, with numbered tags);
  delegated presenting needed the licence secret (now a presentation key); a child could
  finalise leaving a confirmed link out (refused); a parent's payee key could stall a
  child's sales at will (now once in 30 days, and terms can only be lowered); a split too
  small to pay an ancestor anything was silently zero (refused). Fixed in the client: a
  top-up request paid whatever offer it named without showing whose wallet (now shown, with
  the code's fingerprint to compare by phone); upper-case hex in a card stranded every
  top-up (cards are normalised); a terms card naming a stranger as parent was not shown
  (now shown, and refused against the parent proposed in the main contract); retries after a
  timeout bought or settled twice (refused unless asked); a store move dropped the royalties
  store (copied); top-ups and verifiers ignored a record recovered from theft (refused);
  "~/" paths were not expanded and output paths were asked only after paying (expanded, and
  checked before anything is sent; every card can be written again). Regression tests:
  `contract/src/test/royalties-hardening.test.ts` and `bboard-cli/src/royalties-attacks.test.ts`.
- **Round 6 (checking round 5's fixes):** 1 high (a thief with a parent's old record could
  still be named in terms and paid: refused now), 3 medium (a parent could stall a child's
  finalising for good: now a typed confirmation; warnings came after the payer's yes: now
  before; a presentation card reads every settlement of its licence, which the docs
  understated: now said plainly), 4 low (68 uncapped for offers; a period with spaces could
  be settled twice; two licences on one offer confused the retry check; a verifier's period
  label could carry terminal codes). Fixed.
