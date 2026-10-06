# Integrating VeilCore's contracts

For laboratories, breeders, registries, seed certifiers and the software vendors who serve
them. The first part is for the person deciding whether to do it. The rest is for the
developer doing it.

The record format (how a record is written and sealed, signed reports, batches, evidence
packages) is the SDK's: see `INTEGRATING.md` in
[veilcore-sdk](https://github.com/hunterincoming/veilcore-sdk) (`veilcore-records` on npm).
This guide is the other half: putting those records on Midnight and proving things about
them, with the package `@veilcore/contracts`.

---

## Part 1, in plain English (for a lab owner)

**What you get.** Your own system keeps working as it does. For each sample or lot you
already record, your software adds one fingerprint (a 32-byte hash) and can put it on
Midnight, a public blockchain built for privacy. From then on, anyone you choose can check:

- that the record existed on that date and has not been changed since;
- that whoever shows it to them really holds it (they send a one-time challenge, you answer);
- that your lab signed the report on it;
- that a grower holds a live licence from a breeder, without the chain naming either of them;
- one fact about a record, such as "germination at least 95%", without seeing the rest.

**What leaves your building.** Fingerprints, and only when you choose to publish them.
They cannot be worked out back into what they fingerprint. Sample descriptions, results,
client names and genetic data stay with you, except what you choose to prove in a claim:
proving a value publishes that value; proving a bound publishes the bound (not the number);
a laboratory's signature claim publishes the laboratory's public key next to the record.

**What it does not prove.** That the genetics are what the record says. The chain proves
_when_ something was recorded and _who_ could act on it, not that it is true. A parent link
means both holders said so, not that a DNA test agreed. A licence on chain has no terms or
expiry; those stay in your contract with the licensee.

**What you need.**

1. A computer or server running Node 24, and Docker (for the "proof server", a program that
   makes the privacy-preserving proofs on your own machine).
2. A Midnight wallet holding **DUST**, which pays the network's fees. See _Fees_ below.
3. A safe place for a few secrets (a password manager or secret store, and paper for one of
   them). See _Where your secrets live_.

**What it costs to run.** Network fees, paid in DUST, for each action that writes to the
chain. Checking what others show you costs nothing and needs no wallet.

**No developers?** VeilCore can run all of this for you (VeilCore-run): day to day you need none
of the three things above, only a safe place for one sheet of paper. Leaving needs one recovery
run, with a DUST wallet, by you or someone you choose. See _Three ways to use VeilCore
at launch_ below, and [MANAGED.md](MANAGED.md), written for a lab owner.

**If VeilCore disappears.** Your records still verify. Fingerprints are plain SHA-256, the
contracts live on Midnight, and this package and the SDK (both Apache-2.0) work without any
VeilCore server.

---

## Part 2, for the developer

### Install

```sh
npm install @veilcore/contracts veilcore-records
npx veilcore-keys fetch --to ./veilcore-keys      # proving keys, checked (below); once VeilCore publishes them
docker run -d -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.0.3 midnight-proof-server -v
```

Node 24, ES modules. Not yet on npm. Until it is, build it from this repository. The build
needs the compiled contracts, which are not in git:

1. Install the Compact compiler **0.31.1** exactly (`compact compile --version` prints
   `0.31.1`; another version gives other contract code, and the build refuses it).
2. `npm ci`
3. `cd contract && npm run compact` (the full build, not `--skip-zk`: it also makes the
   proving keys, so you can use `keys: { dir: '<repo>/contract/src/managed' }`. It needs to
   download Midnight's proving parameters and takes a while.)
4. `cd .. && npm run build -w @veilcore/contracts`, then depend on the folder `partner-kit/`.
5. `npx veilcore-keys check --dir contract/src/managed` (from `partner-kit/`:
   `node dist/veilcore-keys.js check --dir ../contract/src/managed`) confirms every key
   matches the deployment record.

### Quick start

```js
import {
  connect,
  seedWallet,
  encryptedPrivateState,
  endpointsFor,
  VeilCore,
  VeilCoreClaims,
  commit,
  newSecret,
  newChallenge,
  checkOwnership,
} from '@veilcore/contracts';

const network = 'preprod'; // 'mainnet' once VeilCore's addresses are pinned
const endpoints = endpointsFor(network); // mainnet: endpointsFor('mainnet', {}, { blockfrostProjectId })

// The wallet that pays fees. YOUR secret manager supplies the seed.
const wallet = await seedWallet({
  network,
  endpoints,
  seed: walletSeedHex,
  saveProgress: { password },
});
await wallet.start();
await wallet.synced(); // the first sync on preprod takes a while; later starts resume

const conn = connect({
  network,
  wallet,
  privateState: await encryptedPrivateState({
    network,
    password,
    accountId: 'my-lab',
  }),
  keys: { dir: './veilcore-keys' },
});
const vc = await VeilCore.join(conn); // preprod and mainnet: VeilCore's address by default
const claims = await VeilCoreClaims.join(conn);

// Act as a record: store the secret FIRST, then use it.
const recordSecret = newSecret();
await vc.useRecordSecret(recordSecret);
await vc.anchor(recoveryCommitment); // commit.recovery(recoverySecret), computed offline
```

Three complete, runnable examples are in [`partner-kit/examples/`](../partner-kit/examples/):

| Example               | What it does                                                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lab.mjs`             | A lab receives material: seals the intake record (SDK), anchors it, puts the day's records on chain as one batch root, signs its report (SDK), pairs the report's fingerprint with the record, and proves possession to a verifier who checks it with no wallet. |
| `breeder-licence.mjs` | A breeder issues a licence, the grower countersigns, proves it to a buyer's one-time challenge, the buyer checks it with no wallet, the breeder revokes it.                                                                                                      |
| `claims.mjs`          | A lab seals a record's fields (the SDK computes the same commitment), signs it; the holder proves "germination at least 95.00%" and the lab's signature; a verifier reads both by transaction id and judges them.                                                |

Run one with `node examples/lab.mjs` from `partner-kit/` (settings at the top of
`examples/setup.mjs`: `VEILCORE_NETWORK`, keys, proof server; the wallet seed and the
private-state password are asked for, hidden, unless your secret manager sets them in the
environment). `node examples/check.mjs` runs all three and prints a PASS line per check;
from the repository root that is `npm run partner-check`.

**On a local chain.** `partner-kit/local/compose.yml` runs a node, an indexer and a proof
server on this machine. From `partner-kit/`: `npm run local:up`, then `npm run local:deploy`
(deploys test copies of both contracts and writes `local/addresses.json`), then
`VEILCORE_NETWORK=undeployed node examples/check.mjs`. The chain's built-in funded wallet
pays. `npm run local:down` throws it away.

### What the package offers

**Connecting** (`connect`, `seedWallet`, `encryptedPrivateState`, `endpointsFor`). Bring your
own `WalletProvider` + `MidnightProvider` and private-state providers instead if you have
them; `connect` takes any.

**The main contract** (`VeilCore`):

| You are                   | Operations                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| a record holder           | `useRecordSecret`, `whoAmI`, `anchor`, `pairDna`, `proveOwnership`, `anchorBatch`                                   |
| keeping your own identity | `rotateRecordSecret`, `recoverRecordSecret`, `replaceRecoveryCommitment`, `recoverySecretIsCurrent`                 |
| a licence issuer          | `issueLicense`, `approveTransfer`, `revokeLicense`, `sealRevocations`                                               |
| a licensee                | `countersignLicense`, `proveLicense`, `proposeTransfer`, `withdrawTransfer`                                         |
| in a pedigree             | `proposeParent`, `confirmParent`, `withdrawParent`, `checkLineage`                                                  |
| party to an obligation    | `proposeObligation`, `encumberOwnRecord`, `acceptObligation`, `rejectObligation`, `withdrawObligation`, `discharge` |
| a verifier                | `checkOwnership`, `checkPresentation`, `ledger`                                                                     |

Every method that sends a transaction returns its `txId` (give it to whoever checks),
`txHash` and `blockHeight`. `revokeLicense` and `approveTransfer` also say whether they
sealed; `sealRevocations` returns only that (`sealed`, `waiting`, `sealableAt`), and the
readers (`whoAmI`, `ledger`, `checkLineage`, the checks) send nothing. A call the contract
refuses is refused before anything is proved or sent; tell it from other failures with
`isContractRefusal(e)` (midnight-js wraps the refusal a few causes deep; `errorChain(e)`
lists them all). Commitments are computed offline with `commit.record`, `commit.recovery`,
`commit.license`, `commit.presentationTag` and `commit.obligation`.

**The claims contract** (`VeilCoreClaims`): `proveValue`, `proveRange`, `proveDistinct`,
`proveUnchanged`, `proveAttested`, `readClaim`, `authority`. Seal a record's fields with
`sealFields` (identical to the SDK's `sealFieldSet`, checked on the same 100 vectors); a
laboratory signs with `newLabKey` / `signRecord`.

**Checking, with no wallet** (`checkPresentation`, `checkOwnership`, `checkBatchAnchor`,
`readClaim`, `readClaimsAuthority`, `readLedger`, `verifyClaim`, `ChallengeBook`): only the
network (and an indexer URL on mainnet). Each looks up the transaction the other party
names, requires it to have succeeded with exactly one call of the expected kind on
VeilCore's contract, and judges the state recorded for that call (design.md, verifier rules
5, 7, 8). Keep a `ChallengeBook` (save its `entries()` between runs) so each challenge is
used once.

**Not exposed, on purpose:** deploying VeilCore's contracts, adding circuit keys and the
maintenance authority. That code is bundled inside `dist/index.js` (the clients are built on
it), but none of it is reachable from the package's exports: the clients hold the operator
API in private fields (`partner-kit/test/surface.test.ts` checks the sources and the built
bundle). Without VeilCore's maintenance key it could do nothing privileged anyway.

### Which contract

On **mainnet** the package accepts only the addresses in VeilCore's filed deployment record
(`MAINNET_ADDRESSES`); any other address is refused before anything is read or sent. Anyone
can deploy a contract with identical circuits and different starting state, so the address
is what says which one is VeilCore's. Until the mainnet deploy, those addresses are empty and
every mainnet join is refused.

On **preprod** the default is the pair from the 5 October 2026 test run
(`PREPROD_ADDRESSES`). Test network: nothing there is real.

Joining also checks that every circuit key on chain is the published one, that there is no
unknown circuit, and (main contract) that the contract started from VeilCore's constructor.

### Keys and the proof server

A proof is made by a proof server, but the proof server holds no contract's keys: for every
proof, the client sends it the circuit and its proving key. So your client needs, for every
circuit it calls, the circuit and its two keys: 72 files for the main contract, 15 for the
claims contract. They are large, so they are not in
the npm package.

- `npx veilcore-keys fetch --to <dir>` downloads them from VeilCore's release
  (`DEFAULT_KEYS_URL`) and **checks every file's SHA-256 against the fingerprints in the
  deployment record**, built into the package. A file that differs is refused and never
  kept, so the download location does not have to be trusted. Then `keys: { dir }`.
- Or build them yourself from this repository at the recorded commit with compiler 0.31.1
  (`cd contract && npm run compact`) and point `keys.dir` at `contract/src/managed`; the same
  check applies.
- Or leave `keys` out: the package fetches and caches them under `~/.veilcore/zk/`.

**Run the proof server yourself, on the same machine or a private network.** Every proof
sends it its private inputs: record secrets, licence secrets, hidden field values. A proof
server run by someone else sees all of them. `connect` warns when the proof server is not
local.

### Fees

Every action that writes to the chain pays a fee in **DUST**. Checking costs nothing.

**Today (v1) there are two ways to pay:**

1. **Your own wallet holds DUST.** DUST is not bought or sent: a wallet generates it from the
   NIGHT it holds. On mainnet, NIGHT mostly lives on Cardano (as cNIGHT); you register it,
   once, for DUST generation, naming the Midnight wallet that receives the DUST. The
   registration is made on Cardano and can take many hours to reach Midnight (see
   [Midnight's token documentation](https://docs.midnight.network/tokens/overview)); after
   that DUST accrues over time, up to a cap set by how much NIGHT you hold. DUST cannot be transferred and pays only
   fees. Use your wallet app's registration (Midnight's docs describe it), and **register
   the same NIGHT only once**. Then use that wallet's seed or recovery phrase with
   `seedWallet` (or your own wallet provider): `wallet.dustAddress()` shows the DUST
   address, which must be the one you registered.
   On preprod: get test NIGHT from the faucet (`https://midnight-tmnight-preprod.nethermind.dev/`)
   for `await wallet.nightAddress()`, then `await wallet.registerNightForDust()` (test networks
   only; the package refuses it on mainnet).
2. **VeilCore runs it for you (VeilCore-run).** VeilCore's own wallet pays, and VeilCore sends
   the transactions on your behalf. See _Three ways to use VeilCore at launch_ below and
   [MANAGED.md](MANAGED.md).

**Not offered yet:** VeilCore paying the fees of transactions you prove and send yourself
(fee sponsorship). It is built for VeilCore's website demo and not in service.

Proving the two heavy claims (`proveDistinct`, `proveUnchanged`) takes the most memory: on
VeilCore's own 16 GB laptop the proof server peaked at 3.7 GB proving every claim back to
back (docs/preprod-run-4oct.md). Everything else needs much less.

### Three ways to use VeilCore at launch

| | **VeilCore-run** (custody, with an exit) | **Partner kit** (self-run) | **Website self-custody** |
| --- | --- | --- | --- |
| Who sends transactions | VeilCore, on your written instruction | you, with this package | you, in your browser |
| Who pays fees | VeilCore's wallet (fees per the agreement) | your wallet (DUST) | your wallet |
| Record, licence and claim secrets | held by VeilCore, in an encrypted store that is yours alone | you | you |
| Recovery secrets | you, from one master sheet VeilCore never sees (recommended); or VeilCore | you | you |
| What you need | a safe for one sheet of paper (your master secret) | a developer, Node 24, Docker, a DUST wallet | a browser and a wallet |
| Leaving | any time, in two parts. VeilCore hands you a bundle only your master opens, and (assisted) moves every record off the secrets it stored, or (self) stops acting. Then **you** take each record back with your own recovery secret (`partner-recover`, which needs a DUST wallet): only after that does nothing VeilCore's software made or held control your records. Licences you hold stay usable with VeilCore's old copy until their issuer approves the move. VeilCore then deletes its copies, as far as deleting can (MANAGED.md) | nothing to leave | nothing to leave |
| Available | **at launch** ([MANAGED.md](MANAGED.md)) | **at launch** (this guide) | **after launch** |

VeilCore-run is built on this package's public surface only: VeilCore does for you exactly
what your own developer would do with it, nothing more. What it means that VeilCore holds
your secrets, what it can and cannot do with them, and what happens if VeilCore's computer is
broken into, are in MANAGED.md, plainly. Managed dating (VeilCore timestamps your records'
fingerprints or a batch root, `anchorBatch`, needing no secret of yours) is part of it.

A VeilCore-run partner who leaves receives every secret in a form this package takes
(`useRecordSecret`), so they can carry on self-run. (The other way, handing records you
already run to VeilCore-run, is not built yet.)

### Where your secrets live

The package never prints a secret and never writes one to a log. Where they are kept is
yours to decide; this is what each one is and what losing it means.

| Secret                                                           | What it controls                                         | Keep it                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet seed / recovery phrase                                    | the wallet that pays fees                                | your secret manager. Never in code, a committed file, or on a command line                                                                                                                                 |
| Private-state password                                           | decrypts the private-state store                         | your secret manager. It cannot be recovered                                                                                                                                                                |
| Record secret (`newSecret()`, then `useRecordSecret`)            | acting as the record: licences, lineage, pairing, proofs | stored for you in the encrypted private-state store (`~/.veilcore/<network>/partner-state`, private to your user), **and** in your secret manager before first use. Lost: recover with the recovery secret |
| Recovery secret                                                  | takes the identity back from anyone, at once             | **offline**: paper or an HSM, in two places, never on the machine that holds the record secret. Only `commit.recovery(...)` of it is needed online, at anchor. Used up by a recovery                       |
| Licence secret (licensee)                                        | the licence itself: whoever holds it can present it      | your secret manager. The issuer only ever sees `commit.license(...)`                                                                                                                                       |
| Field secret and the field-set file                              | the hidden values a claim keeps hidden                   | the holder's private storage. Never disclosed with the record                                                                                                                                              |
| Laboratory claims key (`newLabKey().secret`) and SDK signing key | your lab's signatures                                    | your HSM or secret store; publish only the public keys                                                                                                                                                     |
| Obligation terms and salt                                        | showing later what an obligation commitment means        | with your contract records                                                                                                                                                                                 |
| Verifier challenges                                              | that each is answered once                               | a `ChallengeBook`; save `entries()`                                                                                                                                                                        |
| Blockfrost project id (mainnet)                                  | your indexer and node access                             | your secret manager; it travels in the endpoint URLs, so never log them                                                                                                                                    |

What the store holds, and what it does not: the record secret you act as is stored,
encrypted. Secrets needed for one call (a recovery secret, the secret a rotation moves to,
a licence secret, a challenge) are held in memory for that call and written to disk only as
zeros. Signing keys are never written. The claims contract's inputs (field sets, values,
signatures) are kept in memory only, never on disk. If you supply your own private-state
provider, those guarantees are yours to keep.

### Things that will surprise you

- **One network per process.** midnight-js keeps the network process-wide; `connect` sets it.
- **One record at a time per client.** `useRecordSecret` switches which record the client
  acts as. A licensee needs no record: the licence secret is enough.
- **Revocation takes effect in two steps.** The licence is gone at once; presentations
  proved earlier stop verifying at the next seal, at most once per 600 seconds.
  `revokeLicense` seals when it can and otherwise says when it can (`sealableAt`).
- **A presentation shows the licence was live when presented**, and verifiers refuse one
  older than an hour. Ask for a fresh one.
- **If a rotation or recovery reports an error**, it may have landed: the package checks the
  chain twice and throws `LandedButUnconfirmedError` if it did. Keep both secrets until
  `whoAmI()` shows the new one live.
- **The indexer is trusted for what it reports.** For a decision that matters, check with a
  second indexer (pass `indexer` to the checking functions).
- **Test networks reset and lag.** On preprod, `custom error 171` means its indexer was
  behind; nothing was spent; try again later.

### What it does not do yet

- Publish to npm (pending the `@veilcore` npm organisation) or publish the key files (pending
  the `zk-r4` release). Until then: build from this repository, and point `keys.dir` at a build.
- Mainnet: the addresses are pinned on deploy day; before that, mainnet joins are refused.
- Fee sponsorship (above). Website self-custody (after launch; until then, VeilCore-run or
  this package). Browsers (this package is for Node; the website is a demo and
  verification page, not an integration point). Signing keys held in an HSM: secrets are
  passed to the package as bytes.

Questions and corrections: hunter@veilcore.org.
