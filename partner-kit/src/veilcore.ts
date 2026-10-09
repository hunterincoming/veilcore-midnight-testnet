// The partner's client for VeilCore's main contract.
// SPDX-License-Identifier: Apache-2.0
//
// A thin layer over api/src/veilcore-api.ts (the API VeilCore's own tools use), with only
// what a partner does: act as a record holder, a licensee or a beneficiary, and check
// what others show. Deploying, adding circuit keys and the maintenance authority are
// VeilCore's operator work and are not reachable from here: the underlying API object is
// held in a private field, and join never takes the deploy path.

import { type Observable } from 'rxjs';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { identityOf, isLive, type LineageReport } from '../../contract/src/verify.js';
import { type SealResult, type TxRef, VeilcoreAPI } from '../../api/src/veilcore-api.js';
import { type VeilcoreDerivedState, veilcorePrivateStateKey } from '../../api/src/veilcore-types.js';
import { commit } from './commitments.js';
import { type Connection } from './connect.js';
import { type Network, resolveAddress } from './network.js';

export type { SealResult, TxRef };
export type Verdict = { readonly accepted: boolean; readonly reason: string };

/** Who this client acts as, as the chain sees it now. */
export type WhoAmI = {
  /** The record this client's record secret controls. */
  readonly record: Uint8Array;
  /** The identity it belongs to: the record it was anchored as. */
  readonly identity: Uint8Array;
  readonly anchored: boolean;
  /** Whether it is its identity's current head, so it may act. */
  readonly live: boolean;
};

export type JoinOptions = {
  /** The contract's address. Default: pinned on mainnet, known on preprod; required elsewhere. */
  readonly address?: string;
  /**
   * The deploy transaction's id, if the contract's latest action is a verifier-key change
   * and its starting state cannot otherwise be checked (StartingStateUnreachableError).
   */
  readonly deployTxId?: string;
};

export class VeilCore {
  readonly #api: VeilcoreAPI;
  readonly #conn: Connection;

  private constructor(api: VeilcoreAPI, conn: Connection) {
    this.#api = api;
    this.#conn = conn;
  }

  /**
   * Join VeilCore's contract. On mainnet only the address in the deployment record is
   * accepted. Then refused unless every circuit key on chain matches the published
   * fingerprints, no unknown circuit is there, and the contract started from VeilCore's
   * constructor (read from its deploy transaction).
   */
  static async join(conn: Connection, options: JoinOptions = {}): Promise<VeilCore> {
    const address = resolveAddress(conn.network, 'veilcore', options.address);
    const api = await VeilcoreAPI.join(conn.providers.veilcore, address, conn.logger, {
      deployTxId: options.deployTxId,
    });
    return new VeilCore(api, conn);
  }

  get address(): string {
    return this.#api.deployedContractAddress;
  }

  get network(): Network {
    return this.#conn.network;
  }

  /** The ledger and this client's record, as they change. */
  get state$(): Observable<VeilcoreDerivedState> {
    return this.#api.state$;
  }

  /** The contract's ledger now (for checkLineage, identityOf and the other readers). */
  ledger(): Promise<Veilcore.Ledger> {
    return this.#api.currentLedger();
  }

  // ─────────────────────────────────────────────────────────── acting as a record

  /**
   * Act as the holder of `recordSecret` from now on. Refused if the chain shows that
   * secret was rotated or recovered away (it controls nothing). A fresh secret, never
   * anchored, is accepted: anchor it next. Store the secret before using it.
   */
  useRecordSecret(recordSecret: Uint8Array): Promise<{ readonly anchored: boolean }> {
    return this.#api.useRecordSecret(recordSecret);
  }

  /** The record this client acts as, and what the chain says about it. */
  async whoAmI(): Promise<WhoAmI> {
    const ps = await this.#conn.providers.veilcore.privateStateProvider.get(veilcorePrivateStateKey);
    if (ps === null) throw new Error('No record secret yet: call useRecordSecret first.');
    const l = await this.ledger();
    const record = commit.record(ps.geneticSecret);
    const identity = identityOf(l, record);
    return { record, identity, anchored: l.recoveryOf.member(identity), live: isLive(l, record) };
  }

  /**
   * Anchor this client's record. `recoveryCommitment` is commit.recovery(recovery secret),
   * computed on the machine that keeps the recovery secret offline. It is fixed now and
   * cannot be added later. Whoever holds the recovery secret controls the identity.
   */
  anchor(recoveryCommitment: Uint8Array): Promise<TxRef> {
    return this.#api.anchor(recoveryCommitment);
  }

  /**
   * Timestamp a batch root (an SDK buildBatch root, say). Needs no record. Unauthenticated
   * by design: a root on chain says when, not who, and inclusion is not possession.
   */
  anchorBatch(root: Uint8Array): Promise<TxRef> {
    return this.#api.anchorBatch(root);
  }

  /** Bind a DNA report's fingerprint (any non-zero 32 bytes you choose) to this record. */
  pairDna(dnaCommitment: Uint8Array): Promise<TxRef & { readonly recordCommitment: Uint8Array }> {
    return this.#api.pairDna(dnaCommitment);
  }

  /** Answer a verifier's challenge (newChallenge(), from them) with proof of holding this record. Give them the txId. */
  proveOwnership(challenge: Uint8Array): Promise<TxRef & { readonly commitment: Uint8Array }> {
    return this.#api.proveOwnership(challenge);
  }

  // ─────────────────────────────────────────────────────────── keys of your own identity

  /**
   * Move this identity to `newRecordSecret` (store it first). Licences, parentage and
   * obligations stay with the identity. If the call fails after landing, the chain is
   * checked and LandedButUnconfirmedError says so; keep both secrets until whoAmI() shows
   * the new one live.
   */
  rotateRecordSecret(newRecordSecret: Uint8Array): Promise<TxRef & { readonly previousCommitment: Uint8Array }> {
    return this.#api.rotateRecordSecret(commit.record(newRecordSecret), newRecordSecret);
  }

  /**
   * Take an identity back with its recovery secret, whoever holds its current record
   * secret. `originalRecord` is the record it was anchored as. The recovery secret is used
   * up: `newRecoveryCommitment` (commit.recovery of a NEW recovery secret, made offline)
   * replaces it in the same call.
   */
  recoverRecordSecret(args: {
    readonly originalRecord: Uint8Array;
    readonly recoverySecret: Uint8Array;
    readonly newRecordSecret: Uint8Array;
    readonly newRecoveryCommitment: Uint8Array;
  }): Promise<TxRef> {
    return this.#api.recoverRecordSecret(
      args.originalRecord,
      commit.record(args.newRecordSecret),
      args.newRecoveryCommitment,
      args.recoverySecret,
      args.newRecordSecret,
    );
  }

  /** Replace a recovery secret that may have leaked, using it one last time. */
  replaceRecoveryCommitment(args: {
    readonly originalRecord: Uint8Array;
    readonly recoverySecret: Uint8Array;
    readonly newRecoveryCommitment: Uint8Array;
  }): Promise<TxRef> {
    return this.#api.replaceRecoveryCommitment(args.originalRecord, args.newRecoveryCommitment, args.recoverySecret);
  }

  /** Whether `recoverySecret` is the one the chain holds for `record`'s identity. Read-only. */
  recoverySecretIsCurrent(record: Uint8Array, recoverySecret: Uint8Array): Promise<boolean> {
    return this.#api.recoverySecretIsCurrent(record, recoverySecret);
  }

  // ─────────────────────────────────────────────────────────── licences

  /** As issuer: record a licence. `licenseCommitment` is commit.license(their secret, your record), from the licensee. */
  issueLicense(licenseCommitment: Uint8Array): Promise<TxRef> {
    return this.#api.issueLicense(licenseCommitment);
  }

  /**
   * As licensee: the licence commitment to send the issuer, built against the issuer's
   * CURRENT head (any commitment of its identity may be given, its origin included). Use
   * this rather than commit.license with an origin: a licence built against a commitment
   * that is no longer the issuer's head can never be countersigned. Keep the returned
   * `issuerRecord` for countersignLicense, proveLicense and proposeTransfer. Nothing is sent.
   */
  licenseRequest(
    licenseSecret: Uint8Array,
    issuerRecord: Uint8Array,
  ): Promise<{ readonly licenseCommitment: Uint8Array; readonly issuerRecord: Uint8Array }> {
    return this.#api.licenseRequest(licenseSecret, issuerRecord);
  }

  /** As licensee: activate the licence `issuerRecord` issued to commit.license(licenseSecret, issuerRecord). */
  countersignLicense(licenseSecret: Uint8Array, issuerRecord: Uint8Array): Promise<TxRef> {
    return this.#api.countersignLicense(licenseSecret, issuerRecord);
  }

  /**
   * As licensee: prove to one verifier that you hold a live licence from `issuerRecord`,
   * answering their `challenge`. Give them the txId; the chain names neither of you.
   */
  proveLicense(
    licenseSecret: Uint8Array,
    issuerRecord: Uint8Array,
    challenge: Uint8Array,
  ): Promise<TxRef & { readonly tag: Uint8Array }> {
    return this.#api.proveLicense(licenseSecret, issuerRecord, challenge);
  }

  /** As licensee: propose moving the licence to `newLicenseCommitment`, which the incoming party built. */
  proposeTransfer(
    licenseSecret: Uint8Array,
    issuerRecord: Uint8Array,
    newLicenseCommitment: Uint8Array,
  ): Promise<TxRef> {
    return this.#api.proposeTransfer(licenseSecret, issuerRecord, newLicenseCommitment);
  }

  /** As issuer: approve the transfer to `expectedNewLicense`, the commitment you were shown (never one read from the chain). */
  approveTransfer(
    licenseCommitment: Uint8Array,
    issuerRecord: Uint8Array,
    expectedNewLicense: Uint8Array,
  ): Promise<TxRef & SealResult> {
    return this.#api.approveTransfer(licenseCommitment, issuerRecord, expectedNewLicense);
  }

  /** As licensee: withdraw a transfer proposal. */
  withdrawTransfer(licenseSecret: Uint8Array, issuerRecord: Uint8Array): Promise<TxRef> {
    return this.#api.withdrawTransfer(licenseSecret, issuerRecord);
  }

  /**
   * As issuer: revoke. Gone at once; presentations proved earlier stop verifying at the
   * next seal, which this makes straight away when the contract allows (sealableAt otherwise).
   */
  revokeLicense(licenseCommitment: Uint8Array, issuerRecord: Uint8Array): Promise<TxRef & SealResult> {
    return this.#api.revokeLicense(licenseCommitment, issuerRecord);
  }

  /** Seal waiting revocations and transfers, if allowed now (at most once every 600 s). Anyone may. */
  sealRevocations(): Promise<SealResult> {
    return this.#api.sealRevocations();
  }

  // ─────────────────────────────────────────────────────────── lineage and obligations

  /** As the child's holder: name `parentRecord` (any record of an anchored identity) as a parent. */
  proposeParent(parentRecord: Uint8Array): Promise<TxRef> {
    return this.#api.proposeParent(parentRecord);
  }

  /** As the parent's holder: confirm the child that named you. */
  confirmParent(childRecord: Uint8Array): Promise<TxRef> {
    return this.#api.confirmParent(childRecord);
  }

  /** Withdraw your own unconfirmed parentage proposal. */
  withdrawParent(): Promise<TxRef> {
    return this.#api.withdrawParent();
  }

  /** As beneficiary: propose an obligation (commit.obligation(terms, salt)) against `record`. Binds nobody until accepted. */
  proposeObligation(record: Uint8Array, obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.#api.proposeObligation(record, obligationCommitment);
  }

  /** As holder: place an obligation on your own record, in your own favour (a breeder marking a licensed mother). */
  encumberOwnRecord(obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.#api.encumberOwnRecord(obligationCommitment);
  }

  /** As beneficiary: withdraw a proposal the holder has not accepted. */
  withdrawObligation(record: Uint8Array, obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.#api.withdrawObligation(record, obligationCommitment);
  }

  /** As holder: accept an obligation `beneficiary` proposed. It then follows the material down. */
  acceptObligation(obligationCommitment: Uint8Array, beneficiary: Uint8Array): Promise<TxRef> {
    return this.#api.acceptObligation(obligationCommitment, beneficiary);
  }

  /** As holder: decline it. */
  rejectObligation(obligationCommitment: Uint8Array, beneficiary: Uint8Array): Promise<TxRef> {
    return this.#api.rejectObligation(obligationCommitment, beneficiary);
  }

  /** As beneficiary: release an obligation owed to you. Only your identity's current head can. */
  discharge(record: Uint8Array, obligationCommitment: Uint8Array): Promise<TxRef> {
    return this.#api.discharge(record, obligationCommitment);
  }

  /** Walk `record`'s confirmed pedigree on chain and report open obligations (rules 2 to 4). */
  checkLineage(record: Uint8Array, recognisedRoots: readonly Uint8Array[] = []): Promise<LineageReport> {
    return this.#api.checkLineage(record, recognisedRoots);
  }

  // ─────────────────────────────────────────────────────────── as a verifier

  /**
   * Rule 8: check an ownership proof the holder made for your `challenge`, by its txId.
   * Also refused if the proving record is no longer its identity's head.
   */
  checkOwnership(txId: string, record: Uint8Array, challenge: Uint8Array): Promise<Verdict> {
    return this.#api.checkOwnership(this.#conn.endpoints.indexer, txId, record, challenge);
  }

  /**
   * Rule 5: check a licence presentation for your `challenge`, by its txId. `issuedAt`
   * (ms) is when you issued the challenge; also refused when older than an hour.
   */
  checkPresentation(txId: string, issuer: Uint8Array, challenge: Uint8Array, issuedAt?: number): Promise<Verdict> {
    return this.#api.checkPresentation(this.#conn.endpoints.indexer, txId, issuer, challenge, issuedAt);
  }
}
