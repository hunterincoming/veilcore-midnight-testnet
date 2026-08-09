# Veilcore

**Zero-knowledge provenance and licensing for cannabis genetics — built on the [Midnight Network](https://midnight.network/).**

**Live demo → https://veilcore.vercel.app** — runs entirely in your browser; no wallet, faucet, or install required.

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

> Veilcore is built on Midnight's `example-bboard` scaffold, so some naming is inherited from it — most visibly the `bboard-` directory prefixes and stray `bboard` references in tooling. The product itself is Veilcore.

## Run the demo locally

The [live demo](https://veilcore.vercel.app) is the hosted version of exactly this. To run it yourself:

Requires **Node 24** (`.nvmrc` pins `24.11.1`). The demo needs no wallet, faucet, or Docker.

```bash
npm install          # from the repo root (npm workspaces)
cd bboard-ui
npm run dev          # http://localhost:5173
```

The full flow works out of the box: log a strain, pair a DNA report, view the evidence package, license a strain and counter-sign it, and prove ownership. Records persist in `localStorage`; the dashboard has **Export / Import / Reset demo**.

## Current status

- **Provenance is deployed.** The provenance circuits (`anchor`, `proveOwnership`) are deployed on Midnight **Preview** at contract address `4a457e6d046928e0faa971d80701b8cd48c3a1283713039444b47fedd0a1f3c7`.
- **Licensing is built, not yet deployed.** The licensing circuits (`pairDna`, `issueLicense`, `countersignLicense`, `revokeLicense`, `proveLicense`, `licenseStatus`) compile clean but are not yet deployed. The full 9-circuit `veilcore.compact` lives on `main`, built with the Compact compiler `0.31.1` (language `0.23`, runtime `0.16`).
- **The web UI currently runs real local hashing with simulated settlement.** Commitment hashing is genuine and runs in-browser; on-chain settlement in the UI is still simulated and will move to the deployed contract once a wallet is wired in.
- A full Preprod wallet sync now completes with bounded memory (see the CLI in `bboard-cli/`).

## What Veilcore does *not* claim

The product is deliberately honest, and so is this README:

- The tamper-proof timestamp is the **moment you log a record** ("first to log it, first in line"). The editable "date created" is the breeder's own claim — Veilcore does not prove a backdated creation date.
- Records are **evidence an attorney can rely on** to establish prior possession — not a self-executing legal verdict of ownership.
- Veilcore **pairs the DNA report** your lab returns; it does not sequence DNA, and it is lab-agnostic (no specific lab required).
- In-app signatures are **cryptographic signatures binding parties to a record** — not qualified/eIDAS electronic signatures.
- The royalty log **records and proves obligations**; it does not process payments.

## License

Apache-2.0. Built on the Midnight Network.

## Building from a fresh clone

`contract/src/managed/` is gitignored, so a fresh clone has no compiled contract.
You need the Compact toolchain and you must build in order.

```bash
# 1. Install the Compact toolchain
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
# open a new terminal, then:
compact update

# 2. Compile the contracts (generates contract/src/managed/)
cd contract && npm run compact

# 3. Build in order — contract, then api, then ui
cd contract && npm run build
cd ../api && npm run build
cd ../bboard-ui && npm run build
```

### Deploying

Always use `--prebuilt`. Never run bare `vercel --prod` — it builds from source
and has broken production before.

```bash
cd ~/Desktop/veilcore
mkdir -p .vercel/output/static
cp -r bboard-ui/dist/* .vercel/output/static/
echo '{"version":3,"routes":[{"handle":"filesystem"},{"src":"/.*","dest":"/index.html"}]}' \
  > .vercel/output/config.json
npx vercel deploy --prebuilt          # preview
npx vercel deploy --prebuilt --prod   # production
```
