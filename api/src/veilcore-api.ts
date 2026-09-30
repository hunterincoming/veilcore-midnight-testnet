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
import { retireMaintenanceAuthority } from './maintenance.js';
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

/** An API for a deployed veilcore contract. */
export interface DeployedVeilcoreAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<VeilcoreDerivedState>;

  /** Anchors the CALLER's own record, derived from their secret. */
  anchor: (recoveryCommitment: Uint8Array) => Promise<void>;
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
  ) => Promise<{ txHash: string; blockHeight: number }>;
  replaceRecoveryCommitment: (
    recordCommitment: Uint8Array,
    newRecoveryCommitment: Uint8Array,
    recoverySecret: Uint8Array,
  ) => Promise<void>;
  anchorBatch: (root: Uint8Array) => Promise<{ txHash: string; blockHeight: number }>;
  pairDna: (
    dnaCommitment: Uint8Array,
  ) => Promise<{ recordCommitment: Uint8Array; txHash: string; blockHeight: number }>;
  issueLicense: (licenseCommitment: Uint8Array) => Promise<void>;
  countersignLicense: (secret: Uint8Array, recordCommitment: Uint8Array) => Promise<void>;
  revokeLicense: (licenseCommitment: Uint8Array, issuingRecord: Uint8Array) => Promise<void>;
  proveLicense: (
    secret: Uint8Array,
    recordCommitment: Uint8Array,
    challenge: Uint8Array,
  ) => Promise<{ tag: Uint8Array; txHash: string; blockHeight: number }>;
  proposeTransfer: (
    secret: Uint8Array,
    recordCommitment: Uint8Array,
    newLicenseCommitment: Uint8Array,
  ) => Promise<void>;
  approveTransfer: (
    licenseCommitment: Uint8Array,
    issuingRecord: Uint8Array,
    expectedNewLicense: Uint8Array,
  ) => Promise<void>;
  withdrawTransfer: (secret: Uint8Array, recordCommitment: Uint8Array) => Promise<void>;
}

/** A verifier's presentation challenge: 32 fresh random bytes, used once, never published. */
export const newPresentationChallenge = (): Uint8Array => utils.randomBytes(32);

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
  async anchor(recoveryCommitment: Uint8Array): Promise<void> {
    // THE RECOVERY COMMITMENT IS FIXED AT ANCHOR TIME and cannot be added later: by
    // the time a holder knows they need one they no longer hold the secret that would
    // authorise adding it. Anchoring without one is a choice to make the record
    // unrecoverable. Build it with pureCircuits.recoveryCommit from a SECOND secret
    // kept apart from the first, ideally offline: the recovery secret overrides the
    // primary, including against a thief who has rotated the record.
    //
    // The record anchored is always the caller's own, derived from their secret.
    this.logger?.info('anchoring your record');
    const txData = await this.deployedContract.callTx.anchor(recoveryCommitment);
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
    // The chain has retired the old secret, so this client must stop using it: every
    // later call derives the caller's record from `geneticSecret`, and left on the old
    // one each of them would be refused as "rotated".
    await this.patchPrivateState({ geneticSecret: incomingSecret });
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
   * Works even if the record has been rotated since, including by someone who stole
   * the primary secret: recovery retires whatever the current head is. `recordCommitment`
   * is the ORIGINAL anchored record, not the latest head.
   */
  async recoverRecordSecret(
    recordCommitment: Uint8Array,
    newRecordCommitment: Uint8Array,
    recoverySecret: Uint8Array,
    incomingSecret: Uint8Array,
  ): Promise<{ txHash: string; blockHeight: number }> {
    await this.patchPrivateState({ recoverySecret, incomingGeneticSecret: incomingSecret });
    this.logger?.info('recovering record with the recovery secret');
    const txData = await this.deployedContract.callTx.recoverRecordSecret(recordCommitment, newRecordCommitment);
    // Move onto the new secret, and drop the recovery secret: it is the master key and
    // belongs offline, not in a client's private state.
    await this.patchPrivateState({ geneticSecret: incomingSecret, recoverySecret: new Uint8Array(32) });
    this.logger?.trace({
      transactionAdded: {
        circuit: 'recoverRecordSecret',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    // Recovery does not read (or return) the head it retires: reading it is what let a
    // thief who rotated again make recovery fail. The chain records the origin and the
    // new head (lastRecoveredOrigin, lastRotatedTo).
    return { txHash: txData.public.txHash, blockHeight: txData.public.blockHeight };
  }

  /**
   * Replace the recovery commitment on an anchored record, gated by the CURRENT
   * recovery secret. Use it when the recovery secret may have leaked: whoever holds
   * it controls the record.
   */
  async replaceRecoveryCommitment(
    recordCommitment: Uint8Array,
    newRecoveryCommitment: Uint8Array,
    recoverySecret: Uint8Array,
  ): Promise<void> {
    await this.patchPrivateState({ recoverySecret });
    this.logger?.info('replacing the recovery commitment');
    const txData = await this.deployedContract.callTx.replaceRecoveryCommitment(
      recordCommitment,
      newRecoveryCommitment,
    );
    // The recovery secret is only needed for this call; do not leave it in private state.
    await this.patchPrivateState({ recoverySecret: new Uint8Array(32) });
    this.logger?.trace({
      transactionAdded: {
        circuit: 'replaceRecoveryCommitment',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
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
    dnaCommitment: Uint8Array,
  ): Promise<{ recordCommitment: Uint8Array; txHash: string; blockHeight: number }> {
    this.logger?.info('pairing DNA fingerprint to your record');
    const txData = await this.deployedContract.callTx.pairDna(dnaCommitment);
    this.logger?.trace({
      transactionAdded: { circuit: 'pairDna', txHash: txData.public.txHash, blockHeight: txData.public.blockHeight },
    });
    return {
      recordCommitment: txData.private.result,
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
  }

  /**
   * Issues a licence against the caller's own live record. Starts PENDING.
   * `licenseCommitment` must be licenseCommit(licenseeSecret, yourRecord), built by the
   * LICENSEE; you should never hold their secret.
   */
  async issueLicense(licenseCommitment: Uint8Array): Promise<void> {
    this.logger?.info('issuing licence');
    const txData = await this.deployedContract.callTx.issueLicense(licenseCommitment);
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
   * Activation also places the licence in the ledger's tree. No path is needed: the
   * ledger places the leaf itself.
   */
  async countersignLicense(secret: Uint8Array, recordCommitment: Uint8Array): Promise<void> {
    // The secret travels as a WITNESS, never as a circuit argument.
    await this.patchPrivateState({ licenseSecret: secret });
    this.logger?.info('countersigning licence');
    const txData = await this.deployedContract.callTx.countersignLicense(recordCommitment);
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
   * No path: the ledger clears the leaf itself, so a revocation cannot be starved by
   * other tree traffic. A PENDING licence has no leaf, and the circuit skips the tree for one, so nothing
   * is accepted in that case.
   */
  async revokeLicense(licenseCommitment: Uint8Array, issuingRecord: Uint8Array): Promise<void> {
    // `issuingRecord` is the record the licence was issued under. After a rotation it
    // is not the caller's current record; the circuit checks they are one identity.
    this.logger?.info('revoking licence');
    const txData = await this.deployedContract.callTx.revokeLicense(licenseCommitment, issuingRecord);
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
   * The path is found by the licensePath witness in the ledger at proving time and is
   * never published: the position
   * is what would make one presentation linkable to the next.
   */
  async proveLicense(
    secret: Uint8Array,
    recordCommitment: Uint8Array,
    challenge: Uint8Array,
  ): Promise<{ tag: Uint8Array; txHash: string; blockHeight: number }> {
    // SINCE 30 SEP: a presentation is bound to the issuing record and to a challenge
    // the VERIFIER chose. It publishes presentationTag(record, challenge); the verifier
    // recomputes that and looks for it in this transaction. The challenge must be 32
    // random bytes from the verifier (see newPresentationChallenge) and must never be
    // published or reused, or anyone can test each issuing record against the tag.
    if (challenge.length !== 32) throw new Error('a presentation challenge is exactly 32 bytes');
    await this.patchPrivateState({
      licenseSecret: secret,
      licenseRecord: recordCommitment,
      presentationChallenge: challenge,
    });
    this.logger?.info('proving licence (zk)');
    const txData = await this.deployedContract.callTx.proveLicense();
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proveLicense',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    return {
      tag: Veilcore.pureCircuits.presentationTag(recordCommitment, challenge),
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
    };
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
    await this.patchPrivateState({ licenseSecret: secret });
    this.logger?.info('proposing licence transfer');
    const txData = await this.deployedContract.callTx.proposeTransfer(recordCommitment, newLicenseCommitment);
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
    issuingRecord: Uint8Array,
    expectedNewLicense: Uint8Array,
  ): Promise<void> {
    // The outgoing leaf is replaced by the incoming one IN PLACE, by the ledger; no
    // path is needed. The agreement
    // continues, so the slot it occupies continues with it.
    this.logger?.info('approving licence transfer');
    const txData = await this.deployedContract.callTx.approveTransfer(
      licenseCommitment,
      issuingRecord,
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
    await this.patchPrivateState({ licenseSecret: secret });
    this.logger?.info('withdrawing licence transfer');
    const txData = await this.deployedContract.callTx.withdrawTransfer(recordCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'withdrawTransfer',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
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
        ? 'deployContract — then retiring the maintenance authority (see maintenance.ts)'
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

    const api = new VeilcoreAPI(deployedVeilcoreContract, providers, logger);
    // `null` used to mean "omit the key", which midnight-js turns into a randomly
    // sampled authority saved locally. Retire it so null means what it says.
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
