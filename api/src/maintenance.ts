// SPDX-License-Identifier: Apache-2.0
/**
 * Giving up a contract's maintenance authority, for real.
 *
 * MIDNIGHT-JS NEVER DEPLOYS WITHOUT AN AUTHORITY. `deployContract` does
 * `signingKey ?? sampleSigningKey()`, installs that key as the contract's
 * maintenance authority, and saves it in the private-state provider's signing-key
 * store. Leaving the key out therefore does not mean "no authority": it means an
 * authority whose key sits in a local database nobody chose. This CLI used to print
 * "Deploying with NO maintenance authority. This cannot be undone." over exactly
 * that, which was false.
 *
 * The honest equivalent of "no authority" is to replace the authority with a key
 * that exists only in memory for the length of one transaction, then delete the
 * stored copy. After that nobody holds a key that can insert, remove or replace a
 * verifier key, including us. It cannot be undone.
 *
 * `replaceAuthority` stores the new key before returning (midnight-js has a TODO to
 * offer "replace and do not maintain key"), so the removal below is required, not
 * tidying. If the process dies between the two, the stored key is the only copy:
 * delete the signing-key store for this contract by hand.
 */
import { type Logger } from 'pino';
import {
  type ContractAddress,
  sampleSigningKey,
  type SigningKey,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  ContractMaintenanceAuthority,
  Intent,
  MaintenanceUpdate,
  ReplaceAuthority,
  Transaction,
  signData,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type Contract } from '@midnight-ntwrk/midnight-js-protocol/compact-js/effect/Contract';
import {
  ReplaceMaintenanceAuthorityTxFailedError,
  submitTx,
  type SubmitTxProviders,
} from '@midnight-ntwrk/midnight-js-contracts';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';

type Retirable = {
  readonly contractMaintenanceTx: { replaceAuthority: (newAuthority: SigningKey) => Promise<unknown> };
};
type SigningKeyStore = { removeSigningKey: (address: ContractAddress) => Promise<void> };

export const retireMaintenanceAuthority = async (
  deployed: Retirable,
  signingKeys: SigningKeyStore,
  address: ContractAddress,
  logger?: Logger,
): Promise<void> => {
  logger?.info('retiring the maintenance authority: replacing it with a key that is never stored');
  await deployed.contractMaintenanceTx.replaceAuthority(sampleSigningKey());
  await signingKeys.removeSigningKey(address);
  logger?.info("maintenance authority retired. Nobody, including us, can change this contract's circuits.");
};

/* **********************************************************************
 * Provable retirement: an authority nobody can satisfy, visible on chain.
 *
 * The retirement above is honest but has to be taken on trust: the chain shows an
 * authority with one key, and only our word says nobody kept it. A contract's
 * maintenance authority is a committee and a threshold (ledger-v8
 * ContractMaintenanceAuthority(committee, threshold, counter)), and an update needs
 * `threshold` signatures from committee members. Replacing it with an EMPTY committee
 * and threshold 1 leaves an authority no signature can ever satisfy, and anyone who
 * reads the contract's state can see that: committee [], threshold 1.
 *
 * midnight-js cannot build this: replaceAuthority takes a SigningKey and always
 * installs a one-key committee (compact-js createMaintenanceAuthority). So the update
 * is built here, the way compact-js builds its own (createSignedMaintenanceUpdate):
 * MaintenanceUpdate(address, [ReplaceAuthority(new authority)], current counter), signed
 * by the current key at index 0 over `dataToSign`, wrapped in an Intent and a
 * Transaction, then proved, balanced and submitted with midnight-js's own submitTx.
 * api/test-maintenance.mjs applies exactly this update to a real ledger-v8 LedgerState
 * and checks that afterwards the old key, and no key at all, can change anything.
 * The one thing it cannot show here is a real node accepting it; the smoke test's
 * claims phase does that on preprod.
 */

/** The ledger's view of an authority: who may sign, how many must, and the replay counter. */
export type AuthorityView = {
  readonly committee: readonly unknown[];
  readonly threshold: number;
  readonly counter: bigint;
};

/** Nobody can sign for this authority: it needs more signatures than it has members. */
export const isProvablyRetired = (a: AuthorityView): boolean => a.threshold > a.committee.length;

/** The authority a provable retirement installs: no members, one signature needed. */
export const retiredAuthority = (current: AuthorityView): ContractMaintenanceAuthority =>
  new ContractMaintenanceAuthority([], 1, current.counter + 1n);

/** The signed update replacing `current` with an empty committee. Pure: nothing is sent. */
export const provableRetirementUpdate = (
  address: ContractAddress,
  current: AuthorityView,
  signingKey: SigningKey,
): MaintenanceUpdate => {
  const update = new MaintenanceUpdate(address, [new ReplaceAuthority(retiredAuthority(current))], current.counter);
  return update.addSignature(0n, signData(signingKey, update.dataToSign));
};

type RetireProviders = SubmitTxProviders<Contract.Any, Contract.ProvableCircuitId<Contract.Any>> & {
  readonly privateStateProvider: SigningKeyStore & {
    getSigningKey: (address: ContractAddress) => Promise<SigningKey | undefined | null>;
  };
};

/**
 * Replace the maintenance authority with an empty committee (see above), confirm it on
 * chain, then delete the stored key. Needs the current authority's key in the local
 * store. Safe to run again: an authority already retired this way is left alone.
 */
export const retireMaintenanceAuthorityProvably = async (
  providers: RetireProviders,
  address: ContractAddress,
  logger?: Logger,
  waitMs = 2_000,
): Promise<void> => {
  const read = async (): Promise<AuthorityView> => {
    const state = await providers.publicDataProvider.queryContractState(address);
    if (state === null || state === undefined) throw new Error(`No contract state found at ${address}.`);
    return state.maintenanceAuthority;
  };
  const before = await read();
  if (isProvablyRetired(before)) {
    logger?.info('the maintenance authority is already an empty committee: nothing to do');
    await providers.privateStateProvider.removeSigningKey(address);
    return;
  }
  const key = await providers.privateStateProvider.getSigningKey(address);
  if (key === undefined || key === null)
    throw new Error(`The maintenance key for ${address} is not on this computer, so the authority cannot be retired.`);
  logger?.info('retiring the maintenance authority provably: replacing it with an empty committee');
  const unprovenTx = Transaction.fromParts(
    getNetworkId(),
    undefined,
    undefined,
    Intent.new(ttlOneHour()).addMaintenanceUpdate(provableRetirementUpdate(address, before, key)),
  );
  try {
    const finalized = await submitTx(providers, { unprovenTx });
    if (finalized.status !== SucceedEntirely) throw new ReplaceMaintenanceAuthorityTxFailedError(finalized);
    logger?.info({ transactionAdded: { circuit: 'retireMaintenanceAuthorityProvably', ...finalized } });
  } catch (e) {
    // It may have landed with only the confirmation failing: the chain decides below.
    if (!isProvablyRetired(await read())) throw e;
  }
  for (let i = 0; !isProvablyRetired(await read()); i++) {
    if (i >= 30)
      throw new Error(
        'The retirement was sent but the indexer does not show it after a minute. Read the contract state again later; ' +
          'the maintenance key is kept on this computer until it does.',
      );
    await new Promise((r) => setTimeout(r, waitMs));
  }
  await providers.privateStateProvider.removeSigningKey(address);
  logger?.info(
    'maintenance authority retired provably: the chain shows an empty committee (threshold 1), which no key can satisfy.',
  );
};
