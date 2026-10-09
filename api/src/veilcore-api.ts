// The client API for a deployed VeilCore contract.
// SPDX-License-Identifier: Apache-2.0
//
// Every call acts as the holder of the record secret in this client's private state;
// the contract derives the caller from it. Secrets travel to the circuits as witnesses,
// never as arguments, and the ones needed for a single call (a recovery secret, a
// secret being rotated into) are cleared from private state when that call ends,
// whether it succeeded or not. Clearing a value is not the same as it never reaching
// disk: the CLI wraps its store so these, and the maintenance key, are kept in memory
// only (memory-overlays.ts, round D).

import {
  type ContractAddress,
  sampleSigningKey,
  type SigningKey,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { CompiledVeilcore, PROVABLE_CIRCUITS, compiledVeilcoreDeploying } from '../../contract/src/veilcore';
import { type VeilcorePrivateState, createVeilcorePrivateState } from '../../contract/src/witnesses.js';
import {
  acceptOwnership,
  acceptPresentationAt,
  checkLineage,
  identityOf,
  isLive,
  type LineageReport,
} from '../../contract/src/verify.js';
import {
  createCircuitMaintenanceTxInterfaces,
  createUnprovenDeployTx,
  findDeployedContract,
  submitTxAsync,
} from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, from, defer, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { assertDeploymentRecordCurrent, assertJoinAllowed, resolveNetwork } from './deploy-guard.js';
import { FIRST_FRAGMENT, addMissingKeys, deployInFragments, unknownCircuits } from './deploy-fragments.js';
import { retireMaintenanceAuthorityProvably } from './maintenance.js';
import { type LookupCheck, callState, presentationWithTime } from './presentation-lookup.js';
import {
  type AuthorityReport,
  ContractStateMismatchError,
  checkContractState,
  pinnedVerifierKeys,
} from './state-check.js';
import { checkStartingState } from './starting-state.js';
import * as utils from './utils/index.js';
import {
  type VeilcoreProviders,
  type VeilcoreContract,
  type DeployedVeilcoreContract,
  type VeilcoreDerivedState,
  veilcorePrivateStateKey,
} from './veilcore-types.js';

// The deploy helpers live in deploy-fragments.ts, shared with the claims contract.
export { FIRST_FRAGMENT, isBlockLimit, isStaleDustTime, nodeRefusal } from './deploy-fragments.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

  /**
   * Replace a recovery commitment that may have leaked, gated by the current recovery secret.
   *
   * If the call fails, the chain is checked as for a rotation (round D, D-3): when two
   * reads at least `landedCheck.confirmGapMs` apart both show `newRecoveryCommitment`
   * installed, it landed and only its confirmation failed, and this throws
   * {@link RecoveryReplacedButUnconfirmedError}. Any other error means it was not seen on
   * chain, which is not the same as "it did not land": keep both recovery secrets until
   * {@link recoverySecretIsCurrent} says which one the chain holds.
   */
  async replaceRecoveryCommitment(
    recordCommitment: Uint8Array,
    newRecoveryCommitment: Uint8Array,
    recoverySecret: Uint8Array,
  ): Promise<TxRef> {
    let txData;
    try {
      txData = await this.withPrivate({ recoverySecret }, { recoverySecret: ZERO32() }, () =>
        this.deployedContract.callTx.replaceRecoveryCommitment(recordCommitment, newRecoveryCommitment),
      );
    } catch (e) {
      const shows = async (): Promise<boolean | undefined> => {
        try {
          const l = await this.currentLedger();
          const origin = identityOf(l, recordCommitment);
          return l.recoveryOf.member(origin) && toHex(l.recoveryOf.lookup(origin)) === toHex(newRecoveryCommitment);
        } catch {
          return undefined; // the chain could not be read this time
        }
      };
      if (await this.seenTwice(shows)) throw new RecoveryReplacedButUnconfirmedError(e);
      throw e;
    }
    return this.logged('replaceRecoveryCommitment', txData);
  }

  /**
   * Whether `recoverySecret` is the one the chain holds for `record`'s identity now.
   * Read-only: nothing is sent, and the secret is only hashed here.
   */
  async recoverySecretIsCurrent(record: Uint8Array, recoverySecret: Uint8Array): Promise<boolean> {
    const l = await this.currentLedger();
    const origin = identityOf(l, record);
    return (
      l.recoveryOf.member(origin) &&
      toHex(l.recoveryOf.lookup(origin)) === toHex(Veilcore.pureCircuits.recoveryCommit(recoverySecret))
    );
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
   * revocations, so without this the same revoked commitment could come back through a
   * transfer from another licensee, or through a re-issue made by mistake. It only stops
   * that exact commitment: a revoked licensee who makes a new licence secret gets a
   * commitment the issuer cannot link to them, so an issuer must still know who it is
   * approving (design.md, known limits).
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
    // Also when only activations changed the tree: a seal then clears the root history
    // the tree keeps, so it does not grow with every activation (state bounds).
    if (!ledger.unsealedChanges && !ledger.rootsSinceSeal) return { sealed: false, waiting: false };
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
      const after = await this.currentLedger();
      return { sealed: false, waiting: after.unsealedChanges || after.rootsSinceSeal };
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
   * Rule 8: check an ownership proof the holder made for your challenge. On mainnet the
   * state at the proof and the state now must both carry the pinned build's verifier keys
   * (state-check.ts); `check` adds a second indexer or a required authority counter.
   */
  async checkOwnership(
    indexerUri: string,
    txId: string,
    record: Uint8Array,
    challenge: Uint8Array,
    check: LookupCheck = {},
  ): Promise<ReturnType<typeof acceptOwnership> & { readonly authority?: AuthorityReport }> {
    const req = this.lookupCheck(check);
    let after: Veilcore.Ledger;
    try {
      after = await callState(indexerUri, this.deployedContractAddress, txId, 'proveOwnership', undefined, req);
    } catch (e) {
      if (e instanceof ContractStateMismatchError)
        return { accepted: false, reason: e.message, authority: e.authority };
      throw e;
    }
    // The state now as well as the state after the proof: if the proving commitment is
    // no longer the head (rotated, or recovered away from a thief), the proof is refused.
    const v = acceptOwnership(after, record, challenge, await this.currentLedger());
    // Where keys are pinned (mainnet), the current state must carry them too; its
    // maintenance authority is reported with the verdict.
    if (req.verifierKeys === undefined && req.authorityCounter === undefined) return v;
    const nowState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (nowState === null) throw new Error('the VeilCore contract has no state at its address');
    try {
      return { ...v, authority: checkContractState(nowState, req, 'the current state').authority };
    } catch (e) {
      if (e instanceof ContractStateMismatchError)
        return { accepted: false, reason: e.message, authority: e.authority };
      throw e;
    }
  }

  /**
   * As a verifier, check a licence presentation (design.md rule 5). `txId` is what the
   * licensee gave you; it must be a successful proveLicense call on this contract, and
   * the check is made on the state right after it (presentation-lookup.ts).
   *
   * `issuedAt` is when the verifier issued `challenge` (its challenge book). The
   * presentation is also refused when the indexer gives no time for it, when it landed
   * before the challenge was issued, or when it is older than MAX_PRESENTATION_AGE_MS
   * (verify.ts, acceptPresentationAt): it shows the licence was live when presented, not now.
   * On mainnet the state must carry the pinned build's verifier keys; the maintenance
   * authority at that transaction comes back with the verdict.
   */
  async checkPresentation(
    indexerUri: string,
    txId: string,
    issuer: Uint8Array,
    challenge: Uint8Array,
    issuedAt?: number,
    check: LookupCheck = {},
  ): Promise<ReturnType<typeof acceptPresentationAt> & { readonly authority?: AuthorityReport }> {
    let found: Awaited<ReturnType<typeof presentationWithTime>>;
    try {
      found = await presentationWithTime(
        indexerUri,
        this.deployedContractAddress,
        txId,
        undefined,
        this.lookupCheck(check),
      );
    } catch (e) {
      if (e instanceof ContractStateMismatchError)
        return { accepted: false, reason: e.message, authority: e.authority };
      throw e;
    }
    const v = acceptPresentationAt(found.ledger, issuer, challenge, {
      landedAt: found.blockTime,
      blockHeight: found.blockHeight,
      issuedAt,
    });
    return { ...v, authority: found.authority };
  }

  /**
   * What a verification lookup requires here: on mainnet, the pinned build's verifier
   * keys, always (a caller cannot turn that off); elsewhere, whatever the caller asks.
   */
  private lookupCheck(check: LookupCheck): LookupCheck {
    if (resolveNetwork() !== 'mainnet') return check;
    return { ...check, verifierKeys: check.verifierKeys ?? pinnedVerifierKeys('veilcore') };
  }

  // ─────────────────────────────────────────────────────────── plumbing

  /** Act as the holder of this record secret from now on (tests, and restoring a client). */
  async actAs(geneticSecret: Uint8Array): Promise<void> {
    await this.patchPrivateState({ geneticSecret });
  }

  /**
   * Act as `geneticSecret` from now on, if the chain shows it can act: its commitment is
   * its identity's current head, or is not anchored at all (a fresh secret). A secret that
   * was rotated or recovered away controls nothing and is refused; nothing changes then.
   * This is the way back after a rotation or recovery the client adopted on the strength
   * of the indexer (round D, D-4), and the way to restore a client from a paper copy.
   */
  async useRecordSecret(geneticSecret: Uint8Array): Promise<{ readonly anchored: boolean }> {
    const l = await this.currentLedger();
    const mine = Veilcore.pureCircuits.commit(geneticSecret);
    if (!isLive(l, mine)) {
      throw new Error(
        'That record secret is not the current one of its identity (it was rotated or recovered away), so it ' +
          'controls nothing. This client still acts as before.',
      );
    }
    await this.actAs(geneticSecret);
    return { anchored: l.recoveryOf.member(identityOf(l, mine)) };
  }

  /** The chain as this client reads it now. */
  async currentLedger(): Promise<Veilcore.Ledger> {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (contractState === null) throw new Error('the VeilCore contract has no state at its address');
    return Veilcore.ledger(contractState.data);
  }

  /**
   * Retire the maintenance authority for good, PROVABLY: it is replaced with an empty
   * committee (threshold 1), which no key can satisfy and anyone reading the contract can
   * see (maintenance.ts, the path the claims contract uses). No replacement key is made,
   * so none is stored anywhere. `currentKey` is the authority's signing key from the
   * deployer's paper copy; without it, the key must already be in the provider (deploy).
   * Either way it is removed from the provider when this ends, landed or not.
   */
  async retireMaintenanceAuthority(currentKey?: SigningKey): Promise<void> {
    const store = this.providers.privateStateProvider;
    if (currentKey !== undefined) await store.setSigningKey(this.deployedContractAddress, currentKey);
    try {
      await retireMaintenanceAuthorityProvably(this.providers as never, this.deployedContractAddress, this.logger);
    } finally {
      await store.removeSigningKey(this.deployedContractAddress);
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

  /**
   * How long to look for a rotation, recovery or recovery replacement on chain after its
   * call failed. A change is believed only when two reads at least `confirmGapMs` apart
   * both show it (round D, D-4: one read of a lagging or forked indexer is not enough).
   */
  landedCheck: { tries: number; intervalMs: number; confirmGapMs?: number } = {
    tries: 6,
    intervalMs: 10_000,
    confirmGapMs: 30_000,
  };

  /** True when `shows` says yes twice, `confirmGapMs` apart, within `tries` attempts. */
  private async seenTwice(shows: () => Promise<boolean | undefined>): Promise<boolean> {
    const { tries, intervalMs, confirmGapMs = 30_000 } = this.landedCheck;
    for (let i = 0; i < tries; i++) {
      if (i > 0) await sleep(intervalMs);
      if ((await shows()) !== true) continue;
      await sleep(confirmGapMs);
      if ((await shows()) === true) return true;
      this.logger?.warn('Two reads of the chain disagreed about whether the change landed; reading again.');
    }
    return false;
  }

  private async currentSecret(): Promise<Uint8Array> {
    const s = (await this.providers.privateStateProvider.get(veilcorePrivateStateKey))?.geneticSecret;
    if (s === undefined) throw new Error('No record secret in private state.');
    return s;
  }

  /**
   * After a rotation or recovery call failed: if two reads of the chain, apart, both show
   * `fromRecord`'s identity now headed by `newRecord`, the call landed and only its
   * confirmation failed. Then act as the new secret and say so. The old secret is not
   * forgotten by the operator: the indexer could still be wrong, and useRecordSecret
   * goes back to it if the chain later shows it is still the head. Otherwise return, and
   * the caller rethrows the original error.
   */
  private async adoptIfLanded(
    what: 'rotation' | 'recovery',
    fromRecord: Uint8Array,
    newRecord: Uint8Array,
    newSecret: Uint8Array,
    cause: unknown,
  ): Promise<void> {
    const shows = async (): Promise<boolean | undefined> => {
      let ledger: Veilcore.Ledger;
      try {
        ledger = await this.currentLedger();
      } catch {
        return undefined; // the chain could not be read this time; try again
      }
      const origin = identityOf(ledger, fromRecord);
      return ledger.headOf.member(origin) && toHex(ledger.headOf.lookup(origin)) === toHex(newRecord);
    };
    if (await this.seenTwice(shows)) {
      await this.patchPrivateState({ geneticSecret: newSecret });
      throw new LandedButUnconfirmedError(what, cause);
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
   * `null`, or `retire: true`, to retire it provably once every key is on (maintenance.ts):
   * the contract can then never be changed or repaired, by anyone. Sealed records verify
   * either way, by SHA-256. With `null` the key is random and exists only in this process,
   * so a deploy that stops partway cannot be finished: the CLI always passes a key the
   * operator wrote on paper.
   */
  static async deploy(
    providers: VeilcoreProviders,
    signingKey: SigningKey | null,
    logger?: Logger,
    firstFragment = FIRST_FRAGMENT,
    options: { readonly retire?: boolean } = {},
  ): Promise<VeilcoreAPI> {
    const retire = options.retire ?? signingKey === null;
    assertDeploymentRecordCurrent('veilcore', logger);
    // The confirmed deploy is the last transaction submitted (a refused one is retried at a
    // new address). Its id lets join read the deploy itself (starting-state.ts).
    let deployTxId: string | undefined;
    const address = await deployInFragments({
      providers,
      circuits: PROVABLE_CIRCUITS,
      firstFragment,
      create: (keep) =>
        createUnprovenDeployTx(providers, {
          compiledContract: compiledVeilcoreDeploying(keep),
          initialPrivateState: createVeilcorePrivateState(utils.randomBytes(32)),
          signingKey: signingKey ?? sampleSigningKey(),
        }),
      submit: async (unprovenTx) => (deployTxId = await submitTxAsync(providers, { unprovenTx })),
      store: async (candidate, unsubmitted) => {
        providers.privateStateProvider.setContractAddress(candidate);
        await providers.privateStateProvider.set(
          veilcorePrivateStateKey,
          unsubmitted.private.initialPrivateState as VeilcorePrivateState,
        );
        await providers.privateStateProvider.setSigningKey(candidate, unsubmitted.private.signingKey);
      },
      finish: 'Finish a deploy',
      keyOnPaper: true,
      logger,
    });
    logger?.info(
      `Deploy transaction id: ${deployTxId}. Keep it with the contract address: on a network with no pinned ` +
        'address, a verifier may be asked for it to check how the contract started.',
    );
    let api: VeilcoreAPI;
    try {
      await VeilcoreAPI.addMissingCircuitKeys(providers, address, logger);
      // Checks every key on chain, and the starting state, read from the deploy transaction
      // itself. Not the mainnet address pin: this IS the deploy that makes the address the
      // record will name.
      api = await VeilcoreAPI.join(providers, address, logger, { deploying: true, deployTxId });
    } catch (e) {
      // The contract exists from here on. Deploying again would make a second one.
      logger?.error(
        `The contract IS on chain at ${address}, but not every circuit key was added. ` +
          'Do NOT choose Deploy again. Run again with the same password and wallet, choose "Finish a deploy", ' +
          'give it this address, and type the maintenance key from your paper when it asks.',
      );
      throw e;
    }
    if (retire) await api.retireMaintenanceAuthority();
    // midnight-js keeps the authority's signing key in the private-state provider. The
    // deployer was shown it before deploying and holds it on paper; it should not stay
    // here. (The CLI's provider holds signing keys in memory only, so it never reached
    // disk; this clears the memory copy too.)
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
    const maintenance = createCircuitMaintenanceTxInterfaces(providers, CompiledVeilcore, address);
    type Circuit = keyof typeof maintenance;
    await addMissingKeys({
      providers,
      address,
      circuits: PROVABLE_CIRCUITS,
      insert: async (circuit) =>
        maintenance[circuit as Circuit].insertVerifierKey(
          await providers.zkConfigProvider.getVerifierKey(circuit as Circuit),
        ),
      finish: 'Finish a deploy',
      logger,
    });
  }

  /**
   * Join the contract at `contractAddress`. Refused, before anything is read, on a
   * network that pins VeilCore's address (mainnet: deploy-guard.ts) when this is another
   * address; `deploying` skips only that pin, for a deploy and "Finish a deploy", which
   * work on an address their own deploy made. Then refused unless every circuit of this
   * build has its key on chain, no unknown circuit is there, and the contract STARTED from
   * this build's constructor, checked from its deploy transaction (starting-state.ts:
   * found by `deployTxId` when given, else through the indexer's latest action).
   * Throws StartingStateUnreachableError, never a forgery verdict, when the deploy cannot
   * be reached and nothing else settles it; join again with `deployTxId` then.
   */
  static async join(
    providers: VeilcoreProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
    options: { readonly deploying?: boolean; readonly deployTxId?: string } = {},
  ): Promise<VeilcoreAPI> {
    const pinned = options.deploying !== true && assertJoinAllowed(contractAddress, logger) === 'pinned';
    // Checked before anything is written for this address. Matching keys show the code,
    // not the contract: anyone can deploy this build with a forged starting ledger.
    await checkStartingState({
      publicDataProvider: providers.publicDataProvider,
      address: contractAddress,
      deployTxId: options.deployTxId,
      pinned,
      logger,
    });
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
    const extra = await unknownCircuits(providers, contractAddress, PROVABLE_CIRCUITS);
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
    super(
      `The chain shows the ${what} DID land (two reads agree); only confirming it failed. This client now uses the ` +
        'new record secret. Keep BOTH record secrets, the old and the new, until option 31 shows "Current: yes".',
      { cause },
    );
    this.name = 'LandedButUnconfirmedError';
  }
}

/**
 * A recovery-secret replacement the chain shows as done (two reads agree), though
 * confirming it failed. Only the NEW recovery secret works now.
 */
export class RecoveryReplacedButUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super(
      'The chain shows the recovery secret WAS replaced (two reads agree); only confirming it failed. ' +
        'Only the NEW recovery secret works now.',
      { cause },
    );
    this.name = 'RecoveryReplacedButUnconfirmedError';
  }
}

/** issueLicense or approveTransfer named a licence commitment this client revoked before. */
export class RevokedLicenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevokedLicenceError';
  }
}
