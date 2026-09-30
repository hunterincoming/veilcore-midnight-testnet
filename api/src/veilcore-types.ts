// Types for the VeilCore contract client.
// SPDX-License-Identifier: Apache-2.0

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract, Witnesses } from '../../contract/src/managed/veilcore/contract/index.js';
import type { VeilcorePrivateState } from '../../contract/src/witnesses.js';

export const veilcorePrivateStateKey = 'veilcorePrivateState';
export type VeilcorePrivateStateId = typeof veilcorePrivateStateKey;

export type VeilcorePrivateStates = {
  readonly veilcorePrivateState: VeilcorePrivateState;
};

/** A veilcore contract and its private state. */
export type VeilcoreContract = Contract<VeilcorePrivateState, Witnesses<VeilcorePrivateState>>;

/** The keys of the impure circuits exported from {@link VeilcoreContract}. */
export type VeilcoreCircuitKeys = Exclude<keyof VeilcoreContract['impureCircuits'], number | symbol>;

/** The providers required by {@link VeilcoreContract}. */
export type VeilcoreProviders = MidnightProviders<VeilcoreCircuitKeys, VeilcorePrivateStateId, VeilcorePrivateState>;

/** A {@link VeilcoreContract} that has been deployed to the network. */
export type DeployedVeilcoreContract = FoundContract<VeilcoreContract>;

/** Derived state combining the public ledger with this client's private state. */
export type VeilcoreDerivedState = {
  readonly anchorCount: bigint;
  /** Hex of commit(geneticSecret): the record this client acts as. */
  readonly myCommitment: string;
  /** Hex of the identity (origin) that record belongs to. */
  readonly myIdentity: string;
  /** Whether that identity is anchored. */
  readonly iAmAnchored: boolean;
  /** Whether this client's record is its identity's current head. */
  readonly iAmLive: boolean;
};
