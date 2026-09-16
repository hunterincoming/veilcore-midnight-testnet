// Types for license-tree.mjs.
//
// The module is plain JS because it runs in the contract's own test suite alongside
// tree.mjs and descent.mjs, which have no build step. It is the first of those to be
// imported from TypeScript, and without these declarations every value crossing that
// boundary is `any` — which is how a path of the wrong shape reaches a circuit and
// fails after proving.
//
// SPDX-License-Identifier: Apache-2.0

/** Depth of the active-licence tree, read from the build's contract-info.json. */
export const DEPTH: number;
/** Concurrent active licences the tree holds: 2^DEPTH. */
export const CAPACITY: number;
export const NULL_LEAF: Uint8Array;
export const EMPTY_ROOT: Uint8Array;

/**
 * A path into the tree, built before the call that uses it.
 *
 * `index` is the position the plan targets; pass it back to the matching apply once
 * the chain has accepted the call.
 */
export type LicensePlan = {
  readonly index: number;
  readonly dirs: boolean[];
  readonly siblings: Uint8Array[];
  readonly oldRoot: Uint8Array;
};

/** What a completed mutation reports: the plan plus the root it moved to. */
export type LicenseMutation = LicensePlan & { readonly newRoot: Uint8Array };

/** A membership path, for proveLicense. Never publish `index`. */
export type LicenseProofPath = {
  readonly index: number;
  readonly dirs: boolean[];
  readonly siblings: Uint8Array[];
  readonly root: Uint8Array;
};

export class LicenseTree {
  leaves: Map<string, Uint8Array>;
  indexOf: Map<string, number>;

  root(): Uint8Array;
  siblingsFor(index: number): Uint8Array[];
  subtreeRoot(level: number, prefix: string): Uint8Array;
  freeIndex(): number;
  positionOf(licenseCommitment: Uint8Array): number;

  // Plan then apply: a path is built BEFORE the call that uses it and the local tree
  // moves forward only once the chain has accepted. A mutate-on-build API
  // desynchronises from the chain on every refused call.
  planInsert(licenseCommitment: Uint8Array): LicensePlan;
  applyInsert(licenseCommitment: Uint8Array, index: number): Uint8Array;
  insert(licenseCommitment: Uint8Array): LicenseMutation;

  planRemove(licenseCommitment: Uint8Array): LicensePlan;
  applyRemove(licenseCommitment: Uint8Array, index: number): Uint8Array;
  remove(licenseCommitment: Uint8Array): LicenseMutation;

  planReplace(oldCommitment: Uint8Array): LicensePlan;
  applyReplace(
    oldCommitment: Uint8Array,
    newCommitment: Uint8Array,
    index: number,
  ): Uint8Array;
  replace(
    oldCommitment: Uint8Array,
    newCommitment: Uint8Array,
  ): LicenseMutation;

  pathFor(licenseCommitment: Uint8Array): LicenseProofPath;
}
