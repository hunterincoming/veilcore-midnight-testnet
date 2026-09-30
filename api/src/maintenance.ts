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
