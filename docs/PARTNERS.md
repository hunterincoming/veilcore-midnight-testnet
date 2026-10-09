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
- that whoever shows it to them controls the record now (they send a one-time challenge,
  you answer). That is control today: prior possession of the record, not ownership, and
  not who held it before;
- that your lab signed the report on it;
- that whoever controlled a record's identity at a date had a given report, or its SHA-256,
  by then (a bound pairing: the report stays private until you show it, and nobody can
  copy the pairing to their own record);
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
npm install --save-exact @veilcore/contracts@0.2.0 veilcore-records
npm exec --package=@veilcore/contracts@0.2.0 -- veilcore-keys fetch --to ./veilcore-keys   # proving keys, checked (below)
docker run -d -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.0.3@sha256:8e6c36c3c175ef6e1b337952155b30470f252af79a20c3f65153a86a983e17ab midnight-proof-server -v
```

Node 24, ES modules. On npm as `@veilcore/contracts`. **Pin an exact version** (`0.2.0`, not
`^0.2.0`): the package carries the mainnet contract addresses and the key fingerprints it
checks against, so an upgrade should be a choice you make and review, not something a
reinstall does for you.

**Do not run a bare `npx veilcore-keys`.** VeilCore does not own the npm name
`veilcore-keys`. From a folder where the package is not installed, `npx` would download
whatever package has that name, from anyone. Use `npm exec --package=@veilcore/contracts@0.2.0
-- veilcore-keys …` as above, or the installed file directly:
`node node_modules/@veilcore/contracts/dist/veilcore-keys.js …`.

The proof server line binds port 6300 to `127.0.0.1` only, so nothing else on your network
can reach it (see *Keys and the proof server*).

**Or build it from this repository.** The build needs the compiled contracts, which are not
in git:

1. Install the Compact compiler **0.31.1** exactly (`compact compile --version` prints
   `0.31.1`; another version gives other contract code, and the build refuses it).
2. `npm ci`
3. `cd contract && npm run compact` (the full build, not `--skip-zk`: it also makes the
   proving keys, so you can use `keys: { dir: '<repo>/contract/src/managed' }`. It needs to
   download Midnight's proving parameters and takes a while.)
4. `cd .. && npm run build -w @veilcore/contracts`, then depend on the folder `partner-kit/`.
5. From `partner-kit/`: `node dist/veilcore-keys.js check --dir ../contract/src/managed`
   confirms every key matches the deployment record.

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

const network = 'preprod'; // or 'mainnet': 0.2.0 has VeilCore's mainnet addresses pinned
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
| `lab.mjs`             | A lab receives material: seals the intake record (SDK), anchors it, puts the day's records on chain as one batch root, signs its report (SDK), pairs it with the record (bound, so it cannot be copied) and has a verifier check that from the evidence file, and proves control of the record to a verifier who checks it with no wallet. |
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

**Not yet on npm.** Items marked _(0.3.0)_ below are in this repository but not in 0.2.0
on npm. They ship with 0.3.0, which is not published yet. Until then, build from this
repository to use them.

**Connecting** (`connect`, `seedWallet`, `encryptedPrivateState`, `endpointsFor`). Bring your
own `WalletProvider` + `MidnightProvider` and private-state providers instead if you have
them; `connect` takes any.

**The main contract** (`VeilCore`):

| You are                   | Operations                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| a record holder           | `useRecordSecret`, `whoAmI`, `anchor`, `pairReport` _(0.3.0)_, `pairings` _(0.3.0)_, `pairDna`, `proveOwnership`, `anchorBatch` |
| keeping your own identity | `rotateRecordSecret`, `recoverRecordSecret`, `replaceRecoveryCommitment`, `recoverySecretIsCurrent`                 |
| a licence issuer          | `issueLicense`, `approveTransfer`, `revokeLicense`, `sealRevocations`                                               |
| a licensee                | `licenseRequest` _(0.3.0)_, `countersignLicense`, `proveLicense`, `proposeTransfer`, `withdrawTransfer`             |
| in a pedigree             | `proposeParent`, `confirmParent`, `withdrawParent`, `checkLineage`                                                  |
| party to an obligation    | `proposeObligation`, `encumberOwnRecord`, `acceptObligation`, `rejectObligation`, `withdrawObligation`, `discharge` |
| a verifier                | `checkOwnership`, `checkPresentation`, `checkPairing` _(0.3.0)_, `ledger`                                           |

`proveOwnership` and `checkOwnership` keep the contract's names, but they prove control of
the record now (prior possession of the record), not ownership. The identity's anchor date
says nothing about who holds it today: a sale looks like a key rotation on chain.

**Pairing a report.** Use `pairReport(reportHashOf(reportFile))` _(0.3.0)_. `pairDna` puts
the 32 bytes you give it on chain as they are: anyone who sees a raw report hash there, even
in a transaction still waiting to land, can pair it to their own record first, so which raw
pairing came first does not show who had the report first. `pairReport` pairs
`commit.reportPairing(reportHash, identity, salt)` instead: a hash of the report's SHA-256,
your record's identity and 32 random bytes (the salt). It reveals nothing about the report,
it verifies for no other record, and nobody can make one for their own record without the
report's hash. That hash must never have been on chain raw: once it is (a `pairDna` of the
hash itself, as the 0.2.0 lab example did), anyone can make a bound pairing of it, and a
verifier is told so. To show it, give the verifier the report file and the evidence:
`pairingEvidence({ network, contractAddress, txId, identity, reportHash, salt })` (the
record, the report's SHA-256, the salt, the transaction). They hash the report themselves
and run `checkPairing` (design.md, rule 9); without the report file there is nothing to
accept. An acceptance says: whoever controlled this record's identity at that date had this
report, or its SHA-256, by then. The verdict also says when the report's hash was paired
raw earlier (`publishedRawEarlier`; the contract's history is read over the indexer's
subscription, `indexerWS`) and when the identity changed keys since (`identityMoved`: a
sale, a new key and a recovery from a thief look the same). It is not who controls the
record now (a control proof answers that), and the lab that wrote the report had it too.
Keep the salt with the report: without it the pairing can never be shown, and it is not
derived from your record secret, so a paper copy of that does not bring it back.
`pairReport` saves it in your private state before sending (`pairings()`); if a pairing's
confirmation fails, `findPairingTransactions()` finds its transaction from the binding.

Every method that sends a transaction returns its `txId` (give it to whoever checks),
`txHash` and `blockHeight`. `revokeLicense` and `approveTransfer` also say whether they
sealed; `sealRevocations` returns only that (`sealed`, `waiting`, `sealableAt`), and the
readers (`whoAmI`, `ledger`, `checkLineage`, the checks) send nothing. A call the contract
refuses is refused before anything is proved or sent; tell it from other failures with
`isContractRefusal(e)` (midnight-js wraps the refusal a few causes deep; `errorChain(e)`
lists them all). Commitments are computed offline with `commit.record`, `commit.recovery`,
`commit.license`, `commit.presentationTag`, `commit.reportPairing` _(0.3.0)_ and
`commit.obligation`.

**Asking for a licence.** Build the licence commitment with
`vc.licenseRequest(licenseSecret, issuerRecord)` _(0.3.0)_, not with `commit.license` and
the issuer's origin (what a record's `ledgerIdentity` names). An issuer's licence is keyed
on its current head, so a commitment built against an older commitment of the issuer can
never be countersigned once the issuer has rotated. `licenseRequest` reads the current
head from the chain (any commitment of the issuer's identity may be given) and returns it
as `issuerRecord`: use that one for `countersignLicense`, `proveLicense` and
`proposeTransfer`. `currentHead(ledger, record)` does the same lookup on a ledger you
already read. Nothing is sent.

**The claims contract** (`VeilCoreClaims`): `proveValue`, `proveRange`, `proveDistinct`,
`proveUnchanged`, `proveAttested`, `readClaim`, `authority`. Seal a record's fields with
`sealFields` (identical to the SDK's `sealFieldSet`, checked on the same 100 vectors); a
laboratory signs with `newLabKey` / `signRecord`.

**Checking, with no wallet** (`checkPresentation`, `checkOwnership` (control of the record
now, not ownership), `checkPairing` _(0.3.0)_, `checkBatchAnchor`,
`readClaim`, `readClaimsAuthority`, `readAuthority` _(0.3.0)_, `readLedger`, `verifyClaim`,
`ChallengeBook`): only the
network (and an indexer URL on mainnet). Each looks up the transaction the other party
names, requires it to have succeeded with exactly one call of the expected kind on
VeilCore's contract, and judges the state recorded for that call (design.md, verifier rules
5, 7, 8, 9). Keep a `ChallengeBook` (save its `entries()` between runs) so each challenge is
used once.

Options the checks take _(0.3.0)_:

| Option | What it does |
| --- | --- |
| `secondIndexer` | Another indexer's URL (your own, or another provider's). Every check asks both and refuses unless they report the same call, in the same block, with the same contract state. `checkOwnership` and `checkPairing` also read the current state from both. |
| `verifierKeys` | `'pinned'`: refuse a state whose circuits' verifier keys are not the deployment record's build (the verdict says which circuits differ). `'report'`: only report. Default `'pinned'` on mainnet, where it cannot be turned off, and on preprod; `'report'` elsewhere (a local chain, preview), where the contract is usually your own build. |
| `authorityCounter` | Refuse unless the maintenance authority's counter is exactly this. Every maintenance update raises it, so pinning the value you last saw turns any change since into a refusal. |
| `history`, `rule` | `checkPresentation` only. `history` is the contract's state after every call, from the last seal before the presentation up to and including it, from your indexer; with it the issuer-scoped rule 5 decides, so another party's revocations cannot make an honest presentation fail. The package does not fetch it for you. `rule: 'strict'` keeps the original rule even with a history; without one, the original rule applies. |

Every verdict also carries `authority`: the maintenance authority in the state it rests on
(committee size, threshold, counter, and whether it is retired). A state that is not the
pinned build comes back as a refusal; `readClaim` throws `ContractStateMismatchError`
instead. `readAuthority` returns the main contract's authority now; compare its counter
with the one in the latest deployment record revision. The checks also refuse a network
name that does not match: a mainnet indexer or VeilCore's mainnet address under any other
network, or a preprod or preview indexer under `mainnet`. `readLedger` and
`readClaimsAuthority` read the current state as it is; they compare no keys.

**Not exposed, on purpose:** deploying VeilCore's contracts, adding circuit keys and the
maintenance authority. That code is bundled inside `dist/index.js` (the clients are built on
it), but none of it is reachable from the package's exports: the clients hold the operator
API in private fields (`partner-kit/test/surface.test.ts` checks the sources and the built
bundle). Without VeilCore's maintenance key it could do nothing privileged anyway.

### Which contract

On **mainnet** the package accepts only the addresses in VeilCore's filed deployment record
(`MAINNET_ADDRESSES`); any other address is refused before anything is read or sent. Anyone
can deploy a contract with identical circuits and different starting state, so the address
is what says which one is VeilCore's. They were pinned on 8 October 2026, and 0.2.0 joins
them by default (an earlier version, with empty pins, refuses every mainnet join).

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

- `npm exec --package=@veilcore/contracts@0.2.0 -- veilcore-keys fetch --to <dir>` (or
  `node node_modules/@veilcore/contracts/dist/veilcore-keys.js fetch --to <dir>`; never a bare
  `npx veilcore-keys`, see *Install*) downloads them from VeilCore's release
  (`DEFAULT_KEYS_URL`) and **checks every file's SHA-256 against the fingerprints in the
  deployment record**, built into the package. A file that differs is refused and never
  kept, so the download location does not have to be trusted. Then `keys: { dir }`.
- Or build them yourself from this repository at the recorded commit with compiler 0.31.1
  (`cd contract && npm run compact`) and point `keys.dir` at `contract/src/managed`; the same
  check applies.
- Or leave `keys` out: the package fetches and caches them under `~/.veilcore/zk/`.

**Run the proof server yourself, on the same machine.** Every proof sends it its private
inputs: record secrets, licence secrets, hidden field values. A proof server run by
someone else sees all of them. In 0.2.0, `connect` only warns when the proof server is not
local. From 0.3.0, `connect` and `seedWallet` refuse a proof server that is not on this
machine (`ProofServerRefusedError`, before anything is sent). To use one you run yourself
elsewhere, pass `allowRemoteProofServer: true`; it must then be an `https` URL.

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
| Licence secret (licensee)                                        | the licence itself: whoever holds it can present it      | your secret manager. The issuer only ever sees the licence commitment (`licenseRequest`)                                                                                                                   |
| Field secret and the field-set file                              | the hidden values a claim keeps hidden                   | the holder's private storage. Never disclosed with the record                                                                                                                                              |
| Laboratory claims key (`newLabKey().secret`) and SDK signing key | your lab's signatures                                    | your HSM or secret store; publish only the public keys                                                                                                                                                     |
| Obligation terms and salt                                        | showing later what an obligation commitment means        | with your contract records                                                                                                                                                                                 |
| Pairing salt (`pairReport`)                                      | showing a bound pairing: without it, it can never be shown | with the report and its evidence file, backed up: it is not derived from the record secret. Also kept in the private-state store (`pairings()`). Shown to a verifier, it lets anyone holding the report recognise the pairing |
| Verifier challenges                                              | that each is answered once                               | a `ChallengeBook`; save `entries()`                                                                                                                                                                        |
| Blockfrost project id (mainnet)                                  | your indexer and node access                             | your secret manager; it travels in the endpoint URLs, so never log them. From 0.3.0, `connect` and `seedWallet` redact it from everything the process writes to the terminal, since the wallet SDK prints its node URL past any logger; `scrubTerminal: false` turns that off |

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
- **The indexer is trusted for what it reports.** For a decision that matters, pass
  `secondIndexer` to the checking functions _(0.3.0)_: both indexers must agree, or the
  check is refused. In 0.2.0, run the check again with the other indexer as `indexer` and
  compare.
- **Test networks reset and lag.** On preprod, `custom error 171` means its indexer was
  behind; nothing was spent; try again later.

### What it does not do yet

- Fee sponsorship (above). Website self-custody (after launch; until then, VeilCore-run or
  this package). Browsers (this package is for Node; the website is a demo and
  verification page, not an integration point). Signing keys held in an HSM: secrets are
  passed to the package as bytes.

Questions and corrections: hunter@veilcore.org.
