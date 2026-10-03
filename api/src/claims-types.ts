// Types for the claims contract client.
// SPDX-License-Identifier: Apache-2.0

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract, Witnesses } from '../../contract/src/managed/veilcore-claims/contract/index.js';
import type { ClaimsPrivateState } from '../../contract/src/claims.js';

/**
 * The private-state id of a claims client. Keep the claims client's private state in a
 * store of its own: a provider's contract address is one setting per provider, and the
 * main contract's client sets it too.
 */
export const claimsPrivateStateKey = 'veilcoreClaimsPrivateState';
export type ClaimsPrivateStateId = typeof claimsPrivateStateKey;

/** The claims contract and its private state. */
export type ClaimsContract = Contract<ClaimsPrivateState, Witnesses<ClaimsPrivateState>>;

/** The keys of the claims contract's circuits. */
export type ClaimsCircuitKeys = Exclude<keyof ClaimsContract['impureCircuits'], number | symbol>;

/** The providers required by {@link ClaimsContract}. */
export type ClaimsProviders = MidnightProviders<ClaimsCircuitKeys, ClaimsPrivateStateId, ClaimsPrivateState>;

/** A {@link ClaimsContract} that has been deployed to the network. */
export type DeployedClaimsContract = FoundContract<ClaimsContract>;
