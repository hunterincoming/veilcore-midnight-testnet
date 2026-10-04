# Preprod run, 4 October 2026: both contracts, 37 of 37

Hunter ran the full smoke test with the claims phase (`npm run preprod-remote`, option 3,
claims phase yes) on the `claims-contract` build, on his MacBook Air (16 GB), against
Midnight preprod.

**Result: `SMOKE TEST PASSED: 37 checks passed.`**

- Main contract: `f239e680f1f60c38990b7066c59c9538a42c2ae414e584e21155350a7e93306a`
- Claims contract: `175f23573c3d9c9dd20d8bee159df07fc3b739e6a2a895f14ae4d20de5d2a4af`

Checks 1-26 are the main contract (as on 2 October). Checks 27-37 are the claims contract:
deployed with all five circuit keys, its maintenance authority replaced by an empty
committee and read back from the chain, then a value claim, a range claim, a refused range
claim, a distinctness claim, an unchanged claim, a refused unchanged claim, a laboratory's
attested claim, the verifier reading a range claim together with the attested claim, and a
refused read of a transaction that made no claim. Each claim was proved on the laptop and
landed in about 20-30 seconds, for example:

| Check | Circuit | Block |
|---|---|---|
| 29 | proveValue | 2838472 |
| 30 | proveRange | 2838476 |
| 32 | proveDistinct | 2838481 |
| 33 | proveUnchanged | 2838486 |
| 35 | proveAttested | 2838489 |
| 36 | proveRange (verifier with attestation) | 2838493 |

The same build passed 37 of 37 on a local chain earlier the same day, with the proof
server peaking at 3.7 GB (docs/claims-design.md, Size).

## What this does not show

- Nothing is on mainnet yet. The claims contract refuses a mainnet deploy until its keys
  have committed fingerprints and it is in a filed deployment record.
- No independent security audit.
- Made-up marker data only; no real breeder or laboratory has used it.
