// Bound DNA pairings: date the report, not the account.
// SPDX-License-Identifier: Apache-2.0
//
// The live contract's pairDna publishes whatever non-zero 32 bytes it is given, next to
// the caller's record. Pairing the raw SHA-256 of a report publishes that hash: anyone
// watching can copy it, even from a transaction still waiting to land, and pair it to a
// record of their own first. So "which pairing came first" says nothing about who had the
// report first.
//
// The client pairs a BINDING instead (design.md, Hashes):
//
//   binding = H("veilcore:v1:dnapair", reportHash, identity, salt)
//
// over four 32-byte elements, the same layout as the contract's own commitments
// (persistentHash<Vector<4, Bytes<32>>>, like obligationKey):
//   - reportHash: SHA-256 of the report file;
//   - identity:   the identity (origin) of the record that pairs it, so it holds across
//                 rotations and recoveries;
//   - salt:       32 random bytes the holder keeps with the report.
//
// What that gives:
//   - the binding says nothing about the report: without the salt nobody can test a guess;
//   - a copied binding is worthless: it verifies only for the identity inside it, and a
//     copier who paired it under their own record cannot show a report and salt that
//     produce it for theirs;
//   - to bind a report to their own identity, a copier needs the report hash itself, which
//     stays private until the holder shows it. Anything paired after that is dated after.
// So the date of a bound pairing is when that identity's holder had the report. It is not
// who controls the record now: a record can change hands by key rotation (a control proof,
// rule 8, answers that separately). Nor does it show nobody else had the report: the lab
// that wrote it had it too.
//
// Nothing here changes the contract: a binding is just the 32 bytes pairDna is given.

import { createHash } from "node:crypto";

/** The tag of a bound pairing: right-padded with zero bytes to 32, as the contract's tags. */
export const DNA_PAIR_TAG = "veilcore:v1:dnapair";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

const bytes32 = (b: Uint8Array, what: string): Uint8Array => {
  if (!(b instanceof Uint8Array) || b.length !== 32)
    throw new Error(`${what} is 32 bytes.`);
  return b;
};

/** A tag as the contract writes it: pad(32, tag), UTF-8 right-padded with zero bytes. */
export const tag32 = (tag: string): Uint8Array => {
  const t = Buffer.alloc(32);
  if (Buffer.byteLength(tag, "utf8") > 32)
    throw new Error("A tag is at most 32 bytes.");
  t.write(tag, "utf8");
  return new Uint8Array(t);
};

/** SHA-256 over 32-byte elements: Compact's persistentHash<Vector<n, Bytes<32>>>. */
export const taggedHash = (tag: string, ...inputs: Uint8Array[]): Uint8Array =>
  new Uint8Array(
    createHash("sha256")
      .update(
        Buffer.concat([
          tag32(tag),
          ...inputs.map((x, i) => bytes32(x, `Input ${i + 1}`)),
        ]),
      )
      .digest(),
  );

/** The SHA-256 of a report file, as it is paired. */
export const reportHashOf = (report: Uint8Array): Uint8Array =>
  new Uint8Array(createHash("sha256").update(report).digest());

/**
 * The value a bound pairing publishes (pairDna's argument):
 * H("veilcore:v1:dnapair", reportHash, identity, salt).
 */
export const dnaPairBinding = (
  reportHash: Uint8Array,
  identity: Uint8Array,
  salt: Uint8Array,
): Uint8Array =>
  taggedHash(
    DNA_PAIR_TAG,
    bytes32(reportHash, "A report hash"),
    bytes32(identity, "An identity"),
    bytes32(salt, "A pairing salt"),
  );

// ───────────────────────────────────────────── what the holder hands a verifier

/** The format name an evidence file carries. */
export const PAIRING_EVIDENCE_FORMAT = "veilcore/dna-pairing/v1";

/**
 * What a holder gives a verifier to show a bound pairing, with the report file itself.
 * Every byte value is 64 lowercase hex characters. `binding` is there to read, never to
 * trust: a verifier recomputes it.
 */
export type PairingEvidence = {
  readonly format: typeof PAIRING_EVIDENCE_FORMAT;
  /** Where the pairing is: the network name and the VeilCore contract's address. */
  readonly network: string;
  readonly contractAddress: string;
  /** The pairDna transaction. */
  readonly txId: string;
  /** The identity (origin) of the record that paired it. Any record of that identity is checked the same. */
  readonly record: string;
  /** SHA-256 of the report file. A verifier hashes the file it was given and compares. */
  readonly reportSha256: string;
  /** The holder's 32 random bytes. Shown, it lets anyone with the report recognise this pairing. */
  readonly salt: string;
  readonly binding: string;
  /** The report file's name, for the reader. Not checked. */
  readonly reportFile?: string;
};

const HEX64 = /^[0-9a-f]{64}$/;
const HEX_ID = /^[0-9a-f]+$/;

const fromHex64 = (v: unknown, what: string): Uint8Array => {
  if (typeof v !== "string" || !HEX64.test(v))
    throw new Error(`${what} must be 64 lowercase hex characters.`);
  return new Uint8Array(Buffer.from(v, "hex"));
};

/** An evidence file's content for a pairing just made (or remembered). */
export const pairingEvidence = (p: {
  readonly network: string;
  readonly contractAddress: string;
  readonly txId: string;
  readonly identity: Uint8Array;
  readonly reportHash: Uint8Array;
  readonly salt: Uint8Array;
  readonly reportFile?: string;
}): PairingEvidence => ({
  format: PAIRING_EVIDENCE_FORMAT,
  network: p.network,
  contractAddress: p.contractAddress.toLowerCase(),
  txId: p.txId.toLowerCase().replace(/^0x/, ""),
  record: hex(p.identity),
  reportSha256: hex(p.reportHash),
  salt: hex(p.salt),
  binding: hex(dnaPairBinding(p.reportHash, p.identity, p.salt)),
  ...(p.reportFile === undefined ? {} : { reportFile: p.reportFile }),
});

/** An evidence file, checked for form and read into bytes. Throws on anything malformed. */
export type ReadPairingEvidence = {
  readonly network: string;
  readonly contractAddress: string;
  readonly txId: string;
  readonly record: Uint8Array;
  readonly reportHash: Uint8Array;
  readonly salt: Uint8Array;
  readonly reportFile?: string;
};

/**
 * Read an evidence file (its JSON text, or the parsed object). Refused when a field is
 * missing or malformed, or when the binding it states is not the one its report hash,
 * record and salt give (a damaged or edited file). The chain is not read here:
 * checkPairing does that.
 */
export const readPairingEvidence = (input: unknown): ReadPairingEvidence => {
  let v: unknown = input;
  if (typeof input === "string") {
    try {
      v = JSON.parse(input);
    } catch {
      throw new Error("That is not a pairing evidence file (not JSON).");
    }
  }
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw new Error("That is not a pairing evidence file.");
  const e = v as Record<string, unknown>;
  if (e.format !== PAIRING_EVIDENCE_FORMAT)
    throw new Error(
      `That is not a pairing evidence file (format is not ${PAIRING_EVIDENCE_FORMAT}).`,
    );
  if (typeof e.network !== "string" || e.network === "")
    throw new Error("The evidence file names no network.");
  if (typeof e.contractAddress !== "string" || !HEX64.test(e.contractAddress))
    throw new Error(
      "The evidence file's contract address must be 64 lowercase hex characters.",
    );
  if (typeof e.txId !== "string" || !HEX_ID.test(e.txId))
    throw new Error(
      "The evidence file's transaction id must be lowercase hex.",
    );
  const record = fromHex64(e.record, "The record");
  const reportHash = fromHex64(e.reportSha256, "The report's SHA-256");
  const salt = fromHex64(e.salt, "The salt");
  if (e.binding !== undefined) {
    const stated = fromHex64(e.binding, "The binding");
    if (hex(stated) !== hex(dnaPairBinding(reportHash, record, salt)))
      throw new Error(
        "The binding in the evidence file is not the one its report hash, record and salt give. The file is damaged or was edited.",
      );
  }
  if (e.reportFile !== undefined && typeof e.reportFile !== "string")
    throw new Error("The evidence file's report file name must be text.");
  return {
    network: e.network,
    contractAddress: e.contractAddress,
    txId: e.txId,
    record,
    reportHash,
    salt,
    ...(typeof e.reportFile === "string" ? { reportFile: e.reportFile } : {}),
  };
};
