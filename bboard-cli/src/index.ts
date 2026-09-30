// SPDX-License-Identifier: Apache-2.0
// Wallet and network scaffolding adapted from midnightntwrk/example-bboard (Apache-2.0).
//
// The VeilCore command-line client: deploy or join the contract, then act on records,
// licences and lineage. Secrets are shown with showSecret (screen only, never logged).

import { createHash } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Buffer } from 'node:buffer';
import { WebSocket } from 'ws';
import {
  VeilcoreAPI,
  type VeilcoreDerivedState,
  veilcorePrivateStateKey,
  type VeilcoreProviders,
  type VeilcorePrivateStateId,
  type VeilcoreCircuitKeys,
  type SealResult,
  newPresentationChallenge,
} from '../../api/src/index';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { pureCircuits } from '../../contract/src/managed/veilcore/contract/index.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type Logger } from 'pino';
import { type Config, StandaloneConfig } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { randomBytes } from '../../api/src/utils';
import { showSecret } from './secret-out';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { runSmoke } from './smoke';
import { assertKeysMatchRecord } from './keys-check';
import path from 'node:path';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type VeilcorePrivateState } from '../../contract/src/witnesses.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const C = pureCircuits;

/** 32 bytes from exactly 64 hex characters, or null. Anything else is a typo, not a value. */
export const parse32 = (text: string): Uint8Array | null => {
  const t = text.trim().replace(/^0x/, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(t) ? new Uint8Array(Buffer.from(t, 'hex')) : null;
};

class InputError extends Error {}

/** Ask for a 32-byte value in hex; refuses anything else. */
const ask32 = async (rli: Interface, prompt: string): Promise<Uint8Array> => {
  const v = parse32(await rli.question(prompt));
  if (v === null) throw new InputError('That is not 64 hex characters (32 bytes). Nothing was sent.');
  return v;
};

/** A 32-byte value, or blank for a default. */
const ask32Or = async (rli: Interface, prompt: string, fallback: Uint8Array): Promise<Uint8Array> => {
  const raw = (await rli.question(prompt)).trim();
  if (raw === '') return fallback;
  const v = parse32(raw);
  if (v === null) throw new InputError('That is not 64 hex characters (32 bytes). Nothing was sent.');
  return v;
};

/** Obligation terms: a 64-hex commitment as given, or any text, committed by SHA-256. */
const askObligation = async (rli: Interface, logger: Logger): Promise<Uint8Array> => {
  const raw = (await rli.question('Obligation: 64-hex commitment, or the terms as text: ')).trim();
  const asHex = parse32(raw);
  if (asHex !== null) return asHex;
  if (raw === '') throw new InputError('An obligation cannot be empty.');
  const c = new Uint8Array(createHash('sha256').update(raw, 'utf8').digest());
  logger.info(`Obligation commitment (SHA-256 of the text): ${toHex(c)}`);
  return c;
};

const mySecret = async (providers: VeilcoreProviders): Promise<Uint8Array> => {
  const s = (await providers.privateStateProvider.get(veilcorePrivateStateKey))?.geneticSecret;
  if (s === undefined) throw new InputError('No record secret in private state.');
  return s;
};

const describeSeal = (r: SealResult, logger: Logger): void => {
  if (r.sealed) logger.info('Sealed: presentations proved before this can no longer be used.');
  else if (r.waiting && r.sealableAt !== undefined)
    logger.info(
      `Older presentations stay usable until the next seal, possible from ${new Date(r.sealableAt * 1000).toISOString()}. ` +
        'Anyone can make it: choose "Seal waiting revocations" then.',
    );
};

/* **********************************************************************
 * Deploy or join.
 */

const DEPLOY_OR_JOIN_QUESTION = `
  1. Deploy a new VeilCore contract
  2. Join an existing VeilCore contract
  3. Run the full smoke test (preprod or preview only; deploys a fresh test contract)
  4. Exit
Which would you like to do? `;

/**
 * Keep the maintenance authority, or retire it. midnight-js always installs one, so
 * "no" means deploy and then retire it (api/src/maintenance.ts). Keeping it is the
 * default: it is the only way to repair a deployed contract, and it can be retired later.
 */
const askMaintenanceAuthority = async (rli: Interface, logger: Logger): Promise<string | null> => {
  logger.info('The maintenance authority can add and remove verifier keys: it can repair, or disable, any circuit.');
  logger.info('Retired, the contract can never be changed by anyone. Sealed records verify by SHA-256 either way.');
  const answer = (await rli.question('Keep a maintenance authority? (Y/n): ')).trim().toLowerCase();
  if (answer === 'n' || answer === 'no') {
    const sure = (await rli.question('Retiring is permanent. Type RETIRE to confirm: ')).trim();
    if (sure === 'RETIRE') {
      logger.info('Deploying, then retiring the authority with a key that is never stored.');
      return null;
    }
    logger.info('Not retired. Keeping the authority.');
  }
  const key = (await rli.question('Signing key (blank to generate one): ')).trim() || sampleSigningKey();
  showSecret('MAINTENANCE AUTHORITY SIGNING KEY — write it down now and keep it offline:', key);
  return key;
};

export const deployOrJoin = async (
  providers: VeilcoreProviders,
  rli: Interface,
  logger: Logger,
  zkConfigPath: string,
  indexerUri: string,
): Promise<VeilcoreAPI | null> => {
  while (true) {
    const choice = (await rli.question(DEPLOY_OR_JOIN_QUESTION)).trim();
    switch (choice) {
      case '1': {
        if (getNetworkId() === 'mainnet') {
          const n = assertKeysMatchRecord(zkConfigPath, path.resolve(zkConfigPath, '..', '..', '..', '..'));
          logger.info(`All ${n} build artefacts match the committed fingerprints (docs/fingerprints.md).`);
        }
        const api = await VeilcoreAPI.deploy(providers, await askMaintenanceAuthority(rli, logger), logger);
        logger.info(`Deployed VeilCore contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '2': {
        const api = await VeilcoreAPI.join(providers, (await rli.question('Contract address (hex): ')).trim(), logger);
        logger.info(`Joined contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '3': {
        if (getNetworkId() === 'mainnet') {
          logger.error('The smoke test does not run on mainnet.');
          continue;
        }
        const passed = await runSmoke(providers, logger, indexerUri);
        logger.info(passed ? 'Smoke test passed.' : 'Smoke test FAILED — see above.');
        return null;
      }
      case '4':
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

/* **********************************************************************
 * The main menu.
 */

const MAIN_LOOP_QUESTION = `
 Records                                  Lineage
  1. Anchor your record                   16. Propose a parent (as child)
  2. Prove ownership                      17. Confirm a child (as parent)
  3. Pair a DNA report fingerprint        18. Withdraw your parent proposal
  4. Rotate to a new secret               19. Place an obligation on your record
  5. Recover with the recovery secret     20. Propose an obligation (as beneficiary)
  6. Replace the recovery secret          21. Accept an obligation (as holder)
                                          22. Reject an obligation (as holder)
 Licences                                 23. Withdraw an obligation proposal
  7. Make a licence secret (as licensee)  24. Release an obligation (as beneficiary)
  8. Issue a licence                      25. Check a record's lineage
  9. Countersign a licence (as licensee)
 10. Prove you hold a licence             Verifier
 11. Propose a transfer (as holder)       26. Make a challenge for a licensee
 12. Approve a transfer (as issuer)       27. Check a licence presentation
 13. Withdraw a transfer proposal
 14. Revoke a licence                     Other
 15. Seal waiting revocations             28. Anchor a batch root
                                          29. Show the contract state
                                          30. Show your record and identity
                                          31. Show your record secret
                                          32. Retire the maintenance authority (PERMANENT)
                                           0. Exit
Which would you like to do? `;

const mainLoop = async (
  providers: VeilcoreProviders,
  rli: Interface,
  logger: Logger,
  zkConfigPath: string,
  indexerUri: string,
): Promise<void> => {
  const api = await deployOrJoin(providers, rli, logger, zkConfigPath, indexerUri);
  if (api === null) return;

  let derived: VeilcoreDerivedState | undefined;
  const subscription = api.state$.subscribe({ next: (s) => (derived = s) });
  const tx = (r: { txHash: string; blockHeight: number }): void =>
    logger.info(`Transaction ${r.txHash} at block ${r.blockHeight}.`);
  try {
    while (true) {
      const choice = (await rli.question(MAIN_LOOP_QUESTION)).trim();
      try {
        switch (choice) {
          case '1': {
            // A recovery secret is chosen now or never: by the time a holder needs one, they
            // no longer hold the secret that would authorise adding it.
            const recovery = randomBytes(32);
            tx(await api.anchor(C.recoveryCommit(recovery)));
            logger.info(`Anchored record: ${toHex(C.commit(await mySecret(providers)))}`);
            showSecret('RECOVERY SECRET — SAVE THIS NOW, IT IS NOT STORED AND NOT SHOWN AGAIN:', toHex(recovery));
            logger.info('It moves this record even if the record secret is lost OR STOLEN. Keep it offline.');
            break;
          }
          case '2': {
            const p = await api.proveOwnership();
            logger.info(`Ownership proved for record ${toHex(p.commitment)}.`);
            tx(p);
            break;
          }
          case '3': {
            const dna = await ask32(rli, 'DNA report fingerprint (hex): ');
            tx(await api.pairDna(dna));
            break;
          }
          case '4': {
            const next = randomBytes(32);
            showSecret('YOUR NEW RECORD SECRET — store it now, before the rotation is sent:', toHex(next));
            await rli.question('Press Enter once it is stored. ');
            const r = await api.rotateRecordSecret(C.commit(next), next);
            logger.info(`Rotated from ${toHex(r.previousCommitment)} to ${toHex(C.commit(next))}.`);
            tx(r);
            logger.info('Licences, parentage and obligations stay with your identity.');
            break;
          }
          case '5': {
            const origin = await ask32(rli, 'ORIGINAL anchored record (hex): ');
            const recovery = await ask32(rli, 'Recovery secret (hex): ');
            const next = randomBytes(32);
            showSecret('YOUR NEW RECORD SECRET — store it now, before the recovery is sent:', toHex(next));
            await rli.question('Press Enter once it is stored. ');
            tx(await api.recoverRecordSecret(origin, C.commit(next), recovery, next));
            logger.info('Recovered. Whoever held an earlier secret, including a thief, can no longer act from now on.');
            logger.info(
              'What they did before this (licences revoked, obligations accepted) stands. See design.md, Known limits.',
            );
            break;
          }
          case '6': {
            const origin = await ask32(rli, 'ORIGINAL anchored record (hex): ');
            const current = await ask32(rli, 'CURRENT recovery secret (hex): ');
            const next = randomBytes(32);
            showSecret('NEW RECOVERY SECRET — store it now, before it is sent:', toHex(next));
            await rli.question('Press Enter once it is stored. ');
            tx(await api.replaceRecoveryCommitment(origin, C.recoveryCommit(next), current));
            logger.info('Replaced. The old recovery secret no longer works.');
            break;
          }
          case '7': {
            const issuer = await ask32(rli, "Issuer's record (hex): ");
            const secret = randomBytes(32);
            showSecret(
              'YOUR LICENCE SECRET — keep it; you need it to countersign, present and transfer:',
              toHex(secret),
            );
            logger.info(`Send the issuer this licence commitment: ${toHex(C.licenseCommit(secret, issuer))}`);
            break;
          }
          case '8': {
            const lc = await ask32(rli, "Licensee's licence commitment (hex, from their option 7): ");
            tx(await api.issueLicense(lc));
            logger.info("Licence issued, pending the licensee's countersignature.");
            break;
          }
          case '9': {
            const secret = await ask32(rli, 'YOUR licence secret (hex): ');
            const issuer = await ask32(rli, "Issuer's record (hex): ");
            tx(await api.countersignLicense(secret, issuer));
            logger.info(`Licence active: ${toHex(C.licenseCommit(secret, issuer))}`);
            break;
          }
          case '10': {
            const secret = await ask32(rli, 'YOUR licence secret (hex): ');
            const issuer = await ask32(rli, "Issuer's record (hex): ");
            const ch = await ask32(rli, "Verifier's challenge (hex, from the verifier's option 26): ");
            const shown = await api.proveLicense(secret, issuer, ch);
            tx(shown);
            logger.info(`Give the verifier this transaction id: ${shown.txId}`);
            break;
          }
          case '11': {
            const secret = await ask32(rli, 'YOUR licence secret (hex): ');
            const issuer = await ask32(rli, "Issuer's record (hex): ");
            const incoming = await ask32(rli, "Incoming holder's licence commitment (hex, from their option 7): ");
            tx(await api.proposeTransfer(secret, issuer, incoming));
            logger.info('Proposed. Nothing moves until the issuer approves.');
            break;
          }
          case '12': {
            const lc = await ask32(rli, 'Current licence commitment (hex): ');
            const incoming = await ask32(rli, 'Incoming holder commitment you agreed to (hex): ');
            const issuer = await ask32Or(
              rli,
              'Record it was issued under (hex; blank = your current record): ',
              C.commit(await mySecret(providers)),
            );
            const r = await api.approveTransfer(lc, issuer, incoming);
            tx(r);
            describeSeal(r, logger);
            break;
          }
          case '13': {
            const secret = await ask32(rli, 'YOUR licence secret (hex): ');
            const issuer = await ask32(rli, "Issuer's record (hex): ");
            tx(await api.withdrawTransfer(secret, issuer));
            break;
          }
          case '14': {
            const lc = await ask32(rli, 'Licence commitment to revoke (hex): ');
            const issuer = await ask32Or(
              rli,
              'Record it was issued under (hex; blank = your current record): ',
              C.commit(await mySecret(providers)),
            );
            const r = await api.revokeLicense(lc, issuer);
            tx(r);
            logger.info('Revoked.');
            describeSeal(r, logger);
            break;
          }
          case '15': {
            const r = await api.sealRevocations();
            if (!r.sealed && !r.waiting) logger.info('Nothing is waiting to be sealed.');
            describeSeal(r, logger);
            break;
          }
          case '16':
            tx(await api.proposeParent(await ask32(rli, "Parent's record (hex): ")));
            logger.info("Proposed. The edge exists once the parent's holder confirms.");
            break;
          case '17':
            tx(await api.confirmParent(await ask32(rli, "Child's record (hex): ")));
            break;
          case '18':
            tx(await api.withdrawParent());
            break;
          case '19':
            tx(await api.encumberOwnRecord(await askObligation(rli, logger)));
            logger.info('In force. Descendants will not check clean until you release it.');
            break;
          case '20': {
            const record = await ask32(rli, "Holder's record (hex): ");
            tx(await api.proposeObligation(record, await askObligation(rli, logger)));
            logger.info('Proposed. It binds nobody until the holder accepts.');
            break;
          }
          case '21': {
            const obligation = await askObligation(rli, logger);
            tx(await api.acceptObligation(obligation, await ask32(rli, "Beneficiary's record (hex): ")));
            break;
          }
          case '22': {
            const obligation = await askObligation(rli, logger);
            tx(await api.rejectObligation(obligation, await ask32(rli, "Beneficiary's record (hex): ")));
            break;
          }
          case '26': {
            const ch = newPresentationChallenge();
            showSecret('CHALLENGE — send it to the licensee privately, use it once, never publish it:', toHex(ch));
            logger.info('Keep it: you need it to check their presentation (option 27).');
            break;
          }
          case '27': {
            const txId = (await rli.question("The presentation's transaction id (from the licensee): ")).trim();
            const issuer = await ask32(rli, 'Issuer you asked about (any record of that identity, hex): ');
            const ch = await ask32(rli, 'The challenge you sent (hex): ');
            const verdict = await api.checkPresentation(indexerUri, txId, issuer, ch);
            logger.info(`${verdict.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}: ${verdict.reason}.`);
            break;
          }
          case '23': {
            const record = await ask32(rli, "Holder's record (hex): ");
            tx(await api.withdrawObligation(record, await askObligation(rli, logger)));
            break;
          }
          case '24': {
            const record = await ask32(rli, "Holder's record (hex): ");
            tx(await api.discharge(record, await askObligation(rli, logger)));
            break;
          }
          case '25': {
            const record = await ask32(rli, 'Record to check (hex): ');
            const rootsText = (
              await rli.question(
                'Origins you recognise as the start of a line (hex, comma-separated; blank for none): ',
              )
            ).trim();
            const recognised =
              rootsText === ''
                ? []
                : rootsText.split(',').map((t) => {
                    const v = parse32(t);
                    if (v === null) throw new InputError(`Not a record: ${t.trim()}`);
                    return v;
                  });
            const report = await api.checkLineage(record, recognised);
            logger.info(`Identity: ${toHex(report.identity)}`);
            logger.info(`Confirmed ancestors: ${report.ancestors.length}; owing: ${report.encumbered.length}`);
            report.encumbered.forEach((a) => logger.info(`  owes: ${toHex(a)}`));
            report.roots.forEach((a) => logger.info(`  starts at: ${toHex(a)}`));
            if (report.cyclic) logger.info('The pedigree loops back on itself.');
            logger.info(report.clean ? 'CLEAN: nothing on chain is owed on this line.' : 'NOT CLEAN.');
            logger.info(
              report.accepted
                ? 'ACCEPTED: clean, no loop, and every line starts at an origin you recognise.'
                : 'NOT ACCEPTED: needs to be clean, loop-free, and start at origins you recognise (design.md, rule 4).',
            );
            break;
          }
          case '28': {
            const root = await ask32(rli, 'Batch root (hex): ');
            tx(await api.anchorBatch(root));
            logger.info('Anchored. This proves the batch existed at this time, not who held its records.');
            break;
          }
          case '29': {
            const l = await api.currentLedger();
            logger.info(
              `Protocol version ${l.protocolVersion}. Anchors ${l.anchorSeq}, ownership proofs ${l.proofSeq}, presentations ${l.presentationSeq}.`,
            );
            logger.info(`Parentage edges ${l.descentSeq}, obligation changes ${l.obligationSeq}, seals ${l.sealSeq}.`);
            logger.info(`Revocations waiting for a seal: ${l.unsealedChanges ? 'yes' : 'no'}.`);
            break;
          }
          case '30':
            if (derived === undefined) logger.info('No state yet.');
            else {
              logger.info(`Your record:   ${derived.myCommitment}`);
              logger.info(`Your identity: ${derived.myIdentity}`);
              logger.info(
                `Anchored: ${derived.iAmAnchored ? 'yes' : 'no'}. Current: ${derived.iAmLive ? 'yes' : 'no (rotated or recovered away)'}.`,
              );
            }
            break;
          case '31':
            showSecret('YOUR RECORD SECRET:', toHex(await mySecret(providers)));
            break;
          case '32': {
            const sure = (
              await rli.question(
                'Nobody, including you, will ever be able to change this contract. Type RETIRE to confirm: ',
              )
            ).trim();
            if (sure === 'RETIRE') await api.retireMaintenanceAuthority();
            else logger.info('Not retired.');
            break;
          }
          case '0':
            return;
          default:
            logger.error(`Invalid choice: ${choice}`);
        }
      } catch (e) {
        logError(logger, e);
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
  2. Build wallet from a hex seed
  3. Build wallet from a 24-word recovery phrase (the one your wallet app shows)
  4. Exit
Which would you like to do? `;

type WalletSource = { seed?: string; mnemonic?: string };

const buildWallet = async (config: Config, rli: Interface, logger: Logger): Promise<WalletSource | undefined> => {
  if (config instanceof StandaloneConfig) {
    return { seed: GENESIS_MINT_WALLET_SEED };
  }
  while (true) {
    const choice = await rli.question(WALLET_LOOP_QUESTION);
    switch (choice) {
      case '1':
        if (config.mainnet) {
          // A fresh wallet has no DUST on mainnet and cannot get any from a faucet.
          logger.error('On mainnet, use the wallet that holds your DUST (option 3).');
          break;
        }
        return { seed: toHex(randomBytes(32)) };
      case '2':
        return { seed: (await rli.question('Enter your wallet seed (hex): ')).trim() };
      case '3': {
        logger.info('Type the 24 words separated by spaces. They are not logged or stored.');
        const mnemonic = (await rli.question('Recovery phrase: ')).trim().toLowerCase().split(/\s+/).join(' ');
        if (mnemonic.split(' ').length !== 24) {
          logger.error('That is not 24 words.');
          break;
        }
        return { mnemonic };
      }
      case '4':
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
    const source = await buildWallet(config, rli, logger);
    if (source === undefined) {
      return;
    }
    const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, source);
    providersToBeStopped.push(walletProvider);
    const walletFacade: WalletFacade = walletProvider.wallet;
    const seed = walletProvider.masterSeed;

    // Shown for every network, and checked on mainnet BEFORE the sync, which can take
    // hours: a wallet whose DUST address is not the registered one has nothing to pay
    // fees with, and finding that out after the sync wastes the morning.
    const dustAddress = walletProvider.dustAddress(envConfiguration.networkId);
    logger.info(`This wallet's DUST address: ${dustAddress}`);
    if (config.mainnet) {
      const expected =
        (process.env.VEILCORE_EXPECTED_DUST_ADDRESS ?? '').trim() ||
        (await rli.question('Paste the DUST address your wallet app shows (mn_dust1…): ')).trim();
      if (expected !== dustAddress) {
        logger.error('That is not this wallet. The recovery phrase gives a different DUST address.');
        logger.error('Nothing was sent. Check you used the phrase of the wallet whose DUST is registered.');
        return;
      }
      logger.info('DUST address matches. Syncing with mainnet — this can take a long time.');
    }

    await walletProvider.start();

    let unshieldedState;
    if (config.mainnet) {
      // NIGHT is on Cardano and generates DUST cross-chain, so there is no NIGHT here to
      // wait for. What matters is DUST, read after a full sync.
      const synced = await syncWallet(logger, walletFacade);
      const dust = synced.dust.balance(new Date(Date.now())) || 0n;
      if (dust === 0n) {
        logger.error('This wallet has no DUST to pay fees with. Nothing was sent.');
        return;
      }
      logger.info(`DUST available for fees: ${dust}`);
    } else {
      unshieldedState = await waitForUnshieldedFunds(logger, walletFacade, envConfiguration, unshieldedToken());
      const nightBalance = unshieldedState.balances[unshieldedToken().raw];
      if (nightBalance === undefined) {
        logger.info('No funds received, exiting...');
        return;
      }
      logger.info(`Your NIGHT wallet balance is: ${nightBalance}`);
    }

    // Never on mainnet (config.generateDust is false there): re-registering NIGHT for
    // DUST generation is what created duplicate registrations before.
    if (config.generateDust && !config.mainnet && unshieldedState !== undefined) {
      const dustGeneration = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (dustGeneration) {
        logger.info(`Submitted dust generation registration transaction: ${dustGeneration}`);
        await syncWallet(logger, walletFacade);
      }
    }

    const zkConfigProvider = new NodeZkConfigProvider<VeilcoreCircuitKeys>(config.zkConfigPath);
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

    await mainLoop(providers, rli, logger, config.zkConfigPath, envConfiguration.indexer);
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
