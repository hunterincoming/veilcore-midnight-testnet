// SPDX-License-Identifier: Apache-2.0
// Wallet and network scaffolding adapted from midnightntwrk/example-bboard (Apache-2.0).
//
// The VeilCore command-line client: deploy or join the contract, then act on records,
// licences and lineage. Secrets are shown with showSecret (screen only, never logged).

import { createHash } from 'node:crypto';
import { type Interface } from 'node:readline/promises';
import { oneAtATime } from './one-at-a-time.js';
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
  LandedButUnconfirmedError,
  assertDeploymentRecordCurrent,
  decide,
  resolveNetwork,
  REQUIRED_RECORD_REVISION,
  REVISION_VAR,
  type ClaimsProviders,
  type ClaimsPrivateStateId,
  type ClaimsCircuitKeys,
} from '../../api/src/index';
import { type ClaimsPrivateState } from '../../contract/src/claims.js';
import { CLAIMS_MENU, type ClaimsMenuContext, handleClaimsChoice } from './claims-menu';
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
import { MidnightWalletProvider, SavedProgressNotOpenedError } from './midnight-wallet-provider';
import { randomBytes } from '../../api/src/utils';
import { showSecret } from './secret-out';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { CLAIMS_CHECKS, runSmoke } from './smoke';
import { assertKeysMatchRecord } from './keys-check';
import path from 'node:path';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type VeilcorePrivateState } from '../../contract/src/witnesses.js';
import { type ChallengeBook } from '../../contract/src/verify.js';
import {
  createPrompt,
  groupKey,
  parseSecret32,
  parseSigningKey,
  PromptClosedError,
  sameKey,
  type Prompt,
} from './prompt';
import { settlePassword } from './password';
import { ChallengeFile } from './challenge-file';
import { redactThisSession } from './logger-utils';

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

/** Reads one answer without echoing it. Set in run(), on the CLI's one readline. */
let askHidden: (question: string) => Promise<string> = () => {
  throw new Error('askHidden used before the prompt was created');
};

/** Hidden, over several lines until done (a recovery phrase pasted as two lines). Set in run(). */
let askHiddenLines: Prompt['askHiddenLines'] = () => {
  throw new Error('askHiddenLines used before the prompt was created');
};

/**
 * What a wrong menu answer gets. The answer itself is NEVER repeated, on screen or in the
 * log: a recovery phrase pasted at the wrong moment would otherwise land in
 * logs/<network>/*.log in plain text.
 */
export const NOT_AN_OPTION = 'Not an option. Type a number from the list.';

/** Deploy or maintenance transactions under way; Ctrl+C then says to wait (run()). */
let txInProgress = 0;
/** Ctrl+C presses refused during the current transaction(s); the third forces a stop. */
let refusedPresses = 0;
const during = async <T>(f: () => Promise<T>): Promise<T> => {
  if (txInProgress === 0) refusedPresses = 0;
  txInProgress++;
  try {
    return await f();
  } finally {
    txInProgress--;
  }
};

/** A contract address: 64 hex characters. Asked again until it is one; never echoed back. */
const askContractAddress = async (rli: Interface, logger: Logger): Promise<string> => {
  for (;;) {
    const a = (await rli.question('Contract address (hex): ')).trim();
    if (/^[0-9a-fA-F]{64}$/.test(a)) return a.toLowerCase();
    logger.error('That is not a contract address (64 characters, each 0-9 or a-f, no 0x). Nothing was sent.');
  }
};

/** On mainnet: the build is the committed one (docs/fingerprints.md), or this throws. */
const checkBuild = (zkConfigPath: string, logger: Logger): void => {
  const n = assertKeysMatchRecord(zkConfigPath, path.resolve(zkConfigPath, '..', '..', '..', '..'));
  logger.info(`All ${n} build artefacts match the committed fingerprints (docs/fingerprints.md).`);
};

/** Ask for a 32-byte SECRET, hidden as it is typed; refuses anything but 64 hex characters. */
const askSecret32 = async (prompt: string): Promise<Uint8Array> => {
  const r = parseSecret32(await askHidden(prompt));
  if ('problem' in r) throw new InputError(r.problem);
  return r.value;
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
  // Salted, or anyone could guess short terms ("7% royalty") back from the chain. Whoever
  // needs to check the terms later needs the text and this salt.
  const salt = randomBytes(32);
  const c = new Uint8Array(createHash('sha256').update(salt).update(raw, 'utf8').digest());
  showSecret('OBLIGATION SALT — keep it with the terms; both are needed to show what was agreed:', toHex(salt));
  logger.info(`Obligation commitment (SHA-256 of salt + text): ${toHex(c)}`);
  logger.info('To act on this obligation later (accept, release), enter the commitment above, not the text.');
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
  4. Finish a deploy that stopped partway (adds the missing circuit keys)
  5. Exit
Which would you like to do? `;

/**
 * Keep the maintenance authority, or retire it. midnight-js always installs one, so
 * "no" means deploy and then retire it (api/src/maintenance.ts). Keeping it is the
 * default: it is the only way to repair a deployed contract, and it can be retired later.
 */
export const askMaintenanceAuthority = async (
  rli: Interface,
  logger: Logger,
  hidden: (question: string) => Promise<string> = (q) => askHidden(q),
): Promise<string | null> => {
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
  for (;;) {
    const typed = await hidden(
      'Signing key (64 hex characters; nothing shows as you type or paste; blank to generate one): ',
    );
    if (typed === '') {
      const key = sampleSigningKey();
      redactThisSession(key);
      const show = (): void =>
        showSecret(
          'MAINTENANCE AUTHORITY SIGNING KEY — write it down now and keep it offline (the spaces are only to make copying easier):',
          groupKey(key),
        );
      show();
      // Nothing is sent until the operator says the key is written down...
      for (;;) {
        const ok = (await rli.question('Type WRITTEN once the key is on paper and checked (nothing is sent before): '))
          .trim()
          .toUpperCase();
        if (ok === 'WRITTEN') break;
      }
      // ...and has typed it back from the paper: a copying mistake found now costs a minute;
      // found later, it costs the only key that can repair the contract.
      for (;;) {
        const back = await hidden(
          'Now type the key back FROM YOUR PAPER (spaces or dashes are fine; nothing shows; SHOW to see it again): ',
        );
        if (sameKey(back, key)) {
          logger.info('Your paper copy matches the key.');
          break;
        }
        if (back.trim().toUpperCase() === 'SHOW') {
          show();
          continue;
        }
        logger.error('That does not match the key shown. Check your paper copy, correct it, and type it again.');
      }
      return key;
    }
    const r = parseSigningKey(typed);
    if ('value' in r) {
      logger.info('Signing key accepted (not shown: you already hold it).');
      return r.value;
    }
    logger.error(`${r.problem} Try again, or leave it blank to generate one.`);
  }
};

export const deployOrJoin = async (
  providers: VeilcoreProviders,
  rli: Interface,
  logger: Logger,
  zkConfigPath: string,
  indexerUri: string,
  hidden: (question: string) => Promise<string> = (q) => askHidden(q),
  claimsProviders?: ClaimsProviders,
): Promise<VeilcoreAPI | null> => {
  while (true) {
    const choice = (await rli.question(DEPLOY_OR_JOIN_QUESTION)).trim();
    switch (choice) {
      case '1': {
        if (getNetworkId() === 'mainnet') checkBuild(zkConfigPath, logger);
        // Checked again inside deploy; here so a missing record revision is found before a
        // maintenance key is made and written down for nothing.
        assertDeploymentRecordCurrent('veilcore', logger);
        const authority = await askMaintenanceAuthority(rli, logger, hidden);
        const api = await during(() => VeilcoreAPI.deploy(providers, authority, logger));
        logger.info('Deployed. Every circuit key is on chain.');
        logger.info(`Contract address: ${api.deployedContractAddress}`);
        return api;
      }
      case '2': {
        // On mainnet, check this build against the committed fingerprints before joining,
        // as deploy does: join compares the chain's keys with THIS build's keys.
        if (getNetworkId() === 'mainnet') checkBuild(zkConfigPath, logger);
        const api = await VeilcoreAPI.join(providers, await askContractAddress(rli, logger), logger);
        logger.info(`Joined contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '3': {
        if (getNetworkId() === 'mainnet') {
          logger.error('The smoke test does not run on mainnet.');
          continue;
        }
        // The claims phase deploys a second, test-only contract after the main phase passes.
        const withClaims =
          claimsProviders !== undefined &&
          (await rli.question(`Also run the claims contract phase (${CLAIMS_CHECKS} more checks)? (y/N): `))
            .trim()
            .toLowerCase()
            .startsWith('y');
        const passed = await runSmoke(providers, logger, indexerUri, withClaims ? claimsProviders : undefined);
        logger.info(passed ? 'Smoke test passed.' : 'Smoke test FAILED — see above.');
        return null;
      }
      case '4': {
        // A deploy is one transaction plus one per remaining circuit key. If it stopped
        // partway, the authority's key is normally still in the local store; this adds the
        // rest. If it is not (a deploy that stopped before the key was saved), it is asked for.
        if (getNetworkId() === 'mainnet') checkBuild(zkConfigPath, logger);
        const address = await askContractAddress(rli, logger);
        let typedIn = false;
        if (!(await providers.privateStateProvider.getSigningKey(address))) {
          logger.info('This computer does not hold the maintenance key for that contract. It is on your paper copy.');
          for (;;) {
            const typed = await hidden(
              'Maintenance authority signing key, from your paper (64 hex; spaces fine; nothing shows; blank to stop): ',
            );
            if (typed === '') {
              logger.info('Stopped: finishing the deploy needs the signing key. Nothing was sent.');
              return null;
            }
            const r = parseSigningKey(typed.replace(/[\s-]/g, ''));
            if ('value' in r) {
              await providers.privateStateProvider.setSigningKey(address, r.value);
              typedIn = true;
              break;
            }
            logger.error(`${r.problem} Try again.`);
          }
        }
        let api: VeilcoreAPI;
        try {
          await during(() => VeilcoreAPI.addMissingCircuitKeys(providers, address, logger));
          api = await VeilcoreAPI.join(providers, address, logger);
        } catch (e) {
          // A key typed in for this does not stay on this machine; the paper copy is unchanged.
          if (typedIn) await providers.privateStateProvider.removeSigningKey(address);
          throw e;
        }
        const retire = (
          await rli.question('Retire the maintenance authority now? Type RETIRE, or Enter to keep it: ')
        ).trim();
        if (retire === 'RETIRE') await during(() => api.retireMaintenanceAuthority());
        await providers.privateStateProvider.removeSigningKey(address);
        logger.info('Deploy finished: every circuit key is on chain.');
        logger.info(`Contract address: ${address}`);
        return api;
      }
      case '5':
        return null;
      default:
        logger.error(NOT_AN_OPTION);
    }
  }
};

/**
 * Mark an accepted challenge used, saved before the verdict is shown. Refused when another
 * run of this program used it first.
 */
const useUp = async (
  book: ChallengeBook,
  file: ChallengeFile,
  ch: Uint8Array,
  kind: 'licence' | 'ownership',
  logger: Logger,
): Promise<{ ok: boolean; reason: string }> => {
  try {
    return await file.consume(book, ch, kind);
  } catch (e) {
    logger.error(
      `Could not save that this challenge is now used (${e instanceof Error ? e.message : String(e)}). ` +
        'Do not accept it again, even if this program would after a restart.',
    );
    return book.consume(ch, kind);
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
 11. Propose a transfer (as holder)       26. Make a challenge (for a licensee or a holder)
 12. Approve a transfer (as issuer)       27. Check a licence presentation
 13. Withdraw a transfer proposal         28. Check an ownership proof
 14. Revoke a licence
 15. Seal waiting revocations             Other
                                          29. Anchor a batch root
                                          30. Show the contract state
                                          31. Show your record and identity
                                          32. Show your record secret
                                          33. Retire the maintenance authority (PERMANENT)
${CLAIMS_MENU}

  0. Exit
Which would you like to do? `;

const mainLoop = async (
  providers: VeilcoreProviders,
  rli: Interface,
  logger: Logger,
  zkConfigPath: string,
  indexerUri: string,
  claimsProviders?: ClaimsProviders,
): Promise<void> => {
  const api = await deployOrJoin(providers, rli, logger, zkConfigPath, indexerUri, undefined, claimsProviders);
  if (api === null) return;
  const claims: ClaimsMenuContext = {
    rli,
    logger,
    providers: claimsProviders,
    indexerUri,
    hidden: (q) => askHidden(q),
    during,
    api: undefined,
  };

  // Rules 5 and 8: every challenge this verifier issues is recorded, and used once.
  const challengeFile = new ChallengeFile(getNetworkId(), process.env.VEILCORE_PRIVATE_STATE_PASSWORD ?? '');
  const loaded = await challengeFile.load();
  const book: ChallengeBook = loaded.book;
  if (loaded.warning !== undefined) logger.warn(loaded.warning);

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
            // Shown BEFORE the anchor is sent: if the call failed after landing, a secret
            // shown afterwards would be lost, and the commitment can never be replaced.
            const recovery = randomBytes(32);
            showSecret('RECOVERY SECRET — SAVE THIS NOW, IT IS NOT STORED AND NOT SHOWN AGAIN:', toHex(recovery));
            logger.info('It moves this record even if the record secret is lost OR STOLEN. Keep it offline.');
            await rli.question('Press Enter once it is stored, to anchor. ');
            const me = C.commit(await mySecret(providers));
            try {
              tx(await api.anchor(C.recoveryCommit(recovery)));
            } catch (e) {
              // It may have landed with only the confirmation failing: then the secret just
              // shown is the real one, and a retry would show a different, useless one.
              const l = await api.currentLedger();
              if (l.recoveryOf.member(me) && toHex(l.recoveryOf.lookup(me)) === toHex(C.recoveryCommit(recovery))) {
                logger.warn('The anchor DID land; only confirming it failed. Keep the recovery secret shown above.');
              } else throw e;
            }
            logger.info(`Anchored record: ${toHex(me)}`);
            break;
          }
          case '2': {
            const challenge = await ask32(rli, "The verifier's challenge (hex): ");
            const p = await api.proveOwnership(challenge);
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
            try {
              const r = await api.rotateRecordSecret(C.commit(next), next);
              logger.info(`Rotated from ${toHex(r.previousCommitment)} to ${toHex(C.commit(next))}.`);
              tx(r);
            } catch (e) {
              if (!(e instanceof LandedButUnconfirmedError)) {
                logger.error(
                  'The rotation was not seen on chain, so this client keeps your OLD secret, which still works. ' +
                    'If option 31 later says "Current: no", it landed late: keep the new secret shown above and get help before going on.',
                );
                throw e;
              }
              // The API has already switched this client to the new secret.
              logger.warn(`${e.message} The new secret shown above is the real one; the old one can do nothing now.`);
            }
            logger.info('Licences, parentage and obligations stay with your identity.');
            break;
          }
          case '5': {
            const origin = await ask32(rli, 'ORIGINAL anchored record (hex): ');
            const recovery = await askSecret32('Recovery secret (64 hex; nothing shows as you type or paste): ');
            const next = randomBytes(32);
            const nextRecovery = randomBytes(32);
            showSecret('YOUR NEW RECORD SECRET — store it now, before the recovery is sent:', toHex(next));
            showSecret(
              'YOUR NEW RECOVERY SECRET — the old one stops working with this recovery. Store it OFFLINE now:',
              toHex(nextRecovery),
            );
            await rli.question('Press Enter once BOTH are stored. ');
            try {
              tx(await api.recoverRecordSecret(origin, C.commit(next), C.recoveryCommit(nextRecovery), recovery, next));
            } catch (e) {
              // A recovery that landed uses up the recovery secret, so a retry would fail and
              // show new secrets that control nothing. The API checks the chain before failing.
              if (!(e instanceof LandedButUnconfirmedError)) {
                logger.error(
                  'The recovery was not seen on chain. Your old recovery secret still works; the secrets above do not. ' +
                    'If option 31 later says "Current: no", it landed late: keep both new secrets and get help before going on.',
                );
                throw e;
              }
              // The API has already switched this client to the new record secret.
              logger.warn(`${e.message} The two secrets shown above are the real ones.`);
            }
            logger.info('Recovered. Whoever held an earlier secret, including a thief, can no longer act from now on.');
            logger.info('The recovery secret you typed in is used up; only the new one works.');
            logger.info(
              'What they did before this (licences revoked, obligations accepted) stands. See design.md, Known limits.',
            );
            break;
          }
          case '6': {
            const origin = await ask32(rli, 'ORIGINAL anchored record (hex): ');
            const current = await askSecret32('CURRENT recovery secret (64 hex; nothing shows as you type or paste): ');
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
            const secret = await askSecret32('YOUR licence secret (64 hex; nothing shows as you type or paste): ');
            const issuer = await ask32(rli, "Issuer's record (hex): ");
            tx(await api.countersignLicense(secret, issuer));
            logger.info(`Licence active: ${toHex(C.licenseCommit(secret, issuer))}`);
            break;
          }
          case '10': {
            const secret = await askSecret32('YOUR licence secret (64 hex; nothing shows as you type or paste): ');
            const issuer = await ask32(rli, "Issuer's record (hex): ");
            const ch = await ask32(rli, "Verifier's challenge (hex, from the verifier's option 26): ");
            const shown = await api.proveLicense(secret, issuer, ch);
            tx(shown);
            logger.info(`Give the verifier this transaction id: ${shown.txId}`);
            break;
          }
          case '11': {
            const secret = await askSecret32('YOUR licence secret (64 hex; nothing shows as you type or paste): ');
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
            const secret = await askSecret32('YOUR licence secret (64 hex; nothing shows as you type or paste): ');
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
            // Two kinds, never shared: an ownership proof publishes its challenge, and a
            // licence presentation is private only while its challenge stays unpublished.
            const kind = (await rli.question('For a (L)icence presentation or an (O)wnership proof? '))
              .trim()
              .toLowerCase();
            const ch = book.issue(kind.startsWith('o') ? 'ownership' : 'licence').challenge;
            await challengeFile.save(book);
            if (kind.startsWith('o')) {
              showSecret('OWNERSHIP CHALLENGE — send it to the holder; it will be public once they answer:', toHex(ch));
              logger.info('Recorded here: option 28 accepts it once, for an ownership proof, within 7 days.');
            } else {
              showSecret(
                'LICENCE CHALLENGE — send it to the licensee privately, use it once, never publish it:',
                toHex(ch),
              );
              logger.info('Recorded here: option 27 accepts it once, for a licence presentation, within 7 days.');
            }
            break;
          }
          case '27': {
            const txId = (await rli.question("The presentation's transaction id (from the licensee): ")).trim();
            const issuer = await ask32(rli, 'Issuer you asked about (any record of that identity, hex): ');
            const ch = await ask32(rli, 'The challenge you sent (hex): ');
            await challengeFile.refresh(book);
            const usable = book.check(ch, 'licence');
            if (!usable.ok) {
              logger.info(`NOT ACCEPTED: ${usable.reason}.`);
              break;
            }
            const verdict = await api.checkPresentation(indexerUri, txId, issuer, ch);
            const used = verdict.accepted ? await useUp(book, challengeFile, ch, 'licence', logger) : undefined;
            if (used !== undefined && !used.ok) logger.info(`NOT ACCEPTED: ${used.reason}.`);
            else logger.info(`${verdict.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}: ${verdict.reason}.`);
            break;
          }
          case '28': {
            const txId = (await rli.question("The ownership proof's transaction id (from the holder): ")).trim();
            const record = await ask32(rli, 'Record you asked about (any record of that identity, hex): ');
            const ch = await ask32(rli, 'The challenge you sent (hex): ');
            await challengeFile.refresh(book);
            const usable = book.check(ch, 'ownership');
            if (!usable.ok) {
              logger.info(`NOT ACCEPTED: ${usable.reason}.`);
              break;
            }
            const verdict = await api.checkOwnership(indexerUri, txId, record, ch);
            const used = verdict.accepted ? await useUp(book, challengeFile, ch, 'ownership', logger) : undefined;
            if (used !== undefined && !used.ok) logger.info(`NOT ACCEPTED: ${used.reason}.`);
            else logger.info(`${verdict.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}: ${verdict.reason}.`);
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
                : rootsText.split(',').map((t, i) => {
                    const v = parse32(t);
                    // Which one, not what was typed: answers are never echoed into the log.
                    if (v === null)
                      throw new InputError(`Item ${i + 1} of that list is not a record (64 hex characters).`);
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
          case '29': {
            const root = await ask32(rli, 'Batch root (hex): ');
            tx(await api.anchorBatch(root));
            logger.info('Anchored. This proves the batch existed at this time, not who held its records.');
            break;
          }
          case '30': {
            const l = await api.currentLedger();
            logger.info(
              `Protocol version ${l.protocolVersion}. Anchors ${l.anchorSeq}, ownership proofs ${l.proofSeq}, presentations ${l.presentationSeq}.`,
            );
            logger.info(`Parentage edges ${l.descentSeq}, obligation changes ${l.obligationSeq}, seals ${l.sealSeq}.`);
            logger.info(`Revocations waiting for a seal: ${l.unsealedChanges ? 'yes' : 'no'}.`);
            break;
          }
          case '31':
            if (derived === undefined) logger.info('No state yet.');
            else {
              logger.info(`Your record:   ${derived.myCommitment}`);
              logger.info(`Your identity: ${derived.myIdentity}`);
              logger.info(
                `Anchored: ${derived.iAmAnchored ? 'yes' : 'no'}. Current: ${derived.iAmLive ? 'yes' : 'no (rotated or recovered away)'}.`,
              );
            }
            break;
          case '32':
            showSecret('YOUR RECORD SECRET:', toHex(await mySecret(providers)));
            break;
          case '33': {
            const sure = (
              await rli.question(
                'Nobody, including you, will ever be able to change this contract. Type RETIRE to confirm: ',
              )
            ).trim();
            if (sure === 'RETIRE') {
              // The key is removed from this machine after deploy, so it has to be given back
              // for the one transaction that retires it.
              const typed = await askHidden(
                'Maintenance authority signing key (from your offline copy; nothing shows as you type or paste): ',
              );
              const r = parseSigningKey(typed.replace(/[\s-]/g, ''));
              if (typed === '') logger.info('Not retired: the signing key is needed.');
              else if ('problem' in r) logger.error(`Not retired. ${r.problem}`);
              else {
                try {
                  await during(() => api.retireMaintenanceAuthority(r.value));
                  logger.info('Retired. The key you typed was used once and removed from this machine again.');
                } catch (e) {
                  logger.error(
                    'Retiring did not complete (it may or may not have landed). The key you typed has been removed ' +
                      'from this machine again; your offline copy is unchanged.',
                  );
                  throw e;
                }
              }
            } else logger.info('Not retired.');
            break;
          }
          case '0':
            return;
          default:
            if (!(await handleClaimsChoice(choice, claims))) logger.error(NOT_AN_OPTION);
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
    const choice = (await rli.question(WALLET_LOOP_QUESTION)).trim();
    switch (choice) {
      case '1': {
        if (config.mainnet) {
          // A fresh wallet has no DUST on mainnet and cannot get any from a faucet.
          logger.error('On mainnet, use the wallet that holds your DUST (option 3).');
          break;
        }
        // Shown once, here, before anything else happens: it is the only way back into this
        // wallet and whatever it receives. Not logged, not stored by this program.
        const seed = toHex(randomBytes(32));
        redactThisSession(seed);
        showSecret(
          'YOUR NEW WALLET SEED — WRITE THIS DOWN NOW. It is shown once and never again; without it this wallet and its funds are lost:',
          seed,
        );
        await rli.question('Press Enter once it is written down. ');
        return { seed };
      }
      case '2': {
        const seed = await askHidden('Enter your wallet seed (hex; nothing shows as you type or paste): ');
        if (/^0x/i.test(seed)) {
          logger.error('Leave out the 0x at the start: type only the hex characters.');
          break;
        }
        if (!/^([0-9a-fA-F]{2}){16,64}$/.test(seed)) {
          logger.error(`That is not a hex seed (${seed.length} characters; only 0-9 and a-f, an even number).`);
          break;
        }
        redactThisSession(seed);
        return { seed };
      }
      case '3': {
        logger.info(
          'Type or paste the 24 words, separated by spaces. Nothing shows; they are not logged or stored. ' +
            'If they are on several lines, paste them all: this keeps reading until it has 24 words.',
        );
        const words = (lines: readonly string[]): string[] =>
          lines
            .join(' ')
            .split(/\s+/)
            .filter((w) => w !== '');
        const lines = await askHiddenLines(
          'Recovery phrase: ',
          (ls) => words(ls).length >= 24,
          (ls) =>
            `${words(ls).length} of 24 words so far. Paste or type the rest, then press Enter (an empty line stops).`,
        );
        // Each line as typed, and the phrase, are redacted from the log for the rest of the run.
        for (const l of lines) redactThisSession(l);
        const list = words(lines).map((w) => w.toLowerCase());
        if (list.length !== 24) {
          logger.error(`That is ${list.length} words, not 24. Nothing was used. Choose 3 to try again.`);
          break;
        }
        const mnemonic = list.join(' ');
        redactThisSession(mnemonic);
        return { mnemonic };
      }
      case '4':
        logger.info('Exiting...');
        return undefined;
      default:
        logger.error(NOT_AN_OPTION);
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
  // One readline for the whole run; secrets are read on it with the echo muted.
  const prompt = createPrompt();
  const rli = prompt.rli;
  askHidden = prompt.askHidden;
  askHiddenLines = prompt.askHiddenLines;
  const providersToBeStopped: MidnightWalletProvider[] = [];
  let envStarted = false;

  // Clean-up, run once: by the normal end of the run, or by Ctrl+C.
  let stopping: Promise<void> | undefined;
  const stopAll = (): Promise<void> =>
    (stopping ??= (async () => {
      try {
        rli.close();
      } catch (e) {
        logError(logger, e);
      }
      try {
        for (const wallet of providersToBeStopped) {
          logger.info('Stopping wallet...');
          await wallet.stop();
        }
        if (testEnv && envStarted) {
          logger.info('Stopping test environment...');
          await testEnv.shutdown();
        }
      } catch (e) {
        logError(logger, e);
      }
    })());

  // Ctrl+C. During a deploy or maintenance transaction it is refused: stopping between
  // the transactions of a deploy leaves it half done. Otherwise the run stops cleanly.
  let interrupted = false;
  // A transaction that never confirms (a dropped connection the libraries do not report)
  // would otherwise hold the run for ever with Ctrl+C refused. The third press stops it:
  // every key and the contract address were saved before anything was sent.
  const onInterrupt = (): void => {
    if (txInProgress > 0) {
      refusedPresses++;
      if (refusedPresses < 3) {
        logger.warn(
          'A deploy or maintenance transaction is in progress. Wait for the menu to come back. ' +
            'If nothing has changed for 15 minutes or more, press Ctrl+C three times to stop anyway.',
        );
        return;
      }
      logger.warn(
        'Stopping during a transaction. Nothing saved on this computer is lost. If this was a deploy: do NOT ' +
          'choose 1 (Deploy) again; run again with the same password and wallet, choose 4 (Finish a deploy), and ' +
          'give it the contract address from your paper or the newest log. Anything else: run again and check ' +
          'whether it landed before repeating it.',
      );
      interrupted = true;
      // The wallet may be stuck on the same dead connection: give it 10 seconds, then go.
      void Promise.race([stopAll(), new Promise((r) => setTimeout(r, 10_000).unref())]).finally(() =>
        process.exit(130),
      );
      return;
    }
    if (interrupted) return;
    interrupted = true;
    logger.info('Stopping…');
    // At a prompt, closing it ends the run through the normal clean-up below.
    if (prompt.asking()) rli.close();
    // Anywhere else (the wallet sync, say), stop the wallet here and leave.
    else void stopAll().finally(() => process.exit(130));
  };
  rli.on('SIGINT', onInterrupt);
  process.on('SIGINT', onInterrupt);

  try {
    // Asked for up front, before the chain starts and the wallet syncs, so a password
    // midnight-js would refuse is found in the first second rather than after the sync.
    if (!(await settlePassword(askHidden, logger))) return;

    if (config.mainnet) {
      // Also checked before the long sync: a build that does not match the record, or a
      // deploy the record gate will refuse, is found now rather than an hour from now.
      try {
        checkBuild(config.zkConfigPath, logger);
      } catch (e) {
        logError(logger, e);
        logger.error('Nothing was started.');
        return;
      }
      const gate = decide(resolveNetwork(), process.env[REVISION_VAR]);
      if (gate.allow) logger.info(`Deployment record: ${gate.because}. Deploying is allowed.`);
      else
        logger.warn(
          `Deployment record: ${gate.where} ${gate.why} Deploying (option 1) will be refused; joining still works. ` +
            `To deploy, stop now (Ctrl+C), set ${REVISION_VAR}=${REQUIRED_RECORD_REVISION}, and start again.`,
        );
    }

    envStarted = true; // shut down even if starting fails partway
    const envConfiguration = await testEnv.start();
    logger.info(`Environment started with configuration: ${JSON.stringify(envConfiguration)}`);
    const source = await buildWallet(config, rli, logger);
    if (source === undefined) {
      return;
    }
    const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, source, {
      // On mainnet a progress file this password cannot open is never silently replaced.
      confirmFreshSync: config.mainnet
        ? async () =>
            (
              await rli.question(
                'That password does not open your saved progress. If you are sure, type CONTINUE to sync from the start: ',
              )
            ).trim() === 'CONTINUE'
        : undefined,
    });
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

    // This store holds the contract's maintenance authority key, which can insert or
    // remove verifier keys and so decide what the contract accepts. The literal that used
    // to sit here came from the example this was forked from and was published in a public
    // repository, which is no password at all on a network where the contract matters.
    const privateStoragePasswordProvider = (): string => {
      const password = process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
      if (!password) {
        throw new Error(
          'VEILCORE_PRIVATE_STATE_PASSWORD is not set. It encrypts private state and the ' +
            'maintenance authority signing key. Sixteen characters or more, with at least ' +
            'three of uppercase, lowercase, digits and symbols.',
        );
      }
      return password;
    };
    const zkConfigProvider = new NodeZkConfigProvider<VeilcoreCircuitKeys>(config.zkConfigPath);
    const publicDataProvider = indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS);
    const providers: VeilcoreProviders = {
      privateStateProvider: oneAtATime(
        levelPrivateStateProvider<VeilcorePrivateStateId, VeilcorePrivateState>({
          privateStateStoreName: config.privateStateStoreName,
          signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
          privateStoragePasswordProvider,
          accountId: seed,
        }),
      ),
      publicDataProvider,
      zkConfigProvider: zkConfigProvider,
      proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
      walletProvider: walletProvider,
      midnightProvider: walletProvider,
    };
    // The claims contract: its own compiled keys, and its own private-state store, since a
    // provider holds one contract address at a time and the main client sets it too.
    const claimsZkConfigProvider = new NodeZkConfigProvider<ClaimsCircuitKeys>(
      path.resolve(config.zkConfigPath, '..', 'veilcore-claims'),
    );
    const claimsProviders: ClaimsProviders = {
      privateStateProvider: oneAtATime(
        levelPrivateStateProvider<ClaimsPrivateStateId, ClaimsPrivateState>({
          privateStateStoreName: `${config.privateStateStoreName}-claims`,
          signingKeyStoreName: `${config.privateStateStoreName}-claims-signing-keys`,
          privateStoragePasswordProvider,
          accountId: seed,
        }),
      ),
      publicDataProvider,
      zkConfigProvider: claimsZkConfigProvider,
      proofProvider: httpClientProofProvider(envConfiguration.proofServer, claimsZkConfigProvider),
      walletProvider: walletProvider,
      midnightProvider: walletProvider,
    };

    await mainLoop(providers, rli, logger, config.zkConfigPath, envConfiguration.indexer, claimsProviders);
  } catch (e) {
    if (e instanceof SavedProgressNotOpenedError) logger.info(e.message);
    // Stopped at a prompt (Ctrl+C, or the input closed): nothing went wrong.
    else if (!interrupted && !(e instanceof PromptClosedError)) logError(logger, e);
    logger.info('Exiting...');
  } finally {
    process.off('SIGINT', onInterrupt);
    await stopAll();
    rli.removeAllListeners();
  }
};

function logError(logger: Logger, e: unknown) {
  if (e instanceof Error) {
    logger.error(`Found error '${e.message}'${e.cause instanceof Error ? ` (cause: ${e.cause.message})` : ''}`);
    logger.debug(`${e.stack}`);
  } else {
    logger.error(`Found error (unknown type)`);
  }
}
