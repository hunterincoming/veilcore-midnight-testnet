# @veilcore/contracts

Integrate VeilCore's Midnight contracts into your own systems: anchor records and batch
roots, prove control of a record (prior possession, not ownership), pair DNA reports, issue and prove licences, record lineage and
obligations, prove facts about sealed records (claims), and check what other parties show
you.

VeilCore is infrastructure. Your system stays your system: your database, your
identifiers, your workflow. What leaves your machine is 32-byte commitments, plus whatever
you choose to prove in a claim (a proved value is published; a proved bound publishes the
bound, not the number).

**Status:** VeilCore's contracts are live on Midnight's main network (deployed 8 October
2026), and this release joins them there by default:

- VeilCore contract: `a04de0a2684f3713276325649540c7278ffd07cba8b014e7489844f319a02347`
- Claims contract: `ef763eb4ad1846b716dbfa90c00560a9a943ffb4d1fc638b0707df5adefd070d`
  (no maintenance authority: nobody can change it)

On mainnet, any other address is refused. The preprod test contracts remain available for
testing.

Install an exact version, not a range: the package carries the mainnet addresses and the
key fingerprints it checks against.

```sh
npm install --save-exact @veilcore/contracts@0.2.0
```

**Read [docs/PARTNERS.md](https://github.com/hunterincoming/veilcore-midnight-testnet/blob/main/docs/PARTNERS.md)
first.** It says what this does and does not prove, how fees work, and where your secrets
must be kept.

```js
import {
  connect,
  seedWallet,
  encryptedPrivateState,
  endpointsFor,
  VeilCore,
  commit,
  newSecret,
} from '@veilcore/contracts';

const network = 'preprod';
const endpoints = endpointsFor(network);
const wallet = await seedWallet({ network, endpoints, seed: process.env.WALLET_SEED });
await wallet.start();
await wallet.synced();

const conn = connect({
  network,
  wallet,
  privateState: await encryptedPrivateState({ network, password: process.env.STATE_PASSWORD, accountId: 'my-lab' }),
  keys: { dir: '/path/to/veilcore-keys' }, // a build's contract/src/managed, or a folder from `veilcore-keys fetch` (below)
});
const vc = await VeilCore.join(conn); // preprod and mainnet each have a default address

const recordSecret = newSecret(); // store it in your secret manager FIRST
await vc.useRecordSecret(recordSecret);
await vc.anchor(commit.recovery(recoverySecretKeptOffline));
```

Verifying needs no wallet:

```js
import { checkPresentation } from '@veilcore/contracts';
const verdict = await checkPresentation({ network: 'preprod', txId, issuer, challenge, issuedAt });
```

- Node 24, ES modules. A proof server on your own machine (`docker run -d -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.0.3 midnight-proof-server -v`; bound to
  127.0.0.1 so nothing else on your network can reach it). Every proof sends it record and
  licence secrets. From 0.3.0 (not yet published), `connect` and `seedWallet` refuse a
  proof server that is not on this machine unless you pass `allowRemoteProofServer: true`,
  and then only over https; 0.2.0 only warns.
- Proving keys and circuits are not in this package. `veilcore-keys fetch --to <dir>` downloads
  them from VeilCore's `zk-r4` release and checks every file against the fingerprints in
  VeilCore's deployment record; any file that differs is refused. `veilcore-keys check --dir
  <dir>` checks a folder you already have. Run it as `npm exec
  --package=@veilcore/contracts@0.2.0 -- veilcore-keys …`, or `node
  node_modules/@veilcore/contracts/dist/veilcore-keys.js …`. Never a bare `npx veilcore-keys`:
  VeilCore does not own that npm name, so from a folder without this package installed npx
  would download someone else's.
- `proveOwnership` and `checkOwnership` keep the contract's names, but they prove control of
  the record now (prior possession of the record), not ownership.
- Pair a report with `pairReport(reportHashOf(reportFile))`, not `pairDna`. `pairDna` puts the
  32 bytes you give it on chain as they are, so a raw report hash can be copied, even from a
  transaction still waiting to land, and paired to someone else's record first.
  `pairReport` puts a salted binding of the report to your record's identity there instead:
  it reveals nothing about the report, and it verifies for no other record. Give a verifier
  the report file and `pairingEvidence(...)` (record, report hash, salt, transaction id); they
  check it with `checkPairing`, no wallet needed. The date it gives is when that record's
  holder had the report, not who controls the record now. Keep the salt (it is also in your
  private state: `pairings()`): without it the pairing can never be shown. Not in 0.2.0.
- Not exposed, on purpose: deploying VeilCore's contracts, adding circuit keys, the
  maintenance authority. That code is bundled (the clients are built on it) but nothing
  reaches it from the package's exports. It is VeilCore's operator work.

Apache-2.0.
