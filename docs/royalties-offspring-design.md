# Royalties on offspring ("descent links"): design

**Status: DESIGN DRAFT 3, 8 October 2026. Not built.** Extends the royalties contract
(`contract/src/veilcore-royalties.compact`, test networks only) to protocol version 3.
The live mainnet contracts are not changed. Drafts 1 and 2 were attacked by a separate AI
review agent; what each round found and why the design changed are at the end.

## The problem

A breeder licenses a variety. The licensee breeds a new variety from it and sells licences
and royalties of their own. Nothing on chain carries the original breeder's claim into the
new variety: an agreement binds the people who signed it, not the plant's descendants
(MPS-0037, "Heritable Rights for Self-Replicating Off-Chain Assets").

## What the real world does (research, 8 Oct 2026)

- **Plant variety law (UPOV 1991).** An ordinary cross owes the parent's breeder nothing
  (breeder's exemption). An *essentially derived variety* (usually a mutant, sport,
  gene-edited or heavily backcrossed line) needs the original breeder's permission, and
  the right reaches back to the root breeder (UPOV EXN/EDV/3, 2023).
- **Royalties on ordinary offspring come from contracts.** Iowa State's germplasm licences
  charge on varieties carrying at least 12.5% of the licensed germplasm, in proportion to
  its share: the rate halves with each outcross, about three generations deep.
- **Livestock** charges per offspring at registration: a calf from a "certificate sire" is
  not registered without the certificate the bull's owner sells.
- **On chain, Story Protocol** flattens obligations when a derivative is registered, so
  paying never walks the family tree.

In every working system, **the terms are agreed between parent and child at the moment of
derivation**, and the registration of the offspring is the enforcement point.

## What VeilCore already has

The live main contract records lineage between pseudonymous record identities, with both
sides' consent (propose and confirm), at most two parents, frozen once a record has
confirmed offspring. Names and genetics never reach the chain. Money does not follow it.

## The design

### 1. A descent link carries its own terms, agreed by both sides

In the royalties contract, the child's holder **proposes a link** to a parent record, with
the exact terms; the parent's holder **confirms** or ignores it. Nothing binds until
confirmed, and once confirmed the terms never change and the link is never removed.

| Term | Meaning |
|---|---|
| `fee` | A fixed amount per licence the child sells: the certificate. Paid to direct parents only. |
| `share` | Basis points of the child's licence price and royalty top-ups owed to this parent. |
| `generations` | How far the share follows the line: 1 to 3. |
| `until` | When the claim ends (as protection ends). |
| token | What the fee and share are paid in. Every offer the child posts must be in this token if the share is above zero. |
| payee | The wallet paid, and a separate payee key the parent alone may use to move it later. |

Because the child writes the terms and the parent accepts them, **neither side can change
them on the other afterwards.** A parent cannot hold a child up after the fact; a child
cannot pay in a token the parent never agreed to. The parent's leverage is the same as a
livestock registry's: it confirms the child in the main contract only once a link with
acceptable terms is in place.

### 2. A stack: the variety's ancestors, flattened once

When all its links are confirmed, the child's holder **finalises its stack**. The contract
builds it from links and stacks it already holds:

- each confirmed link of the child is a slot (generation 1);
- every slot in each parent's finalised stack comes along one generation further, if it
  has generations left. Through a two-parent cross its share **halves**; through a
  one-parent step (a sport or selection, no genetic dilution) it does not;
- a slot reached twice through the same link (siblings' children) is merged by adding.
  The same ancestor reached through different links is paid under each agreement, which
  adds up the way Iowa's coefficient-of-parentage rule does;
- at most **6** slots. Beyond that, the contract drops by a fixed rule (nearest
  generation first, then largest share) and records which were dropped. It never refuses;
- the total share is capped at **50%**, scaled down in proportion if exceeded.

A parent must have finalised its own stack first (a variety with no parents finalises an
empty one). Finalising is once and forever. Offers can only be posted from a record with a
finalised stack, and each offer keeps a snapshot.

### 3. Money split in the same transaction

- **Licence purchase** (public anyway): the buyer pays each direct link's fee, each slot's
  share of the price, and the remainder to the child. Ancestor amounts round up, the
  contract checks they never exceed the price, and a slot past its `until` is skipped.
- **Royalty top-ups.** If any slot takes a share, the offer's leaf says so and it must be
  topped up through `topUpSplit`, which names the offer and pays each slot its share.
  **That top-up shows which variety it is and how much.** Offers with no shares keep the
  private `topUp`, which proves the offer without naming it, exactly as now.
- **Settlement and presentations: unchanged.** The books stay private.

### 4. What clients check (ledger 8 cannot read the main contract)

1. **Links match the pedigree, now.** The parents linked to the offer's record must be,
   identity for identity, the parents the main contract confirms for that record today. A
   confirmed main-contract parent with no confirmed link (or the reverse) means refuse.
   Confirmed parentage only exists if the child proposed it, so nothing lands on a child
   that did not ask.
2. **For every ancestor in the stack, the same**, up to three generations.
3. **No finalising early.** The client refuses to finalise while a link or a main-contract
   parentage proposal is pending, and warns that it is final.
4. **Shown before paying:** every wallet that will be paid and how much, per token;
   "no declared pedigree"; parents whose records have no history.

Clients apply these at purchase, top-up and presentation. When ledger 9 brings calls
between contracts, rule 1 can move on chain.

## What it can and cannot do (say it plainly)

- **On chain, for declared descent:** the terms both sides signed are paid on every
  licence and every split top-up, automatically, and cannot be changed by either side.
  Nobody has to read anyone's books.
- **Not on chain: declaring.** A breeder can anchor a new variety with no parents, or
  confirm "sock" parents from records they control. Clients make that visible; DNA
  evidence catches the rest, as it does today (the ISF maize guidelines shift the burden
  of proof at 91% similarity).
- **Fees are per licence sold, not per grower.** A child that sells one big licence to a
  company that sublicenses off chain pays one fee. Units stay private, so this is the most
  a contract can do.
- **A parent that never finalises strands its children.** Its own licence terms should
  require it; a parent with a share has every reason to, since it is only paid when the
  child sells.
- **Privacy cost of shares:** split top-ups name the variety, and ancestors can total a
  descendant's top-ups. Fees and price shares cost nothing extra.
- **Contract terms, not law.** Paying intermediate breeders and charging on ordinary
  crosses are what the parties agreed, not an essentially-derived-variety ruling. A claim
  outlasting a US patent may be unenforceable (Brulotte; Kimble v. Marvel); clients warn.
- **Key theft and recovery.** Links and stacks belong to record commitments. After a
  recovery, the owner's new record links and finalises again; a stack a thief set on a
  dead record is never used, because rule 1 checks the live record.

## Why the design changed

**Draft 1** (shares on offers, stack flattened at posting) had a hole: a middle generation
without a claim of its own erased the grandparent's; claims died with offers; the child
controlled the money being split (price 1, a token of its own); and "cannot be skipped"
was overclaimed.

**Draft 2** (one claim per record, stack per record) fixed those, but opened three
serious holes, all from the same cause: the terms lived with the parent, separately from
the link, so a child could set an empty stack before its parent confirmed; a parent could
attach punishing terms after confirming; and a child could escape shares by choosing
another token. Rotation also gave each parent a fresh claim per key.

**Draft 3** puts the terms in the link itself, proposed by the child and accepted by the
parent, which is how livestock certificates and germplasm licences already work. That
removes all three holes at the root, and makes the client rule a plain equality check.

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
