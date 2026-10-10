// Connecting VeilCore-run to the chain, from the partner kit's public surface only: the
// operator's wallet pays; the chain clients keep their private state in memory only, so
// no partner's record secret is ever written to the operator's own stores.
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCKFROST_ENV,
  isBlockfrostNetwork,
  type KeySource,
  type Network,
  DEFAULT_KEYS_URL,
  DEFAULT_PROOF_SERVER,
  VeilCore,
  VeilCoreClaims,
  checkKeys,
  connect,
  endpointsFor,
  isLocalUrl,
  isNetwork,
  memoryPrivateState,
  passwordProblem,
  scrubTerminal,
  seedWallet,
} from '@veilcore/contracts';
import { type Io } from './io.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoManaged = path.join(here, '..', '..', 'contract', 'src', 'managed');

export type Settings = {
  readonly network: Network;
  readonly keys: KeySource;
  readonly proofServer: string;
  readonly addresses: { readonly veilcore?: string; readonly claims?: string };
  readonly deployTxId?: string;
};

/** Settings from the environment: nothing secret is in them. */
export const settingsFrom = (env: NodeJS.ProcessEnv, network: string): Settings => {
  if (!isNetwork(network)) throw new Error(`Unknown network ${network}.`);
  const proofServer = env.VEILCORE_PROOF_SERVER ?? DEFAULT_PROOF_SERVER;
  // Every proof sends the proof server its private inputs: here, partners' secrets.
  if (!isLocalUrl(proofServer))
    throw new Error(
      `VEILCORE_PROOF_SERVER=${proofServer} is not on this machine. Refused: every proof would send it partners' ` +
        'secrets. Run the proof server on this machine.',
    );
  let keys: KeySource;
  if (env.VEILCORE_KEYS_DIR) keys = { dir: env.VEILCORE_KEYS_DIR };
  else if (env.VEILCORE_KEYS_URL) keys = { url: env.VEILCORE_KEYS_URL };
  else if (existsSync(path.join(repoManaged, 'veilcore', 'keys'))) keys = { dir: repoManaged };
  else keys = { url: DEFAULT_KEYS_URL };
  return {
    network,
    keys,
    proofServer,
    addresses: {
      ...(env.VEILCORE_ADDRESS ? { veilcore: env.VEILCORE_ADDRESS } : {}),
      ...(env.VEILCORE_CLAIMS_ADDRESS ? { claims: env.VEILCORE_CLAIMS_ADDRESS } : {}),
    },
    ...(env.VEILCORE_DEPLOY_TX_ID ? { deployTxId: env.VEILCORE_DEPLOY_TX_ID } : {}),
  };
};

const take = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const v = env[name];
  delete env[name]; // nothing this process starts inherits it
  return v === undefined || v === '' ? undefined : v;
};

/** A logger that prints warnings and errors, and nothing at info or debug. */
const quietLogger = (io: Io): never => {
  const line = (level: string) => (m: unknown) =>
    io.print(
      `  [${level}] ${typeof m === 'string' ? m : JSON.stringify(m, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}`,
    );
  const logger: Record<string, unknown> = {
    info: () => undefined,
    warn: line('warn'),
    error: line('error'),
    debug: () => undefined,
    trace: () => undefined,
  };
  logger.child = () => logger;
  return logger as never;
};

export type Chain = {
  readonly vc: VeilCore;
  readonly claims?: VeilCoreClaims;
  readonly stop: () => Promise<void>;
};

/**
 * Check the keys, start the operator's wallet (VEILCORE_WALLET_SEED and
 * VEILCORE_WALLET_PASSWORD from a secret manager, or typed, hidden), and join the
 * contracts with in-memory private state.
 */
export const openChain = async (
  s: Settings,
  io: Io,
  env: NodeJS.ProcessEnv,
  o: { readonly claims: boolean; readonly who?: 'operator' | 'partner' },
): Promise<Chain> => {
  const health = await fetch(new URL('/health', s.proofServer), { signal: AbortSignal.timeout(3_000) }).catch(
    () => null,
  );
  if (health === null || !health.ok)
    throw new Error(
      `No proof server answers at ${s.proofServer}. Start one on this machine: ` +
        'docker run -d -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.0.3@sha256:8e6c36c3c175ef6e1b337952155b30470f252af79a20c3f65153a86a983e17ab midnight-proof-server -v',
    );
  io.print(`Checking the proving keys against the deployment record...`);
  await checkKeys(s.keys);
  // Mainnet (since 30 Sep 2026) and preprod (since 9 Oct 2026) are reached through
  // Blockfrost, each with its own project id.
  const blockfrostProjectId = isBlockfrostNetwork(s.network)
    ? (take(env, BLOCKFROST_ENV[s.network]) ??
      (await io.askHidden(
        `Blockfrost ${s.network === 'mainnet' ? 'Mainnet' : 'Preprod'} project id (nothing shows): `,
      )))
    : undefined;
  const endpoints = endpointsFor(s.network, { proofServer: s.proofServer }, { blockfrostProjectId });
  const seed = (
    take(env, 'VEILCORE_WALLET_SEED') ??
    (await io.askHidden(
      o.who === 'partner'
        ? 'Your own wallet seed, the wallet that pays the fees (hex; nothing shows): '
        : "VeilCore's operator wallet seed (hex; nothing shows): ",
    ))
  ).replace(/^0x/i, '');
  const password =
    take(env, 'VEILCORE_WALLET_PASSWORD') ??
    (await io.askHidden(
      o.who === 'partner'
        ? "Your wallet's progress password (16+ characters; nothing shows): "
        : "The operator wallet's progress password (nothing shows): ",
    ));
  // Whatever prints past this tool's own output (the wallet SDK prints its node URL, with
  // the Blockfrost project id, to stderr on every reconnect) never shows these: the
  // project id, the seed and the password, from the environment or typed.
  scrubTerminal([blockfrostProjectId, seed, password]);
  const problem = passwordProblem(password);
  if (problem !== null) throw new Error(`That wallet password will not be accepted: ${problem}.`);
  const logger = quietLogger(io);
  const wallet = await seedWallet({
    network: s.network,
    endpoints,
    seed,
    saveProgress: { password, onUnreadable: 'stop' },
    logger,
  });
  io.print('Syncing the operator wallet...');
  await wallet.start();
  try {
    const balances = await wallet.synced();
    if (balances.dust === 0n) throw new Error('That wallet has no DUST to pay fees with. Nothing was sent.');
    const conn = connect({
      network: s.network,
      wallet,
      // In memory only: each command gives the record secret it acts with, from the partner's vault.
      privateState: {
        veilcore: memoryPrivateState(),
        claims: memoryPrivateState(),
      },
      keys: s.keys,
      endpoints,
      logger,
      ...(blockfrostProjectId === undefined ? {} : { blockfrostProjectId }),
    });
    const vc = await VeilCore.join(conn, {
      ...(s.addresses.veilcore === undefined ? {} : { address: s.addresses.veilcore }),
      ...(s.deployTxId === undefined ? {} : { deployTxId: s.deployTxId }),
    });
    const claims = o.claims
      ? await VeilCoreClaims.join(conn, s.addresses.claims === undefined ? {} : { address: s.addresses.claims })
      : undefined;
    return { vc, ...(claims === undefined ? {} : { claims }), stop: () => wallet.stop() };
  } catch (e) {
    await wallet.stop();
    throw e;
  }
};
