# Preprod run, 5 October 2026 (after attack round D)

Hunter ran the smoke test on his Mac (Node 24.19, npm 11) on main at `d9d563f`, the first run of the
operator tool after round D: private state in `~/.veilcore/preprod/private-state`, maintenance key held
in memory only, the join check that reads the deploy transaction, and the claims mainnet gate.

**Result: SMOKE TEST PASSED, 37 of 37.** 19:01 to 19:13 local time, wallet seed 2.

| | Address |
|---|---|
| Main contract | `93c062e10863ee8d4d72694a42908aa6c55036645fcc327fafc533bc827dc294` |
| Claims contract | `29d3ea80e121518f8fd8bd72533d856cf29cdbddbda1b6f322a661aa4f2484b6` |
| Claims deploy transaction id | `0060fbb06e1483161bf0bee8204491ca09b698be70f59e9cc0e18e635cc8fbedcc` |

- Main contract phase: 26 checks, including licence issue, countersign, prove, transfer with sealing,
  revocation by a successor, both-holder lineage, a royalty on the grower's lineage, recovery, and the
  refusals (stranger confirming parentage, parents changed after offspring, used recovery secret,
  stolen secret releasing a royalty).
- Claims phase: deployed with all 5 circuit keys, maintenance authority replaced by an empty committee
  (chain shows nobody can change it), then value, range (and a refused bound), distinctness, unchanged
  (and a refused mask), lab-signed, and the verifier reading a range claim together with the lab
  signature.

Found during the run, not by the test:
- The old private-state folder (`bboard-cli/midnight-level-db`) held entries from earlier runs under
  more than one password, so MOVE refused ("The password does not open the old store. Nothing was
  copied."), as designed. It held only test-network data; Hunter moved it to `~/Desktop/old-test-store`
  and the run started a fresh store. Delete that folder.
- Check 27's message said "seven" circuit keys; the claims contract has five. Wording fixed.
- `npm ci` failed on npm 11.21 because the lockfile only satisfied npm 11.6.2. Fixed in `d9d563f`.
