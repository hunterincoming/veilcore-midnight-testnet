# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### VeilCore-run, managed service v1 (6 Oct 2026)

- New folder `veilcore-run/` and `npm run managed`: VeilCore operates on chain for partners
  with no developers, through the partner kit's public exports only. Each partner's secrets
  are in their own encrypted store (scrypt N=2^17, AES-256-GCM, owner-only files, a password
  per partner), never in the operator's own private state; the chain clients run with
  in-memory private state. Every partner operation, a hash-chained audit log per partner
  with no secrets, export bundles encrypted to the partner's passphrase, printable sheets.
- Recovery secrets stay with the partner by default: one master sheet made on their own
  computer (`partner-keys`), VeilCore given only commitments.
- Exit: self, or assisted (the partner's recovery commitment replaces VeilCore's, then each
  record is rotated to a secret made in the run and sealed straight into the partner's
  bundle); resumable; the partner's own recovery (`partner-recover`, `partner-check`) is the
  required last step, and `exit-check` shows it on chain. The store is then retired and every
  operation refused; `purge` deletes the remaining secrets and the bundle files.
- After the independent review (same day): bundles sealed to an X25519 key derived from the
  partner's master (no passphrase typed on VeilCore's computer, no plaintext sheets there);
  pools and exit answers confirmed by a fingerprint the partner reads out; "can act" status
  from what VeilCore actually holds; audit log anchored on chain with receipts; lock before
  read; `change-password` fixed; obligation terms never on the command line.
- `docs/MANAGED.md`; `docs/PARTNERS.md` now lists three options at launch;
  `docs/legal/managed-service-agreement-DRAFT.md` (draft, for a lawyer).

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
