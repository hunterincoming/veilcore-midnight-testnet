# VeilCore

**Provenance and licensing for plant and animal genetics, built on the [Midnight Network](https://midnight.network/).**

**Live → https://veilcore.org** — runs in your browser; no wallet, faucet or install required. Settlement is simulated there; see Current status.

A breeder who holds genetic material may later need to establish three things: that they held it, from a date preceding someone else's acquisition of it, and that material in another party's possession descends from theirs. These are historical claims, ordinarily supported by the holder's own records — which is the weakest evidence available, because it is produced by the party relying on it and can be created after the fact.

Written agreements have a related problem. A contract binds the parties who signed it. It cannot bind a plant that did not exist when it was signed, which is why a cutting that becomes a mother that becomes ten thousand clones carries no obligation anyone can point at.

VeilCore records what was held and when, binds terms to the record rather than to a signature page, and lets an obligation on an ancestor be carried by everything derived from it.

- **Prove prior possession** — a sealed, dated record from the moment it is logged.
- **Pair a DNA report** — bind the record to the genetics using the report your testing laboratory returns.
- **License with terms bound to the record** — draft, countersigned, active, expired or revoked, with the terms travelling with the material.
- **Prove a claim without disclosing it** — show you hold a record, or a live licence, in zero knowledge.

**No custody, ever.** Hashing happens locally in the browser. Only commitments are ever recorded; the genetics, the terms and the counterparties never leave the device.

Cannabis is the first vertical, not the scope. The record format is domain-blind: the same envelope serves ornamental propagation, a livestock herd book, or a microbial culture collection.

## What this repository is

This is the application — the contract, the API, the CLI and the web app.

The record format itself is a separate, open specification with independent implementations in TypeScript, Python and Rust: **[veilcore-sdk](https://github.com/hunterincoming/veilcore-sdk)**. Verification needs SHA-256 and nothing from this repository or from us.

```
contract/     # Compact contracts (veilcore.compact, lineage.compact) + generated bindings
api/          # VeilcoreAPI and lineage API — deploy, anchor, licence lifecycle
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

Log a record, pair a DNA report, view the evidence package, issue and countersign a licence, prove possession. Records persist in `localStorage`; the dashboard has Export, Import and Reset.

## Building from a fresh clone

`contract/src/managed/` is gitignored, so a fresh clone has no compiled contract. You need the Compact toolchain, and the packages build in order.

```bash
# 1. Install the Compact toolchain
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
# open a new terminal, then:
compact update

# 2. Compile the contracts (generates contract/src/managed/)
cd contract && npm run compact

# 3. Build in order
cd contract && npm run build
cd ../api && npm run build
cd ../bboard-ui && npm run build
```

## Current status

**The contract is deployed on preprod and has been independently attacked.**

`fb9c55944908c466dcea7b9807f00ea727b37cebec13870080016ddc5a9d721d` — twelve circuits covering anchoring, DNA pairing, the licence lifecycle and assignment.

An outside developer compiled it, deployed it, and replayed every call as an attacker. Four authorisation gaps were found and fixed. A fifth, found on a subsequent read-through, was in transfer: reassigning a holder field moved nothing, because a licence's identity is the secret behind its commitment and a secret cannot be un-known — the outgoing party kept every power they had. Transfer was rewritten as assignment: the old licence ends and a new one begins under a commitment the incoming party generated.

All of it is kept as regression tests in `contract/test-contract.mjs`, which `npm test` runs.

That was an adversarial review, not a formal security audit. We will not call it one.

**The web app runs real hashing against simulated settlement.** Commitment hashing and the `commit` circuit run genuinely, in the browser. Nothing the app does is submitted to a live network yet, and every screen where that matters says so. The CLI in `bboard-cli/` is what talks to a deployed contract.

**Nothing is deployed to mainnet.**

**MPS-0037**, the proposal for obligations that inherit through descent, is merged into Midnight's standards repository.

## What VeilCore does not claim

- The sealed timestamp is the moment a record is logged. The editable creation date is the holder's own claim; this does not prove a backdated one.
- A record establishes **prior possession, not ownership**. It is evidence a lawyer can rely on, not a verdict.
- It **pairs** the DNA report a laboratory returns. It does not sequence anything, and it is laboratory-agnostic.
- In-app signatures bind parties to a record cryptographically. They are not qualified eIDAS signatures.
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
