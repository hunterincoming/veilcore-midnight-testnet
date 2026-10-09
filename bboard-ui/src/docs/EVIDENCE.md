# VeilCore for Counsel

**What a client can establish, how it is proved, and what it does not prove**

Version 0.1 - August 2026, revised October 2026 - draft for comment

---

## Summary

VeilCore is a records system for plant and animal genetics - plant varieties, breeding lines, seed lots, cultures, animal lines. It lets a holder establish four things that are ordinarily difficult or impossible to establish without disclosing the material itself:

**That a record of it existed by a date.** Provable to a third party, without revealing what "it" is. Who controls that record now can be shown too; who held it in between cannot.

**What it descends from, and what obligations came with it.** Including obligations that carry to offspring declared as descendants later.

**What a second party confirmed about it.** A laboratory's receipt, its report, signed by the laboratory and retractable only by them.

**What terms a counterparty agreed to, and whether those terms are still live.** Countersigned, bound to the record, and revocable - with the revocation visible to anyone who checks.

Each of these is separately disclosable. A holder decides which facts a given recipient sees. **The genetics themselves are never disclosable through the system at all.**

The authors are not lawyers. Corrections are welcome and more useful than agreement.

---

## 1 - What a client can establish

### 1.1 Prior possession, without disclosure

The ordinary way to show you held something first is your own dated records - the weakest evidence available, produced by the party relying on it and creatable after the fact.

The alternatives are worse. Depositing a specimen requires storage that is infeasible for clonally propagated material. Notarising a description requires disclosing it to a third party, which is the one thing a holder of unprotected valuable material cannot afford, and does not scale past a handful of selections.

**What VeilCore provides:** the holder describes the material and commits to that description - a 32-byte hash, published, revealing nothing. Later they produce the description and anyone can confirm it is the one committed to.

**And they can show control without producing it.** A zero-knowledge circuit lets a holder demonstrate they know the secret behind a published commitment without revealing the secret. In practice: a breeder can satisfy a counterparty that they control the record behind a published commitment now, while the description stays private. That shows control today, not who held the record earlier. The date the record's ledger identity was anchored says nothing about who holds the record now: a record can change hands through a key rotation or a recovery, and on chain that looks the same as a holder replacing their own key. It says nothing about the content either: the content is dated only by its own commitment's anchor. And it is control of the record, not proof that any material is the subject it describes (section 4).

**Why this matters commercially:** a breeding programme makes hundreds of selections annually, most of which will never be registered and any of which might later need defending. Committing all of them costs almost nothing. Choosing in advance which will matter is not possible.

### 1.2 A laboratory report bound to the record, not just a name

A record can bind a laboratory's genetic analysis to itself: the report file is hashed, the hash committed with the record, and the report never leaves the holder.

The consequence is that a claim rests on a specific analysis rather than only on a cultivar name, which is reused, renamed and disputed. The hash identifies the report file, not the genotype: two reports on the same plant, from different laboratories or different runs, have unrelated hashes. Where two parties claim the same material, each produces the report they committed; the hashes show that each report is the one its record committed to, and each record's own anchor dates that record. Which of two records or pairings carrying the same raw report hash landed first is not evidence of who had the report first: a hash, once seen, can be copied, and a DNA pairing on the live VeilCore contract accepts any non-zero 32-byte value and makes it public. Whether the material is the same is settled by comparing the reports' marker data.

**What it does not do:** it does not sequence anything, and it does not tell you whether a plant in a field is the material described. That requires comparison against the actual sample. What the record establishes is that the description and the analysis existed before the dispute - which is what makes a later comparison meaningful rather than circular.

### 1.3 Descent, and obligations that travel with it

A record can declare what it descends from. Where a licence carried an obligation on offspring - a royalty on descendants, a restriction on further propagation - that obligation is recorded against the record, and reaches descendants that are declared from it, rather than ending with the transaction.

**The practical problem this addresses:** genetic material is self-replicating. A licensee who buys a cutting can produce a thousand more, and the licensor is paid once. Terms that bind only the original transaction bind almost nothing.

**What VeilCore provides:** an obligation recorded against a record propagates to declared descendants. A party holding material descended from an encumbered record cannot demonstrate clean descent while the obligation is outstanding, and the system reports that to anyone who checks.

**What it does not do:** it does not detect undeclared descent. A licensee who propagates quietly and never registers, sells or tests the result is invisible to any records system. The mechanism operates when material surfaces commercially - which is also when a licensor would want to act.

### 1.4 Second-party confirmation

A holder's own record is their own account. A second party confirming it is materially stronger evidence, and the system makes that confirmation something the second party issues rather than something the holder asserts.

**A laboratory generates its own signing key.** When it confirms receipt of a sample, or returns a report, it signs with that key. The signature establishes the statement came from the holder of that key and nobody else - including the registry.

**A laboratory can withdraw what it issued, and only it can.** A retraction is signed by the same key, so a holder cannot suppress one and a competitor cannot forge one. The original attestation is not deleted; it is reported as retracted.

**Attestations differ in weight and the system says so.** Unsigned, signed, or signed by a party who has named an external accreditor such as an ISO/IEC 17025 accreditation body. The system records which accreditor was named and does not verify it - a verifier confirms that independently, which is the point of naming them.

### 1.5 Licensing, and revocation as the enforcement mechanism

The system carries an agreement lifecycle: draft, issued, countersigned by both parties, active, expired or revoked. Terms name the record and the hash of any report bound to it, so what was licensed is not a matter of recollection.

**Royalty obligations are recorded as live obligations** with a running owed amount. The system records what is owed; it does not process payments and does not hold funds.

**Revocation is the enforcement mechanism, and it is worth understanding why.** Nobody can police an unreported grow - not the licensor, and not any records system. But a licensee whose licence is revoked cannot show a live licence to the next buyer, the next laboratory, or any scheme that requires a record for entry. The licensor is not policing the plant. They are making the licensee's paper worthless.

This is the honest answer to "royalties on genetics are unenforceable." They are unenforceable by pursuit. They are enforceable by making non-compliance visible at the point where the licensee needs to prove something to someone else.

### 1.6 Selective disclosure

A holder grants specific facts to specific recipients: that a record exists and its date; whether a second party attested and at what strength; whether descent is clean; the terms of an agreement, or merely that one exists.

**Facts not granted are absent from the disclosure, not concealed within it.** A recipient cannot recover an ungranted fact by inspecting what they were given, because it was never assembled.

**The genetics are never disclosable.** There is no grant that reveals them, by design.

For counsel, the discovery consequence is worth stating to clients plainly: selective disclosure governs what a holder shares voluntarily. It is not a shield in discovery, and producing a record in response to a request or an order is unaffected by any of it.

---

## 2 - How each of these is proved

Everything above rests on the same foundation: a commitment, published, that fixes a description in time. This section is how that is authenticated.

### 2.1 What a party actually holds

**The record.** A JSON document containing the description and a random value called a nonce. The holder keeps it; it is never published.

**The commitment.** A 32-byte hash of the record. Published, and meaningless by itself.

**The inclusion proof.** A short file showing the path from the commitment to a published root, and the transaction in which that root appeared.

A party producing "a VeilCore record" is producing all three.

### 2.2 The self-verifying property

**FRE 901(a)** requires evidence sufficient to support a finding that the item is what the proponent claims. The standard is permissive, and challenges to integrity ordinarily go to weight rather than admissibility.

A VeilCore record has an unusual property here: **it authenticates itself arithmetically.** Given the record, anyone recomputes the hash and compares. The method is published and reproducible, and needs no proprietary tool or expert judgement; what remains open to challenge is narrower - the published serialisation rules and the anchor lookup.

**FRE 901(b)(9) - evidence about a process or system** is the natural route. The process is SHA-256 over a published serialisation. Three implementations, in different programming languages, produce identical results on the published test vectors. All three were written by the same author, so they show the rules give one answer across languages; no third-party implementation exists yet.

**FRE 902(13)** permits that foundation to be established by certification rather than live testimony. Note the limit the Advisory Committee states plainly: a 902(13) certification establishes authenticity only, and any hearsay exception must be established separately.

**The evidence package's manifest is not part of this.** A package built by the SDK carries a `MANIFEST.json` listing each file's SHA-256, and `verify.py` checks it. That check catches accidental damage (a truncated or re-saved copy) and nothing more: the manifest travels in the same folder, so anyone who edits a file can rewrite it to match. The self-verifying property is the commitment recomputed from the record and checked against its anchor, which an edit cannot survive. Do not present the manifest check as tamper evidence.

### 2.3 Hearsay

The commitment is not a statement. The record it commits to may be.

**FRE 803(6)** requires a custodian or qualified witness to establish that the record was made at or near the time by someone with knowledge, kept in the course of a regularly conducted activity, and that making it was regular practice.

**The first element is unusually strong here** - "at or near the time" is demonstrable from the transaction rather than remembered.

**The others are unaffected by the technology, and this is worth advising clients about before a dispute rather than after.** A holder who commits records as routine practice - every selection, every intake - is in a materially better position than one who sealed a record because a dispute was brewing. A laboratory recording intake contemporaneously as a matter of course is the paradigm case.

### 2.4 Signatures

An attestation signature establishes that the statement came from the holder of a particular key. That is authentication, not a hearsay exception; a laboratory's report will usually qualify under 803(6) on the laboratory's own foundation.

### 2.5 Best evidence, and one practical warning

A record is an original electronic record; a printout accurately reflecting it is an original under FRE 1001(d).

**The nonce must be produced with the record.** It is part of what the commitment covers, and a record produced without it cannot be verified by anyone, including its holder. This is the most common way a party ends up holding evidence that no longer verifies. Confirm early that a client has retained it.

---

## 3 - Jurisdictions

A record may carry several anchors, because jurisdictions do not agree on what establishes a date. Each binds the same commitment; a court reads the one its own law recognises. Adding an anchor never invalidates a record, so a holder may obtain a further one years after sealing.

**European Union.** eIDAS Regulation 910/2014, Article 41(1): an electronic timestamp cannot be denied legal effect solely for being electronic. Article 41(2) goes further - **a qualified electronic timestamp enjoys a presumption of the accuracy of the date and of the integrity of the data bound to it** - and Article 42 sets the requirements a timestamp must meet to be qualified. The burden shifts: the party disputing the date must prove it wrong.

That presumption attaches to a qualified RFC 3161 timestamp from a Qualified Trust Service Provider on a member state's trusted list - not to a blockchain anchor. Where an EU forum is possible, obtaining one alongside is inexpensive and materially changes the position. Verify a claimed qualified status against the trusted list rather than relying on the record's assertion.

**Italy.** Law 12/2019, Article 8-ter gives timestamps on distributed ledgers the effect of an ordinary eIDAS electronic timestamp under Article 41(1) - not denied effect, but carrying no presumption - and makes this subject to technical standards from AgID, which we have not found published. It also defines a distributed ledger as architecturally decentralised, which a federated network may not satisfy.

**China.** Internet Courts in Hangzhou, Beijing and Guangzhou have recognised blockchain-based electronic evidence since 2018, under Supreme People's Court provisions.

**United States.** As above. No federal presumption attaches to a chain anchor. FRE 902(13) and 902(14) allow electronic records and hash-verified copies to be self-authenticated by a qualified person's certification. Vermont (12 V.S.A. §1913, enacted 2016) has a statute on authenticating blockchain records; other states have considered or passed similar laws, which we have not checked one by one.

**Japan.** The Plant Variety Protection and Seed Act gives applicants rights that operate before registration completes. Article 14 permits a compensation claim for use during the pending period, either after warning an infringer by presenting a document describing the applied-for variety, or without warning against a party who used it knowing of a published application. The 2026 amendment adds an export injunction over the same period. Both turn on proving what a description said and when it existed, and the Act prescribes no form for that evidence. **We are not qualified to advise on Japanese procedure and this should be confirmed by Japanese counsel.**

**Where a dispute may arise in more than one forum, obtain more than one anchor.** It costs almost nothing and each forum reads what it recognises.

---

## 4 - What none of this proves

Stated plainly, because a party who overstates will be corrected in front of the fact-finder.

**It does not prove a description is true.** A commitment to a false description is a commitment to a false description. It proves the falsehood was recorded on a date and not since altered. Truth comes from attestations by parties with something to lose, and ultimately from evidence outside the system.

**It does not identify physical material.** Whether a plant is the subject described requires comparison of characteristics or genetic analysis.

**It does not prove possession of material.** It proves prior possession of the record: that someone held a description, and its nonce, by the date the commitment was anchored, and - where a zero-knowledge proof is offered - that whoever answers controls the record now. It does not show those are the same party: a record can change hands through a key rotation or a recovery, which on chain looks the same as a holder replacing their own key. It does not prove that any material is the subject described, or that material was ever in their hands.

**It does not prove anything still exists.** Inspection is the only answer to that.

**It does not detect undeclared descent**, undisclosed propagation, or material that never surfaces commercially.

**A pending anchor establishes no date.** A record may be sealed but not yet anchored, and the system reports the difference. Check which state a record is in before relying on it.

**An unsigned attestation is weak**, and the system says so rather than presenting it as equivalent to a signed one.

**It creates no rights.** It supports claims under rights that exist independently.

---

## 5 - Corrections, retractions and challenges

**Corrections never delete.** A record is never edited and never voided. (A holder may remove a registry's copy of their own record; the commitment and any anchor remain.) A correction issues a new record superseding the old, and both remain. An opponent can see what a record said before it was corrected - which is the price of the original remaining usable as evidence.

**Severity is classified, not chosen.** The system determines from which field changed whether descendants are affected and whether existing agreements are. A holder cannot mark their own correction harmless.

**An attester may withdraw an attestation they issued**, signed with the same key. Nobody else can, and the original remains on record as retracted.

**A third party may contest a record.** A challenge never alters it - it changes what a verifier is told. The challenger must have sealed a record of their own claim, and must sign the challenge, so an unbacked or anonymous assertion cannot be filed.

**Nothing is adjudicated within the system.** A record is reported as contested, on what ground, and whether it was answered. Where a matter has been resolved, the system records which outside authority ruled and a reference that can be checked. VeilCore does not decide who is right, and is designed not to be able to.

---

## 6 - Independence from the registry

**Verification does not require the registry that issued a record, or its continued existence.** A holder with their record, nonce and proof verifies against the public ledger using open-source software. (The ledger fixes a date only when the anchor is on a production network; an anchor on a test network fixes none. See section 8.)

This matters for rights running twenty-five to thirty years. It also forecloses an argument an opponent would otherwise make - that the evidence depends on a commercial party with an interest in the outcome.

Verification is free, requires no account, and is committed to remaining so.

---

## 7 - Practical advice to a client

**Commit records as routine practice, not in response to a dispute.** The business-records foundation turns on regularity.

**Retain the nonce.** Without it nothing verifies.

**Prefer signed attestations, and attesters who name an external accreditor.**

**Where an EU forum is possible, obtain a qualified timestamp** alongside the ledger anchor.

**Correct rather than restate.** A correction preserves the original and records what changed; a fresh record loses the connection and looks worse.

**Check anchoring status before relying on a date.**

---

## 8 - Limitations of this note

The authors are not lawyers. This describes a technical system in terms of the evidentiary questions it appears to raise, and should be checked by counsel in the relevant jurisdiction.

The detailed analysis is written against the United States Federal Rules of Evidence. Section 3 sketches other jurisdictions at the level of the governing instrument, not at the level of how a particular court has applied it.

**No VeilCore record has been offered in evidence anywhere.** The system is new. This describes how it is designed to be used, not how a court has treated it.

**Check which network an anchor is on.** Every anchor names its network. Anchors VeilCore made before its launch on Midnight's main network are on Midnight test networks, and they keep naming that network. A test network can be reset and carries no evidentiary weight, so a date from a test-network anchor should not be relied on. Whether a registry anchors on a production network, and on which contract, is published by the registry itself and can be confirmed on the chain.

Corrections to hunter@veilcore.org.

---

## Appendix - Establishing the foundation

Indicative, not a form.

**Authentication under 901(b)(9), by witness or 902(13) certification:**

1. The record is a JSON document in the VeilCore format, version stated.
2. The commitment is SHA-256 over a canonical serialisation defined in the published specification.
3. Recomputing from the produced record yields the published value.
4. That value appears in the identified transaction, block and time.
5. The process is published and reproducible; three implementations in different languages, all by the same author, agree on the published test vectors.

**Hearsay foundation under 803(6), separately:**

1. Made at or near the time - supported by the transaction timestamp.
2. By a person with knowledge.
3. Kept in the course of a regularly conducted activity.
4. Making such records was a regular practice.
5. So testified by a custodian, or certified under 902(11).

**Anticipate:** that the description may be untrue; that the material may not be what is described; that regular practice may be thin; and that a pending rather than anchored commitment establishes no date.
