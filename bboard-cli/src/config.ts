// This file is part of midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import path from 'node:path';
import {
  EnvironmentConfiguration,
  getTestEnvironment,
  ProofServerClient,
  RemoteTestEnvironment,
  TestEnvironment,
} from '@midnight-ntwrk/testkit-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Logger } from 'pino';

export interface Config {
  readonly privateStateStoreName: string;
  readonly logDir: string;
  readonly zkConfigPath: string;
  getEnvironment(logger: Logger): TestEnvironment;
  readonly generateDust: boolean;
  /**
   * Mainnet: fees are paid from DUST the wallet already has (NIGHT sits on Cardano and
   * generates DUST cross-chain), so the CLI does not wait for NIGHT, never registers for
   * DUST (re-registering is what created duplicate registrations before), and refuses
   * a wallet whose DUST address is not the expected one.
   */
  readonly mainnet?: boolean;
}

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export class StandaloneConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    // Declared rather than left unset. The other two configs name their network and
    // this one did not, so `getNetworkId()` threw here — which was harmless until the
    // deploy guard started refusing on a network it cannot determine. A process that
    // cannot say where it is deploying is not one that should be deploying, so the
    // fix is to say, not to make absence permissive.
    setNetworkId('undeployed');
    return getTestEnvironment(logger) as TestEnvironment;
  }
  privateStateStoreName = 'bboard-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'veilcore');
  generateDust = false;
}

export class PreviewRemoteConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('preview');
    return new PreviewTestEnvironment(logger);
  }
  privateStateStoreName = 'bboard-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'preview-remote', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'veilcore');
  generateDust = true;
}

export class PreprodRemoteConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('preprod');
    return new PreprodTestEnvironment(logger);
  }
  privateStateStoreName = 'bboard-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod-remote', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'veilcore');
  generateDust = true;
}

/**
 * MAINNET. Real value, no faucet, permanent contracts.
 *
 * Its own private-state store, so nothing from preview or preprod — keys, licence
 * secrets, maintenance authorities — is ever mixed with mainnet state. Deploying is
 * still refused by api/src/deploy-guard.ts unless VEILCORE_DEPLOYMENT_RECORD_REVISION
 * declares the current revision as filed.
 */
export class MainnetConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('mainnet');
    return new MainnetEnvironment(logger);
  }
  privateStateStoreName = 'veilcore-mainnet-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'mainnet', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'veilcore');
  generateDust = false;
  mainnet = true;
}

/** Endpoints from docs.midnight.network, "Networks and environments". No faucet. */
/** The Blockfrost project id for Midnight mainnet, from the environment. Never logged. */
export const BLOCKFROST_VAR = 'VEILCORE_BLOCKFROST_PROJECT_ID';
export const blockfrostProjectId = (): string => {
  const id = (process.env[BLOCKFROST_VAR] ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,}$/.test(id)) {
    throw new Error(
      `${BLOCKFROST_VAR} is not set. Since 30 Sep 2026 Midnight mainnet's indexer and RPC are served by Blockfrost: ` +
        'create a Midnight Mainnet project at blockfrost.io and export its project id.',
    );
  }
  return id;
};

/**
 * Mainnet through Blockfrost, the public provider since Midnight shut its own mainnet
 * indexer and RPC on 30 Sep 2026. The project id rides as a query parameter, since
 * midnight-js cannot set headers; the logger scrubs it (launcher/mainnet.ts).
 *
 * The test kit's own health check rebuilds each URL without its query string, so it
 * would call Blockfrost without the project id and fail. This one keeps it.
 */
export class MainnetEnvironment extends RemoteTestEnvironment {
  private readonly projectId = blockfrostProjectId();

  constructor(logger: Logger) {
    super(logger);
    this.healthCheck = async (): Promise<void> => {
      const cfg = this.getEnvironmentConfiguration();
      const post = async (url: string, body: unknown): Promise<unknown> => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok)
          throw new Error(`HTTP ${res.status}${res.status === 403 ? ' (is the Blockfrost project id right?)' : ''}`);
        return res.json();
      };
      try {
        const block = (await post(cfg.indexer, { query: '{ block { height } }' })) as {
          data?: { block?: { height?: number } };
        };
        if (typeof block.data?.block?.height !== 'number') throw new Error('no block height in the answer');
        logger.info(`Connected to the mainnet indexer (Blockfrost): block ${block.data.block.height}`);
      } catch (e) {
        throw new Error(`Mainnet indexer check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await post(cfg.node, { jsonrpc: '2.0', id: 1, method: 'system_health', params: [] });
        logger.info('Connected to the mainnet node RPC (Blockfrost)');
      } catch (e) {
        throw new Error(`Mainnet node RPC check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      await new ProofServerClient(cfg.proofServer, logger).health();
    };
  }

  private getProofServerUrl(): string {
    const container = this.proofServerContainer as { getUrl(): string } | undefined;
    if (!container) {
      throw new Error('Proof server container is not available.');
    }
    return container.getUrl();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    const q = `?project_id=${encodeURIComponent(this.projectId)}`;
    return {
      walletNetworkId: 'mainnet',
      networkId: 'mainnet',
      indexer: `https://midnight-mainnet.blockfrost.io/api/v0${q}`,
      indexerWS: `wss://midnight-mainnet.blockfrost.io/api/v0/ws${q}`,
      node: `https://rpc.midnight-mainnet.blockfrost.io/${q}`,
      nodeWS: `wss://rpc.midnight-mainnet.blockfrost.io/${q}`,
      // There is no mainnet faucet. Empty, so no faucet check.
      faucet: '',
      proofServer: this.getProofServerUrl(),
    };
  }
}

export class PreviewTestEnvironment extends RemoteTestEnvironment {
  constructor(logger: Logger) {
    super(logger);
  }

  private getProofServerUrl(): string {
    const container = this.proofServerContainer as { getUrl(): string } | undefined;
    if (!container) {
      throw new Error('Proof server container is not available.');
    }
    return container.getUrl();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return {
      walletNetworkId: 'preview',
      networkId: 'preview',
      indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
      indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
      node: 'https://rpc.preview.midnight.network',
      nodeWS: 'wss://rpc.preview.midnight.network',
      faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
      proofServer: this.getProofServerUrl(),
    };
  }
}

export class PreprodTestEnvironment extends RemoteTestEnvironment {
  constructor(logger: Logger) {
    super(logger);
  }

  private getProofServerUrl(): string {
    const container = this.proofServerContainer as { getUrl(): string } | undefined;
    if (!container) {
      throw new Error('Proof server container is not available.');
    }
    return container.getUrl();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return {
      walletNetworkId: 'preprod',
      networkId: 'preprod',
      indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
      indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
      node: 'https://rpc.preprod.midnight.network',
      nodeWS: 'wss://rpc.preprod.midnight.network',
      faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
      proofServer: this.getProofServerUrl(),
    };
  }
}
