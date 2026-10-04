// Field sets (SPEC 4.5, commitment algorithm `sha256/fields/v1`), computed with plain
// SHA-256 so that nothing here depends on Midnight tooling. A leaf is one SHA-256 block
// and the root is one hash over the 16 leaves, so the claims contract's proofs stay small
// enough to make on an ordinary computer (docs/claims-design.md, "Size"). The claims contract
// recomputes the same values in-circuit; contract/src/test/claims.test.ts checks that
// the two agree.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";

export const SLOTS = 16;
const ZERO = new Uint8Array(32);

const tag = (t: string): Uint8Array => {
  const b = new Uint8Array(32);
  const e = new TextEncoder().encode(t);
  if (e.length > 32) throw new Error(`tag too long: ${t}`);
  b.set(e);
  return b;
};

/** SHA-256 over 32-byte elements: Compact's persistentHash over Vector<n, Bytes<32>>. */
export const h = (...parts: Uint8Array[]): Uint8Array => {
  const s = createHash("sha256");
  for (const p of parts) {
    if (p.length !== 32) throw new Error("every element is 32 bytes");
    s.update(p);
  }
  return new Uint8Array(s.digest());
};

const sha256 = (b: Uint8Array): Uint8Array =>
  new Uint8Array(createHash("sha256").update(b).digest());

/** A count or mask as 32 bytes, little-endian (schema ids, masks, salt indexes). */
export const countValue = (n: bigint): Uint8Array => {
  if (n < 0n || n >= 1n << 64n) throw new Error("a count is 0 to 2^64-1");
  const b = new Uint8Array(32);
  let v = n;
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
};

/**
 * An unsigned 64-bit number as a slot value: little-endian in bytes 0-7, byte 8 set to 1
 * to mark it present, so the number 0 is never the same as an absent slot.
 */
export const numberValue = (n: bigint): Uint8Array => {
  const b = countValue(n);
  b[8] = 1;
  return b;
};

/** A text value as a slot value: SHA-256 of its UTF-8. Never all zeros in practice. */
export const digestValue = (text: string): Uint8Array =>
  sha256(new TextEncoder().encode(text.normalize("NFC")));

/** An absent value. Never counts as a difference. */
export const ABSENT = ZERO;

/** A 16-slot mask as a number (slot i is bit i), little-endian in 32 bytes. */
export const maskValue = (mask: readonly boolean[]): Uint8Array => {
  if (mask.length !== SLOTS) throw new Error("a mask has 16 slots");
  let n = 0n;
  mask.forEach((b, i) => {
    if (b) n |= 1n << BigInt(i);
  });
  return countValue(n);
};

export type SchemaTerms = {
  readonly documentDigest: Uint8Array;
  readonly comparable: boolean[];
  readonly k: bigint;
  /** Slots declared `uint`: the only ones a range claim may open. */
  readonly numeric: boolean[];
};

/**
 * The schema's terms in one 32-byte element: the comparable mask in bytes 0-1 and the
 * numeric mask in bytes 2-3 (slot i is bit i, little-endian), k in byte 4, the rest zero.
 */
export const termsValue = (t: SchemaTerms): Uint8Array => {
  if (t.k < 0n || t.k > 255n) throw new Error("k is 0 to 255");
  const c = maskValue(t.comparable);
  const n = maskValue(t.numeric);
  const b = new Uint8Array(32);
  b.set(c.subarray(0, 2), 0);
  b.set(n.subarray(0, 2), 2);
  b[4] = Number(t.k);
  return b;
};

export const schemaIdOf = (t: SchemaTerms): Uint8Array =>
  h(tag("veilcore:v1:fschema"), t.documentDigest, termsValue(t));

/** A slot's salt: the first 23 bytes of H(fsalt, fieldSecret, count(slot)). */
export const SALT_BYTES = 23;
export const saltOf = (fieldSecret: Uint8Array, slot: number): Uint8Array =>
  h(tag("veilcore:v1:fsalt"), fieldSecret, countValue(BigInt(slot))).slice(
    0,
    SALT_BYTES,
  );

/** leaf = SHA-256(value || salt): 55 bytes, one SHA-256 block. */
export const leafOf = (value: Uint8Array, salt: Uint8Array): Uint8Array => {
  if (value.length !== 32) throw new Error("a slot value is 32 bytes");
  if (salt.length !== SALT_BYTES) throw new Error("a salt is 23 bytes");
  const b = new Uint8Array(55);
  b.set(value);
  b.set(salt, 32);
  return sha256(b);
};

const SET_TAG = new TextEncoder().encode("veilcore:v1:fset"); // exactly 16 bytes

/** fieldSetRoot = SHA-256("veilcore:v1:fset" || schemaId || the 16 leaves): 560 bytes. */
export const setRootOf = (
  schemaId: Uint8Array,
  leaves: readonly Uint8Array[],
): Uint8Array => {
  if (leaves.length !== SLOTS) throw new Error("a field set has 16 leaves");
  const b = new Uint8Array(16 + 32 + 32 * SLOTS);
  b.set(SET_TAG);
  b.set(schemaId, 16);
  leaves.forEach((l, i) => b.set(l, 48 + 32 * i));
  return sha256(b);
};

export const recordOf = (
  setRoot: Uint8Array,
  jsonDigest: Uint8Array,
): Uint8Array => h(tag("veilcore:v1:frecord"), setRoot, jsonDigest);

/** The private half of a record's field set, as the claims contract's witnesses take it. */
export type FieldSet = {
  values: Uint8Array[];
  salts: Uint8Array[];
  jsonDigest: Uint8Array;
};

export const sealFields = (
  values: readonly Uint8Array[],
  fieldSecret: Uint8Array,
  jsonDigest: Uint8Array,
): FieldSet => {
  if (values.length !== SLOTS) throw new Error("a field set has 16 slots");
  values.forEach((v) => {
    if (v.length !== 32) throw new Error("every slot value is 32 bytes");
  });
  return {
    values: values.map((v) => new Uint8Array(v)),
    salts: values.map((_, i) => saltOf(fieldSecret, i)),
    jsonDigest: new Uint8Array(jsonDigest),
  };
};

/** The 16 leaves. Each reveals nothing about its value without its salt. */
export const leavesOf = (fs: FieldSet): Uint8Array[] =>
  fs.values.map((v, i) => leafOf(v, fs.salts[i]));

/** The record commitment of a field set under a schema. */
export const commitmentOf = (schemaId: Uint8Array, fs: FieldSet): Uint8Array =>
  recordOf(setRootOf(schemaId, leavesOf(fs)), fs.jsonDigest);

/**
 * One slot, opened: its value and salt, and all 16 leaves (the other 15 are salted
 * hashes and disclose nothing about their values).
 */
export type SlotOpening = {
  value: Uint8Array;
  salt: Uint8Array;
  leaves: Uint8Array[];
  jsonDigest: Uint8Array;
};

export const openSlot = (fs: FieldSet, slot: number): SlotOpening => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS)
    throw new Error("slot is 0 to 15");
  return {
    value: fs.values[slot],
    salt: fs.salts[slot],
    leaves: leavesOf(fs),
    jsonDigest: fs.jsonDigest,
  };
};

/** Read a uint slot value back as a number, refusing anything that is not one. */
export const numberFrom = (v: Uint8Array): bigint => {
  if (v.length !== 32 || v[8] !== 1 || v.subarray(9).some((x) => x !== 0))
    throw new Error("not a uint slot value");
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(v[i]);
  return n;
};
