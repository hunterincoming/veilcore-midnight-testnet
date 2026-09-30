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
 * Veilcore private state.
 *
 * The genetic preimage, the secret a rotation is moving to, the recovery secret
 * chosen at anchor time, and the licence a presentation is about. Only
 * commitments (hashes) are ever recorded on-chain; everything below is a private
 * witness that never leaves the client.
 *
 * EVERY WITNESS THE CONTRACT DECLARES HAS TO BE HERE. The compiled Contract
 * constructor refuses a witness object that is missing one, before any circuit
 * runs, so a witness added to the contract and not added here is not a partial
 * failure — it is a client that cannot call anything at all.
 */

export type VeilcorePrivateState = {
  readonly geneticSecret: Uint8Array;
  /** The secret being rotated INTO. Proved by the circuit, not taken on trust. */
  readonly incomingGeneticSecret: Uint8Array;
  /** The second secret, chosen at anchor time and kept apart from the first. */
  readonly recoverySecret: Uint8Array;
  /** The licence being presented, and the record it was issued against. */
  readonly licenseSecret: Uint8Array;
  readonly licenseRecord: Uint8Array;
  /** Its path in the active-licence tree. Set from ./license-tree.mjs per call. */
  readonly licenseSiblings: Uint8Array[];
  readonly licenseDirections: boolean[];
  /**
   * The verifier's challenge for the presentation about to be made. Chosen by the
   * VERIFIER, 32 random bytes, used once, never published.
   */
  readonly presentationChallenge: Uint8Array;
};

const ZERO32 = (): Uint8Array => new Uint8Array(32);

/**
 * A private state holding one record secret and nothing else yet.
 *
 * The rotation, recovery and licence fields default to the record secret or to
 * empty, because a party that never rotates and holds no licence never reads them.
 * A licence path is empty until a caller sets one: an empty path fails the fold,
 * which is the right outcome for a presentation nobody has prepared.
 */
export const createVeilcorePrivateState = (
  geneticSecret: Uint8Array,
): VeilcorePrivateState => ({
  geneticSecret,
  incomingGeneticSecret: geneticSecret,
  // NOT the genetic secret. A recovery secret defaulting to the primary would make
  // recovery a copy of the key it is meant to back up. All-zero is a value no
  // recovery commitment is built from, so a call that forgets to set it fails.
  recoverySecret: ZERO32(),
  licenseSecret: ZERO32(),
  licenseRecord: ZERO32(),
  licenseSiblings: [],
  licenseDirections: [],
  presentationChallenge: ZERO32(),
});

/** Name the secret a rotation is moving into, before calling rotateRecordSecret. */
export const withIncomingSecret = (
  state: VeilcorePrivateState,
  incomingGeneticSecret: Uint8Array,
): VeilcorePrivateState => ({ ...state, incomingGeneticSecret });

/** Name the recovery secret, before calling recoverRecordSecret. */
export const withRecoverySecret = (
  state: VeilcorePrivateState,
  recoverySecret: Uint8Array,
): VeilcorePrivateState => ({ ...state, recoverySecret });

/**
 * Set the licence and its tree path, before any licence circuit.
 *
 * A path is only valid against the root current at that moment, so this is called
 * immediately before the call and from the tree in ./license-tree.mjs. For
 * proveLicense the secret and the record are witnesses too: a presentation takes no
 * arguments, which is what stops it naming the licence or its issuer.
 */
export const withLicensePath = (
  state: VeilcorePrivateState,
  licenseSecret: Uint8Array,
  licenseRecord: Uint8Array,
  licenseSiblings: Uint8Array[],
  licenseDirections: boolean[],
): VeilcorePrivateState => ({
  ...state,
  licenseSecret,
  licenseRecord,
  licenseSiblings,
  licenseDirections,
});

type VC = WitnessContext<VeilcoreLedger, VeilcorePrivateState>;

export const veilcoreWitnesses = {
  localGeneticSecret: ({
    privateState,
  }: VC): [VeilcorePrivateState, Uint8Array] => [
    privateState,
    privateState.geneticSecret,
  ],

  incomingGeneticSecret: ({
    privateState,
  }: VC): [VeilcorePrivateState, Uint8Array] => [
    privateState,
    privateState.incomingGeneticSecret,
  ],

  recoverySecret: ({
    privateState,
  }: VC): [VeilcorePrivateState, Uint8Array] => [
    privateState,
    privateState.recoverySecret,
  ],

  licenseSecret: ({ privateState }: VC): [VeilcorePrivateState, Uint8Array] => [
    privateState,
    privateState.licenseSecret,
  ],

  licenseRecord: ({ privateState }: VC): [VeilcorePrivateState, Uint8Array] => [
    privateState,
    privateState.licenseRecord,
  ],

  licenseSiblings: ({
    privateState,
  }: VC): [VeilcorePrivateState, Uint8Array[]] => [
    privateState,
    privateState.licenseSiblings,
  ],

  licenseDirections: ({
    privateState,
  }: VC): [VeilcorePrivateState, boolean[]] => [
    privateState,
    privateState.licenseDirections,
  ],

  presentationChallenge: ({
    privateState,
  }: VC): [VeilcorePrivateState, Uint8Array] => [
    privateState,
    privateState.presentationChallenge,
  ],
};

/* **********************************************************************
 * Lineage private state.
 *
 * One secret. Since the 30 Sep security pass the lineage contract derives every
 * caller — child, parent, record holder, beneficiary — from the caller's own
 * record secret, and keeps obligations in sets rather than a Merkle tree, so there
 * are no paths, slots or occupants to supply.
 */

export type LineagePrivateState = {
  readonly geneticSecret: Uint8Array;
};

export const createLineagePrivateState = (
  geneticSecret: Uint8Array,
): LineagePrivateState => ({ geneticSecret });

type LC = WitnessContext<LineageLedger, LineagePrivateState>;

export const lineageWitnesses = {
  localGeneticSecret: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array] => [
    privateState,
    privateState.geneticSecret,
  ],
};
