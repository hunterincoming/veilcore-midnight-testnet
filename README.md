# Veilcore

**Zero-knowledge provenance and licensing for cannabis genetics — built on the [Midnight Network](https://midnight.network/).**

Breeders have no working way to prove they created a strain first. Federal IP protection is effectively closed to them, and written licensing agreements have a documented flaw: **contracts bind signatures, not genetics** — if material reaches someone who never signed, the contract does nothing.

Veilcore is the enforcement layer. It gives a breeder:

- **Prove you made it first** — an un-forgeable, timestamped record from the moment it's logged.
- **Pair your DNA report** — bind the record to the actual genetics using the report your testing lab returns.
- **License with terms bound to the genetics** — a real licensing instrument with a lifecycle (draft → signed by both → active → expired/revoked) whose terms travel with the plant.
- **Prove ownership — revealing nothing** — demonstrate you hold a strain, or a valid license, in zero knowledge.

**No custody, ever.** All hashing happens locally in your browser (SHA-256 + the contract's `commit` circuit via WebAssembly). Only fingerprints are ever recorded — your genetics, license terms, and counterparties never leave your device.

## Project structure

```
contract/     # Compact smart contract (veilcore.compact) + generated bindings
api/          # Shared types and the VeilcoreAPI (deploy/anchor/proveOwnership)
bboard-cli/   # CLI used to sync a wallet and deploy to testnet
bboard-ui/    # The Veilcore web app (the product) — React + Vite
```

## Run the demo locally

Requires **Node 24** (`.nvmrc` pins `24.11.1`). The demo needs no wallet, faucet, or Docker.

```bash
npm install          # from the repo root (npm workspaces)
cd bboard-ui
npm run dev          # http://localhost:5173
```

The full flow works out of the box: log a strain, pair a DNA report, view the evidence package, license a strain and counter-sign it, and prove ownership. Records persist in `localStorage`; the dashboard has **Export / Import / Reset demo**.

## Current status

- **Contract compiles.** `veilcore.compact` builds with the Compact compiler `0.31.1` (language `0.23`, runtime `0.16`). Provenance circuits (`anchor`, `proveOwnership`) are on `main`; the licensing circuits (`pairDna`, `issueLicense`, `countersignLicense`, `revokeLicense`, `proveLicense`, `licenseStatus`) are on the `veilcore-contract-licensing` branch — **compiled and typechecked, not yet deployed.**
- **Demo runs on real local crypto with simulated settlement.** The commitment hashing is genuine and runs in-browser; the on-chain settlement is simulated in demo mode and auto-upgrades to the live contract once it's deployed and a wallet is wired.
- **Testnet deploy pending.** A full Preprod wallet sync now completes with bounded memory (see the CLI in `bboard-cli/`); Preview deployment is the next step.

## What Veilcore does *not* claim

The product is deliberately honest, and so is this README:

- The tamper-proof timestamp is the **moment you log a record** ("first to log it, first in line"). The editable "date created" is the breeder's own claim — Veilcore does not prove a backdated creation date.
- Records are **evidence an attorney can rely on** to establish prior possession — not a self-executing legal verdict of ownership.
- Veilcore **pairs the DNA report** your lab returns; it does not sequence DNA, and it is lab-agnostic (no specific lab required).
- In-app signatures are **cryptographic signatures binding parties to a record** — not qualified/eIDAS electronic signatures.
- The royalty log **records and proves obligations**; it does not process payments.

## License

Apache-2.0. Built on the Midnight Network.
