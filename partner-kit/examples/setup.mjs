// What every example needs before it can call VeilCore: a network, a proof server, the
// keys, a wallet that holds DUST, private state, and the contracts. Uses only the public
// package (@veilcore/contracts). Copy it into your own code and replace the parts marked
// YOURS with your own secret storage and configuration.
//
// Settings (environment):
//   VEILCORE_NETWORK            preprod (default) or undeployed (the local chain, partner-kit/local)
//   VEILCORE_BLOCKFROST_PREPROD_PROJECT_ID  preprod only: a Blockfrost "Midnight Preprod" project id.
//                               Midnight's own preprod indexer and RPC shut on 9 October 2026. Set it
//                               without it showing: `read -s VEILCORE_BLOCKFROST_PREPROD_PROJECT_ID`,
//                               paste, Enter, then `export VEILCORE_BLOCKFROST_PREPROD_PROJECT_ID`.
//   VEILCORE_WALLET_SEED        the paying wallet's hex seed; asked for (hidden) when not set
//   VEILCORE_PRIVATE_STATE_PASSWORD  encrypts private state; asked for (hidden) when not set
//   VEILCORE_KEYS_DIR           a folder of keys (a build's contract/src/managed, or `veilcore-keys fetch --to`)
//   VEILCORE_KEYS_URL           or where to download them from (checked against the fingerprints either way)
//   VEILCORE_PROOF_SERVER       default http://127.0.0.1:6300 (started in Docker if nothing answers there)
//   VEILCORE_ADDRESS, VEILCORE_CLAIMS_ADDRESS   the contracts (defaults: preprod's; local/addresses.json on undeployed)
//   VEILCORE_DEPLOY_TX_ID       the main contract's deploy transaction id, only if joining asks for it
//
// Never put a seed or a password in a file you commit, or on a command line (it stays in
// your shell history). Type them at the prompt, or have your secret manager set them.
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_KEYS_URL,
  DEFAULT_PROOF_SERVER,
  PROOF_SERVER_IMAGE,
  VeilCore,
  VeilCoreClaims,
  checkKeys,
  BLOCKFROST_ENV,
  connect,
  encryptedPrivateState,
  endpointsFor,
  errorChain,
  isBlockfrostNetwork,
  isLocalUrl,
  isNetwork,
  passwordProblem,
  seedWallet,
} from '@veilcore/contracts';

const here = path.dirname(fileURLToPath(import.meta.url));
const managed = path.join(here, '..', '..', 'contract', 'src', 'managed');

/** The local chain's built-in funded wallet (partner-kit/local/compose.yml). Test chain only. */
const LOCAL_GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Read a line without showing it. Nothing typed here is echoed, logged or kept.
 * @param {string} question
 * @returns {Promise<string>}
 */
export const askHidden = (question) =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(`Asked for "${question.split(' (')[0].trim()}", but there is no terminal to type it in.`));
      return;
    }
    // readline echoes and redraws into a stream that discards everything; the question is
    // printed here. What is typed or pasted never reaches the screen.
    const muted = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stdout.write(question);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('Stopped.'));
    });
  });

/** @param {string} name @returns {string | undefined} */
const take = (name) => {
  const v = process.env[name];
  delete process.env[name]; // so nothing this starts (docker) inherits it
  return v === undefined || v === '' ? undefined : v;
};

/** Settings from the environment. On preprod the endpoints carry the Blockfrost project id: never print them. */
export const settings = () => {
  const network = process.env.VEILCORE_NETWORK ?? 'preprod';
  if (!isNetwork(network) || network === 'mainnet')
    throw new Error(`VEILCORE_NETWORK=${network}: the examples run on preprod or undeployed (the local chain).`);
  let addresses = { veilcore: process.env.VEILCORE_ADDRESS, claims: process.env.VEILCORE_CLAIMS_ADDRESS };
  if (network === 'undeployed' && (addresses.veilcore === undefined || addresses.claims === undefined)) {
    const file = path.join(here, '..', 'local', 'addresses.json');
    if (!existsSync(file))
      throw new Error(
        'No contracts on the local chain yet: npm run local:up, then npm run local:deploy (partner-kit).',
      );
    const local = JSON.parse(readFileSync(file, 'utf8'));
    addresses = { veilcore: addresses.veilcore ?? local.veilcore, claims: addresses.claims ?? local.claims };
  }
  let keys;
  if (process.env.VEILCORE_KEYS_DIR) keys = { dir: process.env.VEILCORE_KEYS_DIR };
  else if (process.env.VEILCORE_KEYS_URL) keys = { url: process.env.VEILCORE_KEYS_URL };
  else if (existsSync(path.join(managed, 'veilcore', 'keys')))
    keys = { dir: managed }; // a build of this repository
  else keys = { url: DEFAULT_KEYS_URL };
  const proofServer = process.env.VEILCORE_PROOF_SERVER ?? DEFAULT_PROOF_SERVER;
  // Only needed if joining stops with StartingStateUnreachableError: the main contract's
  // deploy transaction id, from whoever deployed it.
  const deployTxId = process.env.VEILCORE_DEPLOY_TX_ID || undefined;
  // Preprod is reached through Blockfrost since 9 October 2026. The endpoints then carry the
  // project id: connect() and the wallet keep it out of the terminal; never log them.
  const blockfrostProjectId = isBlockfrostNetwork(network) ? process.env[BLOCKFROST_ENV[network]]?.trim() : undefined;
  if (isBlockfrostNetwork(network) && !blockfrostProjectId)
    throw new Error(
      `${BLOCKFROST_ENV[network]} is not set. Since 9 October 2026 preprod is reached through Blockfrost: create a ` +
        `"Midnight Preprod" project at blockfrost.io, then: read -s ${BLOCKFROST_ENV[network]} (paste, Enter), ` +
        `export ${BLOCKFROST_ENV[network]}.`,
    );
  const endpoints = endpointsFor(network, { proofServer }, blockfrostProjectId ? { blockfrostProjectId } : {});
  return { network, addresses, keys, proofServer, deployTxId, endpoints };
};

/**
 * The wallet seed and the private-state password. `prompt: true` always asks (hidden),
 * whatever the environment holds. YOURS: in production, read them from your secret manager.
 */
export const secrets = async (network, { prompt = false } = {}) => {
  const fromEnv = (name) => (prompt ? undefined : take(name));
  const seed =
    fromEnv('VEILCORE_WALLET_SEED') ??
    (network === 'undeployed'
      ? LOCAL_GENESIS_SEED
      : await askHidden('Wallet seed for the wallet that pays fees (hex; nothing shows as you type or paste): '));
  let password = fromEnv('VEILCORE_PRIVATE_STATE_PASSWORD');
  if (password === undefined) {
    const typed = await askHidden('Private-state password (16+ characters; nothing shows): ');
    const problem = passwordProblem(typed);
    if (problem !== null)
      throw new Error(`That private-state password will not be accepted: ${problem}. Nothing was started.`);
    // Twice, as the CLI asks: a typo would otherwise not open the saved wallet progress.
    if ((await askHidden('The same password again, to check it: ')) !== typed)
      throw new Error('The two passwords are different. Nothing was started.');
    password = typed;
  }
  const problem = passwordProblem(password);
  if (problem !== null) throw new Error(`That private-state password will not be accepted: ${problem}.`);
  return { seed: seed.replace(/^0x/i, ''), password };
};

const healthy = async (url) => {
  try {
    const res = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * A proof server: the one at `url` if it answers, or one started here in Docker when
 * `url` is this machine's default. Returns a function that stops what this started.
 */
export const proofServer = async (url, say = console.log) => {
  if (await healthy(url)) return () => undefined;
  if (url !== DEFAULT_PROOF_SERVER)
    throw new Error(`No proof server answers at ${url}. Start yours, or unset VEILCORE_PROOF_SERVER.`);
  say(`Starting a proof server in Docker (${PROOF_SERVER_IMAGE}) on port 6300...`);
  const name = `veilcore-kit-proof-server-${process.pid}`;
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '-p',
      '127.0.0.1:6300:6300',
      PROOF_SERVER_IMAGE,
      'midnight-proof-server',
      '-v',
    ],
    { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } },
  );
  if (run.status !== 0)
    throw new Error(`Could not start the proof server (is Docker Desktop running?): ${(run.stderr ?? '').trim()}`);
  for (let i = 0; i < 90; i++) {
    if (await healthy(url)) return () => void spawnSync('docker', ['stop', name], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 2_000));
  }
  spawnSync('docker', ['stop', name], { stdio: 'ignore' });
  throw new Error('The proof server did not start within 3 minutes.');
};

/** A logger that prints the wallet's and the contracts' progress lines, and nothing at debug. */
/** @returns {any} a pino-shaped logger (only the methods the package calls) */
export const quietLogger = (say = console.log) => {
  const line = (level) => (m) => {
    const text = typeof m === 'string' ? m : JSON.stringify(m, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    if (level !== 'info' || process.env.VEILCORE_VERBOSE === '1') say(`  [${level}] ${text}`);
  };
  const logger = {
    info: line('info'),
    warn: line('warn'),
    error: line('error'),
    debug: () => undefined,
    trace: () => undefined,
  };
  logger.child = () => logger;
  return logger;
};

/**
 * Everything up to the joined contracts. `say` prints progress. Returns what the flows
 * use, and `stop`, which must be called at the end.
 */
export const setup = async ({ say = console.log, prompt = false } = {}) => {
  const s = settings();
  say(`Network: ${s.network}. Proof server: ${s.proofServer}.`);
  if (!isLocalUrl(s.proofServer))
    say("The proof server is not on this machine: it receives every proof's private inputs.");
  const { seed, password } = await secrets(s.network, { prompt });
  const stops = [];
  const onInterrupt = () => {
    say('Stopping (Ctrl+C): stopping the wallet and any proof server started here...');
    void stop().finally(() => process.exit(130));
  };
  const stop = async () => {
    process.off('SIGINT', onInterrupt);
    for (const f of stops.splice(0).reverse()) await f();
  };
  // Ctrl+C mid-run still stops the proof server container this run started.
  process.once('SIGINT', onInterrupt);
  try {
    const keysFrom = 'dir' in s.keys ? s.keys.dir : s.keys.url;
    say(`Checking proving keys and circuits from ${keysFrom} against the deployment record...`);
    const nKeys = await checkKeys(s.keys);
    stops.push(await proofServer(s.proofServer, say));

    const logger = quietLogger(say);
    // The wallet: sync progress is saved (encrypted with the same password) so the next run resumes.
    // A password that does not open saved progress stops here, changing nothing ('stop').
    const wallet = await seedWallet({
      network: s.network,
      endpoints: s.endpoints,
      seed,
      saveProgress: { password, onUnreadable: 'stop' },
      logger,
    });
    say(`Wallet DUST address: ${wallet.dustAddress()}`);
    say('Syncing the wallet (the first time on preprod can take an hour; later runs resume)...');
    await wallet.start();
    stops.push(() => wallet.stop());
    let balances = await wallet.synced();
    if (balances.dust === 0n && balances.night > 0n) {
      say('The wallet holds NIGHT but no DUST: registering its NIGHT for DUST generation (test network)...');
      await wallet.registerNightForDust();
      balances = await wallet.synced();
    }
    if (balances.dust === 0n)
      throw new Error(
        `This wallet has no DUST to pay fees with. On preprod, get test NIGHT for ${await wallet.nightAddress()} from ` +
          'https://midnight-tmnight-preprod.nethermind.dev/ and run again: it registers the NIGHT for DUST.',
      );
    say(`Wallet synced. DUST available: ${balances.dust}.`);

    // YOURS: one private-state folder per network, the password from your secret manager.
    const privateState = await encryptedPrivateState({
      network: s.network,
      password,
      accountId: 'veilcore-examples',
      dir: path.join(os.homedir(), '.veilcore', s.network, 'partner-examples'),
    });
    const conn = connect({ network: s.network, wallet, privateState, keys: s.keys, endpoints: s.endpoints, logger });
    const vc = await VeilCore.join(conn, { address: s.addresses.veilcore, deployTxId: s.deployTxId });
    const claims = await VeilCoreClaims.join(conn, { address: s.addresses.claims });
    return { ...s, nKeys, wallet, conn, vc, claims, stop };
  } catch (e) {
    await stop();
    throw e;
  }
};

/** Run `flow` as a stand-alone example, printing each check, and stopping cleanly. */
export const runExample = async (title, flow) => {
  let n = 0;
  let failed = 0;
  const check = (ok, what) => {
    n++;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${n}. ${what}`);
  };
  console.log(`\n${title}\n`);
  let ctx;
  try {
    ctx = await setup();
    await flow(ctx, { check, say: (m) => console.log(`  ${m}`) });
  } catch (e) {
    failed++;
    // Every cause: midnight-js wraps what went wrong two or three levels deep.
    const chain = errorChain(e).filter((t) => !/^(Error|ContractRuntimeError|CompactError)$/.test(t));
    console.error(`\nSTOPPED: ${chain.join('\n  cause: ')}`);
  } finally {
    await ctx?.stop();
  }
  console.log(failed === 0 ? `\nDone: ${n} checks passed.` : `\n${failed} check(s) failed.`);
  process.exitCode = failed === 0 ? 0 : 1;
  // A wallet's connections can outlive stop() by a moment; do not hang on them.
  setTimeout(() => process.exit(), 3_000).unref();
};

/** Whether this module is the script node was started with. */
export const isMain = (url) => {
  try {
    // realpath: macOS reaches /tmp and iCloud folders through symlinks.
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
};
