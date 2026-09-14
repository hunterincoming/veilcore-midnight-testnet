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
  async encumber(recordCommitment: Uint8Array, obligationCommitment: Uint8Array, path: SlotPath): Promise<void> {
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
  async discharge(recordCommitment: Uint8Array, obligationCommitment: Uint8Array, path: SlotPath): Promise<void> {
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
  async proveAncestorClean(
    ancestorCommitment: Uint8Array,
    path: SlotPath,
  ): Promise<{ ancestor: Uint8Array; txHash: string; blockHeight: number }> {
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

    // The circuit discloses which ancestor it cleared and writes it to
    // lastClearedAncestor. Returning void discarded it, which is the same defect this
    // layer had with proveOwnership: a verifier cannot join the proof to a declared
    // descent edge without knowing what was proven clean, and a proof with no subject
    // is one a caller whose real parent is encumbered could produce against any clean
    // record.
    return {
      ancestor: ancestorCommitment,
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /** Write the path (and optionally the claimed ancestry) into private state. */
  private async setPath(path: SlotPath, ancestry?: Uint8Array[]): Promise<void> {
    const current = (await this.providers.privateStateProvider.get(lineagePrivateStateKey)) as LineagePrivateState;

    // Four slots because the witness is a fixed vector, though the circuit reads only
    // element 0 — one ancestor per proof, by design, since bundling a whole lineage
    // quadrupled the prover key. The padding is not dead weight in the proof, it is
    // the shape the witness declares.
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

// verifyDescentClaim was here and is deliberately gone.
//
// It was the third implementation of descent verification in this project, and it
// carried the same defect as the other two: it walked the claimed chain as a single
// line, so a cross — a seed parent and a pollen parent, which is every cannabis
// variety — could not be verified by any chain a caller supplied. One parent was
// refused as an omitted generation, both were refused because the second is not the
// first's parent.
//
// Nothing imported it. Deleting beats fixing, because the next person needing this
// might have found this copy rather than the correct one.
//
// The verifier walks the graph rather than the caller's list, in
// contract/src/descent.mjs (verifyDescent) and behind POST /lineage/verify on the
// registry. Both take the set of ancestors a caller holds clean proofs for and
// require every declared ancestor to be covered, which also closes omission: a
// seller whose grandparent is encumbered cannot pass by declaring only the parent.
