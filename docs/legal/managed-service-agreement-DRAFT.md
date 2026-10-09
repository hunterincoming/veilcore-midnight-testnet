# VeilCore-run Managed Service Agreement

> **DRAFT — must be reviewed by a lawyer before use; not legal advice.**
> Prepared as a starting point for a lawyer, 6 October 2026; revised the same day after an
> independent technical review. Nothing here has been checked against the law of any place.
> Blanks (`[ ]`) must be filled and every section reviewed before anyone signs it.
>
> **For the lawyer, beyond the text below:** (1) cannabis: some partners work with cannabis
> genetics; the service's lawfulness and the parties' exposure under US federal law, the law of each
> state involved, and the law of Japan and Switzerland (where the founders and partners may be)
> needs advice, including whether to exclude cannabis partners or particular places; (2) data
> protection: the audit log links a named partner to on-chain commitments, and staff can see
> instructions; whether that is personal data, where it may be kept, and what notices are needed;
> (3) insolvency: what happens to custody of partners' secrets if VeilCore becomes insolvent, and
> whether a trust, escrow or similar arrangement is needed so they are not treated as VeilCore's
> assets; (4) staff access and subcontractors; (5) insurance for a breach of the operations computer.

**Between:** VeilCore [legal entity name, address] ("VeilCore")
**and:** [Partner legal name, address] ("the Partner")
**Starting:** [date]

## 1. What this agreement covers

1.1 VeilCore will operate the Partner's records, licences, lineage, obligations and claims on the
Midnight network on the Partner's behalf ("the Service"), as described in VeilCore's document
MANAGED.md at version [commit or date], which forms part of this agreement.

1.2 VeilCore acts only on the Partner's instructions, given by a person named in Schedule A through a
channel named there. VeilCore may refuse an instruction it believes is unlawful, mistaken or not from
the Partner, and will say why.

1.3 **High-impact instructions are confirmed a second way.** Before acting on any of the following,
VeilCore confirms it with a person named in Schedule A by telephone or in person, not only by the
channel it arrived through: publishing a value in a claim; releasing an obligation; proposing or
approving a licence transfer; an exit; and any change to Schedule A. Recovery-commitment pools and exit
answers are also confirmed by a fingerprint the Partner reads out from its own screen. VeilCore is not
obliged to act on such an instruction until it is confirmed.

1.4 VeilCore records only fingerprints (cryptographic commitments) on the network, and whatever the
Partner instructs it to prove in a claim.

1.5 The Service records when something was recorded and who could act on it. It does not verify, and
VeilCore does not warrant, that any record, report or genetic material is what the Partner says it is.

## 2. What VeilCore holds

2.1 To provide the Service, VeilCore holds secrets that control the Partner's records and licences:
record secrets, licence secrets for licences the Partner holds, the hidden values of sealed records,
obligation terms and salts, and, if the Partner chooses, a laboratory signing key ("the Partner's
Secrets").

2.2 Recovery secrets. [Choose one:]
  - (a) The Partner holds its own master secret, from which its recovery secrets are derived. VeilCore
    never receives it and receives only recovery commitments. The Partner is responsible for keeping it
    safe; VeilCore cannot replace it.
  - (b) At the Partner's written request, VeilCore also holds the recovery secrets. The Partner
    acknowledges it has read MANAGED.md, Part 3, on what this means if VeilCore's systems are
    compromised. **Continuity:** VeilCore will give the Partner an export of all the Partner's Secrets
    at least every [month], and, if VeilCore decides to stop providing the Service or becomes unable to,
    will give [90] days' notice and complete an exit for the Partner within it. [Lawyer: escrow with a
    third party as an alternative or in addition.]

2.3 The Partner's Secrets belong to the Partner. VeilCore holds them only to provide the Service, uses
them only on the Partner's instructions, and does not sell, share, pledge or disclose them, except as
required by law (and then, where the law allows, only after telling the Partner).

2.4 VeilCore keeps the Partner's Secrets in a store used for the Partner only, encrypted under a
password used for the Partner only, as described in MANAGED.md. Everything VeilCore hands to the Partner
is encrypted to a key only the Partner's master secret opens.

## 3. Security

3.1 VeilCore will keep the Partner's Secrets with at least the measures in MANAGED.md, Parts 2 and 3,
including a dedicated operations computer with disk encryption and a proof server on that computer.
Only [named staff] may operate the Service; VeilCore will not use subcontractors for it without the
Partner's written consent.

3.2 VeilCore will keep an audit log of every action its software takes for the Partner, timestamp it on
the network at least [each working day with activity], send the Partner a receipt for each timestamp,
and give the Partner the log on request and on exit. The Partner understands (MANAGED.md, Part 3) that
the log, being kept by VeilCore, shows a change made after a timestamp but not one made before it.

3.3 If VeilCore becomes aware that the Partner's Secrets may have been accessed by anyone else, VeilCore
will tell the Partner within [24] hours, say what it knows, and take the steps in MANAGED.md, Part 3.
[Data-breach notification law may require more; lawyer to check.]

## 4. The Partner's part

4.1 The Partner keeps its master secret safe, and tells VeilCore at once if it believes it, or any
secret it has received from VeilCore, has been seen by someone else.

4.2 The Partner gives instructions only as in 1.2 and 1.3, and is responsible for their accuracy, and for
having the right to record, license and claim what it instructs.

4.3 To complete an exit (section 6) the Partner must itself take each record back with its own recovery
secret, which needs a computer and a network wallet able to pay the fees (MANAGED.md).

## 5. Fees

5.1 [Set-up fee: ]
5.2 [Monthly or per-record fee: ]
5.3 [Network fees: included / passed through at cost / other]
5.4 [Exit: assisted exit fee, if any: ] [Self exit: no fee.]
5.5 [Payment terms: ]

## 6. Leaving (exit)

6.1 The Partner may leave at any time by notice confirmed as in 1.3. VeilCore may end the Service on [90]
days' written notice, and then must complete its part of an exit.

6.2 On exit, VeilCore will, within [10] business days of the confirmed notice (or of receiving the
Partner's exit answer, for an assisted exit), at the Partner's choice:
  - (a) **assisted exit:** replace any recovery commitment whose secret VeilCore holds with one the
    Partner supplies; move every record it can off the secrets VeilCore stored; and propose the transfer
    of every licence the Partner holds; or
  - (b) **self exit:** stop acting for the Partner;

and in either case hand the Partner the Partner's Secrets (encrypted to the Partner's key), written
steps for what is left to do, the audit log and its receipts. If an assisted exit cannot be completed
for a technical reason (for example a record whose rotations are all used), VeilCore will say why and
complete a self exit instead.

6.3 **The exit is complete for a record when the Partner has taken it back with its own recovery
secret** (4.3), as the check described in MANAGED.md shows. Until then, after an assisted exit, the
record secrets VeilCore's software made for the hand-over still control the records; after a self exit,
VeilCore's copies do. VeilCore will not use them.

6.4 The following cannot be changed on the network by anyone, and the Partner relies for them on
VeilCore's deletion under 6.5: the ability of whoever holds a sealed record's hidden values to prove
facts about it; a laboratory signing key (the Partner replaces it and tells those who rely on it); and,
until the issuer approves the transfer, a licence secret for a licence the Partner holds. Values already
published, parentage already confirmed and obligations already released stay as they are.

6.5 Within [10] business days after the Partner confirms it can open what it was handed, VeilCore will
delete the Partner's Secrets from its store and the files it handed over from its operations computer,
and confirm in writing when it has. Copies in VeilCore's backups are destroyed when those backups expire,
at most [30] days later; VeilCore will not restore or use them meanwhile. The Partner understands that
deleting a file cannot be guaranteed to erase it from a solid-state disk. [Lawyer: whether any records
must be kept longer by law.]

6.6 VeilCore will not withhold an exit for unpaid fees. [Lawyer to confirm this is wanted.]

## 7. Limits of liability

7.1 The Service depends on the Midnight network, its fees, indexers and software, which VeilCore does
not control. VeilCore is not responsible for their outages, changes or failures.

7.2 VeilCore is not liable for indirect or consequential loss, lost profits, or loss caused by the
Partner's instructions, or by the Partner losing its master secret or anything VeilCore handed it.

7.3 **A compromise of VeilCore's operations computer, accounts or staff is not an event outside
VeilCore's control** for the purposes of this agreement, and is not excused as force majeure.
[Lawyer: whether and how liability for it is capped; insurance.]

7.4 VeilCore's total liability under this agreement is limited to [the fees paid in the 12 months
before the claim / a fixed amount: ], except where the law does not allow a limit, including for
[fraud, wilful misconduct, gross negligence: lawyer to set].

7.5 Nothing in this agreement is investment, legal or regulatory advice, and VeilCore does not hold
money or tokens for the Partner.

## 8. General

8.1 Governing law and courts: [ ]
8.2 Changes to this agreement only in writing signed by both.
8.3 Notices: [addresses / emails].
8.4 If a part of this agreement is unenforceable, the rest stands.

Signed for VeilCore: ______________________ Date: __________

Signed for the Partner: ___________________ Date: __________

**Schedule A.** Who may give instructions for the Partner, how, and the telephone numbers used to
confirm them (1.3): [names, emails, telephone numbers].
