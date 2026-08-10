// Lineage contract types. Mirrors veilcore-types.ts.
// SPDX-License-Identifier: Apache-2.0

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract, Witnesses } from '../../contract/src/managed/lineage/contract/index.js';
import type { LineagePrivateState } from '../../contract/src/witnesses.js';

export const lineagePrivateStateKey = 'lineagePrivateState';
export type LineagePrivateStateId = typeof lineagePrivateStateKey;

export type LineagePrivateStates = {
  readonly lineagePrivateState: LineagePrivateState;
};

export type LineageContract = Contract<LineagePrivateState, Witnesses<LineagePrivateState>>;
export type LineageCircuitKeys = Exclude<keyof LineageContract['impureCircuits'], number | symbol>;
export type LineageProviders = MidnightProviders<LineageCircuitKeys, LineagePrivateStateId, LineagePrivateState>;
export type DeployedLineageContract = FoundContract<LineageContract>;

/** What a verifier is told about a clean-descent claim. */
export type DescentVerdict = {
  readonly ok: boolean;
  readonly reason?: string;
};
