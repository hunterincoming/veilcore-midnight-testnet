// Veilcore common types. Mirrors ./common-types.ts (bboard) for the veilcore contract.
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

/** A single anchored strain: its commitment (hex) and logical timestamp. */
export type AnchoredStrain = {
  readonly commitment: string;
  readonly timestamp: bigint;
};

/** Derived state combining the public ledger with this DApp's private state. */
export type VeilcoreDerivedState = {
  readonly anchorCount: bigint;
  readonly anchors: readonly AnchoredStrain[];
  /** Hex of commit(geneticSecret) for this wallet's private strain. */
  readonly myCommitment: string;
  /** Whether this wallet's own commitment is anchored on-chain. */
  readonly iOwnAnchor: boolean;
};
