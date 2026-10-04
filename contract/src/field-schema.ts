// Field schemas and typed slot values (SPEC 4.4 and 4.5), as the SDK computes them:
// the canonical JSON of a schema document, its id, the formats comparable text must be
// written in, and sealing typed values ({uint}, {text}, null) into a field set.
//
// This is a copy of veilcore-sdk's src/canonical.ts and src/fields.ts (branch fields-v1),
// in synchronous form, built on ./fields.ts. It exists so the operator tool and the
// claims verifier do not depend on an SDK version that may not have field sets yet; the
// SDK's own conformance vectors (vectors/fields-v1.json: field sets, rejections and
// canonicalisation) keep the two identical. Change one, change both.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  type FieldSet,
  type SchemaTerms,
  SLOTS,
  commitmentOf,
  recordOf,
  numberValue,
  schemaIdOf,
  sealFields,
  setRootOf,
  leavesOf,
} from "./fields.js";

const sha256 = (b: Uint8Array): Uint8Array =>
  new Uint8Array(createHash("sha256").update(b).digest());
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const HEX32 = /^[0-9a-f]{64}$/;

/** 32 bytes from exactly 64 lowercase hex characters; anything else throws. */
export const bytes32 = (text: string, what: string): Uint8Array => {
  if (typeof text !== "string" || !HEX32.test(text))
    throw new Error(`${what} is 64 lowercase hex characters`);
  return new Uint8Array(Buffer.from(text, "hex"));
};

// ─────────────────────────────────────────────── canonical JSON (SPEC 4.4)

/** Sort by Unicode code point, not UTF-16 code unit (an external reviewer's finding). */
const byCodePoint = (a: string, b: string): number => {
  const ai = Array.from(a);
  const bi = Array.from(b);
  const n = Math.min(ai.length, bi.length);
  for (let i = 0; i < n; i++) {
    const x = ai[i].codePointAt(0) as number;
    const y = bi[i].codePointAt(0) as number;
    if (x !== y) return x - y;
  }
  return ai.length - bi.length;
};

const nfc = (s: string): string => s.normalize("NFC");

const num = (n: number): string => {
  if (!Number.isFinite(n))
    throw new Error("non-finite numbers cannot be committed");
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER)
    throw new Error(
      "numbers above 2^53 - 1 in magnitude cannot be committed: use a string (spec 4.4 rule 8)",
    );
  return String(n);
};

const str = (s: string): string => {
  let out = '"';
  for (const ch of nfc(s)) {
    const c = ch.codePointAt(0) as number;
    if (c >= 0xd800 && c <= 0xdfff)
      throw new Error(
        "a string with an unpaired surrogate cannot be committed: it is not valid Unicode (spec 4.4 rule 1)",
      );
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return out + '"';
};

/** The canonical serialisation of a JSON value (SPEC 4.4; RFC 8785 where they overlap). */
export const canonicalise = (value: unknown): string => {
  if (value === null)
    throw new Error(
      "null cannot be committed: omit the field instead (spec 4.4 rule 4)",
    );
  if (value === undefined)
    throw new Error("undefined cannot be committed: omit the field instead");
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return str(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value) as unknown;
    const isPlain =
      proto === Object.prototype ||
      proto === null ||
      Object.keys(value).length > 0;
    if (!isPlain)
      throw new Error(
        "this object cannot be committed: it has no own enumerable properties and would serialise as {}",
      );
    const src = value as Record<string, unknown>;
    const present = Object.keys(src).filter((k) => src[k] !== undefined);
    const seen = new Map<string, string>();
    for (const k of present) {
      const n = nfc(k);
      const prior = seen.get(n);
      if (prior !== undefined && prior !== k)
        throw new Error(
          `keys "${prior}" and "${k}" are identical after Unicode normalisation; the record is invalid (spec 4.4 rule 1)`,
        );
      seen.set(n, k);
    }
    const parts = [...seen.keys()]
      .sort(byCodePoint)
      .map((n) => `${str(n)}:${canonicalise(src[seen.get(n) as string])}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error(`cannot canonicalise ${typeof value}`);
};

// ─────────────────────────────────────────────── schemas (SPEC 4.5)

export type FieldSchemaSlot = {
  slot: number;
  path: string;
  type: "uint" | "text";
  unit?: string;
  scale?: number;
  comparable?: boolean;
  format?: "allele-pair" | "allele" | "code";
};

/** A published field schema document. Other keys are allowed and are part of its id. */
export type FieldSchema = {
  id: string;
  title: string;
  slots: FieldSchemaSlot[];
  k: number;
  [extra: string]: unknown;
};

/** The one way comparable text may be written (SPEC 4.5 table). */
export const FIELD_FORMATS: Record<string, RegExp> = {
  "allele-pair": /^(0|[1-9][0-9]{0,8})\/(0|[1-9][0-9]{0,8})$/,
  allele: /^(0|[1-9][0-9]{0,8})$/,
  code: /^[A-Z0-9][A-Z0-9._-]{0,63}$/,
};

export const checkFormat = (format: string, text: string): void => {
  if (typeof format !== "string" || !Object.hasOwn(FIELD_FORMATS, format))
    throw new Error(`unknown format: ${String(format)}`);
  if (!FIELD_FORMATS[format].test(text))
    throw new Error(`not in ${format} form: ${JSON.stringify(text)}`);
  if (format === "allele-pair") {
    const [a, b] = text.split("/").map(Number);
    if (a > b)
      throw new Error(
        `an allele pair is written smaller first: ${JSON.stringify(text)}`,
      );
  }
};

/** SHA-256 of the schema document's canonical JSON. */
export const schemaDocumentDigest = (schema: FieldSchema): Uint8Array =>
  sha256(new TextEncoder().encode(canonicalise(schema)));

/** Check a schema document and return its comparable and numeric masks. */
export const schemaMasks = (
  schema: FieldSchema,
): { comparable: boolean[]; numeric: boolean[] } => {
  if (!schema || typeof schema !== "object" || !Array.isArray(schema.slots))
    throw new Error("a schema lists its slots");
  if (typeof schema.id !== "string" || schema.id.length === 0)
    throw new Error("a schema has an id");
  if (typeof schema.title !== "string") throw new Error("a schema has a title");
  const comparable = Array.from({ length: SLOTS }, () => false);
  const numeric = Array.from({ length: SLOTS }, () => false);
  const seen = new Set<number>();
  for (const s of schema.slots) {
    if (!s || typeof s !== "object")
      throw new Error("a slot entry is an object");
    if (!Number.isInteger(s.slot) || s.slot < 0 || s.slot >= SLOTS)
      throw new Error(`slot out of range: ${String(s.slot)}`);
    if (seen.has(s.slot)) throw new Error(`slot ${s.slot} is listed twice`);
    seen.add(s.slot);
    if (s.type !== "uint" && s.type !== "text")
      throw new Error(`slot ${s.slot} has an unknown type`);
    if (typeof s.path !== "string" || s.path.length === 0)
      throw new Error(`slot ${s.slot} has no path`);
    if (s.unit !== undefined && typeof s.unit !== "string")
      throw new Error(`slot ${s.slot}: unit is a string`);
    if (s.scale !== undefined && (!Number.isInteger(s.scale) || s.scale < 1))
      throw new Error(`slot ${s.slot}: scale is a positive integer`);
    if (s.comparable !== undefined && typeof s.comparable !== "boolean")
      throw new Error(`slot ${s.slot}: comparable is true or false`);
    if (
      s.format !== undefined &&
      (s.type !== "text" ||
        typeof s.format !== "string" ||
        !Object.hasOwn(FIELD_FORMATS, s.format))
    )
      throw new Error(
        `slot ${s.slot}: format is allele-pair, allele or code, on a text slot`,
      );
    if (s.comparable && s.type === "text" && s.format === undefined)
      throw new Error(
        `slot ${s.slot}: a comparable text slot declares a format`,
      );
    if (s.comparable) comparable[s.slot] = true;
    if (s.type === "uint") numeric[s.slot] = true;
  }
  return { comparable, numeric };
};

/** What the claims contract takes from a schema: its document digest, masks and k. */
export const schemaTermsOf = (schema: FieldSchema): SchemaTerms => {
  const { comparable, numeric } = schemaMasks(schema);
  if (!Number.isInteger(schema.k) || schema.k < 1 || schema.k > SLOTS)
    throw new Error("k is 1 to 16");
  if (comparable.filter(Boolean).length < schema.k)
    throw new Error("k is more than the number of comparable slots");
  return {
    documentDigest: schemaDocumentDigest(schema),
    comparable,
    k: BigInt(schema.k),
    numeric,
  };
};

/** schemaId = H("veilcore:v1:fschema", SHA-256(canonical schema), comparable, count(k), numeric). */
export const fieldSchemaId = (schema: FieldSchema): Uint8Array =>
  schemaIdOf(schemaTermsOf(schema));

/** The schema's description of one slot, or undefined. */
export const slotOf = (
  schema: FieldSchema,
  slot: number,
): FieldSchemaSlot | undefined => schema.slots.find((s) => s.slot === slot);

// ─────────────────────────────────────────────── typed values

/** A slot value as written in a holder's private copy and in the vectors. */
export type TypedSlotValue = { uint: string } | { text: string } | null;

const UNPAIRED =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Turn a typed value into its 32 bytes (SPEC 4.5). */
export const slotValueOf = (v: TypedSlotValue): Uint8Array => {
  if (v === null) return new Uint8Array(32);
  if (typeof v !== "object")
    throw new Error("a slot value is {uint}, {text} or null");
  if (Object.keys(v).length !== 1)
    throw new Error("a slot value has exactly one of uint or text");
  if ("uint" in v) {
    if (typeof v.uint !== "string" || !/^(0|[1-9][0-9]*)$/.test(v.uint))
      throw new Error("uint is a decimal string with no leading zeros");
    return numberValue(BigInt(v.uint)); // refuses 2^64 and above
  }
  if ("text" in v) {
    if (typeof v.text !== "string") throw new Error("text is a string");
    if (UNPAIRED.test(v.text))
      throw new Error("text contains an unpaired surrogate");
    return sha256(new TextEncoder().encode(v.text.normalize("NFC")));
  }
  throw new Error("a slot value is {uint}, {text} or null");
};

/**
 * Each value must match its slot's declared type and format, and a slot the schema does
 * not describe must be empty: otherwise a text hash could sit in a number slot and a
 * range claim would run over it.
 */
export const typedSlotValues = (
  schema: FieldSchema,
  values: readonly TypedSlotValue[],
): Uint8Array[] => {
  schemaMasks(schema);
  const list: readonly TypedSlotValue[] = values;
  if (!Array.isArray(values) || list.length !== SLOTS)
    throw new Error("a field set has 16 slots");
  return list.map((v, i) => {
    if (v !== null && typeof v === "object") {
      const d = slotOf(schema, i);
      const kind = "uint" in v ? "uint" : "text" in v ? "text" : undefined;
      if (d === undefined)
        throw new Error(
          `slot ${i} is not described by the schema, so it must be empty`,
        );
      if (kind !== d.type) throw new Error(`slot ${i} holds ${d.type} values`);
      if (d.format !== undefined)
        checkFormat(d.format, (v as { text: string }).text);
    }
    return slotValueOf(v);
  });
};

/**
 * A holder's private field-set file: the schema document, the 16 typed values, the
 * field secret and the digest of the record's committed JSON (all hex lowercase).
 */
export type FieldSetFile = {
  schema: FieldSchema;
  values: TypedSlotValue[];
  fieldSecret: string;
  jsonDigest: string;
};

export type SealedFieldSet = {
  schemaId: Uint8Array;
  terms: SchemaTerms;
  fieldSet: FieldSet;
  /** fieldSetRoot, as the record's JSON carries it. */
  setRoot: Uint8Array;
  /** The record commitment: what claims name and laboratories sign. */
  commitment: Uint8Array;
};

/** Seal a field-set file. Throws, naming the problem, on anything the SDK would refuse. */
export const sealFieldSetFile = (f: FieldSetFile): SealedFieldSet => {
  if (!f || typeof f !== "object")
    throw new Error("a field-set file is an object");
  const terms = schemaTermsOf(f.schema);
  const schemaId = schemaIdOf(terms);
  const values = typedSlotValues(f.schema, f.values);
  const fieldSet = sealFields(
    values,
    bytes32(f.fieldSecret, "fieldSecret"),
    bytes32(f.jsonDigest, "jsonDigest"),
  );
  return {
    schemaId,
    terms,
    fieldSet,
    setRoot: setRootOf(schemaId, leavesOf(fieldSet)),
    commitment: commitmentOf(schemaId, fieldSet),
  };
};

/** What the conformance vectors compare across implementations. */
export const fieldSetSummary = (input: {
  schema: FieldSchema;
  values: TypedSlotValue[];
  fieldSecret: string;
}): {
  schemaDocumentDigest: string;
  schemaId: string;
  slotValues: string[];
  salts: string[];
  leaves: string[];
  setRoot: string;
} => {
  const s = sealFieldSetFile({ ...input, jsonDigest: "00".repeat(32) });
  return {
    schemaDocumentDigest: hex(s.terms.documentDigest),
    schemaId: hex(s.schemaId),
    slotValues: s.fieldSet.values.map(hex),
    salts: s.fieldSet.salts.map(hex),
    leaves: leavesOf(s.fieldSet).map(hex),
    setRoot: hex(s.setRoot),
  };
};

// ─────────────────────────────────────────────── record JSON (SPEC 4.2, 4.5)

/** The committed fields, exactly and exhaustively (SPEC 4.2). */
const COMMITTED = [
  "attestations",
  "commitmentAlgorithm",
  "extensions",
  "fieldSchema",
  "fieldSetRoot",
  "formatVersion",
  "holder",
  "identification",
  "jurisdictionBindings",
  "parents",
  "profile",
  "profileData",
  "recordId",
  "registrations",
  "sealedAt",
  "subject",
  "subjectType",
  "supersedes",
] as const;
const REQUIRED = [
  "formatVersion",
  "recordId",
  "subjectType",
  "profile",
  "sealedAt",
  "holder",
  "profileData",
] as const;

/**
 * SHA-256 of a sha256/fields/v1 record's committed JSON (SPEC 4.2): the `jsonDigest` its
 * field set is sealed with. Throws on anything the SDK would refuse.
 */
export const committedJsonDigest = (
  env: Record<string, unknown>,
): Uint8Array => {
  for (const k of REQUIRED)
    if (env[k] === undefined) throw new Error(`a record needs ${k}`);
  if (env.commitmentAlgorithm !== "sha256/fields/v1")
    throw new Error(
      `commitmentAlgorithm is ${JSON.stringify(env.commitmentAlgorithm)}, not sha256/fields/v1`,
    );
  if (typeof env.fieldSetRoot !== "string" || !HEX32.test(env.fieldSetRoot))
    throw new Error("fieldSetRoot is not 64 lowercase hex characters");
  if (typeof env.fieldSchema !== "string" || !HEX32.test(env.fieldSchema))
    throw new Error("fieldSchema is not 64 lowercase hex characters");
  const committed: Record<string, unknown> = {};
  for (const k of COMMITTED) committed[k] = env[k];
  if (committed.attestations === undefined) committed.attestations = [];
  if (committed.parents === undefined) committed.parents = [];
  return sha256(new TextEncoder().encode(canonicalise(committed)));
};

/** A sha256/fields/v1 record's commitment (hex), recomputed from its JSON. */
export const fieldRecordCommitment = (env: Record<string, unknown>): string =>
  hex(
    recordOf(
      bytes32(env.fieldSetRoot as string, "fieldSetRoot"),
      committedJsonDigest(env),
    ),
  );
