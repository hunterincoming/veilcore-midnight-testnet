// Where a partner's VeilCore client keeps its private state.
// SPDX-License-Identifier: Apache-2.0
//
// The main contract's client keeps the record secret it acts as in private state, so it
// is stored: encrypted (midnight-js's LevelDB provider, AES under the password), in a
// folder only this user can read, with the overlays the VeilCore CLI uses (round D, D-2):
// signing keys in memory only, and the secrets a single call needs (a recovery secret,
// the secret a rotation moves to, a licence secret, a presentation challenge) kept in
// this process and written to disk as zeros.
//
// The claims client's private state is only ever the input of the call being made (field
// sets, an opening, a signature), cleared when the call ends. It needs no disk, so it has
// none: a hidden field value never reaches a file, not even one that is overwritten.

import { chmod, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ContractAddress, type SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import { PasswordValidationError, validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { openStores } from '../../bboard-cli/src/private-store.js';
import { type VeilcorePrivateState } from '../../contract/src/witnesses.js';
import { type ClaimsPrivateState } from '../../contract/src/claims.js';
import { type VeilcorePrivateStateId } from '../../api/src/veilcore-types.js';
import { type ClaimsPrivateStateId } from '../../api/src/claims-types.js';
import { type Network, isNetwork } from './network.js';

export type VeilcorePrivateStateProvider = PrivateStateProvider<VeilcorePrivateStateId, VeilcorePrivateState>;
export type ClaimsPrivateStateProvider = PrivateStateProvider<ClaimsPrivateStateId, ClaimsPrivateState>;

/** The two private-state providers connect() needs: one per contract. */
export type PrivateStateStores = {
  readonly veilcore: VeilcorePrivateStateProvider;
  readonly claims: ClaimsPrivateStateProvider;
};

/** ~/.veilcore/<network>/partner-state: private to this user (0700, files 0600). */
export const defaultStateDir = (network: Network, home = os.homedir()): string =>
  path.join(home, '.veilcore', network, 'partner-state');

/** Why midnight-js would refuse `password`, in plain words; null if it is accepted. */
export const passwordProblem = (password: string): string | null => {
  try {
    validatePassword(password);
    return null;
  } catch (e) {
    switch (e instanceof PasswordValidationError ? e.reason : undefined) {
      case 'too_short':
        return 'it needs 16 or more characters';
      case 'repeated_characters':
        return 'it has the same character more than 3 times in a row';
      case 'insufficient_classes':
        return 'it needs at least 3 of: capital letters, small letters, numbers, symbols';
      case 'sequential_pattern':
        return 'it has 4 or more characters in order, like 1234 or abcd';
      default:
        return 'midnight-js does not accept it as a password';
    }
  }
};

/**
 * A private state provider held in this process only. Nothing is written anywhere;
 * everything is gone when the process ends. The claims client uses one (see above); the
 * main contract's client can too, for a verifier or a test, but then the record secret it
 * acts as must be given again (useRecordSecret) every run.
 */
export const memoryPrivateState = <PSI extends string, PS>(): PrivateStateProvider<PSI, PS> => {
  const states = new Map<string, PS>();
  const keys = new Map<string, SigningKey>();
  let address = '';
  const refuse = (): Promise<never> =>
    Promise.reject(new Error('This private state is held in memory only and cannot be exported or imported.'));
  const done = <T>(f: () => T): Promise<T> => Promise.resolve().then(f);
  return {
    setContractAddress: (a: ContractAddress) => void (address = a),
    set: (id: PSI, s: PS) => done(() => void states.set(`${address}:${id}`, s)),
    get: (id: PSI) => done(() => states.get(`${address}:${id}`) ?? null),
    remove: (id: PSI) => done(() => void states.delete(`${address}:${id}`)),
    clear: () =>
      done(() => {
        for (const k of [...states.keys()]) if (k.startsWith(`${address}:`)) states.delete(k);
      }),
    setSigningKey: (a: ContractAddress, k: SigningKey) => done(() => void keys.set(a, k)),
    getSigningKey: (a: ContractAddress) => done(() => keys.get(a) ?? null),
    removeSigningKey: (a: ContractAddress) => done(() => void keys.delete(a)),
    clearSigningKeys: () => done(() => keys.clear()),
    exportPrivateStates: refuse,
    importPrivateStates: refuse,
    exportSigningKeys: refuse,
    importSigningKeys: refuse,
  };
};

export type EncryptedPrivateStateOptions = {
  readonly network: Network;
  /**
   * Encrypts the store. Keep it in a secret manager: without it the record secrets in the
   * store cannot be read, and it cannot be recovered. 16 or more characters, at least 3
   * of capital letters, small letters, numbers and symbols (midnight-js's rule).
   */
  readonly password: string;
  /** Whose state this is: any stable name (your organisation, or the wallet's address). Not secret. */
  readonly accountId: string;
  /** Default ~/.veilcore/<network>/partner-state. Use one folder per network. */
  readonly dir?: string;
  /** Default 'veilcore-partner'. */
  readonly storeName?: string;
};

/**
 * The private state a partner's client needs: the main contract's, encrypted on disk
 * with the overlays above; the claims contract's, in memory only.
 */
export const encryptedPrivateState = async (o: EncryptedPrivateStateOptions): Promise<PrivateStateStores> => {
  if (!isNetwork(o.network)) throw new Error(`Unknown network ${String(o.network)}.`);
  const problem = passwordProblem(o.password);
  if (problem !== null) throw new Error(`That private-state password will not be accepted: ${problem}.`);
  if (o.accountId.trim() === '') throw new Error('Give an accountId: any stable name for whose state this is.');
  const password = o.password;
  const dir = o.dir ?? defaultStateDir(o.network);
  // Private to this user whatever the folder (under ~/.veilcore, openStores also does the parents).
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const stores = await openStores<VeilcorePrivateStateId, VeilcorePrivateState, string, unknown>({
    dir,
    storeName: o.storeName ?? 'veilcore-partner',
    password: () => password,
    accountId: o.accountId,
  });
  return {
    veilcore: stores.main as unknown as VeilcorePrivateStateProvider,
    claims: memoryPrivateState<ClaimsPrivateStateId, ClaimsPrivateState>(),
  };
};
