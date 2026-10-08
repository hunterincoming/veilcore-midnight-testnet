# Royalties contract: design, sources and limits

**Status: DRAFT, version 2, 8 October 2026. Not deployed anywhere.** Contract:
`contract/src/veilcore-royalties.compact`. Client: `api/src/royalties-api.ts`. Menu: options
50 to 68 in `bboard-cli`. Tests: `contract/src/test/royalties*.test.ts` (the contract) and
`bboard-cli/src/royalties-journey.test.ts` (the real client, end to end, on the simulator).
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
period settled for at least N units".

Money only moves in public, in two places, payer to breeder, with the contract holding
nothing. The books are private. That is the answer to "why are the payments public on a
privacy chain": the payment of money is public because Midnight's private token path is
clumsy in contracts today, and what a payment would give away (variety, volumes, growers)
is kept out of the payment and moved into the private settlement.

## Circuits

| Circuit | Who | What it does | Size |
|---|---|---|---|
| `postOffer` | record holder | Posts an offer, run from then on by its own admin key. | |
| `closeOffer`, `changeOfferAdmin` | offer admin | Stop new sales; hand the offer to a new key. | |
| `buyLicense` | anyone | Pays the price to the breeder and issues the licence, in one call. | |
| `topUp` | anyone | Pays an amount to the breeder; creates a credit note only the licensee can spend. Proves the offer without naming it. | 2^16 |
| `settle` | licensee | Spends a note, proves units × rate ≤ its value, keeps the change, records a receipt and the units masked for the breeder. | 2^17 (113,408 rows) |
| `mergeNotes` | licensee | Joins two credit notes into one. | 2^17 |
| `proveLicense` | licensee | Live licence at the verifier's time, and optionally a settled period ≥ N units. | 2^16 |
| `revokeLicense` | offer admin | Only if the offer said revocable. Tracked per offer. | |
| `clearEnded`, `removeEnded` | anyone | Tidy up ended licences (30 days after the end, at the earliest) and ended offers. | |
| `sealRevocations` | anyone | Retires old licence roots so revoked licences stop proving. Every 600 s at most. | |

The limit for anything a holder proves is 2^17 rows. `settle` uses 87% of it. Proving time
on a laptop is still to be measured.

## How the privacy works

Each piece is a known construction, not an invention:

- **Credit notes are Zcash-style.** A note commits to a top-up code (from the licensee's
  spending key), the offer and the amount. Spending it publishes a nullifier made from the
  licensee's nullifier key and the note, so nobody can link a spend to its note, and nobody
  can spend twice. Change goes into a fresh note. (Zcash protocol spec, Sapling.)
- **Offers are proved by Merkle path**, so a top-up or settlement proves "one of the offers
  on this contract" without saying which. Same pattern as zk-creds
  ([eprint 2022/878](https://eprint.iacr.org/2022/878)).
- **Per-offer keys.** From one licence secret the licensee derives a spending key and a viewing
  key for that offer only, so a breeder holding one licence card learns nothing about the
  licensee's other licences. (Zcash's viewing keys are the model.)
- **The breeder reads units with the viewing key.** Each settlement publishes its units plus a
  pad made from the viewing key and that settlement's change note (unique every time). The
  contract keeps every settlement in a map, so the breeder's client scans it with each
  licence card and misses none. Whoever lacks the viewing key sees a random field element.
- **Receipts** bind the viewing key, the period, the offer and the units, so a licensee cannot
  prove more units than they settled or borrow someone else's settlement.

## What is public, and what can still link

Public: who pays at a licence purchase and a top-up, the breeder's wallet, the token, the
amount, the offer at a purchase, and which circuit each transaction calls (and its fee-paying
wallet). A top-up shows a rounded "open until" time (always the start of the day after
tomorrow, UTC) so it names no offer; for the same reason top-ups close one to two days
before an offer ends. A breeder with one royalty offer per wallet and token gets no cover from that.

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
3. **Amounts.** Top-up amounts are public. An unrounded amount, or several with a common
   divisor, can hint at the rate. The menu says "a round amount hides more".
4. **Presentations.** Whether a period was asked, the time the verifier asked for, and the
   holder tag are public. The holder tag repeats when one licence answers the same verifier
   again (that is the point, see below), and anyone can see the repeat.
5. **Merges** show that two notes had one owner. A refused presentation tells the verifier
   something about the units, and repeated requests can narrow it.

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
12. **A presentation proves someone holding the licence answered,** not that the person in
    front of the verifier holds it. A licensee could answer for another grower. The defence:
    the client gives each verifier a stable scope per offer, so one licence answering for
    several growers shows the same holder tag each time.
13. **Receipts commit to units**, so stage 3 (genetics as collateral) can prove royalty
    totals later. BBA+ is the reference for private running totals
    ([KIT](https://publikationen.bibliothek.kit.edu/1000077889)).

## Other limits

- **The record is checked off chain.** Ledger 8 has no calls between contracts. The client
  buys only from an offer whose record is the live head of an anchored identity in the main
  contract. The contract itself does not check, so anyone can post an offer; per-offer
  revocations mean that cannot disturb anyone else.
- **Losing the offer admin key is permanent.** Keep it on paper, like the maintenance key.
- **Credit left when a licence ends or is revoked** stays with the breeder, who already holds
  the money. The terms say whether any is refunded.
- **State grows with use.** Notes, nullifiers, receipts and settlements are never pruned; each
  costs its sender a transaction. Ended licences and offers can be cleared by anyone.
- **The breeder's scan grows with use:** every settlement on the contract × every licence
  card. Fine at hundreds of growers; a large breeder would need an index later.
- **No refunds, transfers or royalties on offspring yet.** Offspring royalties come later, on
  Story Protocol's model of paying direct parents only
  ([Story](https://docs.story.foundation/concepts/royalty-module/liquid-relative-percentage.md)).
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
