# VeilCore

**Provenance and licensing for plant and animal genetics, built on the [Midnight Network](https://midnight.network/).**

**Live → https://veilcore.org** — runs in your browser; no wallet, faucet or install required. Settlement is simulated there; see Current status.

A breeder who holds genetic material may later need to establish three things: that they held it, from a date preceding someone else's acquisition of it, and that material in another party's possession descends from theirs. These are historical claims, ordinarily supported by the holder's own records — which is the weakest evidence available, because it is produced by the party relying on it and can be created after the fact.

Written agreements have a related problem. A contract binds the parties who signed it. It cannot bind a plant that did not exist when it was signed, which is why a cutting that becomes a mother that becomes ten thousand clones carries no obligation anyone can point at.

VeilCore records what was held and when, lets licences be granted against a record, and lets an obligation on an ancestor be carried by everything derived from it.

- **Prove prior possession** — on chain, an anchored record is dated by the block it lands in. (The web app does not anchor yet; see Current status.)
- **Pair a DNA report** — record a DNA report fingerprint against your record. The contract binds whatever 32-byte value the holder submits: it is the holder's own statement that this report belongs to this record, not a check of the genetics. The web app keeps the pairing in the registry, not on chain.
- **License against the record** — on chain a licence is only PENDING (issued) or ACTIVE (countersigned), and revoking removes it. The contract stores no terms and has no expiry. Terms, dates, expiry and the royalty log are kept by the app, in the VeilCore registry. A presentation proves "a live licence from this issuer", not which licence or on what terms.
- **Prove a claim without showing the secret** — prove you hold a record, or a licence, without revealing the secret behind it. An ownership proof publishes the record's commitment. A licence presentation hides the licence and the licensee, and the issuer only among issuers with live licences; while only one issuer has live licences, as at launch, it names that issuer.

**What leaves your browser.** DNA reports and photos are hashed in the browser; only their fingerprints and the report's file name leave it. The web app stores the rest on the VeilCore registry (a server we run), keyed by a random holder key your browser keeps in `localStorage` and sends with every request (whoever has the key can read and change your set): each record's contents (cultivar, breeder, dates, notes, parents, method, your reference, the nonce behind its fingerprint, the fingerprints, the DNA pairing) and each licence in full (counterparty, terms, dates, status, royalty log). Anyone with a record's id can see its id, cultivar, fingerprint, the logging time you claimed and when the registry first saw it. On chain, only commitments are recorded, plus the public values listed under Known limits in [`docs/design.md`](docs/design.md).

Plant genetics is the first use, not the limit. The record format is domain-blind: the same envelope serves ornamental propagation, a livestock herd book, or a microbial culture collection.

## What this repository is

This is the application — the contract, the API, the CLI and the web app.

The record format itself is a separate, open specification with implementations in TypeScript, Python and Rust (all three written by the same team; an implementation by someone else is still to come): **[veilcore-sdk](https://github.com/hunterincoming/veilcore-sdk)**. Checking a record's fingerprint needs SHA-256 and nothing from this repository or from us. Checking what the contract says (anchors, licences, lineage) needs Midnight's tooling to read chain state; see Current status.

```
contract/     # The Compact contract (veilcore.compact), verifier rules (verify.ts), tests, hash vectors
api/          # VeilcoreAPI: records, licences and lineage from a client
bboard-cli/   # CLI for wallet sync and deployment
bboard-ui/    # The web app — React + Vite
```

> The `bboard-` directory names are inherited from the Midnight scaffold this was forked from. The example code itself has been removed; only the directory names remain, because renaming them touches every relative import for no benefit.

## Running it locally

Requires **Node 24** (`.nvmrc` pins `24.11.1`). No wallet, faucet or Docker needed for the app.

```bash
npm install --legacy-peer-deps   # from the repo root (npm workspaces)
cd bboard-ui
npm run dev                      # http://localhost:5173
```

Log a record, pair a DNA report, view the evidence package, issue and countersign a licence, prove possession. Records and licences are saved to the registry named by `VITE_API_BASE` (the live site uses VeilCore's). With it unset, `npm run dev` has no registry to save to, so records last only for the browser session; to keep them, run the registry (the `veilcore-api` repository, not yet public; `npm start`, port 8787) and start the app with `VITE_API_BASE=http://localhost:8787`. Only the holder key, and a few settings, are kept in `localStorage`. The dashboard has Export, Import and Reset.

## Building from a fresh clone

`contract/src/managed/` is gitignored, so a fresh clone has no compiled contract. You need the Compact toolchain, and the packages build in order.

```bash
# 1. Install the Compact toolchain
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
# open a new terminal, then:
compact update

# 2. Compile the contract (generates contract/src/managed/) and run its tests
cd contract && npm run compact && npm test

# 3. Build in order
cd contract && npm run build
cd ../api && npm run build
cd ../bboard-ui && npm run build
```

## Current status

**One contract, `contract/src/veilcore.compact`, protocol version 1, planned for mainnet and not deployed there yet.**
It covers records, licences and lineage in 24 circuits. The design, the normative
verifier rules and the trust model are in [`docs/design.md`](docs/design.md).

An outside developer reviewed it in August. Since then it has had twelve rounds of
attack, recorded in [`docs/security-pass-30sep.md`](docs/security-pass-30sep.md): round 1,
our own pass over both contracts, and rounds 2 to 7 by reviewers who had not seen the
fixes, all on 30 September 2026; then rounds 8 to 12 on 1 October, three of them (8, 11
and 12) followed by a fresh re-attack of their fixes. Round 12 attacked the per-identity state
bounds added that evening (caps on rotations, recoveries, parents, obligations and
licences; see State bounds in `docs/design.md`). Contract findings were demonstrated against
the build before being fixed or documented. Contract attacks are kept as
tests in `contract/src/test/` (`cd contract && npm test`). Many fixes were in the CLI, the
API, the registry or the website, and are tested there instead: `bboard-cli/src/*.test.ts`
(`cd bboard-cli && npx vitest run`), `api/` (`npm test`), and the registry's
`test/*.test.mjs`. Not every attack has a test. These were adversarial reviews, not a
formal security audit, and we do not call them one.

The six commitment hashes (record, recovery, licence, licence key, presentation tag,
obligation) are plain SHA-256 over a tag and their inputs, with published test vectors
(`contract/vectors/v1.json`), so they can be recomputed in any language. The licence
tree is not: its inner nodes use Midnight's own field hash, and verifier rule 5 compares
tree roots, so checking a licence presentation, like reading any contract state, needs
Midnight's tooling.

**The web app runs real hashing against simulated settlement.** It sends nothing to
the chain. The CLI in `bboard-cli/` talks to a deployed contract. Its smoke test
(`bboard-cli/src/smoke.ts`) deploys a fresh contract and calls 16 of the 24 circuits with
real proofs, checking 26 results, including 8 attempts that must be refused (7 by the contract,
1 by the verifier's transaction lookup). It does
not call `anchorBatch`, `replaceRecoveryCommitment`, `withdrawTransfer`, `withdrawParent`,
`proposeObligation`, `acceptObligation`, `rejectObligation` or `withdrawObligation`. It
passed 26 of 26 on a local Midnight chain on this build (the state bounds, `ceb3a16`) on
1 October 2026 at 20:56 EDT, and 26 of 26 on Midnight's preprod test network on 2 October 2026
(contract `9c7b6927…`; see [`docs/preprod-run-2oct.md`](docs/preprod-run-2oct.md)).

**MPS-0037**, the proposal for obligations that inherit through descent, is merged into
Midnight's standards repository.

## What VeilCore does not claim

- On chain, a record is dated by the block its anchor lands in. In the web app, the logging time comes from the browser's clock and the creation date is typed by the holder: both are the holder's own claims. The registry adds the time it first saw the record, which is the registry's word, not the chain's. None of this proves a backdated date wrong.
- A record establishes **prior possession, not ownership**. It is evidence a lawyer can rely on, not a verdict.
- A parent link on chain means both holders **agreed** the child descends from the parent. It is not a genetic test.
- It **pairs** the DNA report a laboratory returns, as the holder's own statement. It does not sequence anything, check the report, or confirm it came from a laboratory.
- In-app "signing" and countersigning of a licence record a time in the registry. They are not cryptographic signatures, and not qualified eIDAS signatures. On chain, a countersign is proved with the licensee's licence secret.
- The royalty log records and proves obligations. It does not move money.
- It raises the cost and the evidentiary risk of laundering stolen genetics. It does not prevent it.
- Settlement in the web app is simulated. The hashing is real; the on-chain submission is not wired in yet.

## Deploying the web app

Always use `--prebuilt`. A bare `vercel --prod` builds from source and has broken production before.

```bash
npm run deploy:prod
```

## Licence

Apache-2.0. Built on the Midnight Network.
