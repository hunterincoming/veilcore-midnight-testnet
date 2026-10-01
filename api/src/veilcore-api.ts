// The client API for a deployed VeilCore contract.
// SPDX-License-Identifier: Apache-2.0
//
// Every call acts as the holder of the record secret in this client's private state;
// the contract derives the caller from it. Secrets travel to the circuits as witnesses,
// never as arguments, and the ones needed for a single call (a recovery secret, a
// secret being rotated into) are cleared from private state when that call ends,
// whether it succeeded or not.

import { type ContractAddress, type SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { inspect } from 'node:util';
import { type Logger } from 'pino';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { CompiledVeilcore, PROVABLE_CIRCUITS, compiledVeilcoreDeploying } from '../../contract/src/veilcore';
import { type VeilcorePrivateState, createVeilcorePrivateState } from '../../contract/src/witnesses.js';
import {
  acceptOwnership,
  acceptPresentation,
  checkLineage,
  identityOf,
  isLive,
  type LineageReport,
} from '../../contract/src/verify.js';
import {
  createCircuitMaintenanceTxInterfaces,
  deployContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, from, defer, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { assertDeploymentRecordCurrent } from './deploy-guard.js';
import { retireMaintenanceAuthority } from './maintenance.js';
import { callState, presentationState } from './presentation-lookup.js';
import * as utils from './utils/index.js';
import {
  type VeilcoreProviders,
  type VeilcoreContract,
  type DeployedVeilcoreContract,
  type VeilcoreDerivedState,
  veilcorePrivateStateKey,
} from './veilcore-types.js';

/** Circuit keys carried by the deploy transaction itself; the rest follow it. */
export const FIRST_FRAGMENT = 8;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const operationName = (o: string | Uint8Array): string => (typeof o === 'string' ? o : Buffer.from(o).toString('utf8'));

/** The network's refusal of a transaction too big for a block, however it is wrapped. */
const isBlockLimit = (e: unknown): boolean =>
  /block limit|BlockLimitExceeded|ExhaustsResources|\b1010\b/i.test(inspect(e, { depth: 6 }));

/** A landed transaction. Give a verifier `txId`: it finds the state right after it. */
export type TxRef = { readonly txId: string; readonly txHash: string; readonly blockHeight: number };

/** Seconds between seals, as the contract enforces (SEAL_INTERVAL). */
export const SEAL_INTERVAL_SECONDS = 600;
/**
 * How far ahead of the clock a seal's bound is placed. The contract needs the bound
 * ahead of the landing block's time and at most 300 s ahead of it; 200 s covers proving
 * and inclusion time and some clock skew either way.
 */
const SEAL_AHEAD_SECONDS = 200;
/** Margin added to the earliest allowed seal time, for clock skew. */
const SEAL_SKEW_SECONDS = 30;

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
        // Read only when someone subscribes. Reading here, in the constructor, ran the read
        // alongside whatever the caller did next with the store, and the local store opens
        // for one operation at a time ("Database failed to open").
        defer(() => from(providers.privateStateProvider.get(veilcorePrivateStateKey) as Promise<VeilcorePrivateState>)),
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
  /** Prove possession to the verifier who chose `challenge`; give them the returned txId. */
  async proveOwnership(challenge: Uint8Array): Promise<TxRef & { commitment: Uint8Array }> {
    const txData = await this.deployedContract.callTx.proveOwnership(challenge);
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
   *
   * If the call fails, the chain is checked: when the rotation landed and only its
   * confirmation failed, this client switches to the new secret anyway and throws
   * {@link LandedButUnconfirmedError}. Any other error means it was not seen on chain.
   */
  async rotateRecordSecret(
    newRecordCommitment: Uint8Array,
    incomingSecret: Uint8Array,
  ): Promise<TxRef & { previousCommitment: Uint8Array }> {
    const previous = Veilcore.pureCircuits.commit(await this.currentSecret());
    let txData;
    try {
      txData = await this.withPrivate(
        { incomingGeneticSecret: incomingSecret },
        { incomingGeneticSecret: ZERO32() },
        () => this.deployedContract.callTx.rotateRecordSecret(newRecordCommitment),
      );
    } catch (e) {
      await this.adoptIfLanded('rotation', previous, newRecordCommitment, incomingSecret, e);
      throw e;
    }
    await this.patchPrivateState({ geneticSecret: incomingSecret });
    return { ...this.logged('rotateRecordSecret', txData), previousCommitment: txData.private.result };
  }

  /**
   * Move an identity whose primary secret is lost or stolen, with its recovery secret.
   * `recordCommitment` is the ORIGINAL anchored record. Works even if a thief rotated
   * it since. The recovery secret is used up: the same call installs
   * `newRecoveryCommitment`, built from a NEW recovery secret the caller has already
   * stored. The recovery secret is cleared from this client when the call ends.
   * A recovery that landed but could not be confirmed is handled as in rotateRecordSecret.
   */
  async recoverRecordSecret(
    recordCommitment: Uint8Array,
    newRecordCommitment: Uint8Array,
    newRecoveryCommitment: Uint8Array,
    recoverySecret: Uint8Array,
    incomingSecret: Uint8Array,
  ): Promise<TxRef> {
    let txData;
    try {
      txData = await this.withPrivate(
        { recoverySecret, incomingGeneticSecret: incomingSecret },
        { recoverySecret: ZERO32(), incomingGeneticSecret: ZERO32() },
        () =>
          this.deployedContract.callTx.recoverRecordSecret(
            recordCommitment,
            newRecordCommitment,
            newRecoveryCommitment,
          ),
      );
    } catch (e) {
      await this.adoptIfLanded('recovery', recordCommitment, newRecordCommitment, incomingSecret, e);
      throw e;
    }
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
    await this.refuseRevoked(licenseCommitment, 'issue a licence to');
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
        const ledger = await this.currentLedger();
        const key = Veilcore.pureCircuits.licenseKey(
          Veilcore.pureCircuits.licenseCommit(secret, recordCommitment),
          recordCommitment,
        );
        // The call may have landed and only the confirmation failed (an indexer timeout,
        // say). Then the slot is "taken" by this very licence: do not retry into a
        // misleading "not pending", say what happened.
        if (ledger.licenseStatusOf.member(key) && ledger.licenseStatusOf.lookup(key) === Veilcore.LicenseState.ACTIVE) {
          throw new Error(
            `The licence IS active: the countersign landed, only confirming it failed (${String(e instanceof Error ? e.message : e)}).`,
          );
        }
        const taken = ledger.licenseAtSlot.member(slot);
        if (!taken || attempt >= 3) throw e;
        this.logger?.info(`licence slot ${slot} was taken first; retrying with another`);
      }
    }
  }

  /**
   * Revoke a licence issued by the caller's identity (`issuingRecord` may be an earlier
   * commitment of it). The licence is gone at once; paths proved before it stop
   * verifying at the next seal, which this tries to make straight away.
   *
   * The commitment is also remembered in this client's private state, and issueLicense
   * and approveTransfer refuse it from then on: the contract keeps no record of
   * revocations, so without this a revoked licensee could come back through a transfer
   * from another licensee, or through a re-issue made by mistake.
   */
  async revokeLicense(licenseCommitment: Uint8Array, issuingRecord: Uint8Array): Promise<TxRef & SealResult> {
    // Remembered before sending, so even a revocation whose confirmation fails is never
    // undone by re-issuing or approving a transfer to the same commitment from here.
    await this.rememberRevoked(licenseCommitment);
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
    await this.refuseRevoked(expectedNewLicense, 'approve a transfer to');
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
    const now = BigInt(Math.floor(Date.now() / 1000));
    const earliest = ledger.lastSealTime + BigInt(SEAL_INTERVAL_SECONDS + SEAL_SKEW_SECONDS);
    if (now < earliest) return { sealed: false, waiting: true, sealableAt: Number(earliest) };
    try {
      this.logged(
        'sealRevocations',
        await this.deployedContract.callTx.sealRevocations(now + BigInt(SEAL_AHEAD_SECONDS)),
      );
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

  /** As the record's holder, decline an obligation proposed by `beneficiary`. */
  async rejectObligation(obligationCommitment: Uint8Array, beneficiary: Uint8Array): Promise<TxRef> {
    return this.logged(
      'rejectObligation',
      await this.deployedContract.callTx.rejectObligation(obligationCommitment, beneficiary),
    );
  }

  /** As beneficiary, release an obligation owed to the caller's identity. */
  async discharge(record: Uint8Array, obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.logged('discharge', await this.deployedContract.callTx.discharge(record, obligationCommitment));
  }

  /** Walk a record's confirmed pedigree on chain and report open obligations. */
  async checkLineage(record: Uint8Array, recognisedRoots: readonly Uint8Array[] = []): Promise<LineageReport> {
    return checkLineage(await this.currentLedger(), record, recognisedRoots);
  }

  /**
   * As a verifier, check a licence presentation (design.md rule 5). `txId` is what the
   * licensee gave you; it must be a successful proveLicense call on this contract, and
   * the check is made on the state right after it (presentation-lookup.ts).
   */
  /** Rule 8: check an ownership proof the holder made for your challenge. */
  async checkOwnership(
    indexerUri: string,
    txId: string,
    record: Uint8Array,
    challenge: Uint8Array,
  ): Promise<ReturnType<typeof acceptOwnership>> {
    // The state now as well as the state after the proof: if the proving commitment is
    // no longer the head (rotated, or recovered away from a thief), the proof is refused.
    return acceptOwnership(
      await callState(indexerUri, this.deployedContractAddress, txId, 'proveOwnership'),
      record,
      challenge,
      await this.currentLedger(),
    );
  }

  async checkPresentation(
    indexerUri: string,
    txId: string,
    issuer: Uint8Array,
    challenge: Uint8Array,
  ): Promise<ReturnType<typeof acceptPresentation>> {
    return acceptPresentation(
      await presentationState(indexerUri, this.deployedContractAddress, txId),
      issuer,
      challenge,
    );
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
  /**
   * Retire the maintenance authority for good. `currentKey` is the authority's signing key
   * from the deployer's offline copy: deploy removes it from the local store.
   */
  async retireMaintenanceAuthority(currentKey?: SigningKey): Promise<void> {
    if (currentKey === undefined) {
      await retireMaintenanceAuthority(
        this.deployedContract,
        this.providers.privateStateProvider,
        this.deployedContractAddress,
        this.logger,
      );
      return;
    }
    await this.providers.privateStateProvider.setSigningKey(this.deployedContractAddress, currentKey);
    try {
      await retireMaintenanceAuthority(
        this.deployedContract,
        this.providers.privateStateProvider,
        this.deployedContractAddress,
        this.logger,
      );
    } finally {
      // The key was typed in for this one transaction. Whether it landed or not, it does
      // not stay on this machine: the deployer still has the offline copy.
      await this.providers.privateStateProvider.removeSigningKey(this.deployedContractAddress);
    }
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

  /** How long to look for a rotation or recovery on chain after its call failed. */
  landedCheck = { tries: 6, intervalMs: 10_000 };

  private async currentSecret(): Promise<Uint8Array> {
    const s = (await this.providers.privateStateProvider.get(veilcorePrivateStateKey))?.geneticSecret;
    if (s === undefined) throw new Error('No record secret in private state.');
    return s;
  }

  /**
   * After a rotation or recovery call failed: if the chain shows `fromRecord`'s identity
   * now headed by `newRecord`, the call landed and only its confirmation failed. Then act
   * as the new secret (the old one can do nothing any more) and say so. Otherwise
   * return, and the caller rethrows the original error.
   */
  private async adoptIfLanded(
    what: 'rotation' | 'recovery',
    fromRecord: Uint8Array,
    newRecord: Uint8Array,
    newSecret: Uint8Array,
    cause: unknown,
  ): Promise<void> {
    const { tries, intervalMs } = this.landedCheck;
    for (let i = 0; i < tries; i++) {
      if (i > 0) await sleep(intervalMs);
      let ledger: Veilcore.Ledger;
      try {
        ledger = await this.currentLedger();
      } catch {
        continue; // the chain could not be read this time; try again
      }
      const origin = identityOf(ledger, fromRecord);
      if (ledger.headOf.member(origin) && toHex(ledger.headOf.lookup(origin)) === toHex(newRecord)) {
        await this.patchPrivateState({ geneticSecret: newSecret });
        throw new LandedButUnconfirmedError(what, cause);
      }
    }
  }

  private async revokedLicenses(): Promise<readonly string[]> {
    const ps = await this.providers.privateStateProvider.get(veilcorePrivateStateKey);
    return ps?.revokedLicenses ?? [];
  }

  private async rememberRevoked(licenseCommitment: Uint8Array): Promise<void> {
    const known = await this.revokedLicenses();
    const h = toHex(licenseCommitment);
    if (!known.includes(h)) await this.patchPrivateState({ revokedLicenses: [...known, h] });
  }

  private async refuseRevoked(licenseCommitment: Uint8Array, action: string): Promise<void> {
    if ((await this.revokedLicenses()).includes(toHex(licenseCommitment))) {
      throw new RevokedLicenceError(
        `Refused: you revoked licence ${toHex(licenseCommitment)} before. Nothing was sent. ` +
          `It cannot be used to ${action} again; the licensee makes a new licence secret (option 7) if you agree to license them again.`,
      );
    }
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
    const { txId, txHash, blockHeight } = txData.public;
    this.logger?.info({ transactionAdded: { circuit, txHash, blockHeight } });
    return { txId, txHash, blockHeight };
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
    firstFragment = FIRST_FRAGMENT,
  ): Promise<VeilcoreAPI> {
    assertDeploymentRecordCurrent('veilcore', logger);
    // The network refuses a deploy carrying a verifier key for every circuit ("exceeded
    // block limit"). Deploy with the first `size` keys, halving on that refusal, then add
    // the rest one maintenance transaction each. The authority's key, which those
    // transactions need, stays in the local store until every key is on chain.
    let size = Math.min(Math.max(1, firstFragment), PROVABLE_CIRCUITS.length);
    let address: ContractAddress;
    for (;;) {
      const keep = PROVABLE_CIRCUITS.slice(0, size);
      try {
        const deployed = await deployContract(providers, {
          compiledContract: compiledVeilcoreDeploying(keep),
          privateStateId: veilcorePrivateStateKey,
          initialPrivateState: createVeilcorePrivateState(utils.randomBytes(32)),
          ...(signingKey === null ? {} : { signingKey }),
        });
        address = deployed.deployTxData.public.contractAddress;
        logger?.info({ contractDeployed: deployed.deployTxData.public, circuitKeysInDeploy: keep.length });
        break;
      } catch (e) {
        if (size > 1 && isBlockLimit(e)) {
          size = Math.ceil(size / 2);
          logger?.info(`the deploy was over the block limit; trying again with ${size} circuit keys in it`);
          continue;
        }
        throw e;
      }
    }
    await VeilcoreAPI.addMissingCircuitKeys(providers, address, logger);
    const api = await VeilcoreAPI.join(providers, address, logger); // checks every key on chain
    if (signingKey === null) await api.retireMaintenanceAuthority();
    // midnight-js keeps the authority's signing key in the local private-state store.
    // The deployer was shown it before deploying and holds it offline; it should not
    // also sit on this machine. To use it later: privateStateProvider.setSigningKey.
    await providers.privateStateProvider.removeSigningKey(address);
    return api;
  }

  /**
   * Add the verifier key of every circuit the contract does not have on chain yet, one
   * maintenance transaction each. Safe to run again after an interruption: it reads
   * what is on chain first. Needs the maintenance authority's key in the local store.
   */
  static async addMissingCircuitKeys(
    providers: VeilcoreProviders,
    address: ContractAddress,
    logger?: Logger,
  ): Promise<void> {
    const onChain = async (): Promise<Set<string>> => {
      for (let i = 0; i < 30; i++) {
        const state = await providers.publicDataProvider.queryContractState(address);
        if (state !== null && state !== undefined) return new Set(state.operations().map(operationName));
        await sleep(2_000);
      }
      throw new Error(`The indexer has no contract at ${address}.`);
    };
    const present = await onChain();
    const todo = PROVABLE_CIRCUITS.filter((c) => !present.has(c));
    const maintenance = createCircuitMaintenanceTxInterfaces(providers, CompiledVeilcore, address);
    type Circuit = keyof typeof maintenance;
    for (const [i, circuit] of todo.entries()) {
      logger?.info(`adding circuit key ${i + 1} of ${todo.length}: ${circuit}`);
      const vk = await providers.zkConfigProvider.getVerifierKey(circuit as Circuit);
      try {
        await maintenance[circuit as Circuit].insertVerifierKey(vk);
      } catch (e) {
        // It may have landed with only the confirmation failing; the chain decides.
        if (!(await onChain()).has(circuit)) throw e;
      }
      // The next insert signs over the authority's counter as the indexer reports it, so
      // wait until the indexer shows this one before building the next.
      for (let tries = 0; !(await onChain()).has(circuit); tries++) {
        if (tries >= 30) throw new Error(`The indexer never showed the key for ${circuit}.`);
        await sleep(2_000);
      }
    }
    logger?.info(`all ${PROVABLE_CIRCUITS.length} circuit keys are on chain`);
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
    // findDeployedContract checks every circuit in this build has its key on chain. Also
    // refuse a contract carrying a circuit this build does not know: one the maintenance
    // authority added would otherwise pass silently.
    const onChain =
      (await providers.publicDataProvider.queryContractState(contractAddress))?.operations().map(operationName) ?? [];
    const extra = onChain.filter((c) => !PROVABLE_CIRCUITS.includes(c));
    if (extra.length > 0) {
      throw new Error(`The contract carries circuits this build does not have: ${extra.join(', ')}. Do not use it.`);
    }
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

/**
 * A rotation or recovery that the chain shows as done, though confirming it failed. This
 * client already acts as the new secret; the secrets shown before sending are the real ones.
 */
export class LandedButUnconfirmedError extends Error {
  constructor(
    readonly what: 'rotation' | 'recovery',
    cause: unknown,
  ) {
    super(`The ${what} DID land on chain; only confirming it failed. This client now uses the new record secret.`, {
      cause,
    });
    this.name = 'LandedButUnconfirmedError';
  }
}

/** issueLicense or approveTransfer named a licence commitment this client revoked before. */
export class RevokedLicenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevokedLicenceError';
  }
}
