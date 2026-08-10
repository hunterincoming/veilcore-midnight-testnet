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

/*
 * Main driver for the Veilcore CLI: anchor a genetics commitment and prove
 * ownership of a previously-anchored strain in zero knowledge. The wallet /
 * sync / dust scaffolding is unchanged from the bboard example.
 */

import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Buffer } from 'node:buffer';
import { WebSocket } from 'ws';
import {
  VeilcoreAPI,
  type VeilcoreDerivedState,
  veilcorePrivateStateKey,
  type VeilcoreProviders,
  type DeployedVeilcoreContract,
  type VeilcorePrivateStateId,
} from '../../api/src/index';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { ledger, type Ledger, pureCircuits } from '../../contract/src/managed/veilcore/contract/index.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type Logger } from 'pino';
import { type Config, StandaloneConfig } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { randomBytes } from '../../api/src/utils';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { type VeilcorePrivateState } from '../../contract/src/witnesses.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

/* **********************************************************************
 * getVeilcoreLedgerState: queries the current ledger state (the anchored
 * commitments) for a specific veilcore contract.
 */

export const getVeilcoreLedgerState = async (
  providers: VeilcoreProviders,
  contractAddress: ContractAddress,
): Promise<Ledger | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  return contractState != null ? ledger(contractState.data) : null;
};

/* **********************************************************************
 * getGeneticSecret: reads this wallet's private genetic preimage from the
 * private state provider. The commitment to this secret is what gets anchored.
 */

const getGeneticSecret = async (providers: VeilcoreProviders): Promise<Uint8Array | null> => {
  const privateState = (await providers.privateStateProvider.get(veilcorePrivateStateKey)) as VeilcorePrivateState | null;
  return privateState?.geneticSecret ?? null;
};

const hexToBytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex.replace(/^0x/, ''), 'hex'));

/* **********************************************************************
 * deployOrJoin: deploy a new veilcore contract or join an existing one.
 */

const DEPLOY_OR_JOIN_QUESTION = `
You can do one of the following:
  1. Deploy a new Veilcore contract
  2. Join an existing Veilcore contract
  3. Exit
Which would you like to do? `;

const deployOrJoin = async (providers: VeilcoreProviders, rli: Interface, logger: Logger): Promise<VeilcoreAPI | null> => {
  while (true) {
    const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
    switch (choice) {
      case '1': {
        const api = await VeilcoreAPI.deploy(providers, logger);
        logger.info(`Deployed contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '2': {
        const api = await VeilcoreAPI.join(providers, await rli.question('What is the contract address (in hex)? '), logger);
        logger.info(`Joined contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '3':
        logger.info('Exiting...');
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

/* **********************************************************************
 * displayLedgerState: shows the anchored commitments (public, known to all).
 */

const displayLedgerState = async (
  providers: VeilcoreProviders,
  deployedContract: DeployedVeilcoreContract,
  logger: Logger,
): Promise<void> => {
  const contractAddress = deployedContract.deployTxData.public.contractAddress;
  const ledgerState = await getVeilcoreLedgerState(providers, contractAddress);
  if (ledgerState === null) {
    logger.info(`There is no Veilcore contract deployed at ${contractAddress}`);
    return;
  }
  // V2: anchoring writes no per-record ledger state. Anchors live in transaction
  // history; the ledger holds only counters and the most recent commitment.
  logger.info(`Total anchors: ${ledgerState.anchorSeq}`);
  logger.info(`Total possession proofs: ${ledgerState.proofSeq}`);
  logger.info(`Most recent commitment: ${toHex(ledgerState.lastAnchor)}`);
};

/* **********************************************************************
 * displayPrivateState: shows the hex of this wallet's genetic secret.
 */

const displayPrivateState = async (providers: VeilcoreProviders, logger: Logger): Promise<void> => {
  const geneticSecret = await getGeneticSecret(providers);
  if (geneticSecret === null) {
    logger.info(`There is no existing Veilcore private state`);
  } else {
    logger.info(`Your genetic secret is: ${toHex(geneticSecret)}`);
    logger.info(`Your commitment is:     ${toHex(pureCircuits.commit(geneticSecret))}`);
  }
};

/* **********************************************************************
 * displayDerivedState: combines ledger + private state to show whether this
 * wallet's own strain is anchored.
 */

const displayDerivedState = (state: VeilcoreDerivedState | undefined, logger: Logger) => {
  if (state === undefined) {
    logger.info(`No Veilcore state currently available`);
    return;
  }
  logger.info(`Total strains anchored: ${state.anchorCount}`);
  logger.info(`Your commitment is:     ${state.myCommitment}`);
  logger.info(`Your strain anchored:   ${state.iOwnAnchor ? 'yes' : 'no'}`);
};

/* **********************************************************************
 * mainLoop: the interactive Veilcore menu.
 */

const MAIN_LOOP_QUESTION = `
You can do one of the following:
  1. Anchor your strain (record its genetics commitment on-chain)
  2. Prove ownership of an anchored strain (zero-knowledge)
  3. Display the current ledger state (known by everyone)
  4. Issue a licence against your record
  5. Countersign a licence (as the licensee)
  6. Revoke a licence you issued
  7. Prove you hold an active licence
  8. Display the current private state (known only to this DApp instance)
  9. Display the current derived state (known only to this DApp instance)
  10. Exit
Which would you like to do? `;

const mainLoop = async (providers: VeilcoreProviders, rli: Interface, logger: Logger): Promise<void> => {
  const veilcoreApi = await deployOrJoin(providers, rli, logger);
  if (veilcoreApi === null) {
    return;
  }
  let currentState: VeilcoreDerivedState | undefined;
  const stateObserver = {
    next: (state: VeilcoreDerivedState) => (currentState = state),
  };
  const subscription = veilcoreApi.state$.subscribe(stateObserver);
  try {
    while (true) {
      const choice = await rli.question(MAIN_LOOP_QUESTION);
      try {
        switch (choice) {
          case '1': {
            // Anchor the commitment of this wallet's private genetic secret. Only the
            // commitment (a hash) is sent on-chain; the preimage stays a private witness.
            const geneticSecret = await getGeneticSecret(providers);
            if (geneticSecret === null) {
              logger.error('No genetic secret in private state; cannot anchor.');
              break;
            }
            const commitment = pureCircuits.commit(geneticSecret);
            await veilcoreApi.anchor(commitment);
            logger.info(`Anchored strain commitment: ${toHex(commitment)}`);
            break;
          }
          case '2': {
            // Prove knowledge of the secret behind an anchored commitment, without
            // revealing it. Blank input uses this wallet's own genetic secret.
            // V2: the circuit proves knowledge of the wallet's own genetic secret and
            // discloses the commitment in a dated transaction. A verifier compares it
            // against the earlier anchor off-chain.
            await veilcoreApi.proveOwnership();
            logger.info('Prior-possession proof submitted. Compare it to the anchor transaction to date the claim.');
            break;
          }
          case '3':
            await displayLedgerState(providers, veilcoreApi.deployedContract, logger);
            break;
          case '4': {
            const geneticSecret = await getGeneticSecret(providers);
            if (geneticSecret === null) {
              logger.error('No genetic secret in private state; cannot issue.');
              break;
            }
            const licSecret = (await rli.question('Enter a licence secret in hex (the licensee will hold this): ')).trim();
            const lic = hexToBytes(licSecret);
            if (lic === null) {
              logger.error('Invalid licence secret.');
              break;
            }
            const recordCommitment = pureCircuits.commit(geneticSecret);
            const licenseCommitment = pureCircuits.commit(lic);
            await veilcoreApi.issueLicense(recordCommitment, licenseCommitment);
            logger.info(`Licence issued (PENDING): ${toHex(licenseCommitment)}`);
            break;
          }
          case '5': {
            const entered = (await rli.question('Enter the licence commitment in hex: ')).trim();
            const lc = hexToBytes(entered);
            if (lc === null) {
              logger.error('Invalid licence commitment.');
              break;
            }
            await veilcoreApi.countersignLicense(lc);
            logger.info('Licence countersigned — now ACTIVE.');
            break;
          }
          case '6': {
            const entered = (await rli.question('Enter the licence commitment to revoke: ')).trim();
            const lc = hexToBytes(entered);
            if (lc === null) {
              logger.error('Invalid licence commitment.');
              break;
            }
            await veilcoreApi.revokeLicense(lc);
            logger.info('Licence revoked and cleared from live state.');
            break;
          }
          case '7': {
            const entered = (await rli.question('Enter your licence secret in hex: ')).trim();
            const sec = hexToBytes(entered);
            if (sec === null) {
              logger.error('Invalid licence secret.');
              break;
            }
            await veilcoreApi.proveLicense(sec);
            logger.info('Licence proof accepted — you hold an active licence.');
            break;
          }
          case '8':
            await displayPrivateState(providers, logger);
            break;
          case '9':
            displayDerivedState(currentState, logger);
            break;
          case '10':
            logger.info('Exiting...');
            return;
          default:
            logger.error(`Invalid choice: ${choice}`);
        }
      } catch (e) {
        logError(logger, e);
        logger.info('Returning to main menu...');
      }
    }
  } finally {
    subscription.unsubscribe();
  }
};

/* ***********************************************************************
 * This seed gives access to tokens minted in the genesis block of a local development node - only
 * used in standalone networks to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/* **********************************************************************
 * buildWallet: unless running in a standalone (offline) mode,
 * prompt the user to tell us whether to create a new wallet
 * or recreate one from a prior seed.
 */

const WALLET_LOOP_QUESTION = `
You can do one of the following:
  1. Build a fresh wallet
  2. Build wallet from a seed
  3. Exit
Which would you like to do? `;

const buildWallet = async (config: Config, rli: Interface, logger: Logger): Promise<string | undefined> => {
  if (config instanceof StandaloneConfig) {
    return GENESIS_MINT_WALLET_SEED;
  }
  while (true) {
    const choice = await rli.question(WALLET_LOOP_QUESTION);
    switch (choice) {
      case '1':
        return toHex(randomBytes(32));
      case '2':
        return await rli.question('Enter your wallet seed: ');
      case '3':
        logger.info('Exiting...');
        return undefined;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

/* **********************************************************************
 * run: the main entry point that starts the whole Veilcore CLI.
 *
 * If called with a Docker environment argument, the application
 * will wait for Docker to be ready before doing anything else.
 */

export const run = async (config: Config, testEnv: TestEnvironment, logger: Logger): Promise<void> => {
  const rli = createInterface({ input, output, terminal: true });
  const providersToBeStopped: MidnightWalletProvider[] = [];
  try {
    const envConfiguration = await testEnv.start();
    logger.info(`Environment started with configuration: ${JSON.stringify(envConfiguration)}`);
    const seed = await buildWallet(config, rli, logger);
    if (seed === undefined) {
      return;
    }
    const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, seed);
    providersToBeStopped.push(walletProvider);
    const walletFacade: WalletFacade = walletProvider.wallet;

    await walletProvider.start();

    const unshieldedState = await waitForUnshieldedFunds(logger, walletFacade, envConfiguration, unshieldedToken());
    const nightBalance = unshieldedState.balances[unshieldedToken().raw];
    if (nightBalance === undefined) {
      logger.info('No funds received, exiting...');
      return;
    }
    logger.info(`Your NIGHT wallet balance is: ${nightBalance}`);

    if (config.generateDust) {
      const dustGeneration = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (dustGeneration) {
        logger.info(`Submitted dust generation registration transaction: ${dustGeneration}`);
        await syncWallet(logger, walletFacade);
      }
    }

    const zkConfigProvider = new NodeZkConfigProvider<'anchor' | 'proveOwnership'>(config.zkConfigPath);
    const providers: VeilcoreProviders = {
      privateStateProvider: levelPrivateStateProvider<VeilcorePrivateStateId, VeilcorePrivateState>({
        privateStateStoreName: config.privateStateStoreName,
        signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
        privateStoragePasswordProvider: () => {
          return 'Bboard-Test-2026!';
        },
        accountId: seed,
      }),
      publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
      zkConfigProvider: zkConfigProvider,
      proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
      walletProvider: walletProvider,
      midnightProvider: walletProvider,
    };
    await mainLoop(providers, rli, logger);
  } catch (e) {
    logError(logger, e);
    logger.info('Exiting...');
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logError(logger, e);
    } finally {
      try {
        for (const wallet of providersToBeStopped) {
          logger.info('Stopping wallet...');
          await wallet.stop();
        }
        if (testEnv) {
          logger.info('Stopping test environment...');
          await testEnv.shutdown();
        }
      } catch (e) {
        logError(logger, e);
      }
    }
  }
};

function logError(logger: Logger, e: unknown) {
  if (e instanceof Error) {
    logger.error(`Found error '${e.message}'`);
    logger.debug(`${e.stack}`);
  } else {
    logger.error(`Found error (unknown type)`);
  }
}
