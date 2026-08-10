// Lineage API — heritable rights over anchored records.
//
// The contract verifies Merkle paths but stores only a root, so something has to
// maintain the tree and produce paths. That is this class's main job: a caller says
// "encumber this record" and never touches a sibling hash.
//
// Two mechanisms decide a clean-descent claim, and both are needed:
//   the Merkle proof shows a claimed ancestor carries no obligation
//   the descent graph shows the claimed ancestor is the real one
//
// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import {
  type DeployedLineageContract,
  type LineageProviders,
  type DescentVerdict,
  lineagePrivateStateKey,
} from './lineage-types.js';
import { type LineagePrivateState } from '../../contract/src/witnesses.js';

/** A record's position and path in the obligation tree. */
export type SlotPath = {
  readonly directions: boolean[];
  readonly siblings: Uint8Array[];
};

export class LineageAPI {
  private constructor(
    public readonly deployedContract: DeployedLineageContract,
    private readonly providers: LineageProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
  }

  readonly deployedContractAddress: ContractAddress;

  /**
   * Declare that a record descends from a parent.
   *
   * The edge is disclosed into the transaction so any verifier can reconstruct the
   * descent graph. No ledger state grows.
   */
  async declareParent(childCommitment: Uint8Array, parentCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`declaring parentage: ${toHex(childCommitment)} <- ${toHex(parentCommitment)}`);
    const txData = await this.deployedContract.callTx.declareParent(childCommitment, parentCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'declareParent',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Attach an obligation to a record.
   *
   * `path` must be current: it is verified against the root on chain, so a path
   * computed before someone else's transaction will fail the fold. That is the
   * intended behaviour — it is what stops a stale view from overwriting the tree.
   */
  async encumber(
    recordCommitment: Uint8Array,
    obligationCommitment: Uint8Array,
    path: SlotPath,
  ): Promise<void> {
    await this.setPath(path);
    this.logger?.info(`encumbering ${toHex(recordCommitment)}`);
    const txData = await this.deployedContract.callTx.encumber(recordCommitment, obligationCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'encumber',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /** Clear an obligation, returning the record's slot to null. */
  async discharge(
    recordCommitment: Uint8Array,
    obligationCommitment: Uint8Array,
    path: SlotPath,
  ): Promise<void> {
    await this.setPath(path);
    this.logger?.info(`discharging ${toHex(recordCommitment)}`);
    const txData = await this.deployedContract.callTx.discharge(recordCommitment, obligationCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'discharge',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Prove one ancestor carries no obligation.
   *
   * One path per proof rather than a whole lineage in one circuit: bundling five
   * paths quadrupled the prover key, which put it out of reach of a browser. A
   * verifier collects one proof per generation instead.
   */
  async proveAncestorClean(ancestorCommitment: Uint8Array, path: SlotPath): Promise<void> {
    await this.setPath(path, [ancestorCommitment]);
    this.logger?.info('proving ancestor clean (zk)');
    const txData = await this.deployedContract.callTx.proveAncestorClean();
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proveAncestorClean',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /** Write the path (and optionally the claimed ancestry) into private state. */
  private async setPath(path: SlotPath, ancestry?: Uint8Array[]): Promise<void> {
    const current = (await this.providers.privateStateProvider.get(
      lineagePrivateStateKey,
    )) as LineagePrivateState;

    const zero = () => new Uint8Array(32);
    const chain = Array.from({ length: 4 }, (_, i) => ancestry?.[i] ?? zero());

    const next: LineagePrivateState = {
      ...current,
      siblings: path.siblings,
      directions: path.directions,
      ancestry: chain,
    };
    await this.providers.privateStateProvider.set(lineagePrivateStateKey, next);
  }
}

/**
 * Verify a clean-descent claim. Both mechanisms must agree.
 *
 * The Merkle side is checked on chain by the circuit; this is the graph side, and
 * it is what stops a prover naming a convenient unrelated record as their parent —
 * a claim whose Merkle proof would verify perfectly.
 */
export const verifyDescentClaim = (
  hasDeclaredEdge: (child: Uint8Array, parent: Uint8Array) => boolean,
  requiredDepth: number,
  record: Uint8Array,
  claimedChain: Uint8Array[],
): DescentVerdict => {
  if (claimedChain.length < requiredDepth) {
    return { ok: false, reason: 'ancestry incomplete — a generation was omitted' };
  }
  let current = record;
  for (const ancestor of claimedChain) {
    if (!hasDeclaredEdge(current, ancestor)) {
      return { ok: false, reason: 'ancestry rejected — no declared edge for this link' };
    }
    current = ancestor;
  }
  return { ok: true };
};
