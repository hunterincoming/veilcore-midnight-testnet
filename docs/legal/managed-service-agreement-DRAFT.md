# VeilCore-run Managed Service Agreement

> **DRAFT — must be reviewed by a lawyer before use; not legal advice.**
> Prepared as a starting point for a lawyer, 6 October 2026.
> Nothing here has been checked against the law of any place. Blanks (`[ ]`) must be filled
> and every section reviewed before anyone signs it.

**Between:** VeilCore [legal entity name, address] ("VeilCore")
**and:** [Partner legal name, address] ("the Partner")
**Starting:** [date]

## 1. What this agreement covers

1.1 VeilCore will operate the Partner's records, licences, lineage, obligations and claims on
the Midnight network on the Partner's behalf ("the Service"), as described in VeilCore's
document MANAGED.md at version [commit or date], which forms part of this agreement.

1.2 VeilCore acts only on the Partner's instructions, given [by email from an address listed in
Schedule A / through a form / other]. VeilCore may refuse an instruction it believes is unlawful,
mistaken or not from the Partner, and will say why.

1.3 VeilCore records only fingerprints (cryptographic commitments) on the network, and whatever the
Partner instructs it to prove in a claim. A claim that publishes a value is made only after the
Partner confirms that value in writing.

1.4 The Service records when something was recorded and who could act on it. It does not verify,
and VeilCore does not warrant, that any record, report or genetic material is what the Partner says
it is.

## 2. What VeilCore holds

2.1 To provide the Service, VeilCore holds secrets that control the Partner's records and licences
(record secrets, licence secrets, the hidden values of sealed records, and, if the Partner chooses,
a laboratory signing key) ("the Partner's Secrets").

2.2 Recovery secrets. [Choose one:]
  - (a) The Partner holds its own master recovery secret. VeilCore never receives it and receives
    only recovery commitments. The Partner is responsible for keeping it safe; VeilCore cannot
    replace it.
  - (b) At the Partner's written request, VeilCore also holds the recovery secrets. The Partner
    acknowledges it has read MANAGED.md, Part 3, on what this means if VeilCore's systems are
    compromised.

2.3 The Partner's Secrets belong to the Partner. VeilCore holds them only to provide the Service,
uses them only on the Partner's instructions, and does not sell, share, pledge or disclose them,
except as required by law (and then, where the law allows, only after telling the Partner).

2.4 VeilCore keeps the Partner's Secrets in a store used for the Partner only, encrypted under a
password used for the Partner only, as described in MANAGED.md.

## 3. Security

3.1 VeilCore will keep the Partner's Secrets with at least the measures in MANAGED.md, Part 2 and
Part 3, including a dedicated operations computer with disk encryption and a proof server on that
computer.

3.2 VeilCore will keep an audit log of every action it takes for the Partner, give it to the Partner
on request, and give it to the Partner on exit.

3.3 If VeilCore becomes aware that the Partner's Secrets may have been accessed by anyone else,
VeilCore will tell the Partner within [24] hours, say what it knows, and take the steps in
MANAGED.md, Part 3. [Data-breach notification law may require more; lawyer to check.]

## 4. The Partner's part

4.1 The Partner keeps its own passphrases and, under 2.2(a), its master recovery sheet safe, and
tells VeilCore at once if it believes any of them has been seen by someone else.

4.2 The Partner gives instructions only through the channel in 1.2, and is responsible for their
accuracy, and for having the right to record, license and claim what it instructs.

## 5. Fees

5.1 [Set-up fee: ]
5.2 [Monthly or per-record fee: ]
5.3 [Network fees: included / passed through at cost / other]
5.4 [Exit: assisted exit fee, if any: ] [Self exit: no fee.]
5.5 [Payment terms: ]

## 6. Leaving (exit)

6.1 The Partner may leave at any time by written notice. VeilCore may end the Service on [90] days'
written notice, and then must complete an exit.

6.2 On exit, VeilCore will, within [10] business days, either (at the Partner's choice):
  - (a) **assisted exit:** move every record so that VeilCore's copies of its secrets no longer
    control it, as described in MANAGED.md, and propose the transfer of every licence the Partner
    holds; or
  - (b) **self exit:** stop acting for the Partner;

and in either case hand the Partner a bundle holding all of the Partner's Secrets, encrypted to a
passphrase the Partner chooses, written steps for anything left to do, and the Partner's audit log.

6.3 VeilCore will delete every copy of the Partner's Secrets it holds within [30] days after the
Partner confirms it can open its bundle, including copies in backups, and confirm in writing when
it has. [Lawyer: whether any records must be kept longer by law.]

6.4 VeilCore will not withhold an exit for unpaid fees. [Lawyer to confirm this is wanted.]

6.5 The Partner understands that some things cannot be changed on the network by anyone: values
already published in claims, parentage already confirmed, obligations already released, and the
ability of whoever holds a sealed record's hidden values to prove facts about it. For those the
Partner relies on VeilCore's deletion under 6.3.

## 7. Limits of liability

7.1 The Service depends on the Midnight network, its fees, indexers and software, which VeilCore does
not control. VeilCore is not responsible for their outages, changes or failures.

7.2 VeilCore is not liable for indirect or consequential loss, lost profits, or loss caused by the
Partner's instructions, by the Partner losing its passphrases or recovery sheet, or by events outside
VeilCore's reasonable control.

7.3 VeilCore's total liability under this agreement is limited to [the fees paid in the 12 months
before the claim / a fixed amount: ], except where the law does not allow a limit, including for
[fraud, wilful misconduct, gross negligence: lawyer to set].

7.4 Nothing in this agreement is investment, legal or regulatory advice, and VeilCore does not hold
money or tokens for the Partner.

## 8. General

8.1 Governing law and courts: [ ]
8.2 Changes to this agreement only in writing signed by both.
8.3 Notices: [addresses / emails].
8.4 If a part of this agreement is unenforceable, the rest stands.

Signed for VeilCore: ______________________ Date: __________

Signed for the Partner: ___________________ Date: __________

**Schedule A.** Who may give instructions for the Partner, and how: [names, emails].
