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
 * Private state and witness functions for the VeilCore contract.
 */

import {
  Ledger as VeilcoreLedger,
  pureCircuits as veilcorePureCircuits,
} from "./managed/veilcore/contract/index.js";
import {
  WitnessContext,
  type MerkleTreePath,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

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
  /**
   * The verifier's challenge for the presentation about to be made. Chosen by the
   * VERIFIER, 32 random bytes, used once, never published.
   */
  readonly presentationChallenge: Uint8Array;
  /**
   * Client bookkeeping, never read by a circuit: licence commitments this party revoked
   * as an issuer (hex). The contract keeps no record of a revocation, so the client
   * refuses to re-issue, or approve a transfer to, any of these (VeilcoreAPI). Absent
   * in private state written before it existed, which reads as none.
   */
  readonly revokedLicenses?: readonly string[];
};

const ZERO32 = (): Uint8Array => new Uint8Array(32);

/**
 * A private state holding one record secret and nothing else yet.
 *
 * The rotation, recovery and licence fields default to the record secret or to
 * empty, because a party that never rotates and holds no licence never reads them.
 * The licence path is never stored: the licensePath witness reads it from the
 * ledger at proving time (see below).
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
 * Name the licence a call acts on: its secret and the record it was issued against.
 * No path: the licensePath witness finds it in the ledger's own tree when the call
 * is proved, so it is always against the state the proof is made for.
 */
export const withLicense = (
  state: VeilcorePrivateState,
  licenseSecret: Uint8Array,
  licenseRecord: Uint8Array,
): VeilcorePrivateState => ({ ...state, licenseSecret, licenseRecord });

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

  /**
   * The licence's path in activeLicenses, computed from the ledger the proof is made
   * against. The leaf is licenseKey(licenseCommit(secret, record), record), the same
   * value the contract recomputes and compares.
   */
  licensePath: ({
    ledger,
    privateState,
  }: VC): [VeilcorePrivateState, MerkleTreePath<Uint8Array>] => {
    const lc = veilcorePureCircuits.licenseCommit(
      privateState.licenseSecret,
      privateState.licenseRecord,
    );
    const leaf = veilcorePureCircuits.licenseKey(
      lc,
      privateState.licenseRecord,
    );
    const path = ledger.activeLicenses.findPathForLeaf(leaf);
    if (path === undefined)
      throw new Error("No live licence for that secret and record");
    return [privateState, path];
  },

  presentationChallenge: ({
    privateState,
  }: VC): [VeilcorePrivateState, Uint8Array] => [
    privateState,
    privateState.presentationChallenge,
  ],
};
