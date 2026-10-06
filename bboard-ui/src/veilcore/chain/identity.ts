// A record's on-chain identity and recovery commitment, from its secrets. Plain hashes
// (the contract's own commit functions), so cheap to import anywhere.
// SPDX-License-Identifier: Apache-2.0

import { pureCircuits } from '../../../../contract/src/managed/veilcore/contract/index.js';

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The record's on-chain identity: commit(recordSecret). Public once anchored. */
export const identityOf = (recordSecret: Uint8Array): string => toHex(pureCircuits.commit(recordSecret));

/** What the anchor publishes about the recovery secret. */
export const recoveryCommitmentOf = (recoverySecret: Uint8Array): Uint8Array =>
  pureCircuits.recoveryCommit(recoverySecret);
