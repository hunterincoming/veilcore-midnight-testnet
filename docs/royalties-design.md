# Royalties contract: design, sources and limits

**Status: DRAFT, 8 October 2026. Not deployed anywhere.** Contract:
`contract/src/veilcore-royalties.compact`. Tests: `contract/src/test/royalties.test.ts`.
The two live mainnet contracts are not changed by any of this.

Roadmap stage 2: breeders sell licences on chain, and royalties are paid on chain.

## What it does, in one paragraph

A breeder posts an **offer** against one of their records: a fingerprint of the licence
terms, a price, a royalty per unit, the token both are paid in, the wallet that gets paid,
how many licences are for sale, the date the licences end, and whether the breeder may revoke
them. A grower **buys**: in one transaction the price goes to the breeder's wallet and the
licence is issued to the grower. Nobody approves a sale by hand. **Royalties** are paid per
unit (a tonne, a plant, a straw of semen: the terms say which) by anyone: the grower, or a
grain buyer, lab or registry paying for them. The payment goes straight to the breeder's
wallet and records a receipt only the grower can later point to. A grower then **proves** to a
buyer or regulator that they hold a live licence and, if asked, that royalties are paid for a
given period for at least a given amount, without saying which licence or which payment.

## Circuits

| Circuit | Who | What it does |
|---|---|---|
| `postOffer` | record holder | Posts an offer, run from then on by an admin key it names. |
| `closeOffer` | offer admin | Stops new sales. Sold licences and royalties carry on. |
| `changeOfferAdmin` | offer admin | Hands the offer to a new admin key. |
| `buyLicense` | anyone | Pays the price to the breeder and issues the licence, in one call. |
| `payRoyalty` | anyone | Pays units × rate to the breeder; records the licensee's receipt. |
| `proveLicense` | licensee | Proves a licence live at a time the verifier names, and optionally "paid for period P, at least N units". |
| `revokeLicense` | offer admin | Revokes a sold licence, only if the offer said revocable. |
| `clearEnded` | anyone | Clears an ended licence so it stops holding a tree slot. |
| `removeEnded` | anyone | Removes an ended offer once its licences are cleared. |
| `sealRevocations` | anyone | Retires old licence roots so revoked licences stop proving. Rate-limited. Receipt roots at most daily. |

Largest circuit: `proveLicense`, 2^16 rows. The live contract's limit for anything a holder
proves is 2^17. Proving time on a laptop is still to be measured.

## Decisions, and where they come from

Research on 8 October 2026 looked at four areas: how seed and animal royalties are collected
today; on-chain licensing projects; the academic papers; and Midnight's own code. Every
decision below traces to one of them.

1. **A licence check can also prove royalties are paid.** NFT royalties (EIP-2981) failed
   because a token stayed valid whether or not anyone paid. OpenSea made royalties optional in
   2023 ([OpenSea](https://opensea.io/blog/articles/on-creator-fees),
   [EIP-2981](https://eips.ethereum.org/EIPS/eip-2981)). Here a buyer, processor or regulator
   can ask for "paid for this period, at least this many units" before dealing with a grower.
   This is the same check as Germany's harvest certificate and Argentina's Sembrá Evolución
   pre-certification, but without sending farm data to a collector. Farmers resist that most
   ([top agrar](https://www.topagrar.com/betriebsleitung/news/arger-um-die-erntegut-bescheinigung-landwirte-sauer-auf-stv-20014683.html),
   [Bichos de Campo](https://bichosdecampo.com/que-es-sembra-evolucion-las-principales-semilleras-controlaran-ogm-en-soja-desde-2023-y-un-ano-mas-tarde-detectarian-tambien-todas-las-variedades-sembradas)).
2. **Anyone can pay on the licensee's behalf.** Australia's End Point Royalties are collected
   best when the grain buyer deducts at delivery. Compliance is below 75% where growers
   self-declare, and below 50% in some regions
   ([Stock Journal](https://www.stockjournal.com.au/story/8586430/grain-producers-sa-crop-breeders-raise-end-point-royalty-concerns/),
   [AGT](https://agtbreeding.com.au/sourcing-seed/pbr-and-epr)). The licensee hands the payer a
   receipt hash; the payer learns nothing else.
3. **A flat royalty per unit, set by the breeder, public.** Same model as EPR (per tonne) and the UK
   Limousin semen royalties, which are charged at calf registration
   ([Limousin](https://limousin.co.uk/the-breed/semen-royalty-scheme/explanation/)). A percentage
   of sale price would make growers reveal their prices.
4. **An end date, and no collecting after it.** Royalties collected after patents expired are
   what lost Bayer the Intacta case in Mato Grosso
   ([Cultivar](https://revistacultivar.com.br/noticias/tribunal-de-mato-grosso-confirma-sentenca-sobre-cobranca-de-royalties-da-soja-intacta)).
   No sale, royalty or presentation after the offer's end date. Payment by the end date also
   avoids bills arriving years late, a complaint about EPR.
5. **Whether a licence can be revoked is declared before anyone buys** (EIP-5484
   [link](https://eips.ethereum.org/EIPS/eip-5484); EIP-5218 named revoker
   [link](https://eips.ethereum.org/EIPS/eip-5218)). Revocation and seals work exactly as in the
   live contract. This is the zk-creds pattern: Merkle leaves, with old roots retired
   ([eprint 2022/878](https://eprint.iacr.org/2022/878)).
6. **Licences are not tradable.** Tradable royalty rights pulled music-royalty and IP-token
   projects into securities trouble. Molecule deliberately keeps revenue rights off its tokens
   ([Molecule](https://molecule.xyz/blog/ipts-a-gain-of-function)). A licence here is a
   commitment to the holder's own secret.
7. **The contract holds nothing.** Every payment is received and sent on in the same call,
   which Midnight's deployment rubric scores as the lowest risk. OpenZeppelin's
   `ForwarderUnshielded` for Compact uses the same pattern. The ledger accepts it with no
   balance held beforehand (midnight-ledger `semantics.rs`), and the bug that once broke it
   was fixed in toolchain 0.30.0 (Compact issue #151).
8. **Any token.** No stablecoin is on Midnight mainnet yet. USDCx is live on Cardano only, from
   27 February 2026 ([Midnight blog](https://midnight.network/blog/consensus-hk-2026-recap)).
   Each offer names its token, so NIGHT works today and a stablecoin needs no rebuild.
9. **No fee.** We stay the layer, not the marketplace. If VeilCore ever charges, a flat fee on
   the sale is simpler to explain than skimming royalties. That is a decision for both founders.
10. **The contract binds each receipt to the offer and units actually paid.** The licensee
    hands the payer only `receiptCommit(secret, period)`. The leaf the contract stores also
    covers the offer and units, so nobody can pay for 1 unit and prove 1,000,000, or pay
    through their own offer.
11. **An offer is run by its own admin key, not the record secret.** If a record secret leaks,
    or is rotated in the live contract, whoever holds it cannot close or revoke anything.
12. **Presentations publish the verifier's time, not the licence's end date,** plus a holder
    tag that repeats only within the verifier's own scope. So one licence cannot quietly
    vouch for many growers to the same verifier.
13. **The receipt commits to the units.** That lets stage 3 (genetics as collateral) prove
    royalty totals later. BBA+ is the reference for private running totals
    ([KIT](https://publikationen.bibliothek.kit.edu/1000077889)).

## Limits of version 1 (say these plainly)

- **Clients must not prove right after their own purchase or payment.** The roots a
  presentation proves against are public. If nobody else touched the tree in between, the
  root is the one your own purchase or payment created, and that names it. Our SDK will wait
  until other insertions have landed. On a quiet contract that can take a while.
- **Losing the offer admin key is permanent.** Whoever holds it can revoke licences (if the
  offer is revocable) and close the offer. They cannot change where money goes. Keep it like
  the maintenance key, on paper. A recovery key per offer can come later.
- **Royalties stop at the end date.** The last period must be paid before it, and a
  paid-up proof stops working at it. Audits after the end happen off chain.
- **State grows with use.** Every sale, payment and offer adds an entry, and each one costs
  its sender a transaction. Ended licences and ended offers can be cleared by anyone. The
  sets that stop repeat purchases and payments are never pruned. That is the same class as
  the live contract's anchors. A full bound table belongs in the deployment record.

- **Payments are public:** amount, units, offer, the paying wallet, the breeder's wallet. The
  licence terms, the licence and which licensee a receipt belongs to are not. A payer who
  reuses a wallet links their own payments, so fresh wallets are advised. An offer with three
  licensees hides a licensee among three, no more. The price paid can identify the offer
  (Mohammadi and Bafghi, [arXiv 1408.6970](https://arxiv.org/abs/1408.6970)). Private
  payments need Midnight's shielded path (Zswap), which is clumsy in contracts today.
- **Units are declared by whoever pays.** The contract cannot see a harvest. Checking units
  against deliveries, DNA tests or audits happens off chain, as it does everywhere today. Terms
  should include an audit right.
- **The record is checked off chain.** Midnight mainnet has no calls between contracts until
  ledger 9, which has no mainnet date. The offer proves the poster held the record's secret.
  The rule our tools apply: an offer counts only if, when it was posted (block time from the
  indexer), its record was the live head of an anchored identity in the live contract, and
  that identity has not been recovered since. A recovery signals a stolen secret, so offers
  from before it must be reposted.
- **No refunds, partial payments, transfers or royalties on offspring.** Royalties up the
  family tree come later, on Story Protocol's model of paying direct parents only
  ([Story](https://docs.story.foundation/concepts/royalty-module/liquid-relative-percentage.md)).
- **No standard terms format yet.** Next: a fixed set of fields in the style of Story's PIL
  (commercial use, territory, unit, rate, derivatives, end date, legal text link). The offer
  stores only its fingerprint, and holders can later prove one field without showing the rest.

## Before mainnet

1. Independent attack passes. Two were run on 8 October (see "Reviews").
2. Proving keys generated and fingerprinted, as for the live contracts.
3. A preprod run with real wallets (`docs/royalties-preprod-run.md`). This confirms that Lace and the SDK wallet add the payer's
   input and the breeder's output automatically. That is confirmed in SDK code but not yet on
   a live network.
4. A lawyer on money transmission and royalty collection before real money moves through it.
5. A new deployment record for this contract. The filed record says no VeilCore circuit moves
   tokens, which stays true of the live contracts but not of this one.
6. Both founders sign off, as for the live contracts.

## Reviews

**Round 1 (8 Oct 2026), independent reviewer.** 1 blocker, 2 high, 3 medium, 3 low. Blocker:
a paid-up proof could claim more units than were paid, or count a payment made through the
licensee's own offer. High: a stolen or rotated record secret kept authority over offers;
receipt squatting by front-running. Medium: the published end date named the offer; trees
could be filled and ended licences held slots for ever; one licence could vouch for many
holders. All fixed. The seven attacks are now regression tests (`A1`–`A7` in the tests).

**Round 2 (8 Oct 2026), same reviewer, on the fixes.** Every fix holds. No blocker or high.
Fixed after it: clearing an ended licence no longer flags presentations as unsealed; a scope
is required; "live at" now means strictly before the end; ended offers can be removed.
Documented rather than fixed: proving right after your own transaction (client rule above),
admin key loss, state growth.

**Still to do:** a third pass after the SDK client exists, since the root-timing rule lives
there; and a paid outside audit before real money, as for the live contracts.
