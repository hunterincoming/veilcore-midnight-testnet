# Royalties contract: design, sources and limits

**Status: DRAFT, protocol 4, 9 October 2026. Test networks only; not deployed anywhere.**
Contract: `contract/src/veilcore-royalties.compact`. Client: `api/src/royalties-api.ts`. Menu:
options 50 to 86 in `bboard-cli`. Royalties on offspring have their own design:
`docs/royalties-offspring-design.md`. Tests: `contract/src/test/royalties*.test.ts` (the
contract; `royalties-credit.test.ts` for issuing), `bboard-cli/src/royalties-credit.test.ts`
(the preprod run as the menu walks it, and each attack on issuing), `royalties-journey.test.ts`
and `royalties-attacks.test.ts` (the rest of the client). The two live mainnet contracts are
not changed by any of this.

## In one paragraph: we never touch the money, we prove the books

A breeder posts an **offer**: how many licences, when they end, whether they can be revoked,
a list price, and a fingerprint of the terms. The royalty rate is not published; the chain
holds only a commitment to it, and the rate is on an **offer card** the breeder hands
licensees with the terms. A grower pays the breeder **however they already pay** (bank
transfer, stablecoin, invoice) and hands over a **licence card**; the breeder **issues** the
licence from it. For royalties, the grower hands over a **top-up request** with the payment,
and the breeder **issues** that much **credit** to it. Issuing moves no money: the credit note
on chain is the grower's receipt that the breeder acknowledged the payment. Each period the
grower **settles** privately against that credit: nothing on chain says which variety, which
grower, which period, how many units or at what rate. The breeder reads all of that for its
own licensees with their licence cards. A buyer or regulator asks for a **presentation**: "a
live licence from this offer, and this period settled for at least N units". If the variety
was bred from a licensed one, every licence and credit the breeder issues **records on chain
what it owes the ancestors**, at the terms they agreed.

## Why money is off chain by default

Version 3 moved the money through the contract (buying a licence paid the price; topping up
paid the credit). Version 4 makes that an option an offer chooses when it is posted, off by
default, for four reasons:

1. **Money transmission.** A contract that receives and forwards payments between other
   people raises the US money-transmitter question for whoever runs it. A contract that only
   records what was paid does not move anyone's money. (A lawyer must still confirm this; see
   "Before mainnet".)
2. **Cannabis proceeds on chain.** Payments for cannabis licences and royalties would sit on
   a public ledger forever, and the federal hemp redefinition takes effect on 12 November
   2026. Paid off chain, the contract holds a record of the books, not the proceeds.
3. **The token.** On chain, payment would have to be in NIGHT, which is volatile; there is no
   stablecoin on Midnight yet. Off chain, parties pay in dollars, euros or yen as they do
   today.
4. **Less state, simpler checks.** Nothing to receive, forward or split in the paying call.

What the contract actually adds is the private books: settling against credit in private,
the breeder reading its licensees' books with viewing keys, presentations that prove "live
licence, period settled for at least N units", and royalties on offspring. None of that
needs the money to pass through the contract.

**On-chain payment stays available.** An offer posted with "take payment through the
contract" also lets a grower buy a licence (`buyLicense`) and anyone pay a top-up request
(`topUp`, `topUpSplit`), as in version 3, in the token the offer names. When a stablecoin is
on Midnight, an offer can use it without a rebuild.

## What is public

- **Posting an offer:** its record, list price, token, how many licences, end date, whether
  revocable, the terms fingerprint, the rate commitment (not the rate), whether it takes
  payment on chain, and its wallet only if it does.
- **Issuing a licence:** the licence key and the offer it is from (as a purchase does). The
  licensee's keys are not published.
- **Issuing credit (ordinary offer):** only that some offer's credit issuer issued some
  credit, and the tree root it proved against. Not the offer, not the breeder, not the
  licensee, not the amount (it stays inside the note).
- **Issuing credit on a variety whose ancestors take a royalty share:** the offer and the
  amount, and each ancestor's share of it (that is what makes the share checkable).
- **Settling:** nothing about the offer, licensee, period, units or rate. The breeder reads
  them with the licence card.
- **Presenting:** a tag only the verifier can check, a holder tag that repeats within one
  verifier's scope, the time asked about, and whether a period was asked.
- **On-chain payment (only for an offer that opted in):** the paying wallet, the breeder's
  wallet, the token and the amount; a top-up hides which of that wallet's offers it pays.
- Always: which circuit each transaction calls, and the tree roots proofs use (see "What can
  still link").

## What the contract enforces, and what it cannot

**Enforced on chain:**

- Only the offer's admin key issues its licences (or revokes, closes, hands over the offer,
  or names a new credit issuer). A licence is issued once, only while the offer is open,
  before its end, and while licences are left.
- Only the offer's credit issuer key issues its credit, and only for that offer: a note is
  bound to the offer's leaf (every term, the rate included), so credit issued on one offer
  can never settle another. The same code, offer and amount can be issued once (a retry
  cannot issue twice). A licensee cannot make credit: it holds no issuer key, and merging and
  settling never create value.
- Settling spends credit worth at least units x rate, against the committed rate; a note
  spends once; receipts cannot claim more units than were settled.
- On a variety whose ancestors take a share, no licence and no credit can be issued without
  each ancestor's share (and each parent's fee, for a licence) being recorded in `owed`, worked
  out and checked by the contract, rounded down, with every share at least one unit. Credit on
  such a variety cannot use the private path.
- An offer that does not take payment on chain refuses purchases and paid top-ups. One that
  does passes the money on in the same call and holds nothing.

**Not enforceable here (said plainly):**

- **That anyone was paid.** The contract never sees money that moves off chain. The issued
  credit note is the breeder's acknowledgement, nothing more. Whether a descendant pays the
  ancestors what `owed` records is between them, like any invoice: the contract makes sure
  the record exists, cannot be skipped and cannot be changed, so both sides work from the
  same numbers.
- **That the breeder issued the right amount.** A breeder could issue less credit than it was
  paid; the grower would then be unable to settle all its units, which is the grower's
  protection (it checks its credit before settling, and the terms say what was paid for). A
  breeder and grower who collude to under-declare units, or to price a licence low and charge
  more on the side, lower what the ancestors are owed; the parent's fee per licence is the
  floor an ancestor can rely on.
- **A stolen issuer key.** Whoever holds it can issue credit on that offer (it cannot move
  money, revoke or issue licences). The admin names a new issuer; the old key stops at the
  next due seal, within an hour. Credit it issued before that stays valid. The breeder's own
  books show it: the menu sets the royalties its licensees settled against the credit that
  computer issued, and warns when more was settled.
- **Units.** Declared by the licensee. Checking them against harvests happens off chain, by
  the breeder, who can read them. Terms should include an audit right.
- **The record behind an offer** is checked by clients against the main contract, not by
  this one (no calls between contracts on ledger 8).

## Circuits

| Circuit | Who | What it does | Rows |
|---|---|---|---|
| `postOffer` | record holder | Posts an offer, run from then on by its own admin key, with its credit issuer key in the issuer tree. A rate commitment must open to a rate above zero. | 41,251 |
| `issueLicense` | offer admin | Issues a licence from the licensee's licence key; no money. Records what it owes ancestors. | 16,066 |
| `issueCredit` | credit issuer | Issues credit to a top-up code, proving the offer through the issuer tree without naming it; the amount stays in the note. Ordinary offers only. | 29,487 |
| `issueCreditSplit` | credit issuer | The same for a variety whose ancestors take a royalty share: names the offer and the amount, records each share. | 30,202 |
| `changeCreditIssuer` | offer admin | Names a new credit issuer key; the old one stops at the next due seal. | 19,199 |
| `closeOffer`, `changeOfferAdmin` | offer admin | Stop new licences; hand the offer to a new key. | |
| `buyLicense` | anyone | Offers that take payment on chain: pays the price (and ancestors' shares and fees) and adds the licence, in one call. | 42,093 |
| `topUp` | anyone | Offers that take payment on chain: pays an amount to the breeder and makes a credit note; proves the offer without naming it. | 22,125 |
| `topUpSplit` | anyone | The same for a variety whose ancestors take a royalty share: names the offer, pays each share. | 31,350 |
| `settle` | licensee | Spends a note, proves units x rate <= its value, keeps the change, records a unique receipt, a numbered lookup tag and the units masked for the breeder. | 102,948 |
| `mergeNotes` | licensee | Joins two credit notes into one. | 69,029 |
| `proveLicense` | licensee or delegate | A licence live at the verifier's time, and optionally a settled period >= N units; or that period settled under a licence since ended. | 51,485 |
| `revokeLicense` | offer admin | Only if the offer said revocable, and only before it ends. | |
| `clearEnded`, `removeEnded` | anyone | Tidy up ended licences (30 days after the end, at the earliest) and ended offers. | |
| `sealRevocations` | anyone | Retires old licence roots after a revocation and old issuer roots after an issuer change, at most once an hour; every tree's at most daily. | |

Measured with `zkir mock-compile` from compiler 0.31.1 on 9 October 2026. The limit for
anything a holder proves is 2^17 = 131,072 rows. `settle` is unchanged and uses 79% of it.
Private issuance is 22% (about 4 SHA-256 hashes and one Merkle path), so proving "I issue for
one of the offers here" costs about a quarter of the limit. Proving time on a laptop is still
to be measured.

## How issuing credit stays private

The question: an issuance signed by an offer's key would name the offer, which tells everyone
which variety was just paid for. So each offer's credit issuer is a leaf of a separate tree,
`issuerLeaves`: the hash of the offer's leaf and the issuer's key commitment, at a place of
its own. Issuing proves "my key is the issuer of one of these leaves, and the note is bound to
that same offer", the same way a settlement proves its offer. The public sees the tree root,
not the leaf. The amount is a private input that only goes into the note commitment.

Replacing the issuer overwrites the offer's place in the tree. The old leaf is still inside
old roots, so the old key keeps working until a seal retires those roots: the same rule as a
revoked licence, at most an hour. A seal retires the issuer tree's roots only when an issuer
was replaced (or at the daily seal), so revocations do not disturb issuances in flight.

Variety with ancestors: the private path is refused (the offer's leaf records whether its
ancestors take a share, so it cannot be dodged). Its credit goes through `issueCreditSplit`,
which names the offer so the contract can read the pedigree chart and record each share. That
costs the same privacy as a split top-up in version 3: the variety and the amount are public.

## How the privacy works

Each piece is a known construction, not an invention:

- **Credit notes are Zcash-style.** A note commits to a top-up code (from the licensee's
  spending key), the offer and the amount. Issued credit and paid credit make the same note,
  so everything after (merging, settling, reading, presenting) is the same. Spending it publishes a nullifier made from the
  licensee's nullifier key and the note, so nobody can link a spend to its note, and nobody
  can spend twice. Change goes into a fresh note. (Zcash protocol spec, Sapling.)
- **Offers are proved by Merkle path**, so an issuance (through the issuer tree), a top-up or
  a settlement proves "one of the offers on this contract" without saying which. Same pattern as zk-creds
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

## What can still link

Fees are paid in DUST, which Midnight's docs call shielded, but they do not say whether a fee
payment can be tied to the wallet behind it; that is to be confirmed against the ledger spec
before we claim either way.

On-chain payment only (offers that opted in): a top-up shows a rounded "open until" time
(always the start of the day after tomorrow, UTC) so it names no offer. Top-ups run until 30
days after an offer ends (its last season can be paid for) and close one to two days before
that, for the same reason. A breeder with one royalty offer per wallet and token gets no
cover from that, and the client says so before paying. "Today" is the payer's own clock:
neither the ledger nor the indexer's contract state gives a recent block time without
another network call, so the client does not look one up. A payer whose clock is a day or
more off publishes a time nobody else uses that day, which marks the top-up as theirs (and a
clock far enough behind is refused by the contract as already past). Keep the clock set
automatically.

What can still link, said plainly:

1. **Timing and roots.** Every proof publishes the tree root it used. If your own transaction
   is the newest in that tree and you prove straight after, a watcher can guess the proof is
   yours. By default the client refuses until someone else's transaction of the same kind has
   landed, and offers to send anyway (saying what that risks). Right after the client merges
   two of your notes it always asks, since the merged note is then the newest. Waiting
   for one other transaction hides you among two, not among everyone. **Privacy grows with
   use:** on a quiet contract with three growers, it is weak. That is true of every
   shielded system.
2. **Issuances.** The issuer tree changes only when an offer is posted or an issuer replaced,
   so its roots are few. A breeder that issues credit right after posting its own offer
   proves against the root its own post made: the client waits for someone else's post
   (rule 2) and asks before sending anyway. A licence issued and then settled under soon
   after can be tied together by timing, as a purchase could.
3. **Wallets (on-chain payment only).** A grower who tops up from the wallet that bought the
   licence links the two. Better: a buyer or processor pays, or a fresh wallet. Paid off
   chain, no wallet is involved and an offer names none.
4. **Amounts (on-chain top-ups, and credit on a variety whose ancestors take a share).**
   These amounts are public. A grower whose credit is exactly what each period costs
   publishes units × rate every period, and amounts with a common divisor hint at the rate:
   anyone who knows one of the two learns the other. Pay round amounts, ahead of time, not per
   settlement. The menu says "a round amount hides more". Ordinary issued credit keeps its
   amount inside the note.
5. **Presentations.** Whether a period was asked, the time the verifier asked for, and the
   holder tag are public. The holder tag repeats when one licence answers the same verifier
   again (that is the point, see below), and anyone can see the repeat.
6. **Merges** show that two notes had one owner, and a merge right before a settlement
   shows the two were one grower's. A refused presentation tells the verifier something
   about the units, and repeated requests can narrow it.
7. **Period labels can be guessed.** A label is checked, not read back, but whoever holds a
   licence card can test likely labels ("2026-Q4") against its settlements. The card is for
   the breeder only.
8. **Rule 2 is only as strong as the traffic.** Waiting for one other transaction of the same
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
   [AGT](https://agtbreeding.com.au/sourcing-seed/pbr-and-epr)). A grain buyer that deducts
   at delivery pays the breeder as it does today and passes on the grower's top-up request,
   which names nobody; the breeder issues the credit. For an offer that takes payment on
   chain, the payer can pay the request through the contract instead.
3. **A flat royalty per unit, kept private.** Same model as EPR (per tonne) and UK Limousin
   semen royalties ([Limousin](https://limousin.co.uk/the-breed/semen-royalty-scheme/explanation/)).
   Rates are commercial terms, so the chain holds only a commitment. A percentage of sale
   price would make growers reveal their prices.
4. **Prepaid credit, settled privately.** Paying per settlement in public would publish units
   × rate for every period. Prepaying decouples the money from the books. This is the Zcash
   model applied to royalties.
5. **An end date.** Royalties collected after patents expired lost Bayer the Intacta case in
   Mato Grosso ([Cultivar](https://revistacultivar.com.br/noticias/tribunal-de-mato-grosso-confirma-sentenca-sobre-cobranca-de-royalties-da-soja-intacta)).
   No licence, sold or issued, after the end, and no paid top-up after 30 days past it.
   Issuing credit has no end date: it moves no money, so a breeder can acknowledge a late
   payment for the last season (an end date would also have to be published to be checked).
   Settling stays possible for at least 30 days after the end,
   since it moves no money and closes the books. **A revocable licence can lose those 30
   days:** a licence cannot be revoked after its end, but its admin can revoke it up to the
   last second before, and a revoked licence settles nothing more, so its last season goes
   unsettled. Terms for a revocable offer should say what happens to the last season.
6. **Revocability is declared before anyone buys** (EIP-5484
   [link](https://eips.ethereum.org/EIPS/eip-5484)). Revocations are tracked per offer, so a
   verifier waits for a seal only after a revocation on the offer it asked about: revoking
   your own licences never makes another breeder's verifiers wait. What a revocation on any
   offer can still do, said exactly: its seal retires the licence tree's old roots, which
   voids every settlement and presentation proved against them that has not landed yet.
   Anyone can revoke a licence of an offer of their own, so the contract allows that at most
   once an hour (plus the daily seal of every tree). The hour is counted from the last
   revocation seal's time bound less its 300 s of slack, which is never later than that
   seal's block: so a revocation waits at most an hour for its seal, and two revocation seals
   are at least 55 minutes apart in block time. The client proves a voided settlement, merge
   or presentation once more and sends it again. It recognises a stale root by the
   contract's refusal ("... or the path is stale") anywhere in the error and what it wraps,
   or by midnight-js reporting the transaction failed on chain; never after a timeout. What
   a real node returns for a stale proof is not yet observed (the preprod run does not cover
   it), and a retry after a failure recorded on chain pays a second fee. The cost of the
   limit is that a revocation waits up to an hour for its seal, and its offer's verifiers
   wait with it. Replacing a credit issuer follows the same hourly rule; its seal retires
   only the issuer tree's roots, so it voids issuances in flight, not settlements.
7. **Licences are not tradable.** Tradable royalty rights pulled music-royalty and IP-token
   projects into securities trouble; Molecule keeps revenue rights off its tokens
   ([Molecule](https://molecule.xyz/blog/ipts-a-gain-of-function)).
8. **No money through the contract by default; never any held.** Licences and credit are
   issued for payments made off chain (see "Why money is off chain by default"). An offer
   that opts into on-chain payment has every payment received and sent on in the same call,
   the lowest-risk pattern in Midnight's deployment rubric (OpenZeppelin's
   `ForwarderUnshielded` for Compact does the same).
9. **Any token.** No stablecoin is on Midnight mainnet yet; USDCx is live on Cardano only
   ([Midnight blog](https://midnight.network/blog/consensus-hk-2026-recap)). Each offer names
   its token (the unit its list price, rate and credit are counted in), so a stablecoin
   needs no rebuild when an offer wants to be paid on chain.
10. **No fee.** We stay the layer, not the marketplace. Any future fee is a decision for both
    founders.
11. **An offer is run by its own admin key**, not the record secret, so a leaked or rotated
    record secret cannot close or revoke anything. **Its credit is issued by a separate key**
    the admin names (and can replace), so the admin key, which issues licences, revokes and
    hands over the offer, can stay on paper while the issuer key is used day to day. A
    stolen issuer key can only make credit; it is replaced within the hour.
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
14. **Issuing credit names no offer.** Considered and rejected: an issuance signed by the
    offer's admin key in public. Simpler, but it would tell everyone which variety was just
    paid for, each time. Proving the issuer key through a tree costs about 29,500 rows
    (22% of the limit) and an hourly seal for a replaced key, the same machinery revocations
    already use.

## Other limits

- **The record is checked off chain.** Ledger 8 has no calls between contracts. The client
  buys only from an offer whose record is the live head of an anchored identity in the main
  contract (asking for a licence too), and refuses paid top-ups and a verifier's check for
  an offer whose record was since recovered from theft (or is not anchored); a plain key
  change only warns, since sold licences cannot move. The contract itself does not check, so
  anyone can post an offer; per-offer revocations mean that never makes anyone else's
  verifiers wait (its revocations can void proofs in flight at most once an hour: decision
  6). Calls between contracts (ledger 9, not on mainnet yet) would let the contract check
  this itself.
- **Losing the offer admin key is permanent.** Without it no licence can be issued, closed or
  revoked, and no issuer named. Keep it on paper, like the maintenance key. Losing the credit
  issuer key is not: the admin names a new one (menu 86).
- **Credit left when a licence ends or is revoked** stays with the breeder, who already holds
  the money. The terms say whether any is refunded.
- **State grows with use.** Notes, nullifiers, receipts and settlements are never pruned; each
  costs its sender a transaction. Ended licences and offers can be cleared by anyone.
- **The breeder's scan grows with use:** every settlement on the contract × every licence
  card. Fine at hundreds of growers; the numbered tags let a client look a licence's
  settlements up directly later.
- **An offer, licence, issuance or settlement that timed out may have landed.** The client
  refuses to post again an offer it already has on chain from the same record with the same
  terms fingerprint, price, number for sale and end date (to within a day), ask for or buy a
  second licence from the same offer, or settle the same period again under the same licence,
  unless asked; a licence already on chain is not issued again, and the same request and
  amount are never issued twice (the contract refuses it too); a top-up of your own that
  timed out is looked for and recorded. One licence per
  offer per computer is the case the client is built for: with two, a top-up request always
  credits the newer one.
- **Two runs of the client on one computer share one store.** midnight-js writes back the
  private state it read when a transaction started, minutes later. Every write of the
  royalties state is merged with what is on disk (nothing in it is ever removed), and each
  run remembers what it kept, so one run's write-back cannot drop the other's licences,
  codes, notes, receipts or keys. Since 9 October a lock on the store (store-lock.ts) also
  refuses a second run on the same store; the merge stays as the second line.
- **A revoked licence still proves until its seal**, which can be up to an hour later (see
  decision 6). A verifier is told to wait, and when it can ask again.
- **A cleared licence still proves until the next daily seal.** Clearing an ended licence
  does not reset the licence tree at once (that would let anyone void proofs in flight at a
  time of their choosing). It matters only for a "last season" presentation, and the
  settlement it shows is real.
- **Tidying is capped:** one run of 68 sends at most 20 transactions (offers cost nothing to
  post, so ended ones could otherwise make whoever tidies pay for many).
- **The simulator is not the chain.** It does not check that a transaction's effects match
  what was proved, and a fee taken from a failed transaction is not modelled. The preprod run
  covers what it can.
- **No refunds or transfers.** Royalties on offspring are built
  (`docs/royalties-offspring-design.md`): a new variety's ancestors are paid their agreed share
  in the same transaction when payment is on chain, and their share is recorded as owed when
  licences and credit are issued for payments made off chain.
- **No standard terms format yet.** Next: fixed fields in the style of Story's PIL.

## Before mainnet

1. A paid outside audit. The review passes so far were AI agents (see "Reviews").
2. Proving keys generated and fingerprinted, as for the live contracts.
3. The preprod run (`docs/royalties-preprod-run.md`): issuing a licence and credit, settling,
   reading and presenting with real wallets, ancestors' dues recorded, and (part 3, optional)
   that a purchase and a top-up move money in one transaction for an offer that opts in.
   Still to confirm on preprod, separately: when a purchase or top-up fails on chain (a race
   for the last licence, say), the payer's transfer fails with it.
4. A lawyer, before real money or real growers: whether issuing credit for payments made off
   chain keeps us out of money transmission (we believe it does, since nothing is received or
   sent, but that is for them to say); what on-chain payment would add for an offer that opts
   in; and what recording cannabis licences and royalty credit means after the federal hemp
   redefinition takes effect on 12 November 2026.
5. A new deployment record and filing for this contract. The filed record says no VeilCore
   circuit moves tokens: true of this contract by default too, but not of an offer that opts
   into on-chain payment.
6. **Upgrades.** The deploy code retires the maintenance authority, so a deployed royalties
   contract can never be changed; that is unchanged here. The founders want upgradability:
   versioned upgrades are being designed on another branch, and must be settled before
   mainnet.
7. Both founders sign off.

## Reviews

- **Protocol 4 (9 October 2026, issuing instead of paying):** built and tested in one
  session (contract tests `royalties-credit.test.ts`, 20; client tests
  `bboard-cli/src/royalties-credit.test.ts`, 14, including issuing without the key, on the
  wrong offer, twice, by a licensee, skipping ancestors' shares, with a replaced key). **Not
  yet reviewed by a separate agent;** the next review pass should start here.

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
- **Round 7 (a fresh review of the whole):** 3 medium. Anyone could still void every
  settlement and presentation in flight every 10 minutes by revoking a licence of their own
  offer and sealing (now at most once an hour, and the client proves a voided one again
  once; "nobody can void proofs in flight at will" was wrong and is corrected above). The
  top-up request handed the payer the private rate, which the contract no longer needed
  (top-ups no longer open the rate; payers get a card without it). Two runs on one computer
  could erase each other's licences and top-up codes (writes now merge with the store).
  4 low: a post that timed out invited a duplicate offer (refused unless asked); a
  revocable licence can lose its 30 days to settle, and a tiny payment to an ancestor is
  refused, not paid nothing (docs corrected); lowering a link's share could make a
  descendant's offer unsellable (the parent is warned first); the rounded top-up time uses
  the payer's clock (documented). A verification pass of these fixes found 3 more low ones:
  the hour was counted from the seal's bound, up to 300 s ahead of its block, so a revocation
  could wait about 65 minutes (now counted from the bound less 300 s); the relax warning left
  out closed and ended offers that still take split top-ups (now listed); the re-prove looked
  only at midnight-js's on-chain failure (now also the contract's refusal anywhere in a
  wrapped error, and the unverified part is said above). Regression tests: `royalties-hardening.test.ts` ("seals")
  and `royalties-attacks.test.ts` ("round 7").
