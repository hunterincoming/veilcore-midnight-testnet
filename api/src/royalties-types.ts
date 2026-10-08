// Types for the royalties contract client.
// SPDX-License-Identifier: Apache-2.0

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract, Witnesses } from '../../contract/src/managed/veilcore-royalties/contract/index.js';
import type { RoyaltiesPrivateState } from '../../contract/src/royalties.js';

/** The private-state id of a royalties client: a store of its own, as for the claims client. */
export const royaltiesPrivateStateKey = 'veilcoreRoyaltiesPrivateState';
export type RoyaltiesPrivateStateId = typeof royaltiesPrivateStateKey;

export type RoyaltiesContract = Contract<RoyaltiesPrivateState, Witnesses<RoyaltiesPrivateState>>;
export type RoyaltiesCircuitKeys = Exclude<keyof RoyaltiesContract['impureCircuits'], number | symbol>;
export type RoyaltiesProviders = MidnightProviders<
  RoyaltiesCircuitKeys,
  RoyaltiesPrivateStateId,
  RoyaltiesPrivateState
>;
export type DeployedRoyaltiesContract = FoundContract<RoyaltiesContract>;
