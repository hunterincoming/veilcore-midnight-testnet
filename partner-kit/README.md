# @veilcore/contracts

Integrate VeilCore's Midnight contracts into your own systems: anchor records and batch
roots, prove possession, pair DNA reports, issue and prove licences, record lineage and
obligations, prove facts about sealed records (claims), and check what other parties show
you.

VeilCore is infrastructure. Your system stays your system: your database, your
identifiers, your workflow. What leaves your machine is 32-byte commitments, plus whatever
you choose to prove in a claim (a proved value is published; a proved bound publishes the
bound, not the number).

**Status:** VeilCore's contracts are live on Midnight's preprod test network, and this
release joins them there. They are not on Midnight's main network yet. The mainnet
addresses come in the release after the mainnet deploy; until then, joining on mainnet is
refused.

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
  keys: { dir: '/path/to/veilcore-keys' }, // a build's contract/src/managed, or `npx veilcore-keys fetch --to …`
});
const vc = await VeilCore.join(conn); // preprod has a default address; mainnet's comes after the mainnet deploy

const recordSecret = newSecret(); // store it in your secret manager FIRST
await vc.useRecordSecret(recordSecret);
await vc.anchor(commit.recovery(recoverySecretKeptOffline));
```

Verifying needs no wallet:

```js
import { checkPresentation } from '@veilcore/contracts';
const verdict = await checkPresentation({ network: 'preprod', txId, issuer, challenge, issuedAt });
```

- Node 24, ES modules. A proof server on your own machine (`docker run -p 6300:6300 midnightntwrk/proof-server:8.0.3 midnight-proof-server -v`).
- Proving keys and circuits are not in this package. `veilcore-keys fetch` downloads them
  (once VeilCore has published them; until then, build them, see PARTNERS.md) and checks every
  file against the fingerprints in VeilCore's deployment record; any file that differs is
  refused. `veilcore-keys check --dir <dir>` checks a folder you already have.
- Not exposed, on purpose: deploying VeilCore's contracts, adding circuit keys, the
  maintenance authority. That code is bundled (the clients are built on it) but nothing
  reaches it from the package's exports. It is VeilCore's operator work.

Apache-2.0.
