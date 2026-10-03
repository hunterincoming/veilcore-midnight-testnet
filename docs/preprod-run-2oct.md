# Preprod run, 2 October 2026

The contract that is planned for mainnet was deployed to Midnight's test network
(preprod) and put through the end-to-end smoke test. It passed all 26 checks.

| | |
|---|---|
| Result | `SMOKE TEST PASSED: 26 checks passed.` |
| Finished | 2 October 2026, 14:35 EDT |
| Contract address (preprod) | `9c7b69275e53acc38fcbebff93c53febe46a3898580c11fd2c4b923fc5efb7a3` |
| Last transaction | `discharge`, preprod block 2808047 |
| Operator tool | commit `455cf05` |
| Run by | Hunter Roberts, on his own machine |

## What the run covers

It deploys a fresh contract and calls 16 of the contract's 24 circuits with real
zero-knowledge proofs, checking each result. It does not call `anchorBatch`,
`replaceRecoveryCommitment`, `withdrawTransfer`, `withdrawParent`, `proposeObligation`,
`acceptObligation`, `rejectObligation` or `withdrawObligation`; those are covered by the
contract's unit tests, not by this run.

The contract is too large to deploy in one transaction, so the deploy carries the first
8 circuit keys and adds the rest one maintenance transaction each. On preprod all 8 fitted
at the first attempt.

## What went wrong first

An earlier attempt the same morning was refused before any contract was created, with
`1010: Invalid Transaction: Custom error: 171` (OutOfDustValidityWindow), while the
preprod indexer lagged the chain. The operator tool misread that refusal as a block-size
limit. That was fixed in `455cf05`, and the run above used the fix.

After this run, a further review changed the operator tool's failure paths only
(error messages, a forced stop, scrubbing secrets from the terminal). The successful path
and the contract are as run here. The local smoke test was run again on the final tool
(`c0647dc`) the same evening and passed 26 of 26.

## What this does not show

- Nothing is deployed to mainnet yet.
- There has been no independent security audit. Our own reviews are in this repository:
  [`docs/self-audit-3oct.md`](self-audit-3oct.md) and
  [`docs/security-pass-30sep.md`](security-pass-30sep.md).
- The full record of this deployment, including decisions still open, is the draft
  [`docs/deployment-record-revision-4.md`](deployment-record-revision-4.md).
