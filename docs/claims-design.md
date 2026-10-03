# VeilCore claims: proving one fact about a record without showing the rest

Status: DESIGN, 3 October 2026. Second contract, deployed alongside `veilcore.compact`,
which stays frozen. Closes the "Per-field commitments" entry in SPEC section 12.

## What it lets a holder prove

Four claims, each about a sealed record, each provable only by someone who holds the
record's sealed values, and none of them revealing anything beyond the claim:

| Claim | Proves | Publishes | Who asked for it |
|---|---|---|---|
| **value** | slot *i* of record *c* holds exactly value *v* | *c*, schema, *i*, *v* | an examiner who was shown a value and must establish later that it is the sealed one |
| **range** | the number in slot *i* of *c* is at least (or at most) *t* | *c*, schema, *i*, at-least/at-most, *t*; never the number | a certifying agency (AOSCA ACR: a trait cleared a specified threshold) |
| **distinct** | records *a* and *b* differ in at least *k* of the schema's comparable slots | *a*, *b*, schema; never which slots or how many | a plant-variety examiner (USDA PVPO: distinctness without exposing proprietary markers) |
| **unchanged** | two records under one schema have equal values outside a published mask (nothing else: not which is the correction) | *old*, *new*, schema, mask | a verifier of a corrected record, together with the `supersedes` link (SPEC section 6) |

A claim the sealed values do not support cannot be constructed: the proof fails on the
prover's machine and nothing reaches the chain.

**Laboratory-signed versions.** `proveAttestedValue`, `proveAttestedRange` and
`proveAttestedDistinct` also check a laboratory's signature (Schnorr over Jubjub,
`contract/src/schnorr.compact`, from Midnight's `example-zkloan`, with a subgroup check on
the key and an exact challenge split added) on the **record commitment**, and publish the
laboratory's key. Signing the record rather than the field-set root means the signature
cannot be moved to another record built around the same values (attack round, 3 Oct). Without it, "germination is at least 95%" proves only
that the holder sealed that number; with it, that a laboratory sealed it. Which keys
belong to which laboratories is the verifier's decision (SPEC section 7); the contract
keeps no registry. For distinctness, one laboratory must have signed both field sets.

## How a record seals its fields (SDK, all three languages)

A new commitment algorithm, `sha256/fields/v1`, alongside the existing
`sha256/canonical-json/v1` (which is unchanged).

- A **schema** is a published JSON document naming up to 16 slots: for each, a path, a
  type (`uint` with a scale and unit, or `text`), whether it is **comparable** (counts
  towards distinctness), and for comparable text a **format** (`allele-pair`, `allele`
  or `code`) whose canonical form is the only one accepted. It also fixes **k**, the
  distinctness threshold. Its id is `schemaId = H("veilcore:v1:fschema", SHA-256(canonical
  schema JSON), comparable mask, count(k), numeric mask)`, so the comparable slots, k and
  which slots are numbers are fixed by the schema and cannot be chosen per claim.
- Each slot holds 32 bytes: a `uint` as an unsigned 64-bit integer, little-endian in
  bytes 0-7, with byte 8 set to 1 to mark it present; a `text` value as SHA-256 of its
  UTF-8 after NFC normalisation; an absent value as 32 zero bytes. The present-marker
  exists so that a missing result can never pass as the number 0 (a record with no THC
  test must not prove "at most 0.3%").
- `leaf_i = H("veilcore:v1:field", value_i, salt_i)`, with `salt_i = SHA-256("veilcore:v1:fsalt"
  ‖ fieldSecret ‖ i)` (i as a 32-byte little-endian count). `fieldSecret` is 32 random bytes kept with the record's private part
  and **never** inside the disclosed JSON: if the salts could be derived from anything a
  recipient is shown, low-entropy hidden values could be guessed back.
- `tree` = binary Merkle tree over the 16 leaves, `node = H("veilcore:v1:fnode", left, right)`.
- `setRoot = H("veilcore:v1:fset", schemaId, tree)`.
- **Record commitment** = `H("veilcore:v1:frecord", setRoot, jsonDigest)`, where
  `jsonDigest` is SHA-256 of the canonical JSON of the committed fields (SPEC 4.2, which
  now includes `fieldSchema` and `fieldSetRoot`), exactly as today. So the existing record, its nonce, its batch
  anchor and its inclusion proof all work unchanged; the commitment simply also binds
  the field set.

`H` is SHA-256 over 32-byte elements, tag right-padded with zeros: exactly Compact's
`persistentHash`, so anyone can recompute every value with SHA-256 alone.

## The contract (`contract/src/veilcore-claims.compact`)

Seven circuits: `proveValue`, `proveRange`, `proveDistinct`, `proveUnchanged`, and the
three laboratory-signed versions. Each
recomputes the record commitment(s) from the witnesses and records the claim in event
cells (`lastClaimKind`, `lastClaimRecord`, `lastClaimOther`, `lastClaimSchema`,
`lastClaimSlot`, `lastClaimParam`, `lastClaimOp`) and a counter. Verifiers read the
cells per transaction from the indexer, as for ownership proofs in the main contract.

**No per-claim state.** Nothing grows with the number of claims, so there is no state
bound to argue: the contract holds only fixed cells and a counter.

**Deploy it without a maintenance authority (recommended, founders to confirm).** The
claims contract holds no rights, licences or money, and no state worth keeping: an
upgrade is simply a new deployment at a new address, and claims made on the old one stay
in the chain's history. Whoever holds a maintenance key could swap a circuit's verifier
key for one that accepts false claims, so keeping one would make every claim depend on
trusting us. Without one, a verifier needs to trust only the published source and
fingerprints. (A maintenance update also cannot add ledger fields, so every field the
contract will need is in it from the start.)

## What a verifier checks

The nine checks are in SPEC section 4.5 ("What a verifier of a claim shall check"). The
ones people forget: obtain the schema document and recompute its id; treat a claim as
being about the record as sealed unless you can establish it is current; check a
laboratory key was valid at the claim transaction, not just at the anchor; have someone
other than the prover identify a distinctness reference; and read claims per contract
call, since a transaction can carry several and only the last is in the cells.

Nothing needs VeilCore's servers or VeilCore's cooperation.

## What it does not do (say this plainly, everywhere)

- **`distinct` is a count, not a verdict.** It says the records differ in at least k
  comparable values; whether that makes a variety distinct is the examining body's call.
- **`distinct` needs one party who holds both value sets.** A breeder comparing a new
  variety with its own parents or earlier varieties, or a testing laboratory that
  genotyped both. It does **not** let two parties who will not show each other their
  markers compare them; that is secure multi-party computation, a different tool.
- **`value` reveals the value.** It establishes authenticity, not confidentiality. A
  low-entropy value is guessable from what is published, by design.
- **Repeated `distinct` claims leak a little.** Each says "differs by at least k, yes".
  A holder who proves against many references with known values gives one bit each.
  Fixing k and the comparable slots in the schema stops the worst case (proving against
  single slots to learn values one at a time); the holder's tool should still refuse to
  run distinctness against references on request from someone else.
- **Repeated `range` claims narrow a hidden number.** Each bound proved is published; a
  holder who proves "at least 90", then "at least 95", then "at most 96" has told the
  world the number is 95 or 96. Only the holder can make these claims, so the holder
  decides how much to reveal; tools should show what a sequence of claims gives away.
- **16 slots per record.** A subject with more (an SSR panel of 30 loci) splits across
  records joined by declared descent, with one claim per part (SPEC section 12 already
  describes this). An absent value never counts as a difference.
- **Statistical distance over thousands of values** (SNP arrays) is the wrong shape for
  per-slot claims; attest the laboratory's computation instead.
- **Cost** (measured with Nite ZK Profiler, 3 Oct): `value` and `range` are k=16 (about
  46,000 rows); the laboratory signature adds about 1,500. `distinct` and `unchanged`
  rebuild two full trees and are k=19 (about 280,000 rows), against k=14 for the largest
  circuit in the main contract. Both must be proved on the preprod proof server and in a
  browser before mainnet; if k=19 is too slow in a browser, those two need a proof server.

## Prior art

An independent implementation of this shape, by another Midnight builder, was exercised
against VeilCore records in August 2026 and is what SPEC section 12 refers to.
This design is VeilCore's own, written from the specification; credit for showing the
shape works, and for the repeated-comparison warning, belongs to that work.
