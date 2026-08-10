// Veilcore API. Mirrors BBoardAPI in ./index.ts but drives the veilcore contract's
// anchor / proveOwnership circuits.
// SPDX-License-Identifier: Apache-2.0

import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { CompiledVeilcore } from '../../contract/src/veilcore';
import { type VeilcorePrivateState, createVeilcorePrivateState } from '../../contract/src/witnesses.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, from, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import * as utils from './utils/index.js';
import {
  type VeilcoreProviders,
  type VeilcoreContract,
  type DeployedVeilcoreContract,
  type VeilcoreDerivedState,
  type AnchoredStrain,
  veilcorePrivateStateKey,
} from './veilcore-types.js';

/** An API for a deployed veilcore contract. */
export interface DeployedVeilcoreAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<VeilcoreDerivedState>;

  anchor: (commitment: Uint8Array) => Promise<void>;
  proveOwnership: () => Promise<void>;
  pairDna: (recordCommitment: Uint8Array, dnaCommitment: Uint8Array) => Promise<void>;
  issueLicense: (recordCommitment: Uint8Array, licenseCommitment: Uint8Array) => Promise<void>;
  countersignLicense: (licenseCommitment: Uint8Array) => Promise<void>;
  revokeLicense: (licenseCommitment: Uint8Array) => Promise<void>;
  proveLicense: (secret: Uint8Array) => Promise<void>;
}

export class VeilcoreAPI implements DeployedVeilcoreAPI {
  private constructor(
    public readonly deployedContract: DeployedVeilcoreContract,
    providers: VeilcoreProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    this.state$ = combineLatest(
      [
        providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(
          map((contractState) => Veilcore.ledger(contractState.data)),
        ),
        from(providers.privateStateProvider.get(veilcorePrivateStateKey) as Promise<VeilcorePrivateState>),
      ],
      (ledgerState, privateState) => {
        const myCommitment = Veilcore.pureCircuits.commit(privateState.geneticSecret);
        // V2: anchoring writes no per-record ledger state. The anchor lives in the
        // transaction; existence is resolved from transaction history off-chain.
        return {
          anchorCount: ledgerState.anchorSeq,
          anchors: [] as AnchoredStrain[],
          myCommitment: toHex(myCommitment),
          iOwnAnchor: toHex(ledgerState.lastAnchor) === toHex(myCommitment),
        };
      },
    );
  }

  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<VeilcoreDerivedState>;

  /**
   * Anchors a genetics commitment on-chain. The circuit proves (in ZK) that the
   * caller holds the preimage behind `commitment` via the private witness, without
   * revealing it; only the commitment hash is recorded.
   */
  async anchor(commitment: Uint8Array): Promise<void> {
    this.logger?.info(`anchoring commitment: ${toHex(commitment)}`);
    const txData = await this.deployedContract.callTx.anchor(commitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'anchor',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Proves ownership of a previously-anchored strain by demonstrating knowledge of
   * its secret preimage WITHOUT revealing it. Only the public commitment is disclosed.
   */
  async proveOwnership(): Promise<void> {
    this.logger?.info('proving prior possession (zk)');
    const txData = await this.deployedContract.callTx.proveOwnership();
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proveOwnership',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /** Binds a DNA report fingerprint to a record the caller owns. */
  async pairDna(recordCommitment: Uint8Array, dnaCommitment: Uint8Array): Promise<void> {
    this.logger?.info('pairing DNA fingerprint');
    const txData = await this.deployedContract.callTx.pairDna(recordCommitment, dnaCommitment);
    this.logger?.trace({
      transactionAdded: { circuit: 'pairDna', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
    });
  }

  /** Issues a licence against a record the caller owns. Starts PENDING. */
  async issueLicense(recordCommitment: Uint8Array, licenseCommitment: Uint8Array): Promise<void> {
    this.logger?.info('issuing licence');
    const txData = await this.deployedContract.callTx.issueLicense(recordCommitment, licenseCommitment);
    this.logger?.trace({
      transactionAdded: { circuit: 'issueLicense', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
    });
  }

  /** The licensee's counter-signature activates a pending licence. */
  async countersignLicense(licenseCommitment: Uint8Array): Promise<void> {
    this.logger?.info('countersigning licence');
    const txData = await this.deployedContract.callTx.countersignLicense(licenseCommitment);
    this.logger?.trace({
      transactionAdded: { circuit: 'countersignLicense', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
    });
  }

  /** Only the issuing record owner can revoke. Clears the live entry. */
  async revokeLicense(licenseCommitment: Uint8Array): Promise<void> {
    this.logger?.info('revoking licence');
    const txData = await this.deployedContract.callTx.revokeLicense(licenseCommitment);
    this.logger?.trace({
      transactionAdded: { circuit: 'revokeLicense', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
    });
  }

  /** A licensee proves they hold an ACTIVE licence without revealing terms or genetics. */
  async proveLicense(secret: Uint8Array): Promise<void> {
    this.logger?.info('proving licence (zk)');
    const txData = await this.deployedContract.callTx.proveLicense(secret);
    this.logger?.trace({
      transactionAdded: { circuit: 'proveLicense', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
    });
  }

  static async deploy(providers: VeilcoreProviders, logger?: Logger): Promise<VeilcoreAPI> {
    logger?.info('deployContract');

    const deployedVeilcoreContract = await deployContract(providers, {
      compiledContract: CompiledVeilcore,
      privateStateId: veilcorePrivateStateKey,
      initialPrivateState: createVeilcorePrivateState(utils.randomBytes(32)),
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedVeilcoreContract.deployTxData.public,
      },
    });

    return new VeilcoreAPI(deployedVeilcoreContract, providers, logger);
  }

  static async join(providers: VeilcoreProviders, contractAddress: ContractAddress, logger?: Logger): Promise<VeilcoreAPI> {
    logger?.info({ joinContract: { contractAddress } });

    const deployedVeilcoreContract = await findDeployedContract<VeilcoreContract>(providers, {
      contractAddress,
      compiledContract: CompiledVeilcore,
      privateStateId: veilcorePrivateStateKey,
      initialPrivateState: await VeilcoreAPI.getPrivateState(providers, contractAddress),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedVeilcoreContract.deployTxData.public,
      },
    });

    return new VeilcoreAPI(deployedVeilcoreContract, providers, logger);
  }

  private static async getPrivateState(
    providers: VeilcoreProviders,
    contractAddress: ContractAddress,
  ): Promise<VeilcorePrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existingPrivateState = await providers.privateStateProvider.get(veilcorePrivateStateKey);
    return existingPrivateState ?? createVeilcorePrivateState(utils.randomBytes(32));
  }
}
