// Laboratory signatures on field sets: Schnorr over Jubjub, as the claims contract checks
// them (contract/src/schnorr.compact). A laboratory signs the root of a field set it
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

const scalar = (): bigint => {
  for (;;) {
    const k = BigInt("0x" + randomBytes(32).toString("hex")) % JUBJUB_ORDER;
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

/** Sign a field-set root. A fresh random nonce per signature: reusing one leaks the key. */
export const signFieldSet = (
  secret: bigint,
  setRoot: Uint8Array,
): AttestationSignature => {
  const key = attesterKeyOf(secret);
  const k = scalar();
  const R = ecMulGenerator(k) as JubjubPoint;
  const c =
    pureCircuits.attestationChallenge(R.x, R.y, key.x, key.y, setRoot) %
    TWO_248;
  return { announcement: R, response: (k + c * secret) % JUBJUB_ORDER };
};

/** The witness the Schnorr check asks for: the challenge hash split at 2^248. */
export const schnorrReduction = (h: bigint): [bigint, bigint] => [
  h / TWO_248,
  h % TWO_248,
];
