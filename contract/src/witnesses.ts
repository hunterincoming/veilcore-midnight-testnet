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
import {
  Ledger as LineageLedger,
  pureCircuits as lineagePureCircuits,
} from "./managed/lineage/contract/index.js";
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
  recoverySecret: geneticSecret,
  licenseSecret: ZERO32(),
  licenseRecord: ZERO32(),
  licenseSiblings: [],
  licenseDirections: [],
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
};

/* **********************************************************************
 * Lineage private state.
 *
 * The lineage contract needs more than a secret: the Merkle path for the slot
 * being proved, who is owed when an obligation is attached or released, what is
 * currently sitting in the slot, and the ancestor being claimed. None of it goes on
 * chain — the circuit folds the path and compares only the resulting root.
 *
 * These are set immediately before a call, from the off-chain tree in ./tree.mjs,
 * because a path is only valid against the root current at that moment. Calling
 * with a stale path fails the fold, which is the intended behaviour rather than an
 * error to work around.
 */

export type LineagePrivateState = {
  readonly geneticSecret: Uint8Array;
  /** The secret behind an obligation's beneficiary. Only they may discharge. */
  readonly beneficiarySecret: Uint8Array;
  /** Sibling hashes for this record's slot, bottom-up. */
  readonly siblings: Uint8Array[];
  /** Direction bits for this record's slot, bottom-up. */
  readonly directions: boolean[];
  /**
   * What occupies the slot being proved clean.
   *
   * A slot is derived from the first DEPTH bytes of a commitment, so another
   * record's obligation can land in it — by collision, or because a squatter ground
   * a secret until it did. A clean proof therefore shows the slot holds nothing
   * binding THIS record rather than that it is empty, and the circuit rebuilds the
   * occupant's leaf from these to fold the path.
   */
  readonly slotIsEmpty: boolean;
  readonly slotOccupantRecord: Uint8Array;
  readonly slotOccupantObligation: Uint8Array;
  readonly slotOccupantBeneficiary: Uint8Array;
  /** Claimed ancestors, innermost first. Padded to 4 with zero commitments. */
  readonly ancestry: Uint8Array[];
};

/**
 * Depth from the compiled artifact, never a literal.
 *
 * This was a hardcoded 16 while the contract was generated at 24, which is a silent
 * break: the client would supply sixteen siblings, the circuit would expect
 * twenty-four, and every call would fail after proving and after paying.
 */
const LINEAGE_DEPTH = lineagePureCircuits.slotBits(new Uint8Array(32)).length;
const emptyPath = (depth = LINEAGE_DEPTH): Uint8Array[] =>
  Array.from({ length: depth }, ZERO32);
const emptyDirs = (depth = LINEAGE_DEPTH): boolean[] =>
  Array.from({ length: depth }, () => false);

/** A private state with no obligations and no claimed ancestry. */
export const createLineagePrivateState = (
  geneticSecret: Uint8Array,
): LineagePrivateState => ({
  geneticSecret,
  beneficiarySecret: geneticSecret,
  siblings: emptyPath(),
  directions: emptyDirs(),
  slotIsEmpty: true,
  slotOccupantRecord: ZERO32(),
  slotOccupantObligation: ZERO32(),
  slotOccupantBeneficiary: ZERO32(),
  ancestry: Array.from({ length: 4 }, ZERO32),
});

/** Replace the path before a call, from the current off-chain tree. */
export const withPath = (
  state: LineagePrivateState,
  siblings: Uint8Array[],
  directions: boolean[],
): LineagePrivateState => ({ ...state, siblings, directions });

/** Name the beneficiary before encumbering or discharging. */
export const withBeneficiary = (
  state: LineagePrivateState,
  beneficiarySecret: Uint8Array,
): LineagePrivateState => ({ ...state, beneficiarySecret });

/**
 * Describe the slot's current occupant before a clean proof.
 *
 * Takes what ObligationTree.occupantOf returns.
 */
export const withOccupant = (
  state: LineagePrivateState,
  occupant: {
    isEmpty: boolean;
    record: Uint8Array;
    obligation: Uint8Array;
    beneficiary: Uint8Array;
  },
): LineagePrivateState => ({
  ...state,
  slotIsEmpty: occupant.isEmpty,
  slotOccupantRecord: occupant.record,
  slotOccupantObligation: occupant.obligation,
  slotOccupantBeneficiary: occupant.beneficiary,
});

/**
 * Name the ancestor a clean proof concerns.
 *
 * Took a sibling path and direction bits per ancestor as well, for a
 * four-generation walk that was never built. Those witnesses are gone from the
 * contract: one proof covers one ancestor, and a verifier collects one per
 * generation rather than paying for a bundled walk in every prover key.
 */
export const withAncestry = (
  state: LineagePrivateState,
  ancestry: Uint8Array[],
): LineagePrivateState => ({ ...state, ancestry });

type LC = WitnessContext<LineageLedger, LineagePrivateState>;

export const lineageWitnesses = {
  localGeneticSecret: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array] => [
    privateState,
    privateState.geneticSecret,
  ],

  beneficiarySecret: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array] => [
    privateState,
    privateState.beneficiarySecret,
  ],

  merkleSiblings: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array[]] => [
    privateState,
    privateState.siblings,
  ],

  merkleDirections: ({
    privateState,
  }: LC): [LineagePrivateState, boolean[]] => [
    privateState,
    privateState.directions,
  ],

  slotIsEmpty: ({ privateState }: LC): [LineagePrivateState, boolean] => [
    privateState,
    privateState.slotIsEmpty,
  ],

  slotOccupantRecord: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array] => [
    privateState,
    privateState.slotOccupantRecord,
  ],

  slotOccupantObligation: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array] => [
    privateState,
    privateState.slotOccupantObligation,
  ],

  slotOccupantBeneficiary: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array] => [
    privateState,
    privateState.slotOccupantBeneficiary,
  ],

  ancestryChain: ({
    privateState,
  }: LC): [LineagePrivateState, Uint8Array[]] => [
    privateState,
    privateState.ancestry,
  ],
};
