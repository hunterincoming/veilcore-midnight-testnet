# The Correction Path

**What happens when a record is wrong · 10 August 2026**

Records are anchored, so they cannot be edited. A lab technician mistypes a cultivar
name at 8am and that record is permanent and wrong. Every real registry — CPVO, DOI,
livestock herd books — has amendment procedures. Ours has none.

This cannot be retrofitted. Once records exist, changing how correction works means
changing the meaning of records already issued.

---

## The rule

**Never rewrite. Supersede. And propagate at read time, not write time.**

A correction is a new anchored record that points at the one it supersedes, states what
changed and why, and carries a severity and an effective date. The original stays
retrievable forever.

That last part matters more than it looks: **the history of the correction is itself
evidence.** When the correction is the thing being disputed, you need both versions.

---

## Who can correct what

Each party can only correct what they asserted. This is not a permissions nicety — it
is what stops a correction being used as an attack.

| Party | Corrects | Mechanism |
|---|---|---|
| **The holder** | Their own record's contents — a typo, a wrong date, bad notes | Self-service supersession |
| **An attester** | Their own attestation, and nothing else | Retraction |
| **A third party** | Disputed parentage, a fraudulent claim | Challenge → resolution → supersession |

If a DNA lab retracts a report, the holder must not be able to suppress that. And the
lab must not be able to alter anything else about the record. Same record, two parties,
two separate correction rights.

---

## Severity decides whether descendants care

This is what keeps the mechanism usable.

**Cosmetic** — a misspelled name, corrected notes, a date typo. **Does not propagate.**
The physical material a descendant came from did not change.

**Material** — wrong parentage, a retracted DNA report, a fraudulent record.
**Propagates**, because a descendant's claim about where it came from is now different.

Without that split, every typo ripples through the whole graph and the flag becomes
noise nobody reads.

---

## Propagation happens at read time

**You do not push corrections down. You pull them up when someone asks.**

A descendant record is never modified — it is anchored, and it belongs to someone else.
What changes is what the graph *reports* when a lineage is resolved.

When anyone walks a lineage or requests a clean-descent proof, the resolution collects
supersession markers on every ancestor it passes. The answer comes back as *"an ancestor
of this record was materially corrected on this date"* — not as a modification to the
descendant.

**And this dissolves the privacy problem.** The only person who can see that an ancestor
was corrected is someone who already had the right to walk that lineage. Corrections
inherit the disclosure model rather than needing one of their own.

---

## Effective dates protect good faith

If someone licensed from a record that later turns out to be fraudulent, they should
not be wiped out for having acted honestly.

A supersession carries an **effective date**, and anything created before it is marked
*"created before correction"* rather than *"invalid."*

That is how legal systems already handle this — bona fide purchaser, and CPVR Article
98's five-year limit unless the holder knew they were not entitled. **We are copying a
rule tested for centuries rather than inventing one.**

---

## What it does to clean-descent proofs

A clean-descent proof asserts *not descended from anything encumbered.* A materially
corrected or retracted ancestor is a new kind of encumbrance.

Which means **a proof that was valid last year can be invalid today.** That is correct,
and it has one design consequence:

**Proofs are timestamped and re-provable, never permanent.** A buyer gets a proof as of
a date and re-runs it at the point of transfer. That is also how a title search works in
property — nobody treats a search from three years ago as current.

---

## What to build

**In the record format** — decide now, free, unretrofittable:

```
supersedes      recordId of the record being corrected
reason          free text, hashed like any other field
severity        cosmetic | material
effectiveAt     timestamp
correctedBy     holder | attester | challenge
```

**In the API** — small:

- `POST /records/:id/supersede` creating the correction record
- The lineage resolver collecting supersession markers when walking ancestry
- `verifyDescent` returning *"an ancestor was materially corrected"* as a distinct
  outcome from clean or encumbered

**In the app:**

- A correction action on the record detail page, holder-only
- The superseded record still viewable, marked as superseded, linking to its replacement
- Clean-descent results showing corrections as a third state rather than folding them
  into blocked

**Later, and needing more thought:**

- Third-party challenge and how it is resolved — who arbitrates, and on what basis
- Attester retraction, which needs attester identity to exist first

---

## The one-line version

> A correction is a new anchored record that supersedes an old one, carrying a reason, a
> severity and an effective date. Nothing is ever rewritten. Descendants are never
> modified — anyone resolving a lineage picks the correction up at read time, so it
> inherits our disclosure model instead of needing its own. Cosmetic corrections do not
> propagate; material ones do. Anything created before the effective date is marked as
> such rather than invalidated. And clean-descent proofs become point-in-time rather
> than permanent, which is how title searches already work.
