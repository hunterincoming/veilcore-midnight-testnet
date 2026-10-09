// The partner's client for VeilCore's claims contract, and sealing a record's fields.
// SPDX-License-Identifier: Apache-2.0
//
// A holder proves one fact about a record sealed with sha256/fields/v1 (SPEC 4.5): a
// value, a bound on a number, that two records differ, or that a correction changed
// only some slots; a laboratory's signature on a record is its own claim. A thin layer
// over api/src/claims-api.ts without its deploy path, which is VeilCore's operator work.

import {
  ClaimsAPI,
  type ClaimReading,
  type ClaimRef,
  type LabSignature,
  type RangeDirection,
  type SealedRecord,
} from '../../api/src/claims-api.js';
import { type FieldSchema, type FieldSetFile, sealFieldSetFile } from '../../contract/src/field-schema.js';
import { type Connection } from './connect.js';
import { type Network, resolveAddress } from './network.js';

export type { ClaimReading, ClaimRef, LabSignature, RangeDirection, SealedRecord };

/** A record's field set, sealed: what claims are proved from, and what a laboratory signs. */
export type SealedFields = {
  /** What ClaimsAPI and VeilCoreClaims take. Private: it holds the values and their salts. */
  readonly record: SealedRecord;
  /** The record commitment: what claims name and laboratories sign. Public. */
  readonly commitment: Uint8Array;
  /** The schema id the values were sealed under. Public. */
  readonly schemaId: Uint8Array;
  /** The field-set root the record's JSON carries (fieldSetRoot). Public. */
  readonly setRoot: Uint8Array;
};

/**
 * Seal a holder's private field-set file exactly as the SDK does (veilcore-records 0.15,
 * sealFieldSet; the same 100 vectors): types, formats, the present-marker on numbers, NFC
 * text. Throws, naming the problem, on anything the SDK would refuse. Keep the file and
 * the result private: the values and the field secret are what the claims keep hidden.
 */
export const sealFields = (file: FieldSetFile): SealedFields => {
  const s = sealFieldSetFile(file);
  return {
    record: {
      fieldSet: { schemaId: s.schemaId, values: s.fieldSet.values, salts: s.fieldSet.salts },
      jsonDigest: s.fieldSet.jsonDigest,
    },
    commitment: s.commitment,
    schemaId: s.schemaId,
    setRoot: s.setRoot,
  };
};

export class VeilCoreClaims {
  readonly #api: ClaimsAPI;
  readonly #conn: Connection;

  private constructor(api: ClaimsAPI, conn: Connection) {
    this.#api = api;
    this.#conn = conn;
  }

  /**
   * Join VeilCore's claims contract. On mainnet only the address in the deployment record
   * is accepted. Refused unless every claims circuit's key on chain matches the published
   * fingerprints and no unknown circuit is there. A contract whose maintenance authority
   * is not retired is joined with a warning; check authority().retired before relying on it.
   */
  static async join(conn: Connection, options: { readonly address?: string } = {}): Promise<VeilCoreClaims> {
    const address = resolveAddress(conn.network, 'claims', options.address);
    return new VeilCoreClaims(await ClaimsAPI.join(conn.providers.claims, address, conn.logger), conn);
  }

  get address(): string {
    return this.#api.deployedContractAddress;
  }

  get network(): Network {
    return this.#conn.network;
  }

  /** Slot `slot` holds exactly its sealed value. PUBLISHES the value. */
  proveValue(record: SealedRecord, slot: number): Promise<ClaimRef> {
    return this.#api.proveValue(record, slot);
  }

  /** The number in `slot` is at least (or at most) `bound`, in the schema's stored units. The number stays hidden. */
  proveRange(
    record: SealedRecord,
    schema: FieldSchema,
    slot: number,
    direction: RangeDirection,
    bound: bigint,
  ): Promise<ClaimRef> {
    return this.#api.proveRange(record, schema, slot, direction, bound);
  }

  /** The two records differ in at least the schema's k comparable slots. Which, and how many, stay hidden. */
  proveDistinct(first: SealedRecord, second: SealedRecord, schema: FieldSchema): Promise<ClaimRef> {
    return this.#api.proveDistinct(first, second, schema);
  }

  /** `corrected` has the same values as `original` outside the slots marked in `mayChange` (16 booleans). */
  proveUnchanged(original: SealedRecord, corrected: SealedRecord, mayChange: readonly boolean[]): Promise<ClaimRef> {
    return this.#api.proveUnchanged(original, corrected, mayChange);
  }

  /** A laboratory signed this record (signRecord). Publishes the record commitment and the laboratory's key. */
  proveAttested(record: SealedRecord, lab: LabSignature): Promise<ClaimRef> {
    return this.#api.proveAttested(record, lab);
  }

  /** Read one claim back by its transaction id, as a verifier would (or use readClaim, which needs no wallet). */
  readClaim(txId: string): Promise<ClaimReading> {
    return this.#api.readClaim(txId, this.#conn.endpoints.indexer);
  }

  /** What claims made by this client in this run already published about a slot (SPEC 4.5, disclosure accounting). */
  disclosedSoFar(record: SealedRecord, slot: number, schema?: FieldSchema): string {
    return this.#api.disclosedSoFar(record, slot, schema);
  }

  /** The contract's maintenance authority as the chain shows it. `retired`: nobody can change the circuits. */
  authority(): ReturnType<ClaimsAPI['authority']> {
    return this.#api.authority();
  }
}
