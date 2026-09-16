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
import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { randomBytes } from '../../api/src/utils';
import { LicenseTree } from '../../contract/src/license-tree.mjs';
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
  const privateState = await providers.privateStateProvider.get(veilcorePrivateStateKey);
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

const deployOrJoin = async (
  providers: VeilcoreProviders,
  rli: Interface,
  logger: Logger,
): Promise<VeilcoreAPI | null> => {
  while (true) {
    const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
    switch (choice) {
      case '1': {
        // The authority decides which circuits the network accepts calls to, so
        // it is asked rather than defaulted. Left to the SDK, a key is sampled
        // and installed silently and the deployment acquires an authority
        // nobody chose.
        logger.info(
          'A maintenance authority can insert and remove verifier keys, so it can disable any circuit in this contract.',
        );
        logger.info(
          'Without one the contract is permanently non-upgradable, and cannot be repaired when the proof system changes.',
        );
        logger.info('Sealed records verify either way — verification is SHA-256 and needs nothing from a chain.');
        const authority = (await rli.question('Deploy with a maintenance authority? (y/N): ')).trim().toLowerCase();

        let signingKey: string | null = null;
        if (authority === 'y' || authority === 'yes') {
          signingKey = (await rli.question('Signing key (blank to generate one): ')).trim() || sampleSigningKey();
          logger.info(`Maintenance authority signing key: ${signingKey}`);
          logger.info(
            'Record this somewhere deliberate. Whoever holds it controls what the contract accepts, and losing it makes the contract permanently non-upgradable.',
          );
        } else {
          logger.info('Deploying with NO maintenance authority. This cannot be undone.');
        }

        const api = await VeilcoreAPI.deploy(providers, signingKey, logger);
        logger.info(`Deployed contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '2': {
        const api = await VeilcoreAPI.join(
          providers,
          await rli.question('What is the contract address (in hex)? '),
          logger,
        );
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
  10. Anchor a batch root (one transaction covers every record in the batch)
  11. Propose transferring a licence to a new holder
  12. Approve a proposed transfer (as the issuer)
  13. Withdraw a proposed transfer
  14. Rotate a record to a new secret
  15. Exit
Which would you like to do? `;

const mainLoop = async (providers: VeilcoreProviders, rli: Interface, logger: Logger): Promise<void> => {
  const veilcoreApi = await deployOrJoin(providers, rli, logger);
  if (veilcoreApi === null) {
    return;
  }
  /**
   * The CLI's copy of the active-licence tree.
   *
   * proveLicense opens a leaf of this tree rather than looking a commitment up in a
   * map, which is what stops a presentation naming the breeder — but it means every
   * licence call needs a path, and a path is only valid against the root the chain
   * currently holds.
   *
   * THIS COPY STARTS EMPTY, so it is only correct when this CLI is the only party
   * acting on a contract deployed in this session. Anything else — a second operator,
   * a redeployment, a restart — and it has missed transactions. Rebuilding it properly
   * means replaying the chain's history, which is an indexer's job and not a dev
   * CLI's, so instead every licence action checks the local root against the chain's
   * and refuses when they differ. Failing here beats building a path that folds to a
   * root the chain never had and finding out after proving and paying.
   */
  const licTree = new LicenseTree();
  const licenceTreeInSync = async (): Promise<boolean> => {
    const chainRoot = await veilcoreApi.activeLicenseRoot();
    if (toHex(licTree.root()) === toHex(chainRoot)) return true;
    logger.error("This CLI's licence tree does not match the chain.");
    logger.error(`  local: ${toHex(licTree.root())}`);
    logger.error(`  chain: ${toHex(chainRoot)}`);
    logger.error(
      'Licence actions need a path into the active-licence tree, and this copy starts ' +
        'empty. It is only usable against a contract deployed in this session with no ' +
        'other party acting on it. Rebuild from chain history to do better.',
    );
    return false;
  };

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
            // A RECOVERY SECRET IS CHOSEN NOW OR NEVER. It cannot be added later,
            // because by the time a holder knows they need one they no longer hold the
            // secret that would authorise adding it. It is generated here and printed
            // once — the CLI does not store it, and a record whose recovery secret is
            // lost along with its genetic secret is gone for good.
            const recoverySecret = randomBytes(32);
            const recoveryCommitment = pureCircuits.commit(recoverySecret);
            await veilcoreApi.anchor(commitment, recoveryCommitment);
            logger.info(`Anchored strain commitment: ${toHex(commitment)}`);
            logger.info('');
            logger.info('  RECOVERY SECRET — SAVE THIS NOW, IT IS NOT STORED AND NOT SHOWN AGAIN:');
            logger.info(`  ${toHex(recoverySecret)}`);
            logger.info('');
            logger.info(
              'It is the only way to move this record if the genetic secret is lost. ' +
                'Keep it apart from that secret — a place that loses both loses the record.',
            );
            break;
          }
          case '2': {
            // Prove knowledge of the secret behind an anchored commitment, without
            // revealing it. Blank input uses this wallet's own genetic secret.
            // V2: the circuit proves knowledge of the wallet's own genetic secret and
            // discloses the commitment in a dated transaction. A verifier compares it
            // against the earlier anchor off-chain.
            const proof = await veilcoreApi.proveOwnership();
            logger.info(`Prior-possession proof submitted for commitment: ${toHex(proof.commitment)}`);
            logger.info(`Transaction ${proof.txHash} at block ${proof.blockHeight}.`);
            logger.info(
              'Give a verifier both. They compare the commitment against the earlier anchor transaction — telling them a proof happened without saying which record it concerns proves nothing.',
            );
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
            const licSecret = (
              await rli.question('Enter a licence secret in hex (the licensee will hold this): ')
            ).trim();
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
            // The licensee supplies their SECRET, not the commitment. The commitment is
            // derived in-circuit from that secret and the issuing record, so a licence a
            // sniper registered first under their own record is a different value and the
            // countersignature cannot land on it.
            const secHex = (await rli.question('Enter YOUR licence secret in hex: ')).trim();
            const recHex = (await rli.question('Issuing record commitment in hex: ')).trim();
            const sec = hexToBytes(secHex);
            const rec = hexToBytes(recHex);
            if (sec === null || rec === null) {
              logger.error('Invalid input.');
              break;
            }
            if (!(await licenceTreeInSync())) break;
            const lc = pureCircuits.licenseCommit(sec, rec);
            const plan = licTree.planInsert(lc);
            await veilcoreApi.countersignLicense(sec, rec, {
              directions: plan.dirs,
              siblings: plan.siblings,
            });
            // Only after the chain accepted it. A refused call must leave the local tree
            // where it was, or every path built afterwards is wrong.
            licTree.applyInsert(lc, plan.index);
            logger.info(`Licence countersigned — now ACTIVE: ${toHex(lc)}`);
            break;
          }
          case '6': {
            const entered = (await rli.question('Enter the licence commitment to revoke: ')).trim();
            const lc = hexToBytes(entered);
            if (lc === null) {
              logger.error('Invalid licence commitment.');
              break;
            }
            if (!(await licenceTreeInSync())) break;
            // A PENDING licence has no leaf and the circuit skips the tree for one, so a
            // null path is what it gets. An ACTIVE one needs its real position.
            let plan;
            try {
              plan = licTree.planRemove(lc);
            } catch {
              plan = { index: -1, dirs: [] as boolean[], siblings: [] as Uint8Array[] };
            }
            await veilcoreApi.revokeLicense(lc, { directions: plan.dirs, siblings: plan.siblings });
            if (plan.index >= 0) licTree.applyRemove(lc, plan.index);
            logger.info('Licence revoked, cleared from live state and removed from the tree.');
            break;
          }
          case '7': {
            const entered = (await rli.question('Enter your licence secret in hex: ')).trim();
            const recHex = (await rli.question('Issuing record commitment in hex: ')).trim();
            const sec = hexToBytes(entered);
            const rec = hexToBytes(recHex);
            if (sec === null || rec === null) {
              logger.error('Invalid input.');
              break;
            }
            if (!(await licenceTreeInSync())) break;
            const lc = pureCircuits.licenseCommit(sec, rec);
            let path;
            try {
              path = licTree.pathFor(lc);
            } catch {
              logger.error('No live licence with that secret against that record.');
              break;
            }
            // The record commitment is entered here but never leaves this process: the
            // circuit takes no arguments at all, so the secret, the record and the
            // position are witnesses. Two presentations are byte-identical on chain.
            await veilcoreApi.proveLicense(sec, rec, { directions: path.dirs, siblings: path.siblings });
            logger.info('Licence proof accepted — you hold a live licence.');
            logger.info('The transaction names neither the licence nor the record it was issued against.');
            break;
          }
          case '8':
            await displayPrivateState(providers, logger);
            break;
          case '9':
            displayDerivedState(currentState, logger);
            break;
          case '10': {
            // A batch root aggregates many record commitments. Anchoring it timestamps
            // every record in the batch in a single transaction, which is what lets a
            // holder settle on chain without running a wallet.
            const entered = (await rli.question('Enter the batch root in hex: ')).trim();
            const root = hexToBytes(entered);
            if (root === null) {
              logger.error('Invalid root.');
              break;
            }
            const anchored = await veilcoreApi.anchorBatch(root);
            logger.info('Batch root anchored. Every record in that batch is now timestamped.');
            logger.info(`txHash: ${anchored.txHash}`);
            logger.info(`blockHeight: ${anchored.blockHeight}`);
            logger.info('Record this against the batch so proofs reference a transaction anyone can look up.');
            break;
          }
          case '11': {
            // A licence is not a bearer instrument. Proposing is only half the act —
            // the issuer must approve, which is what makes it permissioned rather than
            // freely transferable.
            // The holder proves the licence secret rather than naming its commitment:
            // taking the commitment as an argument let any observer write into the
            // pending slot and replace a proposal the issuer had already agreed to.
            const secHex = (await rli.question('YOUR licence secret in hex: ')).trim();
            const recHex = (await rli.question('Issuing record commitment: ')).trim();
            const nhHex = (await rli.question("Incoming party's NEW licence commitment: ")).trim();
            const sec = hexToBytes(secHex);
            const rec = hexToBytes(recHex);
            const nh = hexToBytes(nhHex);
            if (sec === null || rec === null || nh === null) {
              logger.error('Invalid input.');
              break;
            }
            await veilcoreApi.proposeTransfer(sec, rec, nh);
            logger.info('Transfer proposed. Nothing moves until the issuer approves.');
            logger.info(
              'The incoming party generated that commitment from a secret you have never ' +
                'seen — which is what ends your rights when the assignment completes.',
            );
            break;
          }
          case '12': {
            const lcHex = (await rli.question('Licence commitment: ')).trim();
            const lc = hexToBytes(lcHex);
            if (lc === null) {
              logger.error('Invalid licence commitment.');
              break;
            }
            // The issuer names the recipient they agreed to. This is deliberately not
            // read back from the ledger: the circuit compares it against what is
            // pending, so an approval cannot land on a proposal that was swapped
            // between the agreement and this call. Reading it here would approve
            // whatever is pending, which is the thing the check exists to stop.
            const enlHex = (await rli.question('New holder commitment you are approving: ')).trim();
            const enl = hexToBytes(enlHex);
            if (enl === null) {
              logger.error('Invalid new holder commitment.');
              break;
            }
            const geneticSecret = await getGeneticSecret(providers);
            if (geneticSecret === null) {
              logger.error('No genetic secret in private state.');
              break;
            }
            if (!(await licenceTreeInSync())) break;
            // The outgoing leaf is replaced by the incoming one in place — the same
            // agreement continuing with a party the issuer has just consented to.
            const plan = licTree.planReplace(lc);
            await veilcoreApi.approveTransfer(lc, pureCircuits.commit(geneticSecret), enl, {
              directions: plan.dirs,
              siblings: plan.siblings,
            });
            licTree.applyReplace(lc, enl, plan.index);
            logger.info('Transfer approved. The licence now belongs to the new holder.');
            break;
          }
          case '13': {
            // Derived, not accepted, for the same reason as proposing: taking the
            // commitment let any observer cancel any pending transfer and block a
            // licence from moving indefinitely.
            const secHex = (await rli.question('YOUR licence secret in hex: ')).trim();
            const recHex = (await rli.question('Issuing record commitment: ')).trim();
            const sec = hexToBytes(secHex);
            const rec = hexToBytes(recHex);
            if (sec === null || rec === null) {
              logger.error('Invalid input.');
              break;
            }
            await veilcoreApi.withdrawTransfer(sec, rec);
            logger.info('Transfer proposal withdrawn.');
            break;
          }
          case '14': {
            // A witness secret cannot be recovered from the chain. Without this, a
            // holder who loses theirs loses every record keyed to it permanently.
            // The incoming commitment is generated by the holder from a secret they
            // created themselves, so nothing secret crosses the wire.
            // BOTH SIDES ARE PROVED NOW. The incoming commitment used to be taken on
            // trust, which let a holder rotate onto a record belonging to somebody else,
            // so the new SECRET is supplied and the circuit derives the commitment from
            // it. Nothing secret crosses the wire — this is the holder's own machine.
            const nsHex = (await rli.question('New record SECRET in hex: ')).trim();
            const ns = hexToBytes(nsHex);
            if (ns === null) {
              logger.error('Invalid secret.');
              break;
            }
            const nc = pureCircuits.commit(ns);
            const rot = await veilcoreApi.rotateRecordSecret(nc, ns);
            logger.info(`Rotated. Previous commitment: ${toHex(rot.previousCommitment)}`);
            logger.info(`Transaction ${rot.txHash} at block ${rot.blockHeight}.`);
            logger.info(
              'Licences issued against the old record are not moved. Re-key them through transfer, where the issuer approves.',
            );
            break;
          }
          case '15':
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
          // This store holds the contract's maintenance authority key, which can
          // insert or remove verifier keys and so decide what the contract accepts.
          // The literal that used to sit here came from the example this was forked
          // from and was published in a public repository, which is no password at
          // all on a network where the contract matters.
          const password = process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
          if (!password) {
            throw new Error(
              'VEILCORE_PRIVATE_STATE_PASSWORD is not set. It encrypts private state and the ' +
                'maintenance authority signing key. Sixteen characters or more, with at least ' +
                'three of uppercase, lowercase, digits and symbols.',
            );
          }
          return password;
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
