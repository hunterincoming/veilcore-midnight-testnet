// Deploying a contract in fragments, and adding the circuit keys that did not fit, for
// any VeilCore contract (the main contract, VeilcoreAPI; the claims contract, ClaimsAPI).
// SPDX-License-Identifier: Apache-2.0
//
// The network refuses a deploy carrying a verifier key for every circuit ("exceeded
// block limit"). Deploy with the first `size` keys, halving on that refusal, then add the
// rest one maintenance transaction each. The authority's key, which those transactions
// need, stays in the local store until every key is on chain.

import { inspect } from 'node:util';
import { type Logger } from 'pino';
import { type ContractAddress, type SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type UnprovenTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { DeployTxFailedError } from '@midnight-ntwrk/midnight-js-contracts';
import { type PublicDataProvider, SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';

/** Circuit keys carried by the deploy transaction itself; the rest follow it. */
export const FIRST_FRAGMENT = 8;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const operationName = (o: string | Uint8Array): string =>
  typeof o === 'string' ? o : Buffer.from(o).toString('utf8');

/**
 * The refusal of a transaction too big for a block, however it is wrapped: the wallet's
 * fee computation ("exceeded block limit in transaction fee computation") or the node's
 * LedgerApiError::BlockLimitExceededError (1010, custom error 154). A bare 1010 is any
 * refusal at all, so it is not enough: a stale-clock DUST refusal (171) must not be
 * taken for size and retried smaller at new addresses.
 */
export const isBlockLimit = (e: unknown): boolean =>
  /block limit|BlockLimitExceeded|ExhaustsResources|Custom error:\s*154\b/i.test(inspect(e, { depth: 6 }));

/**
 * The node's "custom error 171", OutOfDustValidityWindow: the fee payment was built with a
 * time the chain is already past, which happens when the indexer the wallet reads the
 * chain's time from is behind the chain. Nothing landed; retrying later is the remedy.
 */
export const isStaleDustTime = (e: unknown): boolean => /Custom error:\s*171\b/i.test(inspect(e, { depth: 6 }));

/**
 * A refusal by the node's transaction pool ("1010: Invalid Transaction"): the transaction
 * was never admitted, so it cannot land in a block. Returns the node's custom error code
 * when it gives one, or 'none'.
 */
export const nodeRefusal = (e: unknown): string | undefined => {
  const text = inspect(e, { depth: 6 });
  if (!/\b1010:\s*Invalid Transaction/i.test(text)) return undefined;
  return /Custom error:\s*(\d+)/i.exec(text)?.[1] ?? 'none';
};

/** What the deploy needs from midnight-js: an unsubmitted deploy transaction. */
export type UnsubmittedDeploy = {
  readonly public: { readonly contractAddress: ContractAddress };
  readonly private: {
    readonly unprovenTx: UnprovenTransaction;
    readonly signingKey: SigningKey;
    readonly initialPrivateState: unknown;
  };
};

export type FragmentProviders = {
  readonly publicDataProvider: PublicDataProvider;
  readonly privateStateProvider: { removeSigningKey(address: ContractAddress): Promise<void> };
};

/**
 * Deploy, carrying the keys of the first `firstFragment` circuits and halving on a
 * block-limit refusal. Returns the address once the deploy is confirmed.
 *
 * What deployContract does, in an order that survives a confirmation that fails or
 * hangs. midnight-js stores the authority's key and the private state only AFTER the
 * deploy is confirmed, so a deploy that landed unconfirmed left the address unknown and
 * the key nowhere. Here the address is known before anything is sent: `store` saves the
 * key and private state, and the address is logged, first.
 */
export const deployInFragments = async (args: {
  readonly providers: FragmentProviders;
  readonly circuits: readonly string[];
  readonly firstFragment: number;
  /** Build the deploy transaction carrying the keys of `keep`. */
  readonly create: (keep: readonly string[]) => Promise<UnsubmittedDeploy>;
  /** Prove, balance and submit (midnight-js submitTxAsync); returns the transaction id. */
  readonly submit: (unprovenTx: UnprovenTransaction) => Promise<string>;
  /** Store the private state and the authority's key for `candidate`, before sending. */
  readonly store: (candidate: ContractAddress, unsubmitted: UnsubmittedDeploy) => Promise<void>;
  /** The menu choice that finishes a deploy that stopped partway. */
  readonly finish: string;
  /**
   * The authority's key is on the operator's paper, not kept by the provider (the CLI's
   * main contract: its signing keys live in memory only). Changes only what is said.
   */
  readonly keyOnPaper?: boolean;
  readonly logger?: Logger;
}): Promise<ContractAddress> => {
  const { providers, circuits, logger } = args;
  let size = Math.min(Math.max(1, args.firstFragment), circuits.length);
  for (;;) {
    const keep = circuits.slice(0, size);
    const unsubmitted = await args.create(keep);
    const candidate = unsubmitted.public.contractAddress;
    await args.store(candidate, unsubmitted);
    logger?.info(`Contract address: ${candidate}`);
    try {
      const txId = await args.submit(unsubmitted.private.unprovenTx);
      logger?.info(`deploy transaction submitted (${txId}); waiting for it to be confirmed`);
      const finalized = await providers.publicDataProvider.watchForTxData(txId);
      if (finalized.status !== SucceedEntirely) throw new DeployTxFailedError(finalized);
      logger?.info({
        contractDeployed: { ...finalized, contractAddress: candidate },
        circuitKeysInDeploy: keep.length,
      });
      return candidate;
    } catch (e) {
      if (size > 1 && isBlockLimit(e)) {
        // Refused by the network: that contract never existed, so its key goes.
        await providers.privateStateProvider.removeSigningKey(candidate);
        size = Math.ceil(size / 2);
        logger?.info(
          `the deploy was over the block limit, so contract ${candidate} was never created; ` +
            `trying again with ${size} circuit keys in it (a new address)`,
        );
        continue;
      }
      if (isBlockLimit(e)) {
        // Too big even with one key: refused or never built, so that contract never existed.
        await providers.privateStateProvider.removeSigningKey(candidate);
        logger?.error(
          `The deploy is over the block limit even with one circuit key. Nothing was created at ${candidate} ` +
            'and nothing was spent. Send this message to Claude.',
        );
        throw e;
      }
      if (isStaleDustTime(e)) {
        // Refused before entering a block: that contract never existed, so its key goes.
        await providers.privateStateProvider.removeSigningKey(candidate);
        logger?.error(
          `The network refused the deploy (custom error 171, OutOfDustValidityWindow): the indexer ` +
            `this wallet reads the chain's time from is behind the chain. Nothing was created at ${candidate} ` +
            'and nothing was spent. Wait, then run again; if it repeats, the indexer is lagging.',
        );
        throw e;
      }
      const refused = nodeRefusal(e);
      if (refused !== undefined) {
        // Refused before entering a block: that contract never existed, so its key goes.
        await providers.privateStateProvider.removeSigningKey(candidate);
        logger?.error(
          `The network refused the deploy (1010, custom error ${refused}). Nothing was created at ${candidate} ` +
            'and nothing was spent. Do not try again until the cause is known: send this message to Claude.',
        );
        throw e;
      }
      logger?.error(
        `The deploy did not complete. It may still have landed at contract address ${candidate}. ` +
          (args.keyOnPaper === true
            ? `The maintenance key is NOT kept on this computer: finish it with "${args.finish}", that address, ` +
              'and the key from your paper.'
            : `The maintenance key is kept in the local store for it: finish it with "${args.finish}" and that address.`),
      );
      throw e;
    }
  }
};

/**
 * Add the verifier key of every circuit in `circuits` the contract does not have on
 * chain yet, one maintenance transaction each. Safe to run again after an interruption:
 * it reads what is on chain first. Needs the maintenance authority's key in the local
 * store.
 */
export const addMissingKeys = async (args: {
  readonly providers: { readonly publicDataProvider: PublicDataProvider };
  readonly address: ContractAddress;
  readonly circuits: readonly string[];
  /** Fetch the circuit's verifier key and send it (createCircuitMaintenanceTxInterfaces). */
  readonly insert: (circuit: string) => Promise<unknown>;
  readonly finish: string;
  readonly logger?: Logger;
}): Promise<void> => {
  const { providers, address, circuits, logger } = args;
  const onChain = async (): Promise<Set<string>> => {
    for (let i = 0; i < 30; i++) {
      const state = await providers.publicDataProvider.queryContractState(address);
      if (state !== null && state !== undefined) return new Set(state.operations().map(operationName));
      await sleep(2_000);
    }
    throw new Error(
      `The indexer shows no contract at ${address} after a minute. Either the deploy never landed, or the ` +
        `indexer is behind. Wait 15 minutes and choose ${args.finish} again. Do not choose Deploy again ` +
        'until a block explorer also shows nothing at this address.',
    );
  };
  const present = await onChain();
  const todo = circuits.filter((c) => !present.has(c));
  for (const [i, circuit] of todo.entries()) {
    logger?.info(`adding circuit key ${i + 1} of ${todo.length}: ${circuit}`);
    try {
      await args.insert(circuit);
    } catch (e) {
      // It may have landed with only the confirmation failing; the chain decides.
      if (!(await onChain()).has(circuit)) throw e;
    }
    // The next insert signs over the authority's counter as the indexer reports it, so
    // wait until the indexer shows this one before building the next.
    for (let tries = 0; !(await onChain()).has(circuit); tries++) {
      if (tries >= 30)
        throw new Error(
          `The indexer has not shown the key for ${circuit} after a minute; it may be behind. ` +
            `Wait 15 minutes, then choose ${args.finish} again with the same address.`,
        );
      await sleep(2_000);
    }
  }
  logger?.info(`all ${circuits.length} circuit keys are on chain`);
};

/** The circuits a contract carries on chain that this build does not have. */
export const unknownCircuits = async (
  providers: { readonly publicDataProvider: PublicDataProvider },
  address: ContractAddress,
  known: readonly string[],
): Promise<string[]> => {
  const onChain =
    (await providers.publicDataProvider.queryContractState(address))?.operations().map(operationName) ?? [];
  return onChain.filter((c) => !known.includes(c));
};
