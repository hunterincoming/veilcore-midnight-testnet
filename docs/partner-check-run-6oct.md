# Partner kit check, preprod, 6 October 2026

Hunter ran `npm run partner-check` on his Mac on main at `19c9555`, wallet seed 2, proof server
`midnightntwrk/proof-server:8.0.3` in Docker. First live run of the partner kit
(`@veilcore/contracts`), which uses only the package's public exports: no deploy, circuit-key or
maintenance operation is reachable from it.

**Result: PARTNER KIT CHECK PASSED, 23 of 23.** About 20:07 to 20:12 local time (blocks 2868980 to
about 2869010).

| | Address |
|---|---|
| Main contract (joined, not deployed) | `93c062e10863ee8d4d72694a42908aa6c55036645fcc327fafc533bc827dc294` |
| Claims contract (joined, not deployed) | `29d3ea80e121518f8fd8bd72533d856cf29cdbddbda1b6f322a661aa4f2484b6` |
| Laboratory batch transaction | `006c523bdf96c818bdab3a0c2016e99fea51d58e5e60d33739411539fb2143ed6b` |
| Range claim transaction | `00595a25d34ed92696ba6ae15015abafdad26f13c977e152f7972d6a760f5513a5` |
| Attested claim transaction | `00fa2f31bf069d155303fa81478c2d0a4e3ff1296dd02998c5f4809b28bce5e58e` |

- Check 1: all 87 proving keys, verifier keys and circuits match the deployment record (main contract
  built at `ceb3a16`, claims at `c75c155`, compiler 0.31.1), before any transaction.
- Checks 2-3: join both contracts; every circuit key on chain matches; the main contract started from
  the constructor.
- Checks 4-11, a laboratory: intake sealed with the SDK and bound to its on-chain identity, anchored,
  inclusion proof folds to the batch root, a wallet-free verifier finds the root on chain, the signed
  report verifies, `pairDna` binds the report, the possession proof is accepted for the right challenge
  and refused for another.
- Checks 12-18, a licence: issued, countersigned, accepted by a wallet-free buyer, replay refused,
  another buyer's challenge refused, presentation refused after revocation (the check the 6 October
  review's blocker would have failed).
- Checks 19-23, a claim: the claims contract's maintenance authority is an empty committee; the SDK and
  chain agree on the record commitment; an unmet bound cannot be proved; read back by transaction id
  the chain shows the bound and never the number; the verifier's sentence for a lab-signed range claim.

Nothing went wrong during the run. The two "RPC-CORE ... Normal Closure" lines during wallet sync are
the node's websocket reconnecting, not errors.
