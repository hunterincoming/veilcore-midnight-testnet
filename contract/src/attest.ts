// Laboratory signatures on field sets: Schnorr over Jubjub, as the claims contract checks
// them (contract/src/schnorr.compact). A laboratory signs the commitment of a record it
// sealed; a holder then proves claims "on values this laboratory sealed".
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import {
  MAX_FIELD,
  ecAdd,
  ecMul,
  ecMulGenerator,
} from "@midnight-ntwrk/compact-runtime";
import { pureCircuits } from "./managed/veilcore-claims/contract/index.js";

/** The order of the Jubjub prime-order subgroup. */
export const JUBJUB_ORDER =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const TWO_248 = 1n << 248n;

export type JubjubPoint = { x: bigint; y: bigint };
export type AttestationSignature = {
  announcement: JubjubPoint;
  response: bigint;
};

/**
 * A uniform scalar: 512 random bits reduced mod the 252-bit order. Reducing only 256 bits
 * biases the result, and biased Schnorr nonces leak the key over many signatures
 * (attack round A7).
 */
const scalar = (): bigint => {
  for (;;) {
    const k = BigInt("0x" + randomBytes(64).toString("hex")) % JUBJUB_ORDER;
    if (k !== 0n) return k;
  }
};

/** A new laboratory signing key. Keep `secret` offline; publish `key`. */
export const newAttesterKey = (): { secret: bigint; key: JubjubPoint } => {
  const secret = scalar();
  return { secret, key: ecMulGenerator(secret) };
};

export const attesterKeyOf = (secret: bigint): JubjubPoint =>
  ecMulGenerator(secret);

/**
 * Sign a record the laboratory sealed: its commitment, which binds the field set AND the
 * record's subject, lot and holder, so the signature cannot be moved to another record
 * built around the same values. A fresh random nonce per signature: reusing one leaks
 * the key.
 */
export const signRecord = (
  secret: bigint,
  record: Uint8Array,
): AttestationSignature => {
  const key = attesterKeyOf(secret);
  const k = scalar();
  const R = ecMulGenerator(k) as JubjubPoint;
  const c =
    pureCircuits.attestationChallenge(R.x, R.y, key.x, key.y, record) % TWO_248;
  return { announcement: R, response: (k + c * secret) % JUBJUB_ORDER };
};

/** The witness the Schnorr check asks for: the challenge hash split at 2^248. */
export const schnorrReduction = (h: bigint): [bigint, bigint] => [
  h / TWO_248,
  h % TWO_248,
];

/** The BLS12-381 scalar field modulus: every coordinate and response is below it. */
const FIELD_P = MAX_FIELD + 1n;

/**
 * Whether `key` is a laboratory signing key the claims contract accepts
 * (schnorr.compact, schnorrVerify): a point on Jubjub, x != 0 (not the identity or the
 * order-2 point), and in the prime-order subgroup (r * key is the identity). Any point
 * the JS runtime refuses (off the curve, outside the subgroup) is not one.
 */
export const isSigningKey = (key: JubjubPoint): boolean => {
  if (typeof key?.x !== "bigint" || typeof key?.y !== "bigint") return false;
  if (key.x <= 0n || key.x >= FIELD_P || key.y < 0n || key.y >= FIELD_P)
    return false;
  try {
    const rk = ecAdd(ecMul(key, JUBJUB_ORDER - 1n), key);
    return rk.x === 0n && rk.y === 1n;
  } catch {
    return false;
  }
};

/**
 * Check a laboratory's signature on a record commitment off-chain, exactly as the claims
 * contract's proveAttested does (schnorr.compact): the key rule of isSigningKey, the
 * challenge transientHash over (announcement, key, attestationMessage(record)) split at
 * 2^248 by integer division (the only split the circuit accepts), and
 * response * G = announcement + (challenge mod 2^248) * key.
 * Never throws: anything malformed is `false`.
 */
export const verifyRecordSignature = (
  key: JubjubPoint,
  record: Uint8Array,
  sig: AttestationSignature,
): boolean => {
  try {
    if (!(record instanceof Uint8Array) || record.length !== 32) return false;
    if (!isSigningKey(key)) return false;
    const R = sig?.announcement;
    const s = sig?.response;
    if (typeof R?.x !== "bigint" || typeof R?.y !== "bigint") return false;
    if (typeof s !== "bigint") return false;
    for (const v of [R.x, R.y]) if (v < 0n || v >= FIELD_P) return false;
    // The runtime that builds the proof takes the response as a Jubjub scalar and refuses
    // one at or above the subgroup order, so such a signature can never be published.
    if (s < 0n || s >= JUBJUB_ORDER) return false;
    const h = pureCircuits.attestationChallenge(R.x, R.y, key.x, key.y, record);
    const [, c] = schnorrReduction(h);
    const lhs = ecMulGenerator(s);
    const rhs = ecAdd(R, ecMul(key, c));
    return lhs.x === rhs.x && lhs.y === rhs.y;
  } catch {
    return false;
  }
};
