// Copyright (C) VeilCore
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/*
 * Private state and witness functions for the VeilCore and lineage contracts.
 */

import { Ledger as VeilcoreLedger } from "./managed/veilcore/contract/index.js";
import { Ledger as LineageLedger } from "./managed/lineage/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";


/* **********************************************************************
 * Veilcore private state: the caller's genetic preimage. Only its
 * commitment (a hash) is ever recorded on-chain; the preimage below is
 * a private witness that never leaves the client.
 */

export type VeilcorePrivateState = {
  readonly geneticSecret: Uint8Array;
};

export const createVeilcorePrivateState = (
  geneticSecret: Uint8Array,
): VeilcorePrivateState => ({
  geneticSecret,
});

export const veilcoreWitnesses = {
  localGeneticSecret: ({
    privateState,
  }: WitnessContext<VeilcoreLedger, VeilcorePrivateState>): [
    VeilcorePrivateState,
    Uint8Array,
  ] => [privateState, privateState.geneticSecret],
};

/* **********************************************************************
 * Lineage private state.
 *
 * The lineage contract needs more than a secret: it needs the Merkle path for
 * the caller's slot in the obligation tree, and the ancestry being claimed.
 * None of it goes on chain — the circuit folds the path and compares only the
 * resulting root, so the ancestors and the path stay client-side.
 *
 * These are set immediately before a call, from the off-chain tree in
 * ./tree.mjs, because a path is only valid against the root current at that
 * moment. Calling with a stale path fails the fold, which is the intended
 * behaviour rather than an error to work around.
 */

export type LineagePrivateState = {
  readonly geneticSecret: Uint8Array;
  /** Sibling hashes for this record's slot, bottom-up. Depth 16. */
  readonly siblings: Uint8Array[];
  /** Direction bits for this record's slot, bottom-up. */
  readonly directions: boolean[];
  /** Claimed ancestors, innermost first. Padded to 4 with zero commitments. */
  readonly ancestry: Uint8Array[];
  /** A sibling path per ancestor, same order. */
  readonly ancestrySiblings: Uint8Array[][];
  /** Direction bits per ancestor, same order. */
  readonly ancestryDirections: boolean[][];
};

const ZERO32 = (): Uint8Array => new Uint8Array(32);
const emptyPath = (depth = 16): Uint8Array[] => Array.from({ length: depth }, ZERO32);
const emptyDirs = (depth = 16): boolean[] => Array.from({ length: depth }, () => false);

/** A private state with no obligations and no claimed ancestry. */
export const createLineagePrivateState = (
  geneticSecret: Uint8Array,
): LineagePrivateState => ({
  geneticSecret,
  siblings: emptyPath(),
  directions: emptyDirs(),
  ancestry: Array.from({ length: 4 }, ZERO32),
  ancestrySiblings: Array.from({ length: 4 }, () => emptyPath()),
  ancestryDirections: Array.from({ length: 4 }, () => emptyDirs()),
});

/** Replace the path before a call, from the current off-chain tree. */
export const withPath = (
  state: LineagePrivateState,
  siblings: Uint8Array[],
  directions: boolean[],
): LineagePrivateState => ({ ...state, siblings, directions });

/** Replace the claimed ancestry and its paths before a clean-descent proof. */
export const withAncestry = (
  state: LineagePrivateState,
  ancestry: Uint8Array[],
  ancestrySiblings: Uint8Array[][],
  ancestryDirections: boolean[][],
): LineagePrivateState => ({ ...state, ancestry, ancestrySiblings, ancestryDirections });

export const lineageWitnesses = {
  localGeneticSecret: ({ privateState }: WitnessContext<LineageLedger, LineagePrivateState>): [
    LineagePrivateState, Uint8Array,
  ] => [privateState, privateState.geneticSecret],

  merkleSiblings: ({ privateState }: WitnessContext<LineageLedger, LineagePrivateState>): [
    LineagePrivateState, Uint8Array[],
  ] => [privateState, privateState.siblings],

  merkleDirections: ({ privateState }: WitnessContext<LineageLedger, LineagePrivateState>): [
    LineagePrivateState, boolean[],
  ] => [privateState, privateState.directions],

  ancestryChain: ({ privateState }: WitnessContext<LineageLedger, LineagePrivateState>): [
    LineagePrivateState, Uint8Array[],
  ] => [privateState, privateState.ancestry],

  ancestrySiblings: ({ privateState }: WitnessContext<LineageLedger, LineagePrivateState>): [
    LineagePrivateState, Uint8Array[][],
  ] => [privateState, privateState.ancestrySiblings],

  ancestryDirections: ({ privateState }: WitnessContext<LineageLedger, LineagePrivateState>): [
    LineagePrivateState, boolean[][],
  ] => [privateState, privateState.ancestryDirections],
};
