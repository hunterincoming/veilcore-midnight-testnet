# VeilCore security policy

This repository holds the VeilCore contract for Midnight, the operator tool used to
deploy and maintain it, the registry API client and the reference web app. It began as a
fork of Midnight's example-bboard; this policy replaces the Midnight Foundation policy
that came with the fork. Vulnerabilities in VeilCore code are ours to fix, so please
report them to us, not to Midnight.

## Reporting a vulnerability

Please do not open a public issue.

- **Preferred:** GitHub private vulnerability reporting on this repository
  (Security tab → "Report a vulnerability").
- **Or email:** hunter@veilcore.org, subject starting "SECURITY".

Helpful to include: the commit or deployed contract address, what an attacker can do,
and the steps or test that show it. A failing test against `contract/src/test/` or
`bboard-cli/src/` is the fastest route to a fix.

We acknowledge within three business days and send an assessment within a further five.
We credit reporters in the fix and the deployment record unless asked not to.

## What is in scope

- `contract/src/veilcore.compact` as deployed (fingerprints: `docs/fingerprints.md`)
- `contract/src/verify.ts` (the off-chain checks a verifier relies on)
- `api/` and `bboard-cli/` (deploy, maintenance, key handling)
- `bboard-ui/` (the reference web app)

The record format and its other implementations live in
[veilcore-sdk](https://github.com/hunterincoming/veilcore-sdk) and
[veilcore-rs](https://github.com/hunterincoming/veilcore-rs); the same contacts apply.
Bugs in Midnight itself (node, ledger, compiler, wallet, indexer) belong with Midnight:
see https://github.com/midnightntwrk.

## What happens after a report

`docs/incident-response.md` sets out the steps, and `docs/maintenance-policy.md` how a
fix reaches the deployed contract.
