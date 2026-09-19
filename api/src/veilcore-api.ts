// Veilcore API. Mirrors BBoardAPI in ./index.ts but drives the veilcore contract's
// anchor / proveOwnership circuits.
// SPDX-License-Identifier: Apache-2.0

import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { CompiledVeilcore } from '../../contract/src/veilcore';
import { type VeilcorePrivateState, createVeilcorePrivateState } from '../../contract/src/witnesses.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { assertDeploymentRecordCurrent } from './deploy-guard.js';
import { type SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
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

/**
 * A licence's position and path in the active-licence tree.
 *
 * The contract verifies the fold and stores only a root, so something has to keep
 * the tree and produce paths — `LicenseTree` in contract/src/license-tree.mjs. The
 * caller supplies the path for the same reason LineageAPI takes a SlotPath: it is
 * only valid against the root current at that moment.
 */
export type LicensePath = {
  readonly directions: boolean[];
  readonly siblings: Uint8Array[];
};

/** An API for a deployed veilcore contract. */
export interface DeployedVeilcoreAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<VeilcoreDerivedState>;

  anchor: (commitment: Uint8Array, recoveryCommitment: Uint8Array) => Promise<void>;
  activeLicenseRoot: () => Promise<Uint8Array>;
  proveOwnership: () => Promise<{ commitment: Uint8Array; txHash: string; blockHeight: number }>;
  rotateRecordSecret: (
    newRecordCommitment: Uint8Array,
    incomingSecret: Uint8Array,
  ) => Promise<{ previousCommitment: Uint8Array; txHash: string; blockHeight: number }>;
  recoverRecordSecret: (
    recordCommitment: Uint8Array,
    newRecordCommitment: Uint8Array,
    recoverySecret: Uint8Array,
    incomingSecret: Uint8Array,
  ) => Promise<{ previousCommitment: Uint8Array; txHash: string; blockHeight: number }>;
  anchorBatch: (root: Uint8Array) => Promise<{ txHash: string; blockHeight: number }>;
  pairDna: (
    recordCommitment: Uint8Array,
    dnaCommitment: Uint8Array,
  ) => Promise<{ recordCommitment: Uint8Array; txHash: string; blockHeight: number }>;
  issueLicense: (recordCommitment: Uint8Array, licenseCommitment: Uint8Array) => Promise<void>;
  countersignLicense: (secret: Uint8Array, recordCommitment: Uint8Array, path: LicensePath) => Promise<void>;
  revokeLicense: (licenseCommitment: Uint8Array, path: LicensePath) => Promise<void>;
  proveLicense: (secret: Uint8Array, recordCommitment: Uint8Array, path: LicensePath) => Promise<void>;
  proposeTransfer: (
    secret: Uint8Array,
    recordCommitment: Uint8Array,
    newLicenseCommitment: Uint8Array,
  ) => Promise<void>;
  approveTransfer: (
    licenseCommitment: Uint8Array,
    recordCommitment: Uint8Array,
    expectedNewLicense: Uint8Array,
    path: LicensePath,
  ) => Promise<void>;
  withdrawTransfer: (secret: Uint8Array, recordCommitment: Uint8Array) => Promise<void>;
}

export class VeilcoreAPI implements DeployedVeilcoreAPI {
  private constructor(
    public readonly deployedContract: DeployedVeilcoreContract,
    private readonly providers: VeilcoreProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    this.state$ = combineLatest(
      [
        providers.publicDataProvider
          .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
          .pipe(map((contractState) => Veilcore.ledger(contractState.data))),
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
  async anchor(commitment: Uint8Array, recoveryCommitment: Uint8Array): Promise<void> {
    // THE RECOVERY COMMITMENT IS FIXED AT ANCHOR TIME and cannot be added later: by
    // the time a holder knows they need one they no longer hold the secret that would
    // authorise adding it. Anchoring without one is a choice to make the record
    // unrecoverable, and the contract refuses a recovery commitment equal to the
    // record, so the caller must derive it from a SECOND secret kept apart from the
    // first. Losing that secret costs the recovery path; losing both is final.
    this.logger?.info(`anchoring commitment: ${toHex(commitment)}`);
    const txData = await this.deployedContract.callTx.anchor(commitment, recoveryCommitment);
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
   *
   * THE CHAIN CARRIES THE COMMITMENT, in `lastOwnershipProof`. It is returned here
   * too, for the caller's convenience, but the return is not what makes the proof
   * checkable: a return travels in the call's communication commitment, which is
   * blinded, so it reaches this DApp and nobody reading the ledger. An earlier
   * revision returned it and called that publishing — the chain showed `proofSeq + 1`
   * and nothing else, and a prior-possession proof a third party cannot tie to a
   * record establishes nothing.
   */
  async proveOwnership(): Promise<{ commitment: Uint8Array; txHash: string; blockHeight: number }> {
    this.logger?.info('proving prior possession (zk)');
    const txData = await this.deployedContract.callTx.proveOwnership();
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proveOwnership',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    return {
      commitment: txData.private.result,
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /**
   * Moves a record's identity to a new secret.
   *
   * A witness secret cannot be recovered from the chain, so without this a holder
   * who loses theirs loses every record keyed to it, permanently. The incoming
   * commitment is generated by the holder from a secret they created locally, so
   * nothing secret crosses the wire and the old secret is never needed again.
   *
   * Licences issued against the old record are deliberately not swept along.
   * Re-keying them here would move other parties' rights without their knowledge;
   * they go through the normal transfer path, where the issuer approves.
   *
   * BOTH SIDES ARE PROVED. The incoming commitment used to be an argument taken on
   * trust, which let a holder rotate "into" a commitment belonging to someone else —
   * naming a target is not the same as holding it. So the caller passes the incoming
   * SECRET, not just its commitment, and it goes into private state for the circuit
   * to check against `newRecordCommitment`.
   *
   * The link between the two identities is on chain in `lastRotatedFrom` and
   * `lastRotatedTo`. The old commitment is returned as well, for convenience only.
   */
  async rotateRecordSecret(
    newRecordCommitment: Uint8Array,
    incomingSecret: Uint8Array,
  ): Promise<{ previousCommitment: Uint8Array; txHash: string; blockHeight: number }> {
    await this.patchPrivateState({ incomingGeneticSecret: incomingSecret });
    this.logger?.info('rotating record secret');
    const txData = await this.deployedContract.callTx.rotateRecordSecret(newRecordCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'rotateRecordSecret',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    return {
      previousCommitment: txData.private.result,
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /**
   * Move a record whose primary secret is gone.
   *
   * Rotation requires the secret, so it is no remedy for losing one — which is the
   * checklist item about no role being permanently lockable by a single lost secret.
   * This is gated by the recovery secret instead, chosen when the record was anchored
   * and kept apart from the first.
   *
   * A record anchored before recovery commitments existed, or anchored without one,
   * cannot use this. That is a property of when it was anchored rather than something
   * a holder can fix later.
   */
  async recoverRecordSecret(
    recordCommitment: Uint8Array,
    newRecordCommitment: Uint8Array,
    recoverySecret: Uint8Array,
    incomingSecret: Uint8Array,
  ): Promise<{ previousCommitment: Uint8Array; txHash: string; blockHeight: number }> {
    await this.patchPrivateState({ recoverySecret, incomingGeneticSecret: incomingSecret });
    this.logger?.info('recovering record with the recovery secret');
    const txData = await this.deployedContract.callTx.recoverRecordSecret(recordCommitment, newRecordCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'recoverRecordSecret',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    return {
      previousCommitment: txData.private.result,
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /**
   * Anchor a batch root.
   *
   * One transaction timestamps every record in the batch, so no holder needs a wallet.
   * Unlike anchor(), there is no preimage to prove — a root is a public value derived
   * from commitments, and the privacy was applied when each record was committed.
   */
  async anchorBatch(root: Uint8Array): Promise<{ txHash: string; blockHeight: number }> {
    this.logger?.info(`anchoring batch root: ${toHex(root)}`);
    const txData = await this.deployedContract.callTx.anchorBatch(root);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'anchorBatch',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    // Returned rather than only logged: a proof that names an anchor nobody can look up
    // is not independently checkable, which is the whole point of the proof.
    return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
  }

  /**
   * Binds a DNA report fingerprint to a record the caller owns.
   *
   * BOTH HALVES ARE ON CHAIN: the DNA side in `lastAnchor`, the record side in
   * `lastPairedRecord`. Writing only the DNA side published a fingerprint attached to
   * nothing — an observer learned that somebody paired a report, not to which record,
   * and the pairing is the point. The record commitment is returned as well, for
   * convenience only; a return reaches this DApp and not the ledger.
   */
  async pairDna(
    recordCommitment: Uint8Array,
    dnaCommitment: Uint8Array,
  ): Promise<{ recordCommitment: Uint8Array; txHash: string; blockHeight: number }> {
    this.logger?.info('pairing DNA fingerprint');
    const txData = await this.deployedContract.callTx.pairDna(recordCommitment, dnaCommitment);
    this.logger?.trace({
      transactionAdded: { circuit: 'pairDna', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
    });
    return {
      recordCommitment: txData.private.result,
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /** Issues a licence against a record the caller owns. Starts PENDING. */
  async issueLicense(recordCommitment: Uint8Array, licenseCommitment: Uint8Array): Promise<void> {
    this.logger?.info('issuing licence');
    const txData = await this.deployedContract.callTx.issueLicense(recordCommitment, licenseCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'issueLicense',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * The licensee's counter-signature activates a pending licence.
   *
   * The commitment is DERIVED from the licensee's secret and the record it was issued
   * against, not passed in. Taking it as an argument meant the same secret produced
   * the same commitment whoever issued it, so a licence a sniper had registered first
   * under their own record was the same key the licensee countersigned — and the
   * licence went active under the sniper.
   *
   * Activation is also what puts the licence in the tree, so this needs a path to a
   * FREE slot: `LicenseTree.planInsert()`. Advance your local tree only once this
   * resolves, or every path built afterwards is against a root the chain never had.
   */
  async countersignLicense(secret: Uint8Array, recordCommitment: Uint8Array, path: LicensePath): Promise<void> {
    await this.setLicenseWitness(path);
    this.logger?.info('countersigning licence');
    const txData = await this.deployedContract.callTx.countersignLicense(secret, recordCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'countersignLicense',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Only the issuing record owner, or the record they rotated to, can revoke.
   *
   * Clears the map entries AND removes the leaf from the tree. Removing it from the
   * maps alone would leave a revoked licence still presentable, because proveLicense
   * opens the tree rather than the map.
   *
   * `path` must locate the licence's current leaf — `LicenseTree.planRemove()`. A
   * PENDING licence has no leaf, and the circuit skips the tree for one, so any path
   * is accepted in that case.
   */
  async revokeLicense(licenseCommitment: Uint8Array, path: LicensePath): Promise<void> {
    await this.setLicenseWitness(path);
    this.logger?.info('revoking licence');
    const txData = await this.deployedContract.callTx.revokeLicense(licenseCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'revokeLicense',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * A licensee proves they hold a live licence, NAMING NOTHING.
   *
   * The circuit takes no arguments at all: the secret, the record and the position
   * are witnesses, so what reaches the chain is that somebody opened a leaf of the
   * current active-licence tree. Two presentations are byte-identical, including two
   * of different licences from different breeders.
   *
   * What it used to do: derive the commitment and look it up in `licenseStatusOf`. A
   * map lookup puts its key in the public transcript and `licenseRecordOf` maps that
   * key to the issuing record, so every presentation named the breeder and repeated
   * presentations linked to each other.
   *
   * NOT the same as `licenseStatus`, despite the names. That one takes a public
   * commitment by design and therefore links to the issuer; use it for a licence
   * whose identity is already in the open between the parties, and this whenever a
   * holder is showing a stranger that they hold something.
   *
   * `path` comes from `LicenseTree.pathFor()` and must not be published: the position
   * is what would make one presentation linkable to the next.
   */
  async proveLicense(secret: Uint8Array, recordCommitment: Uint8Array, path: LicensePath): Promise<void> {
    await this.setLicenseWitness(path, secret, recordCommitment);
    this.logger?.info('proving licence (zk)');
    const txData = await this.deployedContract.callTx.proveLicense();
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proveLicense',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Propose transferring a licence to a new holder.
   *
   * A licence is not a bearer instrument. The USDA's own plant variety licence template
   * grants a nontransferable licence and permits sublicensing only with the grantor's
   * prior approval — so transfer is a two-party act, and this is only the first half.
   */
  async proposeTransfer(
    secret: Uint8Array,
    recordCommitment: Uint8Array,
    newLicenseCommitment: Uint8Array,
  ): Promise<void> {
    // Derived, not accepted: only the holder of the licence secret may propose
    // assigning it. Taking the commitment as an argument let anyone write into the
    // pending slot, and because insert overwrites, a stranger could replace a proposal
    // the issuer had already agreed to out of band.
    //
    // The incoming party generates their OWN secret and hands over only its
    // commitment, so after approval the licence lives under a key the outgoing party
    // has never seen.
    this.logger?.info('proposing licence transfer');
    const txData = await this.deployedContract.callTx.proposeTransfer(secret, recordCommitment, newLicenseCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proposeTransfer',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * The issuer approves, and the licence moves. Only they can.
   *
   * `expectedNewLicense` is the recipient the issuer actually agreed to, and it is not
   * optional. The circuit compares it against whatever is pending at execution time, so
   * an approval cannot land on a proposal that was replaced between the agreement and
   * the approval. Reading the pending value back from the ledger to fill this in would
   * defeat the check entirely: it has to be the commitment the issuer was shown.
   */
  async approveTransfer(
    licenseCommitment: Uint8Array,
    recordCommitment: Uint8Array,
    expectedNewLicense: Uint8Array,
    path: LicensePath,
  ): Promise<void> {
    // The outgoing leaf is replaced by the incoming one IN PLACE, so the path locates
    // the old licence's current position: `LicenseTree.planReplace()`. The agreement
    // continues, so the slot it occupies continues with it.
    await this.setLicenseWitness(path);
    this.logger?.info('approving licence transfer');
    const txData = await this.deployedContract.callTx.approveTransfer(
      licenseCommitment,
      recordCommitment,
      expectedNewLicense,
    );
    this.logger?.trace({
      transactionAdded: {
        circuit: 'approveTransfer',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Withdraw a proposal that was never approved.
   *
   * Derived, not accepted, for the same reason as proposeTransfer: taking the
   * commitment as an argument let any observer cancel any pending transfer and block
   * a licence from moving indefinitely.
   */
  async withdrawTransfer(secret: Uint8Array, recordCommitment: Uint8Array): Promise<void> {
    this.logger?.info('withdrawing licence transfer');
    const txData = await this.deployedContract.callTx.withdrawTransfer(secret, recordCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'withdrawTransfer',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * The root of the active-licence tree, as the chain currently holds it.
   *
   * A caller keeping a local `LicenseTree` must check this before building a path.
   * The tree is public — anyone replaying the chain arrives at the same one — but a
   * local copy that has missed a transaction produces paths that fold to a root the
   * chain never had, and the call fails after proving and after paying.
   */
  async activeLicenseRoot(): Promise<Uint8Array> {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (contractState === null) throw new Error('the veilcore contract has no state at its address');
    return Veilcore.ledger(contractState.data).activeLicenseRoot;
  }

  /**
   * Merge fields into the private state the witnesses read.
   *
   * Every witness the contract declares has to be present or the Contract cannot be
   * constructed at all, so `createVeilcorePrivateState` fills them and this replaces
   * the ones a particular call needs. Set immediately before the call that reads
   * them.
   */
  private async patchPrivateState(patch: Partial<VeilcorePrivateState>): Promise<void> {
    const current = (await this.providers.privateStateProvider.get(veilcorePrivateStateKey)) as VeilcorePrivateState;
    await this.providers.privateStateProvider.set(veilcorePrivateStateKey, { ...current, ...patch });
  }

  /**
   * Put a licence-tree path, and optionally the licence being presented, in reach of
   * the witnesses.
   *
   * `secret` and `recordCommitment` are only read by proveLicense — the other licence
   * circuits take them as arguments or do not need them, and pass the path alone.
   */
  private async setLicenseWitness(
    path: LicensePath,
    secret?: Uint8Array,
    recordCommitment?: Uint8Array,
  ): Promise<void> {
    await this.patchPrivateState({
      licenseSiblings: path.siblings,
      licenseDirections: path.directions,
      ...(secret === undefined ? {} : { licenseSecret: secret }),
      ...(recordCommitment === undefined ? {} : { licenseRecord: recordCommitment }),
    });
  }

  /**
   * Deploy the contract, naming its maintenance authority.
   *
   * The authority can insert and remove verifier keys, which means it decides
   * which circuits the network will accept calls to. That is not a footnote: a
   * party holding the key can disable any part of this contract, and a registry
   * whose rules can be rewritten by one party is not the neutral thing the
   * format claims to be.
   *
   * Passing `signingKey` is required rather than optional, deliberately. Left
   * unset, `deployContract` samples a key, installs it as the authority and
   * stores it in the private state provider — so a deployment acquires an
   * authority nobody chose, held in a file nobody decided the custody of. That
   * is what happened on preprod.
   *
   * Passing `null` deploys with NO authority: at the ledger level that is an
   * empty committee with a threshold of one, which no signature can satisfy, so
   * the contract is permanently non-upgradable. That is a real option and a
   * one-way door. Circuits are bound to the proof system that compiled them, and
   * when the proving stack breaks compatibility an un-upgradable contract cannot
   * be repaired — only replaced, with every record that names its address left
   * pointing at a contract that can no longer be called.
   *
   * Sealed records still verify either way. Verification is SHA-256 over a
   * canonical serialisation and needs nothing from any chain, so losing the
   * contract degrades anchoring rather than invalidating evidence.
   */
  static async deploy(
    providers: VeilcoreProviders,
    signingKey: SigningKey | null,
    logger?: Logger,
  ): Promise<VeilcoreAPI> {
    // Refuses unless the target network is one where the deployment record is not a
    // gate, or a sufficient revision has been declared as filed. Closed by default:
    // an unknown network, an unset network, a missing revision or a mistyped one all
    // refuse. See api/src/deploy-guard.ts, and test-deploy-guard.mjs for the table.
    assertDeploymentRecordCurrent('veilcore', logger);

    logger?.info(
      signingKey === null
        ? 'deployContract — NO maintenance authority, permanently non-upgradable'
        : 'deployContract — with the maintenance authority supplied',
    );

    const deployedVeilcoreContract = await deployContract(providers, {
      compiledContract: CompiledVeilcore,
      privateStateId: veilcorePrivateStateKey,
      initialPrivateState: createVeilcorePrivateState(utils.randomBytes(32)),
      ...(signingKey === null ? {} : { signingKey }),
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedVeilcoreContract.deployTxData.public,
      },
    });

    return new VeilcoreAPI(deployedVeilcoreContract, providers, logger);
  }

  static async join(
    providers: VeilcoreProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
  ): Promise<VeilcoreAPI> {
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
