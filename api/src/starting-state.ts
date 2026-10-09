// Where a VeilCore contract started: the check `join` makes before anything is written
// for an address (round D, D-1; fixed again after the round D verification, 4 Oct 2026).
// SPDX-License-Identifier: Apache-2.0
//
// Midnight does not run the constructor on chain: a deploy carries whatever starting
// state its deployer built, so a copy of this build with identical verifier keys can
// start from a forged ledger. The check compares the ledger data in the DEPLOY
// TRANSACTION with what this build's constructor produces (startsFromConstructor).
//
// Why not midnight-js's queryDeployContractState: it asks the indexer for the contract's
// LATEST action. For a call it follows the call's link back to the deploy; for a
// maintenance update (a verifier-key change, which VeilCore's maintenance authority can
// make on mainnet) the indexer has no such link, and midnight-js returns the update's
// own state, the CURRENT state (midnight-js-indexer-public-data-provider 4.1.1,
// DEPLOY_CONTRACT_STATE_TX_QUERY and queryDeployContractState). After any record
// activity followed by a key change, the genuine contract was refused as forged.
//
// Here the deploy transaction itself is read and its ContractDeploy action's initial
// state compared. The transaction is found from its id when one is given, or else from
// the latest action when that action leads to it (a deploy, or a call). When the latest
// action is a maintenance update and no id was given, the indexer offers no way back to
// the deploy (its contractAction query by block is exact-block only), so:
//   - a contract whose ledger is still exactly the constructor's (no record activity yet:
//     a fresh deploy, "Finish a deploy") is accepted: maintenance updates never change
//     ledger data, so it is in the genuine starting state now;
//   - on a network that pins VeilCore's address (mainnet), the pinned address, matched
//     before this runs, is what identifies VeilCore; it is accepted and the log says the
//     starting state was not re-checked;
//   - anywhere else it is refused with StartingStateUnreachableError, which says it is
//     NOT a finding of forgery and asks for the deploy transaction id.
// A contract is called forged only when its deploy transaction was actually read.

import { type Logger } from 'pino';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type FinalizedTxData, type PublicDataProvider, SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { startsFromConstructor } from '../../contract/src/veilcore';

/** How long to wait for the indexer to hand over a transaction it should already have. */
export const DEPLOY_LOOKUP_MS = 60_000;

const norm = (h: string): string => h.trim().toLowerCase().replace(/^0x/, '');

/** The starting state a transaction deploys `address` with, if it deploys it. */
export const deployedStateIn = (tx: FinalizedTxData['tx'], address: string): ContractState | undefined => {
  for (const intent of tx.intents?.values() ?? []) {
    for (const action of intent.actions) {
      if ('initialState' in action && norm(action.address) === norm(address)) {
        // The ledger's ContractState, as the runtime's (what startsFromConstructor reads),
        // the way midnight-js converts between the two.
        return ContractState.deserialize(action.initialState.serialize());
      }
    }
  }
  return undefined;
};

/**
 * The indexer's latest action for the contract is a maintenance update, no deploy
 * transaction id was given, and the address is not one this network pins: the starting
 * state cannot be checked now. Not a finding that the contract is forged.
 */
export class StartingStateUnreachableError extends Error {
  constructor(readonly address: string) {
    super(
      `Could not check how the contract at ${address} started. Its latest action is a maintenance update (a ` +
        'verifier-key change), and from there the indexer gives no way back to its deploy transaction. This is NOT ' +
        'a finding that the contract is forged. Ask its deployer for the deploy transaction id (their log line ' +
        '"deploy transaction submitted (...)", or "Deploy transaction id: ..."), and give it when asked: the deploy ' +
        'is then read and checked exactly. Nothing was written for this address.',
    );
    this.name = 'StartingStateUnreachableError';
  }
}

export type StartingStateCheck =
  /** The deploy transaction was read and its starting state is the constructor's. */
  | { readonly checked: 'deploy-transaction'; readonly txId: string }
  /** The deploy could not be reached, but the ledger now is exactly the constructor's. */
  | { readonly checked: 'current-state' }
  /** Not checked: the deploy could not be reached, and the address is this network's pinned one. */
  | { readonly checked: 'pinned-address' };

type Lookup = Pick<PublicDataProvider, 'queryContractState' | 'watchForDeployTxData' | 'watchForTxData'>;

/**
 * Resolve `p`, or 'timeout' after `ms`. midnight-js's watchFor* functions poll until the
 * indexer has what they ask for, with no way to cancel them; the timer is unref'ed so a
 * poll left running does not by itself keep the process alive.
 */
const within = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([
    p,
    new Promise<'timeout'>((r) => {
      const t = setTimeout(() => r('timeout'), ms);
      (t as { unref?: () => void }).unref?.();
    }),
  ]);

const forged = (address: string): Error =>
  new Error(
    `The contract at ${address} did not start from the VeilCore constructor's state: its deploy ` +
      "carried other ledger data. It has VeilCore's circuits but is not a genuine VeilCore deployment. Do not use it.",
  );

/**
 * Throw unless the contract at `address` started from this build's constructor, as far
 * as can be checked soundly (see the top of this file). `pinned`: the address was matched
 * against this network's pinned VeilCore address (deploy-guard.ts) before this was called.
 */
export const checkStartingState = async (args: {
  readonly publicDataProvider: Lookup;
  readonly address: string;
  readonly deployTxId?: string;
  readonly pinned: boolean;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
}): Promise<StartingStateCheck> => {
  const { publicDataProvider: pdp, address, logger } = args;
  const ms = args.timeoutMs ?? DEPLOY_LOOKUP_MS;
  const current = await pdp.queryContractState(address);
  if (current === null || current === undefined) {
    throw new Error(`The indexer has no contract at ${address}, so it cannot be checked. Do not use it.`);
  }

  // 1. A deploy transaction id was given: read that transaction.
  const given = args.deployTxId?.trim();
  if (given !== undefined && given !== '') {
    if (!/^(0x)?[0-9a-fA-F]+$/.test(given)) throw new Error('That is not a transaction id. Nothing was written.');
    const data = await within(pdp.watchForTxData(norm(given)), ms);
    if (data === 'timeout') {
      throw new Error(
        `The indexer did not find transaction ${given} within ${Math.round(ms / 1000)} s. Check the id. ` +
          'Nothing was written for this address.',
      );
    }
    const state = data.status === SucceedEntirely ? deployedStateIn(data.tx, address) : undefined;
    if (state === undefined) {
      throw new Error(
        `Transaction ${given} is not a successful deploy of the contract at ${address}. Check the id. ` +
          'Nothing was written for this address.',
      );
    }
    if (!startsFromConstructor(state)) throw forged(address);
    logger?.info(`Starting state checked: deploy transaction ${given} carries the VeilCore constructor's state.`);
    return { checked: 'deploy-transaction', txId: given };
  }

  // 2. The deploy transaction, as the latest action leads to it (a deploy, or a call).
  let data: FinalizedTxData | 'timeout' | undefined;
  try {
    data = await within(pdp.watchForDeployTxData(address), ms);
  } catch (e) {
    // midnight-js maps a maintenance update's transaction as if it were the deploy, and
    // can fail doing so (IndexerDataError). That says where the latest action is, not
    // whether the contract is genuine.
    if (!(e instanceof Error && e.name === 'IndexerDataError')) throw e;
    data = undefined;
  }
  const state = data === undefined || data === 'timeout' ? undefined : deployedStateIn(data.tx, address);
  if (state !== undefined && data !== undefined && data !== 'timeout') {
    if (!startsFromConstructor(state)) throw forged(address);
    logger?.info(`Starting state checked: deploy transaction ${data.txId} carries the VeilCore constructor's state.`);
    return { checked: 'deploy-transaction', txId: data.txId };
  }

  // 3. The latest action is a maintenance update (or the indexer did not answer in time):
  //    no way back to the deploy.
  if (startsFromConstructor(current)) {
    logger?.info(
      "Starting state checked: the contract's ledger is still exactly the VeilCore constructor's (no record " +
        'activity yet; key changes never alter it).',
    );
    return { checked: 'current-state' };
  }
  if (args.pinned) {
    logger?.info(
      'Starting state not re-checked: the latest action on this contract is a maintenance update, after which the ' +
        'indexer cannot show its deploy. On this network the address is pinned in this build and in the deployment ' +
        "record, and that pin is what identifies VeilCore's contract.",
    );
    return { checked: 'pinned-address' };
  }
  if (data === 'timeout') {
    throw new Error(
      `The indexer did not hand over the deploy transaction of ${address} within ${Math.round(ms / 1000)} s, so ` +
        'its starting state could not be checked. Try again. Nothing was written for this address.',
    );
  }
  throw new StartingStateUnreachableError(address);
};
