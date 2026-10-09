# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixes from the 8 October review (8 Oct 2026)

- **Site:** copy on what a DNA pairing shows, what the maintenance key can do, anchoring
  and privacy, with the translations; the verify page shows a grey seal unless an anchor
  is checked on chain, times in UTC; a not-found page and robots.txt; a smaller build.
  Docs vendored from veilcore-sdk `33fa929`. The translation worksheets are out of date
  and need regenerating.
- **Client checks:** every verdict's lookup compares the circuits' verifier keys with the
  pinned build (always on mainnet) and reports the maintenance authority (committee,
  threshold, counter; `authorityCounter` can require one). An optional second indexer
  must agree on call, block and state. The partner kit refuses a network name that does
  not match its indexers or address. Rule 5 has an issuer-scoped form
  (`acceptPresentationScoped`) for a caller who supplies the history since the last seal;
  the strict rule stays the default. Licence requests are built against the issuer's
  current head (`licenseRequest`). Claims check 8 refuses a mask over every described
  slot and matches `supersedes` beyond `recordId`. The package's canonical JSON refuses
  what the SDK refuses.
- **CLI:** one CLI per private-state store (`private-state.lock`); every secret it shows
  is redacted from then on. Proof server containers bind 127.0.0.1 only.
- **Partner kit:** a remote proof server is refused unless `allowRemoteProofServer`, then
  https only; credentials in endpoint URLs are kept off the terminal (`scrubTerminal`).
  These need a 0.3.0 release of `@veilcore/contracts`, not yet published; 0.2.0 on npm
  does not have them.
- **Docs:** design, partner guide, maintenance policy and deployment record match the
  above. Still open: the mainnet authority counter to expect (a TODO), and Docker image
  digests (all three images are on tags).
- **Deploy tool:** Vercel CLI stays on 62.2.0 with `tar` overridden past the critical
  advisory.

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
- After a fresh-session AI review (same day; not an audit): bundles sealed to an X25519 key derived from the
  partner's master (no passphrase typed on VeilCore's computer, no plaintext sheets there);
  pools and exit answers confirmed by a fingerprint the partner reads out; "can act" status
  from what VeilCore actually holds; audit log anchored on chain with receipts; lock before
  read; `change-password` fixed; obligation terms never on the command line.
- After the re-check: an exit reconciles with the chain before acting (a hand-over that landed
  late is done, from the bundle that holds it; a recovery replacement that landed unrecorded is
  applied, also before a self exit); `exit-cancel` for an exit that sent nothing;
  `partner-check-receipt`, with the log's raw lines in every bundle; `purge` anchors the log
  after the purge line; unusable bundle keys refused.
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
