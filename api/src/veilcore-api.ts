// The client API for a deployed VeilCore contract.
// SPDX-License-Identifier: Apache-2.0
//
// Every call acts as the holder of the record secret in this client's private state;
// the contract derives the caller from it. Secrets travel to the circuits as witnesses,
// never as arguments, and the ones needed for a single call (a recovery secret, a
// secret being rotated into) are cleared from private state when that call ends,
// whether it succeeded or not.

import { type ContractAddress, type SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { CompiledVeilcore } from '../../contract/src/veilcore';
import { type VeilcorePrivateState, createVeilcorePrivateState } from '../../contract/src/witnesses.js';
import { checkLineage, identityOf, isLive, type LineageReport } from '../../contract/src/verify.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, from, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { assertDeploymentRecordCurrent } from './deploy-guard.js';
import { retireMaintenanceAuthority } from './maintenance.js';
import * as utils from './utils/index.js';
import {
  type VeilcoreProviders,
  type VeilcoreContract,
  type DeployedVeilcoreContract,
  type VeilcoreDerivedState,
  veilcorePrivateStateKey,
} from './veilcore-types.js';

export type TxRef = { readonly txHash: string; readonly blockHeight: number };

/** Seconds between seals, as the contract enforces (SEAL_INTERVAL). */
export const SEAL_INTERVAL_SECONDS = 600;
/** How far behind the chain's clock a seal's claimed time is placed, to absorb clock skew. */
const SEAL_LAG_SECONDS = 60;

/** A verifier's presentation challenge: 32 fresh random bytes, used once, never published. */
export const newPresentationChallenge = (): Uint8Array => utils.randomBytes(32);

const ZERO32 = (): Uint8Array => new Uint8Array(32);

export class VeilcoreAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<VeilcoreDerivedState>;

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
      (ledger, privateState) => {
        const mine = Veilcore.pureCircuits.commit(privateState.geneticSecret);
        return {
          anchorCount: ledger.anchorSeq,
          myCommitment: toHex(mine),
          myIdentity: toHex(identityOf(ledger, mine)),
          iAmAnchored: ledger.recoveryOf.member(identityOf(ledger, mine)),
          iAmLive: isLive(ledger, mine),
        };
      },
    );
  }

  // ─────────────────────────────────────────────────────────── records

  /**
   * Anchor the caller's record. The recovery commitment is fixed now and cannot be
   * added later; build it with pureCircuits.recoveryCommit from a SECOND secret kept
   * offline. Whoever holds that secret controls the record.
   */
  async anchor(recoveryCommitment: Uint8Array): Promise<TxRef> {
    return this.logged('anchor', await this.deployedContract.callTx.anchor(recoveryCommitment));
  }

  /** Prove present possession of the caller's live record. The chain carries it in lastOwnershipProof. */
  async proveOwnership(): Promise<TxRef & { commitment: Uint8Array }> {
    const txData = await this.deployedContract.callTx.proveOwnership();
    return { ...this.logged('proveOwnership', txData), commitment: txData.private.result };
  }

  /** Bind a DNA report fingerprint to the caller's record (lastPairedRecord, lastPairedDna). */
  async pairDna(dnaCommitment: Uint8Array): Promise<TxRef & { recordCommitment: Uint8Array }> {
    const txData = await this.deployedContract.callTx.pairDna(dnaCommitment);
    return { ...this.logged('pairDna', txData), recordCommitment: txData.private.result };
  }

  /** Timestamp a batch root. Unauthenticated by design: inclusion is not possession. */
  async anchorBatch(root: Uint8Array): Promise<TxRef> {
    return this.logged('anchorBatch', await this.deployedContract.callTx.anchorBatch(root));
  }

  /**
   * Move the caller's record to a new secret. The caller must hold the new secret,
   * which the circuit checks. Everything keyed to the identity (licences, parentage,
   * obligations) stays with it. On success this client acts under the new secret.
   */
  async rotateRecordSecret(
    newRecordCommitment: Uint8Array,
    incomingSecret: Uint8Array,
  ): Promise<TxRef & { previousCommitment: Uint8Array }> {
    const txData = await this.withPrivate(
      { incomingGeneticSecret: incomingSecret },
      { incomingGeneticSecret: ZERO32() },
      () => this.deployedContract.callTx.rotateRecordSecret(newRecordCommitment),
    );
    await this.patchPrivateState({ geneticSecret: incomingSecret });
    return { ...this.logged('rotateRecordSecret', txData), previousCommitment: txData.private.result };
  }

  /**
   * Move an identity whose primary secret is lost or stolen, with its recovery secret.
   * `recordCommitment` is the ORIGINAL anchored record. Works even if a thief rotated
   * it since. The recovery secret is cleared from this client when the call ends.
   */
  async recoverRecordSecret(
    recordCommitment: Uint8Array,
    newRecordCommitment: Uint8Array,
    recoverySecret: Uint8Array,
    incomingSecret: Uint8Array,
  ): Promise<TxRef> {
    const txData = await this.withPrivate(
      { recoverySecret, incomingGeneticSecret: incomingSecret },
      { recoverySecret: ZERO32(), incomingGeneticSecret: ZERO32() },
      () => this.deployedContract.callTx.recoverRecordSecret(recordCommitment, newRecordCommitment),
    );
    await this.patchPrivateState({ geneticSecret: incomingSecret });
    return this.logged('recoverRecordSecret', txData);
  }

  /** Replace a recovery commitment that may have leaked, gated by the current recovery secret. */
  async replaceRecoveryCommitment(
    recordCommitment: Uint8Array,
    newRecoveryCommitment: Uint8Array,
    recoverySecret: Uint8Array,
  ): Promise<TxRef> {
    const txData = await this.withPrivate({ recoverySecret }, { recoverySecret: ZERO32() }, () =>
      this.deployedContract.callTx.replaceRecoveryCommitment(recordCommitment, newRecoveryCommitment),
    );
    return this.logged('replaceRecoveryCommitment', txData);
  }

  // ─────────────────────────────────────────────────────────── licences

  /**
   * Issue a licence against the caller's record. `licenseCommitment` is
   * licenseCommit(licenseeSecret, yourRecord), built by the LICENSEE.
   */
  async issueLicense(licenseCommitment: Uint8Array): Promise<TxRef> {
    return this.logged('issueLicense', await this.deployedContract.callTx.issueLicense(licenseCommitment));
  }

  /**
   * The licensee activates a pending licence at a random free leaf index. If another
   * activation takes the same index first, it retries with a new one.
   */
  async countersignLicense(secret: Uint8Array, recordCommitment: Uint8Array): Promise<TxRef> {
    await this.patchPrivateState({ licenseSecret: secret });
    for (let attempt = 1; ; attempt++) {
      const slot = await this.randomFreeLicenseSlot();
      try {
        return this.logged(
          'countersignLicense',
          await this.deployedContract.callTx.countersignLicense(recordCommitment, slot),
        );
      } catch (e) {
        const taken = (await this.currentLedger()).licenseAtSlot.member(slot);
        if (!taken || attempt >= 3) throw e;
        this.logger?.info(`licence slot ${slot} was taken first; retrying with another`);
      }
    }
  }

  /**
   * Revoke a licence issued by the caller's identity (`issuingRecord` may be an earlier
   * commitment of it). The licence is gone at once; paths proved before it stop
   * verifying at the next seal, which this tries to make straight away.
   */
  async revokeLicense(licenseCommitment: Uint8Array, issuingRecord: Uint8Array): Promise<TxRef & SealResult> {
    const ref = this.logged(
      'revokeLicense',
      await this.deployedContract.callTx.revokeLicense(licenseCommitment, issuingRecord),
    );
    return { ...ref, ...(await this.sealRevocations()) };
  }

  /**
   * Prove to one verifier that the caller holds a live licence from `recordCommitment`,
   * answering the verifier's `challenge` (32 random bytes the verifier chose). The chain
   * publishes presentationTag(record, challenge), which only the verifier can recognise.
   */
  async proveLicense(
    secret: Uint8Array,
    recordCommitment: Uint8Array,
    challenge: Uint8Array,
  ): Promise<TxRef & { tag: Uint8Array }> {
    if (challenge.length !== 32) throw new Error('a presentation challenge is exactly 32 bytes');
    const txData = await this.withPrivate(
      { licenseSecret: secret, licenseRecord: recordCommitment, presentationChallenge: challenge },
      { presentationChallenge: ZERO32() },
      () => this.deployedContract.callTx.proveLicense(),
    );
    return {
      ...this.logged('proveLicense', txData),
      tag: Veilcore.pureCircuits.presentationTag(recordCommitment, challenge),
    };
  }

  /** The holder proposes moving the licence to a commitment the incoming party built. */
  async proposeTransfer(
    secret: Uint8Array,
    recordCommitment: Uint8Array,
    newLicenseCommitment: Uint8Array,
  ): Promise<TxRef> {
    await this.patchPrivateState({ licenseSecret: secret });
    return this.logged(
      'proposeTransfer',
      await this.deployedContract.callTx.proposeTransfer(recordCommitment, newLicenseCommitment),
    );
  }

  /**
   * The issuer approves the transfer to `expectedNewLicense`: the commitment it was
   * shown, never one read back from the ledger, or the check means nothing.
   */
  async approveTransfer(
    licenseCommitment: Uint8Array,
    issuingRecord: Uint8Array,
    expectedNewLicense: Uint8Array,
  ): Promise<TxRef & SealResult> {
    const ref = this.logged(
      'approveTransfer',
      await this.deployedContract.callTx.approveTransfer(licenseCommitment, issuingRecord, expectedNewLicense),
    );
    return { ...ref, ...(await this.sealRevocations()) };
  }

  /** The holder withdraws a transfer proposal. */
  async withdrawTransfer(secret: Uint8Array, recordCommitment: Uint8Array): Promise<TxRef> {
    await this.patchPrivateState({ licenseSecret: secret });
    return this.logged('withdrawTransfer', await this.deployedContract.callTx.withdrawTransfer(recordCommitment));
  }

  /**
   * Seal waiting revocations and transfers, if the contract allows it now. Anyone may
   * call it. Returns whether it sealed, and if not, the earliest time it can.
   */
  async sealRevocations(): Promise<SealResult> {
    const ledger = await this.currentLedger();
    if (!ledger.unsealedChanges) return { sealed: false, waiting: false };
    const now = BigInt(Math.floor(Date.now() / 1000) - SEAL_LAG_SECONDS);
    const earliest = ledger.lastSealTime + BigInt(SEAL_INTERVAL_SECONDS);
    if (now < earliest)
      return { sealed: false, waiting: true, sealableAt: Number(earliest + BigInt(SEAL_LAG_SECONDS)) };
    try {
      this.logged('sealRevocations', await this.deployedContract.callTx.sealRevocations(now));
      return { sealed: true, waiting: false };
    } catch (e) {
      // Someone else sealed first, or the clock disagreed: the revocation stands either way.
      this.logger?.info(`seal not made now: ${e instanceof Error ? e.message : String(e)}`);
      return { sealed: false, waiting: (await this.currentLedger()).unsealedChanges };
    }
  }

  // ─────────────────────────────────────────────────────────── lineage

  /** Propose `parentRecord` (any commitment of an anchored identity) as the caller's parent. */
  async proposeParent(parentRecord: Uint8Array): Promise<TxRef> {
    return this.logged('proposeParent', await this.deployedContract.callTx.proposeParent(parentRecord));
  }

  /** As the parent, confirm the child that named the caller. */
  async confirmParent(childRecord: Uint8Array): Promise<TxRef> {
    return this.logged('confirmParent', await this.deployedContract.callTx.confirmParent(childRecord));
  }

  /** Withdraw the caller's own unconfirmed parentage proposal. */
  async withdrawParent(): Promise<TxRef> {
    return this.logged('withdrawParent', await this.deployedContract.callTx.withdrawParent());
  }

  /** As beneficiary, propose an obligation against someone else's record. Binds nobody until accepted. */
  async proposeObligation(record: Uint8Array, obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.logged(
      'proposeObligation',
      await this.deployedContract.callTx.proposeObligation(record, obligationCommitment),
    );
  }

  /** Place an obligation on the caller's own record, in the caller's favour. */
  async encumberOwnRecord(obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.logged('encumberOwnRecord', await this.deployedContract.callTx.encumberOwnRecord(obligationCommitment));
  }

  /** As beneficiary, withdraw a proposal the holder has not accepted. */
  async withdrawObligation(record: Uint8Array, obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.logged(
      'withdrawObligation',
      await this.deployedContract.callTx.withdrawObligation(record, obligationCommitment),
    );
  }

  /** As the record's holder, accept an obligation proposed by `beneficiary`. */
  async acceptObligation(obligationCommitment: Uint8Array, beneficiary: Uint8Array): Promise<TxRef> {
    return this.logged(
      'acceptObligation',
      await this.deployedContract.callTx.acceptObligation(obligationCommitment, beneficiary),
    );
  }

  /** As beneficiary, release an obligation owed to the caller's identity. */
  async discharge(record: Uint8Array, obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.logged('discharge', await this.deployedContract.callTx.discharge(record, obligationCommitment));
  }

  /** Walk a record's confirmed pedigree on chain and report open obligations. */
  async checkLineage(record: Uint8Array): Promise<LineageReport> {
    return checkLineage(await this.currentLedger(), record);
  }

  // ─────────────────────────────────────────────────────────── plumbing

  /** Act as the holder of this record secret from now on (tests, and restoring a client). */
  async actAs(geneticSecret: Uint8Array): Promise<void> {
    await this.patchPrivateState({ geneticSecret });
  }

  /** The chain as this client reads it now. */
  async currentLedger(): Promise<Veilcore.Ledger> {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (contractState === null) throw new Error('the VeilCore contract has no state at its address');
    return Veilcore.ledger(contractState.data);
  }

  /** Give up the maintenance authority permanently. See maintenance.ts. */
  async retireMaintenanceAuthority(): Promise<void> {
    await retireMaintenanceAuthority(
      this.deployedContract,
      this.providers.privateStateProvider,
      this.deployedContractAddress,
      this.logger,
    );
  }

  private async randomFreeLicenseSlot(): Promise<bigint> {
    const taken = (await this.currentLedger()).licenseAtSlot;
    for (let i = 0; i < 64; i++) {
      const [a, b, c] = utils.randomBytes(3);
      const slot = BigInt((a << 16) | (b << 8) | c);
      if (!taken.member(slot)) return slot;
    }
    throw new Error('could not find a free licence slot; the tree is nearly full');
  }

  /** Set private-state fields for one call and reset them afterwards, success or failure. */
  private async withPrivate<T>(
    set: Partial<VeilcorePrivateState>,
    reset: Partial<VeilcorePrivateState>,
    f: () => Promise<T>,
  ): Promise<T> {
    await this.patchPrivateState(set);
    try {
      return await f();
    } finally {
      await this.patchPrivateState(reset);
    }
  }

  private async patchPrivateState(patch: Partial<VeilcorePrivateState>): Promise<void> {
    const current = (await this.providers.privateStateProvider.get(veilcorePrivateStateKey)) as VeilcorePrivateState;
    await this.providers.privateStateProvider.set(veilcorePrivateStateKey, { ...current, ...patch });
  }

  private logged(circuit: string, txData: { public: TxRef }): TxRef {
    const { txHash, blockHeight } = txData.public;
    this.logger?.info({ transactionAdded: { circuit, txHash, blockHeight } });
    return { txHash, blockHeight };
  }

  // ─────────────────────────────────────────────────────────── deploy and join

  /**
   * Deploy the contract. `signingKey` becomes the maintenance authority, which can add
   * and remove verifier keys and so decides which circuits the network accepts. Pass
   * `null` to retire it immediately (maintenance.ts): the contract can then never be
   * changed or repaired, by anyone. Sealed records verify either way, by SHA-256.
   */
  static async deploy(
    providers: VeilcoreProviders,
    signingKey: SigningKey | null,
    logger?: Logger,
  ): Promise<VeilcoreAPI> {
    assertDeploymentRecordCurrent('veilcore', logger);
    const deployed = await deployContract(providers, {
      compiledContract: CompiledVeilcore,
      privateStateId: veilcorePrivateStateKey,
      initialPrivateState: createVeilcorePrivateState(utils.randomBytes(32)),
      ...(signingKey === null ? {} : { signingKey }),
    });
    logger?.info({ contractDeployed: deployed.deployTxData.public });
    const api = new VeilcoreAPI(deployed, providers, logger);
    if (signingKey === null) await api.retireMaintenanceAuthority();
    return api;
  }

  static async join(
    providers: VeilcoreProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
  ): Promise<VeilcoreAPI> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(veilcorePrivateStateKey);
    const deployed = await findDeployedContract<VeilcoreContract>(providers, {
      contractAddress,
      compiledContract: CompiledVeilcore,
      privateStateId: veilcorePrivateStateKey,
      initialPrivateState: existing ?? createVeilcorePrivateState(utils.randomBytes(32)),
    });
    logger?.info({ contractJoined: deployed.deployTxData.public });
    return new VeilcoreAPI(deployed, providers, logger);
  }
}

export type SealResult = {
  /** A seal was made by this call. */
  readonly sealed: boolean;
  /** Revocations or transfers are still waiting for a seal. */
  readonly waiting: boolean;
  /** When waiting, the earliest time (Unix seconds) a seal can be made. */
  readonly sealableAt?: number;
};
