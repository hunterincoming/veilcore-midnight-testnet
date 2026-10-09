# Royalties on offspring ("descent links"): design, as built

**Status: BUILT on the test-network royalties contract, protocol 3; in protocol 4 (9
October 2026) dues are recorded, exactly, for payments made off chain, and no circuit pays
anyone. Not deployed anywhere.**
Contract: `contract/src/veilcore-royalties.compact`. Client: `api/src/royalties-api.ts`. Menu
options 69 to 76, 81 and 85 (73 also shows what a variety owes). Tests:
`contract/src/test/royalties-descent.test.ts` (22, including the chunked-issuance case) and `royalties-credit.test.ts` (the
recorded dues), `royalties-hardening.test.ts`, the client end to end in
`bboard-cli/src/royalties-journey.test.ts` and `royalties-credit.test.ts`, and each attack
on the client in `bboard-cli/src/royalties-attacks.test.ts`. The live mainnet contracts are
not changed.

## In one paragraph

A new variety's breeder and the breeder of the variety it was bred from agree terms (a
share and a fee) on chain, once, and the new variety's pedigree chart is fixed. From then on,
whenever the new variety's breeder issues a licence or royalty credit for a payment made off
chain, the contract writes down, in the same transaction, exactly what each ancestor is owed
from it. It cannot be skipped, changed or left out. The contract cannot make anyone pay that
debt, because it never sees the money; it makes sure both sides work from the same record.
No circuit pays an ancestor: version 3's split payments were cut with every other payment
(see `docs/royalties-design.md`, "Why no circuit can move money").

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
removed. The parent's separate payee key can LOWER the terms (a smaller share or fee, an
earlier end: a protection that ended, a dispute settled), never raise them, and at most
once in 30 days (menu 81). Since what is owed is recorded exactly, not paid, no share is
too small to record: lowering never stalls a descendant's offers.

| Term | Meaning |
|---|---|
| fee | A fixed amount per licence the new variety issues, owed to direct parents only. The livestock certificate. |
| share | Basis points of the new variety's licence list prices and royalty credit, at most 50%. |
| generations | How far the share follows: 1 to 3. |
| until | When the link ends. Ended links are owed nothing, and no longer count toward the cap or the unit rule. An offer posted while a share still ran keeps issuing its credit in the open (naming itself); a new offer posted after it ended does not. |
| unit | What the fee and share are counted in (text, as an offer's unit: "USD cents"). Owed only on the descendant's offers counted in the same unit. |
| payee | The key that may lower the terms. |

The parent writes the terms (menu 69 makes a terms card, optionally naming the child's
record, so no other record can use it); the child proposes exactly those (70), after its
client shows the parent's record, the unit and what the parent's own chart passes down,
and refuses a card whose parent is not the one the child proposed in the main contract;
the parent's client confirms only terms it made (71). The child's client also refuses a
card whose parent record is no longer its identity's current record (after a key change or
a recovery from theft, whoever holds the old secret could still confirm, and be owed).

**2. A pedigree chart, flattened once.** When its links are confirmed, the child makes
its ancestors final (72), once and forever. The contract builds the chart from data it
holds: 14 fixed places, like a paper pedigree chart: 2 parents, 4 grandparents, 8
great-grandparents. Each grandparent and great-grandparent place is copied from the
parent's own chart, and only while its link still runs that many generations. A share is
owed in full to a parent, half to a grandparent and a quarter to a great-grandparent (the
Iowa halving rule), kept exactly as a weight in 40,000ths (quarter basis points). Nothing is merged or dropped; the chart cannot
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
- **All shares in one unit**, also checked when each link is confirmed. Two ancestors
  asking for shares in different units are refused up front, not discovered later.
- A record that replaced an earlier one (a key change in the main contract) can take
  over its chart unchanged (75); clients accept this only for one identity.

**3. What is owed is recorded in the same transaction, exactly.**

- **Licence issued:** the breeder's `issueLicense` writes an entry into `owed`, under the
  licence key: the offer's list price (`total`), each chart place's weight, and each parent's
  fee. Nothing is rounded on chain: what a place is owed is total x weight / 40,000, and a
  reader adds up the entries before dividing, once. Nothing is written for a variety whose
  ancestors take nothing.
- **Royalty credit issued:** an offer whose ancestors take a royalty share must take
  royalties, and its credit is issued through `issueCreditSplit`, which writes the amount and
  the weights into `owed`, under the credit note. **That issuance names the offer: anyone can
  see which variety it is for and how much.** Offers whose ancestors take no royalty share
  keep the private issuance. The offer's leaf records which kind it is, so the private path
  cannot be used to skip the record.
- **Exact, so issuing in pieces changes nothing.** An earlier build recorded each share
  rounded down, so 100 issuances of 19 at 10% recorded 100 instead of 190. Keeping the amount
  and the weight, and dividing once when reading, records 1,900 x 10% = 190 however it is cut
  up (descent test "chunked").
- **Reading it:** each entry names the descendant's record and offer, so a parent (menu 85),
  the descendant (73) or anyone adds up what is owed to each ancestor. 85 matches the
  ancestor by identity through the main contract, so links made by an earlier record of the
  same identity (before a key change) are counted. The contract never removes an entry.

**Settlement and presentations: unchanged.** The books stay private.

## What clients check

Ledger 8 has no calls between contracts, so the royalties contract cannot see the main
contract's pedigree. Clients check it when a licence is asked for, show it to the breeder
before issuing, and show it in a verifier's check:

1. **A parent a chart names that the main contract does not confirm is shown as a
   warning** (with what it takes). It is owed a share of this variety's price, plus its
   fee, which the breeder sees before issuing. It is not refused: a confirmed link can never
   be dropped, so refusing would strand the variety for good, and nobody else is harmed.
2. **A confirmed parent left out of the chart is refused if the two agreed terms here**
   (the child chose to leave out a confirmed link). A parent that never set terms, or
   never uses this contract, is shown as "takes nothing here", not refused, so one absent
   ancestor cannot strand every descendant.
3. The same for every ancestor in the chart, three generations up.
4. A warning when a parent record is no longer its identity's current record: stronger
   when it was recovered from theft (its link may have been made by the thief). An offer
   whose OWN record was recovered from theft is refused when a licence is asked for and in a
   verifier's check (the offer may be the thief's).
5. Before issuing a licence or credit, the breeder sees every place in the chart: who,
   what share, what fee, until when, and what it will record as owed.

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

- **On chain, for declared descent:** the terms both sides confirmed are recorded as owed on
  every licence and every credit the descendant issues, exactly. Neither side can change
  them, and nobody has to read anyone's books.
- **Not on chain: paying what is owed.** The money moves off chain, so the contract cannot
  make the descendant pay its ancestors; it makes the debt a fact both sides can read and
  neither can dispute or erase, entry by entry. Collecting it is the parties' business, under
  their terms, as with any invoice. **The ancestors' guarantee is this public `owed` record,
  plus the per-licence fee as their floor.**
- **Credit the descendant under-issues:** if it issues a licensee less credit than it was
  paid, the shares recorded are smaller, but the licensee cannot settle as many units, so a
  presentation of its real units fails. A descendant and licensee who collude to declare
  fewer units lower what the ancestors are owed, as they would lower what the breeder is
  paid.
- **The list price and the royalty rate are the descendant's own numbers.** A licence listed
  at 10 records 1 owed at 10%, whatever was charged for it on the side; a low rate needs less
  credit per unit settled, and less credit records less owed. **The fee per licence is the
  only real floor** an ancestor can rely on; the shares are as honest as the descendant's
  numbers, and an ancestor who doubts them needs an audit right in the agreement.
- **Not on chain: declaring.** A breeder can anchor a new variety with no parents, or
  confirm "sock" parents from records they control (which also takes the two parent
  places, and the 50%). Clients show the pedigree; DNA evidence catches the rest, as it
  does today (the ISF maize guidelines shift the burden of proof at 91% similarity).
- **A parent that confirms parentage without terms gets nothing.** Parents should confirm
  the main-contract parentage only after the link is confirmed.
- **Fees are per licence issued, not per grower.** A breeder that issues one big licence to a
  company that sublicenses off chain pays one fee.
- **Privacy cost of royalty shares:** credit on such a variety names the variety and the
  amount, and anyone can add up a descendant's royalty credit. Fees and price shares cost
  nothing extra (a licence key and its offer are public anyway).
- **Contract terms, not law.** Paying intermediate breeders and charging on ordinary
  crosses are what the parties agreed, not an essentially-derived-variety ruling. A claim
  outlasting a US patent may be unenforceable (Brulotte; Kimble v. Marvel).
- **Key theft.** A thief holding a parent's key during the theft window could confirm
  links with their own payee key, and be owed; clients warn about links from records later recovered from
  theft, but the contract cannot undo them, just as the main contract cannot undo
  parentage a thief confirmed.
- **A link confirmed by mistake is permanent for that record.** If a child proposed on a
  card from the wrong party and it was confirmed, the way out is a key change in the main
  contract: the new record has no links and links afresh (its offers are new offers).
- **Not yet run on a real network.** Issuing with a full 14-place chart has run only on the
  simulator.

## Next (not built)

- **Payment through a contract.** Paying each ancestor its share in the same transaction,
  as version 3 did, needs a circuit that moves tokens, and there is no stablecoin on
  Midnight yet. It returns, if the founders want it, in a later contract version deployed as
  a new version once a stablecoin exists, not by changing this one. Until then the record
  above is what an ancestor has.

## Circuit sizes (rows, measured with `zkir mock-compile` from compiler 0.31.1 on 9 Oct 2026, after the cut; the limit is 2^17 = 131,072)

issueLicense 17,293 · issueCreditSplit 25,269 · settle 102,651 (78%) · confirmLink 24,474 ·
postOffer 40,119 · finaliseStack 8,972 · proposeLink 9,278 · withdrawLink 8,552 · adoptStack
4,611 · relaxLink 4,954.

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
- **Protocol 4, hostile review (9 October 2026):** issuing credit for a descendant in many
  small pieces lost the ancestors' share to rounding (100 x 19 at 10% recorded 100, not 190;
  now exact, with the amount kept in each entry); the docs implied the list price and rate
  protect the ancestors (now said plainly: the fee is the only floor); 85 missed what was owed
  to an earlier record of the same identity (now matched through the main contract). On-chain
  payment, split payments and `movePayee` were cut from the contract.
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
