// Checking what someone shows you, with no wallet, no keys and no private state: only
// an indexer. For a verifier, a registry or an examiner.
// SPDX-License-Identifier: Apache-2.0
//
// Each check finds the transaction the other party names, requires it to have succeeded
// with exactly one call on VeilCore's contract, of the expected kind, and judges the
// state the indexer recorded for that call (docs/design.md, verifier rules 5, 7 and 8).
// On mainnet only the pinned addresses are accepted. The indexer is trusted for what it
// reports: for a decision that matters, ask a second indexer and compare.

import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { CLAIMS_PROVABLE_CIRCUITS, claimsLedger } from '../../contract/src/claims.js';
import { acceptOwnership, acceptPresentationAt } from '../../contract/src/verify.js';
import { type Claim, claimFromCells } from '../../contract/src/verify-claims.js';
import { presentationWithTime, singleCallState } from '../../api/src/presentation-lookup.js';
import { isProvablyRetired } from '../../api/src/maintenance.js';
import { type ContractKind, type Network, endpointsFor, isNetwork, resolveAddress } from './network.js';

/** Where to read from. Nothing else is needed: no wallet, no keys. */
export type ReadOptions = {
  readonly network: Network;
  /** The indexer's GraphQL URL. Default: the network's public one (mainnet: Blockfrost, with blockfrostProjectId). */
  readonly indexer?: string;
  readonly blockfrostProjectId?: string;
  /** The contract's address. Default: pinned on mainnet (and only that one is accepted), known on preprod. */
  readonly address?: string;
  readonly timeoutMs?: number;
};

export type Verdict = { readonly accepted: boolean; readonly reason: string };
export type WhenLanded = { readonly blockHeight?: number; readonly blockTime?: number };

const where = (o: ReadOptions, kind: ContractKind): { indexer: string; address: string } => {
  if (!isNetwork(o.network)) throw new Error(`Unknown network ${String(o.network)}.`);
  const indexer = o.indexer ?? endpointsFor(o.network, {}, { blockfrostProjectId: o.blockfrostProjectId }).indexer;
  return { indexer, address: resolveAddress(o.network, kind, o.address) };
};

const STATE_QUERY = `query VEILCORE_STATE($address: HexEncoded!) { contractAction(address: $address) { state } }`;

/** A contract's state now, as the indexer reports it. */
const stateNow = async (indexer: string, address: string, timeoutMs = 20_000): Promise<ContractState> => {
  const res = await fetch(indexer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: STATE_QUERY, variables: { address } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`The indexer answered ${res.status}.`);
  const body = (await res.json()) as {
    data?: { contractAction?: { state?: string } | null };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(`The indexer refused the query: ${body.errors[0].message}`);
  const hex = body.data?.contractAction?.state;
  if (typeof hex !== 'string' || !/^(0x)?[0-9a-fA-F]+$/.test(hex))
    throw new Error(`The indexer has no contract at ${address}.`);
  return ContractState.deserialize(Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex')));
};

/** VeilCore's ledger now: for checkLineage, identityOf, isLive and the other readers. */
export const readLedger = async (o: ReadOptions): Promise<Veilcore.Ledger> => {
  const w = where(o, 'veilcore');
  return Veilcore.ledger((await stateNow(w.indexer, w.address, o.timeoutMs)).data);
};

/**
 * Rule 5: a licence presentation. `txId` is what the licensee gave you; `challenge` is
 * the one you sent them (newChallenge(), used once); `issuer` is any record of the
 * licensing identity; `issuedAt` (ms) is when you sent the challenge. Accepted only if
 * that transaction answered your challenge with a licence from that issuer that was live
 * when presented, and it is under an hour old.
 */
export const checkPresentation = async (
  o: ReadOptions & {
    readonly txId: string;
    readonly issuer: Uint8Array;
    readonly challenge: Uint8Array;
    readonly issuedAt?: number;
  },
): Promise<Verdict & WhenLanded> => {
  const w = where(o, 'veilcore');
  const found = await presentationWithTime(w.indexer, w.address, o.txId, o.timeoutMs);
  const v = acceptPresentationAt(found.ledger, o.issuer, o.challenge, {
    landedAt: found.blockTime,
    blockHeight: found.blockHeight,
    issuedAt: o.issuedAt,
  });
  return { ...v, blockHeight: found.blockHeight, blockTime: found.blockTime };
};

/**
 * Rule 8: an ownership proof. Accepted only if that transaction answered your
 * `challenge` for `record`'s identity from its live head, and that head has not moved
 * since (rotated, or recovered away from whoever made the proof).
 */
export const checkOwnership = async (
  o: ReadOptions & { readonly txId: string; readonly record: Uint8Array; readonly challenge: Uint8Array },
): Promise<Verdict & WhenLanded> => {
  const w = where(o, 'veilcore');
  const found = await singleCallState(
    w.indexer,
    w.address,
    o.txId,
    ['proveOwnership'],
    'That transaction is not a single proveOwnership call on this contract.',
    o.timeoutMs,
  );
  const now = Veilcore.ledger((await stateNow(w.indexer, w.address, o.timeoutMs)).data);
  const v = acceptOwnership(Veilcore.ledger(found.state.data), o.record, o.challenge, now);
  return { ...v, blockHeight: found.blockHeight, blockTime: found.blockTime };
};

/**
 * Rule 7: was `root` (an SDK batch root) timestamped by transaction `txId`? Says when, by
 * the block. It does not say who: anchoring a batch is unauthenticated, and inclusion in
 * a batch is not possession.
 */
export const checkBatchAnchor = async (
  o: ReadOptions & { readonly txId: string; readonly root: Uint8Array },
): Promise<Verdict & WhenLanded> => {
  const w = where(o, 'veilcore');
  const found = await singleCallState(
    w.indexer,
    w.address,
    o.txId,
    ['anchorBatch'],
    'That transaction is not a single anchorBatch call on this contract.',
    o.timeoutMs,
  );
  const onChain = Buffer.from(Veilcore.ledger(found.state.data).lastBatchRoot).toString('hex');
  const ok = onChain === Buffer.from(o.root).toString('hex');
  return {
    accepted: ok,
    reason: ok
      ? `the root was timestamped${found.blockHeight === undefined ? '' : ` in block ${found.blockHeight}`}${found.blockTime === undefined ? '' : `, ${new Date(found.blockTime).toISOString()}`}`
      : 'that transaction timestamped a different root',
    blockHeight: found.blockHeight,
    blockTime: found.blockTime,
  };
};

/**
 * Read one claim by its transaction id from VeilCore's claims contract. Judge it with
 * verifyClaim, against the schema document from its publisher and the laboratory keys
 * you trust.
 */
export const readClaim = async (
  o: ReadOptions & { readonly txId: string },
): Promise<
  { readonly claim: Claim; readonly cells: ReturnType<typeof claimsLedger>; readonly entryPoint: string } & WhenLanded
> => {
  const w = where(o, 'claims');
  const found = await singleCallState(
    w.indexer,
    w.address,
    o.txId,
    CLAIMS_PROVABLE_CIRCUITS,
    'That transaction is not a single claim on this claims contract.',
    o.timeoutMs,
  );
  const cells = claimsLedger(found.state.data);
  return {
    claim: claimFromCells(cells),
    cells,
    entryPoint: found.entryPoint,
    blockHeight: found.blockHeight,
    blockTime: found.blockTime,
  };
};

/** The claims contract's maintenance authority now. `retired`: an empty committee, so nobody can change its circuits. */
export const readClaimsAuthority = async (
  o: ReadOptions,
): Promise<{ readonly retired: boolean; readonly keys: number; readonly threshold: number }> => {
  const w = where(o, 'claims');
  const a = (await stateNow(w.indexer, w.address, o.timeoutMs)).maintenanceAuthority;
  return { retired: isProvablyRetired(a), keys: a.committee.length, threshold: a.threshold };
};
