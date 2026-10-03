// Laboratory signatures on field sets: Schnorr over Jubjub, as the claims contract checks
// them (contract/src/schnorr.compact). A laboratory signs the commitment of a record it
// sealed; a holder then proves claims "on values this laboratory sealed".
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import { ecMulGenerator } from "@midnight-ntwrk/compact-runtime";
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
