# Self-audit, 3 October 2026

A review run with methods that do not depend on a reviewer's judgement, chosen from how
audit firms describe their own process (Trail of Bits' review checklist, OpenZeppelin's
audit readiness guide, Zellic's ZK audit phases, the 0xPARC ZK bug tracker) and from
Midnight's Compact security guidance. Earlier rounds were adversarial reading; this one
measures.

## 1. Midnight's Compact security checklist

Checked line by line against
[docs.midnight.network/compact/smart-contract-security](https://docs.midnight.network/compact/smart-contract-security).

| Rule | Result |
|---|---|
| Witnesses are untrusted | Every witness value is bound by an assert before use: secrets through their commitment (`commit`, `recoveryCommit`, `licenseCommit`), the Merkle path through `checkRoot` and its leaf, the challenge only published inside a hash a verifier recomputes. |
| No `ownPublicKey()` for caller identity | Not used anywhere. Callers prove a secret behind a commitment. (The class OpenZeppelin's August 2026 Compact audit found as N-08.) |
| `disclose()` at the point of use | 43 `disclose` calls, each enumerated: commitments, hashes, booleans, a slot number, a Merkle root. No witness value is disclosed except through a domain-separated hash. |
| `persistentHash` for state, domain separation | Every hash is `persistentHash` with a distinct `veilcore:v1:*` prefix. No `transientHash`. |
| Commitment randomness not reused | Secrets are 32 random bytes per record, licence and recovery; the client never reuses one. |
| Nullifiers against reuse | Presentation tags bind a verifier's challenge; challenges are single-use off chain (`ChallengeBook`). |
| Sealed configuration | `protocolVersion` is `sealed`. |
| Error messages leak nothing | Every assert message is a constant string. |
| Unlinkability | Not a goal for a record's own actions: a record is a public identity and its actions are linkable by design (design.md Known limits, "Rotation does not unlink"). Licence presentations do not name the licence. |

## 2. Mutation testing, contract

Every one of the 68 `assert`s in `veilcore.compact` was disabled in turn
(`assert(true || …)`), the contract recompiled, and the full suite run. A mutant the suite
does not notice is a rule the tests did not actually check.

**64 of 68 caught.** The 4 that survived:

| Line | Check | Verdict |
|---|---|---|
| 296 | `assertUnused`: not an origin with history | Equivalent: every origin in `headOf` is also in `recoveryOf` (set at anchor, never removed), which the line above already checks. Defence in depth, no gap. |
| 414 | `recoverRecordSecret`: you hold the secret behind the new commitment | **A real test gap.** Test added (`mutation-gaps.test.ts`); it fails with the check disabled. |
| 467 | `countersignLicense`: 1,024 active licences per issuer | Covered only by a slow test (`SLOW_TESTS=1`, about 2,000 circuit calls), which had never run to completion. It now has: see below. |
| 626 | `confirmParent`: at most two parents | Equivalent: a child has one pending proposal at a time and `proposeParent` refuses a third parent, so nothing can add a parent between proposal and confirmation. |

A test of the cycle a pair of mutual parent proposals would create was added too, though
the check it exercises (line 625) was already caught.

**The slow test, run to completion.** Its first full run died after 27 minutes with
`RuntimeError: unreachable` in the WASM runtime, and every later test in the file failed
with it. The cause was the test simulator, not the contract: its `freeSlot` helper
scanned the licence slots from 0 on every activation, N^2 ledger queries, and at N = 1,024
the runtime ran out of memory. Made linear, the whole file passes in 4 minutes, including
the 1,024-active-licence cap and that revoking one frees a place.

## 3. Canonicalisation across the three implementations

The format's promise is that any implementation computes the same commitment for the
same record. A three-way differential run fed 27,000 JSON inputs through the
TypeScript, Python and Rust implementations. **They disagreed** on:

- floats with an integral value: `95.0` committed as `95` (TypeScript) and `95.0` (Python,
  Rust), so a germination figure from a lab's Python system would verify as altered in a
  browser;
- `1e16`, `1e21`, `1.5e300`: written differently by each;
- integers above 2^53: rounded by TypeScript, kept exact by Python and Rust;
- unpaired surrogates: committed by TypeScript as U+FFFD, so three different strings
  hashed alike; refused by Python only when hashing; unparseable in Rust;
- the last digit of about 1 in 11 random doubles in Rust, whose JSON parser was not
  correctly rounded by default.

Fixed in veilcore-sdk v0.14.0 and veilcore-rs 0.2.0: numbers above 2^53 − 1 in
magnitude are invalid (spec 4.4 rule 8), every other number is written in ECMAScript form
(`95.0` → `95`), and unpaired surrogates are invalid (rule 1). 81,000 random inputs now
agree three ways. 14 conformance vectors were added, given as JSON text so that `95.0`
survives; the old TypeScript fails 7 of them, the old Python 11.

The conformance tooling had two faults of its own, both fixed: the CLI runner sent the
non-finite rejection vector through `JSON.stringify`, which turned it into a null, so it
tested null rejection under that name; and the generator built attestation vectors after
its shrink check, so every regeneration was refused unless forced.

## 4. Repository hygiene

`SECURITY.md` was Midnight Foundation's policy, inherited from the example this
repository was forked from, and directed VeilCore vulnerability reports to Midnight.
Replaced with VeilCore's own; `SECURITY.md` added to veilcore-sdk, veilcore-rs and
veilcore-api. `docs/incident-response.md` added.

## 5. Mutation testing, verifier (`contract/src/verify.ts`)

StrykerJS 9, 283 mutants of `verify.ts`, against the nine test files that exercise it.

**First run: 217 killed, 47 survived, 17 not covered.** Leaving aside changed wording of
messages, the gaps that mattered:

- **`commitmentsOf` returning every identity's successors, not just the issuer's,
  survived.** The code is right; nothing tested it. Had it been wrong, a licence from B,
  presented under B's rotated record, would have been accepted as a licence from A.
- **Reloading the challenge book** (saved entries passed back in) and **`absorb`**
  (merging another run's book) were not exercised in these files. Either one broken would
  let a used challenge be used again after a restart.
- **The `entries()` age cut** inverted (keeping nothing) survived, which would also have
  forgotten used challenges.
- **Refusing all-zero or wrong-length challenges** was not tested directly.
- **A refused presentation must not use up its challenge** was not tested.
- **`issue` never repeating a challenge already in the book**, and the seven-day default.

Tests added in `mutation-gaps-verifier.test.ts` (12). **Second run: 246 killed, 31
survived, 4 not covered**; of those, all but wording changes are equivalent mutants or
boundaries of no consequence:

- an early return that a later check makes redundant (`presentationSeq === 0`);
- a line marked unreachable;
- `rootsKnown` with no roots, which needs a cycle the contract refuses;
- `absorb` overwriting one "used" timestamp with another;
- `>` against `>=` at the exact expiry instant;
- `acceptOwnership` refusing challenges that contain any zero byte, which only refuses
  more.

## Not covered by this round

- An independent human review of the frozen commit.
- Formal verification of any circuit.
- The proving system and Midnight's own components, which are out of scope.
