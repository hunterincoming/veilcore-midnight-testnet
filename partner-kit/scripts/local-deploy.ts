// Deploy test copies of both VeilCore contracts on the LOCAL chain (partner-kit/local),
// so the examples have something to talk to. Repository tooling: it uses VeilCore's
// operator API, which the package does not export, and it refuses any network but the
// local one. Writes local/addresses.json (gitignored).
//
//   npm run local:up && npm run local:deploy      (from partner-kit/)
// SPDX-License-Identifier: Apache-2.0
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import { VeilcoreAPI } from '../../api/src/veilcore-api.js';
import { ClaimsAPI } from '../../api/src/claims-api.js';
import { connect, endpointsFor, memoryPrivateState, seedWallet } from '../src/index.js';

const LOCAL_GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const main = async (pkg: string): Promise<void> => {
  if ((process.env.VEILCORE_NETWORK ?? 'undeployed') !== 'undeployed')
    throw new Error('local:deploy deploys on the local chain only (VEILCORE_NETWORK=undeployed).');
  const managed = path.join(pkg, '..', 'contract', 'src', 'managed');
  const keys = process.env.VEILCORE_KEYS_DIR
    ? { dir: process.env.VEILCORE_KEYS_DIR }
    : existsSync(path.join(managed, 'veilcore', 'keys'))
      ? { dir: managed }
      : process.env.VEILCORE_KEYS_URL
        ? { url: process.env.VEILCORE_KEYS_URL }
        : undefined;
  if (keys === undefined)
    throw new Error('No keys: compile the contracts (cd contract && npm run compact) or set VEILCORE_KEYS_DIR.');
  const say = (m: unknown): void =>
    console.log(
      `  ${typeof m === 'string' ? m : JSON.stringify(m, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}`,
    );
  const logger = {
    info: say,
    warn: say,
    error: say,
    debug: () => undefined,
    trace: () => undefined,
  } as unknown as Logger;
  (logger as unknown as { child: () => Logger }).child = () => logger;

  const endpoints = endpointsFor('undeployed');
  const wallet = await seedWallet({ network: 'undeployed', endpoints, seed: LOCAL_GENESIS_SEED });
  await wallet.start();
  try {
    console.log('Syncing the local chain’s funded wallet...');
    const b = await wallet.synced();
    console.log(`DUST: ${b.dust}`);
    const conn = connect({
      network: 'undeployed',
      wallet,
      keys,
      endpoints,
      logger,
      // The deploy's throwaway maintenance key lives in memory only, and is dropped at the end.
      privateState: { veilcore: memoryPrivateState(), claims: memoryPrivateState() },
    });
    console.log('Deploying the VeilCore contract (test copy)...');
    const vc = await VeilcoreAPI.deploy(conn.providers.veilcore, sampleSigningKey(), logger);
    console.log('Deploying the claims contract (test copy)...');
    const cl = await ClaimsAPI.deploy(conn.providers.claims, logger);
    const out = path.join(pkg, 'local', 'addresses.json');
    writeFileSync(
      out,
      `${JSON.stringify({ veilcore: vc.deployedContractAddress, claims: cl.deployedContractAddress, at: new Date().toISOString() }, null, 2)}\n`,
    );
    console.log(`\nLocal contracts: VeilCore ${vc.deployedContractAddress}, claims ${cl.deployedContractAddress}`);
    console.log(`Written to ${out}. Now: VEILCORE_NETWORK=undeployed node examples/check.mjs`);
  } finally {
    await wallet.stop();
  }
};

export default main;
