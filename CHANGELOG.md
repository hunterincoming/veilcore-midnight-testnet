# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Partner integration kit (6 Oct 2026)

- New workspace `partner-kit/`: the package `@veilcore/contracts` (Apache-2.0, ESM, Node 24)
  for labs, registries, certifiers and vendors to call VeilCore's contracts from their own
  systems. `connect` (network, endpoints, a wallet and private state they supply, or
  `seedWallet` and `encryptedPrivateState`), `VeilCore.join` and `VeilCoreClaims.join`
  (mainnet: the pinned addresses only), every partner operation of both contracts, and
  checks that need no wallet (`checkPresentation`, `checkOwnership`, `checkBatchAnchor`,
  `readClaim`). Deploying, circuit keys and the maintenance authority are not exported.
- Proving keys and circuits are not shipped: they are loaded from a folder or a URL and
  every file is checked against the deployment record's fingerprints (`veilcore-keys`).
  The compiled contract code ships byte for byte as fingerprinted.
- `docs/PARTNERS.md`; three runnable examples (lab, breeder licence, claims); `npm run
  partner-check` runs all three on preprod through the public package only.

### Claims contract ready for mainnet (5 Oct 2026)

- `docs/fingerprints.md` has a second table for the claims contract, written by
  `npm run fingerprints:claims` (refuses unless the same build of the main contract still
  matches its table); `npm run fingerprints:check` checks both and writes nothing. Each
  contract's build is checked against its own table only. The claims table is not yet
  generated (the keys need proving parameters; runbook C0).
- A claims deploy off a test network is allowed only when it ends with an empty-committee
  maintenance authority, the deployment record revision is declared, and the build matches
  the committed claims fingerprints; it was refused everywhere off a test network before.
- Joining (and so reading claims from) the claims contract on mainnet accepts only
  `MAINNET_CLAIMS_ADDRESS` (empty until the deploy). CLI options 35 and 36 check the claims
  build first on mainnet; the mainnet start-up warns if the claims build does not match.
- The claims deploy prints its deploy transaction id.

### Security (round D, 4 Oct 2026: operator tooling before mainnet)

- The maintenance key and one-call secrets (recovery secret, incoming record secret,
  licence secret, presentation challenge) are never written to the local private-state
  store; they are held in memory for the call. "Finish a deploy" always asks for the key
  from paper.
- The private-state store moved from `bboard-cli/midnight-level-db` to
  `~/.veilcore/<network>/private-state` (folders 0700, files 0600). An old folder is
  detected and its live entries can be copied (without maintenance keys); the old folder
  is never changed or deleted by the CLI.
- Replacing the recovery secret checks whether it landed, and says which secrets to keep.
- Join checks the contract started from the constructor's state; on mainnet it accepts
  only the pinned address (`MAINNET_VEILCORE_ADDRESS`, empty until the deploy).
- A secret change is believed landed only on two agreeing chain reads 30 s apart; new
  menu options 41 (use a record secret you hold) and 42 (check a recovery secret).
- State-stream errors no longer crash the CLI; rule 5 refuses presentations older than an
  hour or older than their challenge; circuit names match exactly; the password is kept
  out of the environment and git runs with a minimal environment; the main contract
  retires provably (empty committee).
