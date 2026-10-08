# Integrating VeilCore

For developers building software that laboratories, breeders, registries or rights bodies
use. If you are looking for the format itself, read [SPEC.md](SPEC.md).

## What this is, and what it is not

**This is not a service you sign up for.** There is no account, no API key, and no server
you have to reach. Your software computes a commitment locally. To give it a date, the
commitment needs an anchor on Midnight, made by you or by a registry you use.

**Your system stays your system.** Your identifiers, your database, your workflow. A
commitment is one field added to a record you already create.

**Nothing sensitive leaves your infrastructure.** Sample descriptions, laboratory reports,
client data, genetics: none of it is transmitted. What gets published is a 32-byte hash
that reveals nothing about its contents.

## Why anyone would bother

Your users have records. Their records are their own word, which is the weakest evidence
there is in a dispute — produced by the party relying on them, and creatable after the
fact.

Adding a commitment turns a record into something a stranger can check: the description
existed on a given date and has not been altered since. That does not make it true. It
makes it fixed, which is the thing a court, a customs officer, or a buyer can work with.

## The smallest useful integration

```
npm install veilcore-records
```

Version 0.15.0 or later includes the October 2026 number and string rules.

```js
import { computeCommitment, newNonce } from 'veilcore-records';

const record = {
  formatVersion: '0.1',
  recordId: yourOwnIdentifier,
  subjectType: 'plant-genetic-material',
  profile: 'veilcore/profile/plant-variety/v1',
  commitmentAlgorithm: 'sha256/canonical-json/v1',
  anchor: { chain: 'midnight', network: 'undeployed' },
  sealedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  holder: { id: yourClientIdentifier },
  profileData: { ...yourExistingFields, nonce: newNonce() },
};

record.commitment = await computeCommitment(record);
// Store record.commitment alongside the record in your own database.
```

That is a working integration. Everything below makes it more useful.

## The four things worth adding, in order

**1. Store the nonce.** It is part of what the commitment covers. A record whose nonce is
lost can never be verified again, by anyone, including you. It is the easiest thing to
get wrong.

**2. Sign what you attest to.** If your users issue reports about someone else's material,
sign them. An unsigned attestation is a claim your system recorded; a signed one is a
statement your user made. The difference matters in exactly the situations this exists for.

**3. Batch before anchoring.** Anchoring commitments individually is expensive and requires
each user to hold a wallet. Aggregate a day's records into a Merkle tree, publish one root,
and give each user their inclusion proof. One transaction, any number of records, and your
users never touch a ledger. Every anchor names its network: an anchor on a test network
carries no evidentiary weight, so check `network` before relying on a date. VeilCore's own
anchors made before its launch on Midnight's main network are on test networks.

**4. Hand users their proof.** A proof is a small JSON file: the commitment, the path to the
root, and the transaction that published it. It verifies with this package and a chain
lookup, with no dependency on you or on us. That independence is the point — a record that
stops being verifiable when a company disappears is not evidence.

## What you must not do

**Do not compute commitments on a server on your users' behalf** unless they understand
that. A commitment computed by someone else is that party's claim about a record, not the
holder's own. Where your users need to make a statement that is theirs, the computation
belongs on their machine.

**Do not let anyone set a correction's severity.** The format classifies severity from
which field changed, precisely because a party choosing their own would always choose the
harmless option.

**Do not report an unanchored record as anchored,** or an unsigned attestation as signed.
The format distinguishes them so that the difference reaches whoever is relying on it.

## Verifying without integrating

If you only need to check records other people produced, this is the whole of it:

```js
import { verifyCommitment } from 'veilcore-records';
const result = await verifyCommitment(record);
```

No account, no key, no network. This will always be free.

## Confirming your implementation is correct

If you implement the format yourself rather than using this package — in another language,
or inside an existing system — the conformance vectors tell you whether you got it right:

    node conformance/run-cli.mjs "your-command"

Your program reads a job on standard input and writes a result on standard output. There
are 100 vectors. Three implementations pass them: TypeScript, Python and Rust. All three
have the same author, so they show the rules give one answer across languages, not that
someone else can implement the format from the specification alone. An implementation by
an unrelated party is the test the format still needs. The Python implementation, in
`conformance/impl.py`, needs only the standard library.

## A complete example

`examples/lab-integration.mjs` walks through a laboratory receiving a sample, signing the
report it produced, anchoring a day's records in one transaction, and what the client can
prove years later. It runs with no accounts and no configuration:

    node examples/lab-integration.mjs

## Questions and corrections

The specification is published for comment, and specific correction is more useful than
general agreement. Open an issue, or write to hunter@veilcore.org.
