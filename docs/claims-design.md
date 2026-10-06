# VeilCore claims: proving one fact about a record without showing the rest

Status: DESIGN, 3 October 2026; layout revised 4 October after measuring proofs (see Size). Second contract, deployed alongside `veilcore.compact`,
which stays frozen. Closes the "Per-field commitments" entry in SPEC section 12.

## What it lets a holder prove

Four claims, each about a sealed record, each provable only by someone who holds the
record's sealed values, and none of them revealing anything beyond the claim:

| Claim | Proves | Publishes | Who needs it |
|---|---|---|---|
| **value** | slot *i* of record *c* holds exactly value *v* | *c*, schema, *i*, *v* | anyone who was shown a value and must establish later that it is the sealed one |
| **range** | the number in slot *i* of *c* is at least (or at most) *t* | *c*, schema, *i*, at-least/at-most, *t*; never the number | a certifying agency checking that a trait cleared a specified threshold (as in AOSCA's Additional Certification Requirements) |
| **distinct** | records *a* and *b* differ in at least *k* of the schema's comparable slots | *a*, *b*, schema; never which slots or how many | a breeder showing an examiner that markers differ without exposing them (the problem a USDA plant-variety examiner described to us; no office has asked for or used this) |
| **unchanged** | two records under one schema have equal values outside a published mask (nothing else: not which is the correction) | *old*, *new*, schema, mask | a verifier of a corrected record, together with the `supersedes` link (SPEC section 6) |

A claim the sealed values do not support cannot be constructed: the proof fails on the
prover's machine and nothing reaches the chain.

**Laboratory signatures.** `proveAttested` checks a laboratory's signature (Schnorr over
Jubjub, `contract/src/schnorr.compact`, from Midnight's `example-zkloan`, with a subgroup
check on the key and an exact challenge split added) on a **record commitment**, and
publishes the record and the laboratory's key. It is its own claim: read together with a
value, range, distinct or unchanged claim on the same record, it makes that claim about
values a laboratory sealed. Without it, "germination is at least 95%" proves only that the
holder sealed that number; with it, that a laboratory sealed it. Signing the record rather
than the field-set root means the signature cannot be moved to another record built
around the same values (attack round, 3 Oct). A distinctness claim over two signed records
needs one attested claim on each. Which keys belong to which laboratories is the
verifier's decision (SPEC section 7); the contract keeps no registry.

(Until 4 October the signature was checked inside each claim, as `proveAttestedValue`,
`proveAttestedRange` and `proveAttestedDistinct`. The distinct one needed two signature
checks on top of two whole records and could not be brought under k=17; a separate claim
says the same thing, since the signature already binds every value through the record
commitment, and keeps every circuit small.)

## How a record seals its fields (SDK, all three languages)

A new commitment algorithm, `sha256/fields/v1`, alongside the existing
`sha256/canonical-json/v1` (which is unchanged).

- A **schema** is a published JSON document naming up to 16 slots: for each, a path, a
  type (`uint` with a scale and unit, or `text`), whether it is **comparable** (counts
  towards distinctness), and for comparable text a **format** (`allele-pair`, `allele`
  or `code`) whose canonical form is the only one accepted. It also fixes **k**, the
  distinctness threshold. Its id is `schemaId = H("veilcore:v1:fschema", SHA-256(canonical
  schema JSON), terms)`, where `terms` packs the comparable mask (bytes 0-1), the numeric
  mask (bytes 2-3) and k (byte 4) into one 32-byte element, so the comparable slots, k
  and which slots are numbers are fixed by the schema and cannot be chosen per claim.
- Each slot holds 32 bytes: a `uint` as an unsigned 64-bit integer, little-endian in
  bytes 0-7, with byte 8 set to 1 to mark it present; a `text` value as SHA-256 of its
  UTF-8 after NFC normalisation; an absent value as 32 zero bytes. The present-marker
  exists so that a missing result can never pass as the number 0 (a record with no THC
  test must not prove "at most 0.3%").
- `leaf_i = SHA-256(value_i ‖ salt_i)`, 55 bytes, one SHA-256 block, with `salt_i` the
  first 23 bytes of `H("veilcore:v1:fsalt", fieldSecret, i)` (i as a 32-byte
  little-endian count; 184 bits). `fieldSecret` is 32 random bytes kept with the record's
  private part and **never** inside the disclosed JSON: if the salts could be derived from
  anything a recipient is shown, low-entropy hidden values could be guessed back.
- `setRoot = SHA-256("veilcore:v1:fset" ‖ schemaId ‖ leaf_0 ‖ … ‖ leaf_15)`: one hash over
  all 16 leaves (560 bytes, the tag unpadded at 16 bytes). Opening one slot discloses its
  value and salt and the other 15 leaves, which are salted and say nothing.
- **Record commitment** = `H("veilcore:v1:frecord", setRoot, jsonDigest)`, where
  `jsonDigest` is SHA-256 of the canonical JSON of the committed fields (SPEC 4.2, which
  now includes `fieldSchema` and `fieldSetRoot`), exactly as today. So the existing record, its nonce, its batch
  anchor and its inclusion proof all work unchanged; the commitment simply also binds
  the field set.

`H` is SHA-256 over 32-byte elements, tag right-padded with zeros. Every hash here,
including the leaf and the root, is exactly what Compact's `persistentHash` computes over
those bytes, so anyone can recompute every value with SHA-256 alone. A leaf (55 bytes)
and a set root (560 bytes) each have a length no other hash here takes. The record
commitment, the schema id and the salt derivation all take 96 bytes (a 32-byte tag and
two 32-byte elements); they are kept apart by their tags (`veilcore:v1:frecord`,
`veilcore:v1:fschema`, `veilcore:v1:fsalt`), which differ in the first element, so one
cannot be presented as another. The second attestation hash (`veilcore:v1:fattest2`,
64 bytes) has its own length and tag.

## The contract (`contract/src/veilcore-claims.compact`)

Five circuits: `proveValue`, `proveRange`, `proveDistinct`, `proveUnchanged` and
`proveAttested`. Each recomputes the record commitment(s) from the witnesses (or, for
`proveAttested`, checks a signature on one) and records the claim in event
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

**How, provably** (`api/src/maintenance.ts`, `retireMaintenanceAuthorityProvably`). After
the five circuit keys are on chain, the deploy replaces the authority with an **empty
committee and a threshold of 1**: an authority no signature can ever satisfy, which anyone
can read from the contract's state (`committee: []`, `threshold: 1`). That is checkable,
unlike "we threw the key away". midnight-js cannot build it, so the signed maintenance
update is built directly with ledger-v8; `api/test-maintenance.mjs` applies it to a real
ledger state and checks that the old key, any other key and an unsigned update are all
refused afterwards. The smoke test's claims phase checks the same on preprod.

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
- **Size** (see below): every circuit is at most k=17, so a holder proves on their own
  computer.

## Size, and why the layout is what it is

Memory for a proof roughly doubles with each step of k. On 3-4 October the first layout
(a binary Merkle tree of 3-element hashes) was proved on a local chain on a 16 GB laptop:
`distinct` (k=19) peaked at about 8.2 GB and passed; `unchanged` (k=19), right after it,
took the proof server past the 12 GB Docker had and it was killed. A holder who cannot
prove on their own machine has to hand the values to someone who can, which defeats the
point. So the layout was changed before anything was published or deployed.

In-circuit, one SHA-256 block costs about 1,940 rows (measured with `zkir mock-compile`).
The old layout spent 2 blocks on each of 16 leaves and 15 nodes per record. Now a leaf is
one block, the root is one hash of 9 blocks, and the schema terms are one element:

| Circuit | Before (k, rows) | Now (k, rows) |
|---|---|---|
| `proveDistinct` | 19, 284,507 | **17, 128,015** |
| `proveUnchanged` | 19, 277,391 | **17, 123,547** |
| `proveRange` | 16, 54,037 | 16, 34,828 |
| `proveValue` | 16, 45,868 | **15**, 29,339 |
| `proveAttested` | (inside each claim) | **13**, 6,371 |
| largest in the main contract | 14 | 14 |

`contract/scripts/circuit-sizes.sh` prints these and fails if any circuit passes k=17.
`proveDistinct` is about 3,000 rows under the k=17 limit: a compiler change could push it
over, which that script would catch.

Measured on the same laptop on 4 October, local chain, all claims back to back: the proof
server peaked at **3.7 GB** (from 2.5 GB idle, which holds the main contract's
parameters), against 8.2 GB and an out-of-memory crash before. `proveDistinct` took
8.6 s (was about 55 s), `proveUnchanged` 6.7 s, `proveAttested` 0.7 s.

## Mutation testing

Every `assert` removed and every comparison flipped, one at a time, against the claims
tests (4 Oct, after the layout change: 71 mutants). Survivors other than comments:

- `schnorr.compact`, the subgroup check (`r * pk` is the identity) removed, or its AND
  weakened to OR; and `q < 116` relaxed to `q <= 116`. These survived the run before too
  and were wrongly reported as comments. Each now has a test that fails with it
  (`claims-schnorr.test.ts`): the first two read the compiled circuit, because the JS
  runtime refuses keys outside the subgroup before the circuit's check can run; the
  third builds the one alternative challenge split that only `q < 116` refuses.
- `schnorr.compact`, `c < p - 115 * 2^248` relaxed to `<=`: equivalent in practice. The
  two differ only when `q = 115` and `c = p - 115 * 2^248`, which is a split of the
  challenge 0; a challenge hash of 0 is not something anyone can produce.

## Prior art

An independent implementation of this shape, by another Midnight builder, was exercised
against VeilCore records in August 2026 and is what SPEC section 12 refers to.
This design is VeilCore's own, written from the specification; credit for showing the
shape works, and for the repeated-comparison warning, belongs to that work.

## Note for the next compiler migration (6 Oct 2026)

`contract/src/schnorr.compact` says the standard library's `jubjubSchnorrVerify` gains the
identity-key check in Compact 0.34. It landed in **0.35.0**
(https://docs.midnight.network/relnotes/compact/toolchain-0.35.0); pointed out by Guvenkaya
while scoping their review. When migrating (ledger 9), go straight to 0.35 or later before
replacing the custom Schnorr check. The comment in the `.compact` file is left as it is for
now, because that file is frozen and fingerprinted for the mainnet deploy.
