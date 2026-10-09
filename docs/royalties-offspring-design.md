# Royalties on offspring ("descent links"): design, as built

**Status: BUILT on the test-network royalties contract, protocol 3, 8 October 2026. Not
deployed anywhere.** Contract: `contract/src/veilcore-royalties.compact`. Client:
`api/src/royalties-api.ts`. Menu options 69 to 76 and 81. Tests:
`contract/src/test/royalties-descent.test.ts` (22), `royalties-hardening.test.ts`, the client
end to end in `bboard-cli/src/royalties-journey.test.ts`, and each attack on the client in
`bboard-cli/src/royalties-attacks.test.ts`. The live mainnet contracts are not changed.

The design was attacked three times before any code, and the built code twice more, all
by separate AI review agents (not a human or an outside audit). What each round found is
at the end.

## The problem

A breeder licenses a variety. The licensee breeds a new variety from it and sells
licences and royalties of their own. Nothing on chain carried the original breeder's
claim into the new variety: an agreement binds the people who signed it, not the plant's
descendants (MPS-0037, "Heritable Rights for Self-Replicating Off-Chain Assets").

## What the real world does (research, 8 Oct 2026)

- **Plant variety law (UPOV 1991).** An ordinary cross owes the parent's breeder nothing
  (breeder's exemption). An *essentially derived variety* (usually a mutant, sport,
  gene-edited or heavily backcrossed line) needs the original breeder's permission, and
  the right reaches back to the root breeder (UPOV EXN/EDV/3, 2023).
- **Royalties on ordinary offspring come from contracts.** Iowa State's germplasm licences
  charge on varieties carrying at least 12.5% of the licensed germplasm, in proportion:
  the rate halves with each outcross, about three generations deep.
- **Livestock** charges per offspring at registration: a calf from a "certificate sire" is
  not registered without the certificate the bull's owner sells.
- **On chain, Story Protocol** flattens obligations when a derivative is registered, so
  paying never walks the family tree.

The licensor sets terms at licensing; the offspring's registration is where they are
enforced. That is what this copies.

## How it works

**1. A descent link carries its own terms.** The new variety's breeder proposes a link to
a parent record, with exact terms; the parent's holder confirms those exact terms (the
confirmation names a hash of every term, so a link changed in between is refused).
Nothing binds until confirmed. Once confirmed, the child can change nothing and nothing is
removed. The parent's separate payee key can move where it is paid, or LOWER the terms (a
smaller share or fee, an earlier end: a protection that ended, a dispute settled), never
raise them, and at most once in 30 days, so it cannot stall the child's sales at will.
Lowering a share to a tiny one that is not zero can still stall a descendant's offer: every
share must come to at least one unit of a payment, so at 0.05% an offer priced under 2,000
units (4,000 for a grandparent's place, 8,000 for a great-grandparent's) can no longer be
sold, and its breeder must post a new one at a higher price. The parent's client lists every
open offer that would break and asks first (menu 81); zero is always safe.

| Term | Meaning |
|---|---|
| fee | A fixed amount per licence the new variety sells, paid to direct parents only. The livestock certificate. |
| share | Basis points of the new variety's licence prices and royalty top-ups, at most 50%. |
| generations | How far the share follows: 1 to 3. |
| until | When the link ends. Ended links pay nothing, and no longer count toward the cap, the token rule or the split. An offer posted while a share still ran keeps naming itself on top-ups; a new offer posted after it ended does not. |
| token | What the fee and share are paid in. |
| payee | The wallet, and the key that may move it. |

The parent writes the terms (menu 69 makes a terms card, optionally naming the child's
record, so no other record can use it); the child proposes exactly those (70), after its
client shows the parent's record, the token and what the parent's own chart passes down,
and refuses a card whose parent is not the one the child proposed in the main contract;
the parent's client confirms only terms it made (71). The child's client also refuses a
card whose parent record is no longer its identity's current record (after a key change or
a recovery from theft, whoever holds the old secret could still confirm, and be paid).

**2. A pedigree chart, flattened once.** When its links are confirmed, the child makes
its ancestors final (72), once and forever. The contract builds the chart from data it
holds: 14 fixed places, like a paper pedigree chart: 2 parents, 4 grandparents, 8
great-grandparents. Each grandparent and great-grandparent place is copied from the
parent's own chart, and only while its link still runs that many generations. A share is
paid in full to a parent, half to a grandparent and a quarter to a great-grandparent,
rounded down (the Iowa halving rule). Nothing is merged or dropped; the chart cannot
overflow because each record has at most two parents.

Rules the contract enforces:

- A parent must have finalised its own ancestors before confirming a child, so the child
  sees everything it takes on, and the parent has no later step to withhold.
- No link can be proposed or confirmed once the child is final, and the child cannot
  finalise while a link is still waiting. Finalising must name EVERY confirmed link: a
  parent's agreed terms cannot be left out. A record that has links cannot take over another
  record's chart instead.
- At most two confirmed parents.
- **All shares together at most 50%**, checked when each link is confirmed, counting what
  the parent's chart passes down. Whoever confirms second sees the whole picture.
- **All shares in one token**, also checked when each link is confirmed. Two ancestors
  asking for shares in different tokens are refused up front, not discovered later.
- A record that replaced an earlier one (a key change in the main contract) can take
  over its chart unchanged (75); clients accept this only for one identity.

**3. Money split in the same transaction.**

- **Licence purchase:** the buyer pays each share of the price and each parent's fee; the
  rest goes to the new variety's breeder. All in one call; the contract holds nothing.
- **Royalty top-ups:** an offer whose ancestors take a royalty share must take royalties
  through the contract, and is topped up through `topUpSplit`, which pays each share.
  **That top-up names the offer: anyone can see which variety it is for and how much.**
  Offers whose ancestors take no royalty share keep the private top-up. The offer's leaf
  records which kind it is, so the private path cannot be used to skip a split.
- **Settlement and presentations: unchanged.** The books stay private.

## What clients check

Ledger 8 has no calls between contracts, so the royalties contract cannot see the main
contract's pedigree. Clients check it at purchase and top-up, and show it in a verifier's
check:

1. **A parent a chart names that the main contract does not confirm is shown as a
   warning** (with what it takes). It is paid out of this variety's price, plus its fee on
   top, which the buyer sees before paying. It is not refused: a confirmed link can never
   be dropped, so refusing would strand the variety for good, and nobody else is harmed.
2. **A confirmed parent left out of the chart is refused if the two agreed terms here**
   (the child chose to leave out a confirmed link). A parent that never set terms, or
   never uses this contract, is shown as "takes nothing here", not refused, so one absent
   ancestor cannot strand every descendant.
3. The same for every ancestor in the chart, three generations up.
4. A warning when a parent record is no longer its identity's current record: stronger
   when it was recovered from theft (its link may have been made by the thief). An offer
   whose OWN record was recovered from theft is refused at top-ups and in a verifier's check
   (the offer may be the thief's).
5. Before paying, the buyer or payer sees every place in the chart: who, what share,
   what fee, until when.
6. A payment within ten minutes of a link's end date is refused, since block time and
   the client's clock could disagree.

The child's own client shows the chart before making its ancestors final (72), and
refuses while a parentage proposal is waiting in the main contract. It stops, and asks the
child to type FINAL, when a confirmed link's parent is not a parent the main contract
confirms (a parent can confirm the link and then never confirm the parentage: refusing
outright would let it hold the child up forever) or was since recovered from theft. A
main-contract parent that set no terms is left out with a warning (it takes nothing). If a
parent agreed terms with an earlier record of the same identity, it refuses and points to
taking over that record's chart. Posting refuses to lock in an empty chart in that case.
A parent confirming parentage in the main contract (menu 17) is warned when no terms are
agreed with that child here, when the child's chart leaves them out, or when this run has
not joined the royalties contract to check.

## What it can and cannot do (say it plainly)

- **On chain, for declared descent:** the terms both sides confirmed are paid on every
  licence and every split top-up, automatically. Neither side can change them, and nobody
  has to read anyone's books.
- **The child sets the price and the royalty rate.** A low price or a low rate lowers
  every share. The fee per licence is the floor an ancestor can rely on. Shares round down,
  and a payment too small for every running share to come to at least one unit is refused:
  at 10%, a purchase or split top-up under 10 units (under 20 with a grandparent at 10%, under
  40 with a great-grandparent). Nothing is ever paid with an ancestor's share silently zero.
- **Not on chain: declaring.** A breeder can anchor a new variety with no parents, or
  confirm "sock" parents from records they control (which also takes the two parent
  places, and the 50%). Clients show the pedigree; DNA evidence catches the rest, as it
  does today (the ISF maize guidelines shift the burden of proof at 91% similarity).
- **A parent that confirms parentage without terms gets nothing.** Parents should confirm
  the main-contract parentage only after the link is confirmed.
- **Fees are per licence sold, not per grower.** A breeder that sells one big licence to a
  company that sublicenses off chain pays one fee.
- **Privacy cost of royalty shares:** split top-ups name the variety, and ancestors can
  add up a descendant's top-ups. Fees and price shares cost nothing extra.
- **Contract terms, not law.** Paying intermediate breeders and charging on ordinary
  crosses are what the parties agreed, not an essentially-derived-variety ruling. A claim
  outlasting a US patent may be unenforceable (Brulotte; Kimble v. Marvel).
- **Key theft.** A thief holding a parent's key during the theft window could confirm
  links with their own payee; clients warn about links from records later recovered from
  theft, but the contract cannot undo them, just as the main contract cannot undo
  parentage a thief confirmed.
- **A link confirmed by mistake is permanent for that record.** If a child proposed on a
  card from the wrong party and it was confirmed, the way out is a key change in the main
  contract: the new record has no links and links afresh (its offers are new offers).
- **Not yet run on a real network.** A purchase with a full chart makes up to 17 payments
  in one transaction (one to each of the 14 places, the rest to the breeder, and the two
  parents' fees); that has run only on the simulator.

## Circuit sizes (rows, measured with `zkir mock-compile` from compiler 0.31.1 on 8 Oct 2026; the limit is 2^17 = 131,072)

buyLicense 38,905 · topUpSplit 28,516 · topUp 22,118 · settle 102,942 (79%) · confirmLink
27,033 · postOffer 35,039 · finaliseStack 9,374 · proposeLink 9,557 · movePayee 4,964 ·
relaxLink 4,956.

## Review rounds

- **Design draft 1** (shares on offers): a middle generation without terms erased the
  grandparent's claim; claims died with offers; the child controlled the money being
  split; "cannot be skipped" overclaimed.
- **Design draft 2** (one claim per record): the child could finalise an empty chart
  before its parent confirmed; a parent could attach punishing terms after confirming;
  another token escaped every share.
- **Design draft 3** (terms in the link): parents could still hold children up three
  ways; links could be added after finalising; a sock parent could dilute the real one
  through proportional scaling; a thief could keep confirming on a dead record; the token
  escape survived one generation down. Fixed in the build: parent final before confirming,
  nothing after the child is final, a hard 50% check instead of scaling, the fixed
  14-place chart (nothing dropped), the client theft warning.
- **The built code**: no way found to forge or steal a payment. Fixed after it: shares in
  two tokens could lock a child out (now refused at confirm); a zero royalty rate dodged
  royalty shares (now refused); one absent ancestor stranded every descendant (now "takes
  nothing", refused only for a parent with agreed terms); posting too early could lock in
  an empty chart (client refuses); rounding up could break the 50% cap (now rounds down);
  confirmation now binds a hash of the exact terms; ended links no longer count; a margin
  near end dates.
- **Round 5 (four attackers at once, see `docs/royalties-design.md`):** a child could
  finalise leaving out a confirmed link (now refused on chain); a parent's payee key could
  stall a child's sales by moving at will (now once in 30 days; terms can only be lowered);
  a terms card naming a stranger as parent was never shown (now shown, checked against the
  main contract's parent proposal, and a card can name its child); a split too small to pay
  each ancestor at least one unit was silently zero for them (refused); the buyer was told
  the price but the parent's fee is paid on top (the total per token is now shown).
- **Round 7 (see `docs/royalties-design.md`):** the docs said a tiny payment pays an
  ancestor nothing, but the contract refuses it (corrected); a full chart's purchase makes
  17 payments, not 16; lowering a share to a tiny one could stall a descendant's offers (the
  parent's client now warns and asks first); top-ups no longer need the rate.
- **Round 5, checking the fixes:** a thief holding a parent's OLD record (after the owner
  recovered it) could still write terms and confirm, and be paid forever (the child's
  client now refuses a parent record that is not its identity's current one); a parent
  could confirm the link but never the parentage and so stop the child ever finalising
  (now a typed FINAL, not a refusal); the warnings about a non-parent or a stolen record
  came only after the buyer said yes (now shown, with their own yes, before).

## Sources

- UPOV EXN/EDV/3 (2023): https://www.acc.upov.int/edocs/mdocs/upov/en/c_56/upov_exn_edv_3_draft_3.pdf
- UPOV exceptions: https://www.upov.int/overview/en/exceptions.html
- ISF EDV guidelines for maize (2014): https://betterseed.org/wp-content/uploads/ISF_Guidelines_Disputes_EDV_Maize_2014-1.pdf
- Iowa State soybean germplasm licence: https://www.cad.iastate.edu/files/inline-files/Soy%20RD%20COMPANY%20MTA%20Non%20AFA%202015.pdf
- Iowa State corn commercialization agreement: https://www.cad.iastate.edu/files/inline-files/2015%20ISURF%20CORN%20COMMERCIALIZATION%20AGREEMENT%20jjgm.pdf
- J.E.M. v Pioneer (2001): https://fedcircuitblog.com/supreme-court/cases/j-e-m-ag-supply-inc-v-pioneer-hi-bred-international-inc/
- Canadian Livestock Records, AI rules: https://www.clrc.ca/sites/default/files/associations/regapp/15airules.pdf
- ABS Global germplasm terms: https://www.absglobal.com/?p=1255
- Story Protocol LAP: https://docs.story.foundation/docs/liquid-absolute-percentage
- ERC-4910: https://eips.ethereum.org/EIPS/eip-4910
- Midnight tokens overview: https://docs.midnight.network/tokens/overview
- USDM on Midnight: https://moneta.global/midnight/
