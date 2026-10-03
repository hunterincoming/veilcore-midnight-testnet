// The client API for the VeilCore claims contract (contract/src/veilcore-claims.compact).
// SPDX-License-Identifier: Apache-2.0
//
// A holder proves one fact about a record it sealed with sha256/fields/v1: a value, a
// bound on a number, that two records differ in enough comparable slots, or that a
// correction changed only some slots; optionally on values a laboratory signed. Inputs
// are what the SDK hands a holder: the record's field set and the digest of its committed
// JSON, the published schema document, and a laboratory's key and signature.
//
// Every call's private input (field sets, an opening, the number) goes into private state
// for that call only and is cleared when it ends, whether it succeeded or not. Nothing a
// claim is proved from stays in the store between calls.
//
// The contract is deployed without a maintenance authority that anyone can use: after the
// circuit keys are on chain, the authority is replaced by an empty committee
// (maintenance.ts, retireMaintenanceAuthorityProvably), visible to anyone who reads the
// contract's state. Design and limits: docs/claims-design.md.

import { type ContractAddress, sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type StateValue } from '@midnight-ntwrk/midnight-js-protocol/onchain-runtime';
import { type Logger } from 'pino';
import {
  createCircuitMaintenanceTxInterfaces,
  createUnprovenDeployTx,
  findDeployedContract,
  submitTxAsync,
} from '@midnight-ntwrk/midnight-js-contracts';
import {
  CLAIMS_PROVABLE_CIRCUITS,
  type ClaimInput,
  type ClaimsLedger,
  type ClaimsPrivateState,
  CompiledVeilcoreClaims,
  RangeOp,
  claimsLedger,
  compiledClaimsDeploying,
  emptyClaimsPrivateState,
} from '../../contract/src/claims.js';
import { type AttestationSignature, type JubjubPoint } from '../../contract/src/attest.js';
import { SLOTS, commitmentOf, numberFrom, openSlot, type FieldSet } from '../../contract/src/fields.js';
import { type FieldSchema, fieldSchemaId, schemaTermsOf, slotOf } from '../../contract/src/field-schema.js';
import { type Claim, claimFromCells, disclosedText } from '../../contract/src/verify-claims.js';
import { RECORD_NOT_REQUIRED, resolveNetwork } from './deploy-guard.js';
import { FIRST_FRAGMENT, addMissingKeys, deployInFragments, unknownCircuits } from './deploy-fragments.js';
import { type AuthorityView, isProvablyRetired, retireMaintenanceAuthorityProvably } from './maintenance.js';
import { singleCallState } from './presentation-lookup.js';
import { type TxRef } from './veilcore-api.js';
import {
  type ClaimsContract,
  type ClaimsProviders,
  type DeployedClaimsContract,
  claimsPrivateStateKey,
} from './claims-types.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** A record's field set as the SDK hands it over (veilcore-sdk FieldSet). */
export type SdkFieldSet = {
  readonly schemaId: Uint8Array;
  readonly values: readonly Uint8Array[];
  readonly salts: readonly Uint8Array[];
};

/** What a holder proves from: the field set and the digest of the record's committed JSON. */
export type SealedRecord = {
  readonly fieldSet: SdkFieldSet;
  /** SHA-256 of the canonical JSON of the record's committed fields (SPEC 4.2). */
  readonly jsonDigest: Uint8Array;
};

/** A laboratory's key and its signature on one record's commitment (contract/src/attest.ts). */
export type LabSignature = { readonly key: JubjubPoint; readonly signature: AttestationSignature };

/** One laboratory's key and its signatures on both records of a distinctness claim. */
export type LabPairSignature = {
  readonly key: JubjubPoint;
  readonly first: AttestationSignature;
  readonly second: AttestationSignature;
};

export type RangeDirection = 'at least' | 'at most';

/** A landed claim: where it is, and what it published (read from that call's own state). */
export type ClaimRef = TxRef & { readonly claim: Claim };

/** A claim read back from the chain or from a call's result. */
export type ClaimReading = {
  readonly claim: Claim;
  readonly cells: ClaimsLedger;
  /** The circuit called, when read from the indexer. */
  readonly entryPoint?: string;
};

/** The transaction data a claim call returns (midnight-js FinalizedCallTxData), as far as it is read. */
export type ClaimCallTxData = { readonly public: { readonly nextContractState: Parameters<typeof claimsLedger>[0] } };

const toContractFieldSet = (r: SealedRecord): FieldSet => {
  if (r.fieldSet.values.length !== SLOTS || r.fieldSet.salts.length !== SLOTS)
    throw new Error('A field set has 16 values and 16 salts.');
  if (r.jsonDigest.length !== 32) throw new Error('jsonDigest is 32 bytes.');
  return { values: [...r.fieldSet.values], salts: [...r.fieldSet.salts], jsonDigest: r.jsonDigest };
};

/** The record commitment a field set and JSON digest seal: what claims name and laboratories sign. */
export const recordCommitment = (r: SealedRecord): Uint8Array =>
  commitmentOf(r.fieldSet.schemaId, toContractFieldSet(r));

const checkSlot = (slot: number): void => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) throw new Error('A slot is 0 to 15.');
};

/** The schema document must be the one the record was sealed under: refused before anything is sent. */
const termsFor = (schema: FieldSchema, ...records: SealedRecord[]) => {
  const id = hex(fieldSchemaId(schema));
  for (const r of records)
    if (hex(r.fieldSet.schemaId) !== id)
      throw new Error(
        `That schema document has id ${id}, but the record was sealed under ${hex(r.fieldSet.schemaId)}. Nothing was sent.`,
      );
  return schemaTermsOf(schema);
};

const sameSchema = (a: SealedRecord, b: SealedRecord): void => {
  if (hex(a.fieldSet.schemaId) !== hex(b.fieldSet.schemaId))
    throw new Error('The two records were sealed under different schemas. Nothing was sent.');
};

/** Refuse a claims deploy anywhere but a development network (see deploy). */
export const assertClaimsDeployAllowed = (logger?: Logger): void => {
  const network = resolveNetwork();
  if (network !== null && RECORD_NOT_REQUIRED.has(network)) {
    logger?.info(`veilcore-claims: network ${network}, test deploy allowed`);
    return;
  }
  throw new Error(
    `Refusing to deploy the claims contract on ${network ?? 'an unknown network'}. It is not in a filed deployment ` +
      'record and its keys have no committed fingerprints yet (docs/fingerprints.md covers the main contract). ' +
      'Nothing was made or sent.',
  );
};

export class ClaimsAPI {
  readonly deployedContractAddress: ContractAddress;
  /** Claims made by this client in this run, for disclosure accounting (SPEC 4.5). */
  private readonly made: Claim[] = [];

  private constructor(
    public readonly deployedContract: DeployedClaimsContract,
    private readonly providers: ClaimsProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
  }

  // ─────────────────────────────────────────────────────────── claims

  /** Slot `slot` of the record holds exactly its sealed value. PUBLISHES the value. */
  async proveValue(record: SealedRecord, slot: number): Promise<ClaimRef> {
    checkSlot(slot);
    const fs = toContractFieldSet(record);
    return this.claim('proveValue', { opening: openSlot(fs, slot) }, (c) =>
      c.callTx.proveValue(recordCommitment(record), record.fieldSet.schemaId, BigInt(slot), fs.values[slot]),
    );
  }

  /** The number in `slot` is at least (or at most) `bound`. The number is never published. */
  async proveRange(
    record: SealedRecord,
    schema: FieldSchema,
    slot: number,
    direction: RangeDirection,
    bound: bigint,
  ): Promise<ClaimRef> {
    checkSlot(slot);
    const terms = termsFor(schema, record);
    const fs = toContractFieldSet(record);
    const input: ClaimInput = { opening: openSlot(fs, slot), number: numberOrRefuse(fs.values[slot], slot), terms };
    return this.claim('proveRange', input, (c) =>
      c.callTx.proveRange(recordCommitment(record), record.fieldSet.schemaId, BigInt(slot), op(direction), bound),
    );
  }

  /** The two records differ in at least the schema's k comparable slots. Which, and how many, are never published. */
  async proveDistinct(first: SealedRecord, second: SealedRecord, schema: FieldSchema): Promise<ClaimRef> {
    const terms = termsFor(schema, first, second);
    const input: ClaimInput = { first: toContractFieldSet(first), second: toContractFieldSet(second), terms };
    return this.claim('proveDistinct', input, (c) =>
      c.callTx.proveDistinct(recordCommitment(first), recordCommitment(second)),
    );
  }

  /** `corrected` has the same values as `original` outside the slots in `mayChange`. */
  async proveUnchanged(
    original: SealedRecord,
    corrected: SealedRecord,
    mayChange: readonly boolean[],
  ): Promise<ClaimRef> {
    sameSchema(original, corrected);
    if (mayChange.length !== SLOTS) throw new Error('A mask has 16 slots.');
    const input: ClaimInput = { first: toContractFieldSet(original), second: toContractFieldSet(corrected) };
    return this.claim('proveUnchanged', input, (c) =>
      c.callTx.proveUnchanged(recordCommitment(original), recordCommitment(corrected), original.fieldSet.schemaId, [
        ...mayChange,
      ]),
    );
  }

  /** proveValue, on a record a laboratory signed. Publishes the laboratory's key. */
  async proveAttestedValue(record: SealedRecord, slot: number, lab: LabSignature): Promise<ClaimRef> {
    checkSlot(slot);
    const fs = toContractFieldSet(record);
    const input: ClaimInput = { opening: openSlot(fs, slot), attester: lab.key, signature: lab.signature };
    return this.claim('proveAttestedValue', input, (c) =>
      c.callTx.proveAttestedValue(recordCommitment(record), record.fieldSet.schemaId, BigInt(slot), fs.values[slot]),
    );
  }

  /** proveRange, on a record a laboratory signed. Publishes the laboratory's key. */
  async proveAttestedRange(
    record: SealedRecord,
    schema: FieldSchema,
    slot: number,
    direction: RangeDirection,
    bound: bigint,
    lab: LabSignature,
  ): Promise<ClaimRef> {
    checkSlot(slot);
    const terms = termsFor(schema, record);
    const fs = toContractFieldSet(record);
    const input: ClaimInput = {
      opening: openSlot(fs, slot),
      number: numberOrRefuse(fs.values[slot], slot),
      terms,
      attester: lab.key,
      signature: lab.signature,
    };
    return this.claim('proveAttestedRange', input, (c) =>
      c.callTx.proveAttestedRange(
        recordCommitment(record),
        record.fieldSet.schemaId,
        BigInt(slot),
        op(direction),
        bound,
      ),
    );
  }

  /** proveDistinct, where one laboratory signed both records. Publishes the laboratory's key. */
  async proveAttestedDistinct(
    first: SealedRecord,
    second: SealedRecord,
    schema: FieldSchema,
    lab: LabPairSignature,
  ): Promise<ClaimRef> {
    const terms = termsFor(schema, first, second);
    const input: ClaimInput = {
      first: toContractFieldSet(first),
      second: toContractFieldSet(second),
      terms,
      attester: lab.key,
      signature: lab.first,
      secondSignature: lab.second,
    };
    return this.claim('proveAttestedDistinct', input, (c) =>
      c.callTx.proveAttestedDistinct(recordCommitment(first), recordCommitment(second)),
    );
  }

  /**
   * Read one claim back. Given a transaction id (and the indexer), the transaction must
   * have succeeded and carry exactly one call on this contract, a claim; its cells are
   * the state the indexer recorded for that call. Given a call's own result, its cells
   * are the state that call produced.
   */
  async readClaim(source: string | ClaimCallTxData, indexerUri?: string): Promise<ClaimReading> {
    if (typeof source !== 'string') {
      const cells = claimsLedger(source.public.nextContractState);
      return { claim: claimFromCells(cells), cells };
    }
    if (indexerUri === undefined) throw new Error('Reading a claim by transaction id needs the indexer address.');
    const found = await singleCallState(
      indexerUri,
      this.deployedContractAddress,
      source,
      CLAIMS_PROVABLE_CIRCUITS,
      'That transaction is not a single claim on this claims contract.',
    );
    const cells = claimsLedger(found.state.data);
    return { claim: claimFromCells(cells), cells, entryPoint: found.entryPoint };
  }

  /**
   * What claims this client made in this run already published about a record's slot
   * (SPEC 4.5, disclosure accounting). Claims made elsewhere or earlier are not known
   * here: read them from the chain to be complete.
   */
  disclosedSoFar(record: SealedRecord, slot: number, schema?: FieldSchema): string {
    const c = hex(recordCommitment(record));
    return disclosedText(
      this.made.filter((m) => hex(m.record) === c && m.slot === slot),
      schema === undefined ? undefined : slotOf(schema, slot),
    );
  }

  /** The contract's maintenance authority as the chain shows it now. */
  async authority(): Promise<AuthorityView & { readonly retired: boolean }> {
    return ClaimsAPI.authorityOf(this.providers, this.deployedContractAddress);
  }

  // ─────────────────────────────────────────────────────────── plumbing

  private async claim(
    circuit: string,
    input: ClaimInput,
    call: (c: DeployedClaimsContract) => Promise<{ public: TxRef & { nextContractState: StateValue } }>,
  ): Promise<ClaimRef> {
    await this.providers.privateStateProvider.set(claimsPrivateStateKey, { input });
    let txData;
    try {
      txData = await call(this.deployedContract);
    } finally {
      await this.providers.privateStateProvider.set(claimsPrivateStateKey, emptyClaimsPrivateState());
    }
    const { txId, txHash, blockHeight } = txData.public;
    this.logger?.info({ transactionAdded: { circuit, txHash, blockHeight } });
    const claim = claimFromCells(claimsLedger(txData.public.nextContractState));
    this.made.push(claim);
    return { txId, txHash, blockHeight, claim };
  }

  private static async authorityOf(
    providers: ClaimsProviders,
    address: ContractAddress,
  ): Promise<AuthorityView & { readonly retired: boolean }> {
    const state = await providers.publicDataProvider.queryContractState(address);
    if (state === null || state === undefined) throw new Error(`No claims contract state at ${address}.`);
    const a = state.maintenanceAuthority;
    return { committee: a.committee, threshold: a.threshold, counter: a.counter, retired: isProvablyRetired(a) };
  }

  // ─────────────────────────────────────────────────────────── deploy and join

  /**
   * Deploy a claims contract on a development network (preprod, preview, a local chain),
   * add every circuit key, then retire the maintenance authority provably. On any other
   * network it is refused: the claims contract is not yet in a filed deployment record.
   */
  static async deploy(providers: ClaimsProviders, logger?: Logger, firstFragment = FIRST_FRAGMENT): Promise<ClaimsAPI> {
    assertClaimsDeployAllowed(logger);
    const address = await deployInFragments({
      providers,
      circuits: CLAIMS_PROVABLE_CIRCUITS,
      firstFragment,
      create: (keep) =>
        createUnprovenDeployTx(providers, {
          compiledContract: compiledClaimsDeploying(keep),
          initialPrivateState: emptyClaimsPrivateState(),
          // A key that exists only to add the circuit keys; it is retired, provably, below.
          signingKey: sampleSigningKey(),
        }),
      submit: (unprovenTx) => submitTxAsync(providers, { unprovenTx }),
      store: async (candidate, unsubmitted) => {
        providers.privateStateProvider.setContractAddress(candidate);
        await providers.privateStateProvider.set(
          claimsPrivateStateKey,
          unsubmitted.private.initialPrivateState as ClaimsPrivateState,
        );
        await providers.privateStateProvider.setSigningKey(candidate, unsubmitted.private.signingKey);
      },
      finish: 'Finish a claims deploy',
      logger,
    });
    return ClaimsAPI.finishDeploy(providers, address, logger);
  }

  /**
   * Add the missing circuit keys, check every key on chain, and retire the authority
   * provably. Safe to run again after an interruption. Needs the authority's key in the
   * local store unless the authority is already retired.
   */
  static async finishDeploy(providers: ClaimsProviders, address: ContractAddress, logger?: Logger): Promise<ClaimsAPI> {
    let api: ClaimsAPI;
    try {
      if (!(await ClaimsAPI.authorityOf(providers, address)).retired)
        await ClaimsAPI.addMissingCircuitKeys(providers, address, logger);
      api = await ClaimsAPI.join(providers, address, logger); // checks every key on chain
    } catch (e) {
      logger?.error(
        `The claims contract IS on chain at ${address}, but not every circuit key was added. ` +
          'Do NOT deploy it again. The key that adds them is kept on this computer: run again with the same ' +
          'password and wallet, choose "Finish a claims deploy", and give it this address.',
      );
      throw e;
    }
    try {
      await retireMaintenanceAuthorityProvably(providers, address, logger);
    } catch (e) {
      logger?.error(
        `The claims contract at ${address} has every circuit key, but its maintenance authority is NOT retired yet. ` +
          'Do not use it for claims anyone relies on until it is: choose "Finish a claims deploy" with this address.',
      );
      throw e;
    }
    const a = await api.authority();
    if (!a.retired) throw new Error(`The claims contract at ${address} still shows a maintenance authority.`);
    logger?.info(
      `Claims contract ready at ${address}: all ${CLAIMS_PROVABLE_CIRCUITS.length} circuit keys on chain, ` +
        'maintenance authority an empty committee (nobody can change it).',
    );
    return api;
  }

  /** Add the verifier key of every claims circuit not on chain yet (see addMissingKeys). */
  static async addMissingCircuitKeys(
    providers: ClaimsProviders,
    address: ContractAddress,
    logger?: Logger,
  ): Promise<void> {
    const maintenance = createCircuitMaintenanceTxInterfaces(providers, CompiledVeilcoreClaims, address);
    type Circuit = keyof typeof maintenance;
    await addMissingKeys({
      providers,
      address,
      circuits: CLAIMS_PROVABLE_CIRCUITS,
      insert: async (circuit) =>
        maintenance[circuit as Circuit].insertVerifierKey(
          await providers.zkConfigProvider.getVerifierKey(circuit as Circuit),
        ),
      finish: 'Finish a claims deploy',
      logger,
    });
  }

  /**
   * Join a claims contract. Refused unless every claims circuit's key on chain matches
   * this build and the contract carries no circuit this build does not have. A contract
   * whose authority is not retired is joined with a warning: a verifier should not rely
   * on its claims.
   */
  static async join(providers: ClaimsProviders, contractAddress: ContractAddress, logger?: Logger): Promise<ClaimsAPI> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const deployed = await findDeployedContract<ClaimsContract>(providers, {
      contractAddress,
      compiledContract: CompiledVeilcoreClaims,
      privateStateId: claimsPrivateStateKey,
      initialPrivateState: emptyClaimsPrivateState(),
    });
    const extra = await unknownCircuits(providers, contractAddress, CLAIMS_PROVABLE_CIRCUITS);
    if (extra.length > 0)
      throw new Error(`The contract carries circuits this build does not have: ${extra.join(', ')}. Do not use it.`);
    const api = new ClaimsAPI(deployed, providers, logger);
    const a = await api.authority();
    if (!a.retired)
      logger?.warn(
        `This claims contract still has a maintenance authority (${a.committee.length} key(s), threshold ${a.threshold}): ` +
          'whoever holds it could change what its circuits accept. Do not rely on its claims until it is retired.',
      );
    logger?.info({ claimsContractJoined: deployed.deployTxData.public, authorityRetired: a.retired });
    return api;
  }
}

const op = (d: RangeDirection): RangeOp => (d === 'at most' ? RangeOp.AT_MOST : RangeOp.AT_LEAST);

const numberOrRefuse = (v: Uint8Array, slot: number): bigint => {
  try {
    return numberFrom(v);
  } catch {
    throw new Error(`Slot ${slot} of that record does not hold a number. Nothing was sent.`);
  }
};
