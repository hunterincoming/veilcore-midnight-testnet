// Lineage API — heritable rights over anchored records.
//
// Two mechanisms decide a clean-descent claim, and both are needed:
//   a clean proof shows a claimed ancestor carries no obligation in force
//   the descent graph shows the claimed ancestor is the real one
//
// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import * as Lineage from '../../contract/src/managed/lineage/contract/index.js';
import { CompiledLineage } from '../../contract/src/lineage';
import { type DeployedLineageContract, type LineageProviders, lineagePrivateStateKey } from './lineage-types.js';
import { createLineagePrivateState } from '../../contract/src/witnesses.js';
import { assertDeploymentRecordCurrent } from './deploy-guard.js';
import { retireMaintenanceAuthority } from './maintenance.js';
import { type SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import * as utils from './utils/index.js';

/** A record's position and path in the obligation tree. */
const tx = (logger: Logger | undefined, circuit: string, txData: { public: { txHash: string; blockHeight: number } }) =>
  logger?.trace({
    transactionAdded: { circuit, txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
  });

/**
 * Every call acts as the holder of this client's record secret. The contract derives
 * the caller from it — a child proposing, a parent confirming, a holder accepting,
 * a beneficiary proposing or discharging — so no call takes the caller's own record.
 */
export class LineageAPI {
  private constructor(
    public readonly deployedContract: DeployedLineageContract,
    private readonly providers: LineageProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
  }

  readonly deployedContractAddress: ContractAddress;

  /** As the CHILD's holder: name a parent. An offer until the parent confirms. */
  async proposeParent(parentCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`proposing parent ${toHex(parentCommitment)}`);
    tx(this.logger, 'proposeParent', await this.deployedContract.callTx.proposeParent(parentCommitment));
  }

  /** As the PARENT's holder: accept being named by this child. */
  async confirmParent(childCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`confirming parentage of ${toHex(childCommitment)}`);
    tx(this.logger, 'confirmParent', await this.deployedContract.callTx.confirmParent(childCommitment));
  }

  /** As the child's holder: retract your own proposal. */
  async withdrawParent(): Promise<void> {
    this.logger?.info('withdrawing parentage proposal');
    tx(this.logger, 'withdrawParent', await this.deployedContract.callTx.withdrawParent());
  }

  /** As the BENEFICIARY: propose a claim against a record. Binds nobody until accepted. */
  async proposeObligation(recordCommitment: Uint8Array, obligationCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`proposing an obligation against ${toHex(recordCommitment)}`);
    tx(
      this.logger,
      'proposeObligation',
      await this.deployedContract.callTx.proposeObligation(recordCommitment, obligationCommitment),
    );
  }

  /** As a record's holder: claim against your OWN record, in your favour, in one step. */
  async encumberOwnRecord(obligationCommitment: Uint8Array): Promise<void> {
    this.logger?.info('placing an obligation on your own record');
    tx(this.logger, 'encumberOwnRecord', await this.deployedContract.callTx.encumberOwnRecord(obligationCommitment));
  }

  /** As the beneficiary: retract a proposal the holder has not accepted. */
  async withdrawObligation(recordCommitment: Uint8Array, obligationCommitment: Uint8Array): Promise<void> {
    this.logger?.info('withdrawing obligation proposal');
    tx(
      this.logger,
      'withdrawObligation',
      await this.deployedContract.callTx.withdrawObligation(recordCommitment, obligationCommitment),
    );
  }

  /** As the RECORD's holder: accept an obligation, naming the beneficiary you agreed with. */
  async acceptObligation(obligationCommitment: Uint8Array, beneficiaryCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`accepting an obligation in favour of ${toHex(beneficiaryCommitment)}`);
    tx(
      this.logger,
      'acceptObligation',
      await this.deployedContract.callTx.acceptObligation(obligationCommitment, beneficiaryCommitment),
    );
  }

  /** As the beneficiary, and only them: release an obligation. */
  async discharge(recordCommitment: Uint8Array, obligationCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`discharging an obligation on ${toHex(recordCommitment)}`);
    tx(this.logger, 'discharge', await this.deployedContract.callTx.discharge(recordCommitment, obligationCommitment));
  }

  /**
   * Prove an ancestor carries no obligation in force AS OF THIS TRANSACTION. There
   * is no stale-root window any more: the circuit reads the current set.
   *
   * It does not prove the ancestor is yours. The verifier joins it to confirmed
   * edges (contract/src/descent.mjs), and must resolve rotations through the
   * provenance contract — see the header of lineage.compact.
   */
  async proveAncestorClean(
    ancestorCommitment: Uint8Array,
  ): Promise<{ ancestor: Uint8Array; txHash: string; blockHeight: number }> {
    this.logger?.info('proving ancestor clean (zk)');
    const txData = await this.deployedContract.callTx.proveAncestorClean(ancestorCommitment);
    tx(this.logger, 'proveAncestorClean', txData);
    return { ancestor: ancestorCommitment, txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
  }

  /** Is an obligation in force against this record right now? Read-only, no wallet. */
  async hasOpenObligation(recordCommitment: Uint8Array): Promise<boolean> {
    return (await this.currentLedger()).obligationCountOf.member(recordCommitment);
  }

  private async currentLedger(): Promise<Lineage.Ledger> {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (contractState === null) throw new Error('the lineage contract has no state at its address');
    return Lineage.ledger(contractState.data);
  }

  static async deploy(
    providers: LineageProviders,
    signingKey: SigningKey | null,
    logger?: Logger,
  ): Promise<LineageAPI> {
    // Refuses unless the target network is one where the deployment record is not a
    // gate, or a sufficient revision has been declared as filed. Closed by default:
    // an unknown network, an unset network, a missing revision or a mistyped one all
    // refuse. Same record and same revision counter as veilcore — see the note on
    // REQUIRED_RECORD_REVISION in deploy-guard.ts for why it is not its own.
    assertDeploymentRecordCurrent('lineage', logger);

    logger?.info('deployContract — lineage');

    const deployedLineageContract = await deployContract(providers, {
      compiledContract: CompiledLineage,
      privateStateId: lineagePrivateStateKey,
      initialPrivateState: createLineagePrivateState(utils.randomBytes(32)),
      // Asked for, like veilcore's: omitted, midnight-js installs a random authority
      // and saves its key locally. null retires it straight after deployment.
      ...(signingKey === null ? {} : { signingKey }),
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedLineageContract.deployTxData.public,
      },
    });

    const api = new LineageAPI(deployedLineageContract, providers, logger);
    if (signingKey === null) await api.retireMaintenanceAuthority();
    return api;
  }

  /** Give up the maintenance authority permanently. See api/src/maintenance.ts. */
  async retireMaintenanceAuthority(): Promise<void> {
    await retireMaintenanceAuthority(
      this.deployedContract,
      this.providers.privateStateProvider,
      this.deployedContractAddress,
      this.logger,
    );
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
