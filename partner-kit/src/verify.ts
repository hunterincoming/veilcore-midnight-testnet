// Checking what someone shows you, with no wallet, no keys and no private state: only
// an indexer. For a verifier, a registry or an examiner.
// SPDX-License-Identifier: Apache-2.0
//
// Each check finds the transaction the other party names, requires it to have succeeded
// with exactly one call on VeilCore's contract, of the expected kind, and judges the
// state the indexer recorded for that call (docs/design.md, verifier rules 5, 7 and 8).
// On mainnet only the pinned addresses are accepted, and the state judged must carry the
// pinned build's verifier keys (state-check.ts): a circuit the maintenance authority
// replaced is refused. The authority itself (committee, threshold, counter) comes back
// with every verdict, so a change is visible. The indexer is trusted for what it reports:
// for a decision that matters, give `secondIndexer` and both must agree.

import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { CLAIMS_PROVABLE_CIRCUITS, claimsLedger } from '../../contract/src/claims.js';
import { acceptOwnership, acceptPresentationAt } from '../../contract/src/verify.js';
import { type Claim, claimFromCells } from '../../contract/src/verify-claims.js';
import { type LookupCheck, presentationWithTime, singleCallState } from '../../api/src/presentation-lookup.js';
import {
  type AuthorityReport,
  ContractStateMismatchError,
  checkContractState,
  pinnedVerifierKeys,
} from '../../api/src/state-check.js';
import { isProvablyRetired } from '../../api/src/maintenance.js';
import {
  type ContractKind,
  MAINNET_ADDRESSES,
  type Network,
  endpointsFor,
  isNetwork,
  resolveAddress,
} from './network.js';

/** Where to read from. Nothing else is needed: no wallet, no keys. */
export type ReadOptions = {
  readonly network: Network;
  /** The indexer's GraphQL URL. Default: the network's public one (mainnet: Blockfrost, with blockfrostProjectId). */
  readonly indexer?: string;
  readonly blockfrostProjectId?: string;
  /**
   * A second indexer (your own, or another provider's). When given, every check asks both,
   * and refuses unless they report the same transaction, call, block and contract state.
   */
  readonly secondIndexer?: string;
  /** The contract's address. Default: pinned on mainnet (and only that one is accepted), known on preprod. */
  readonly address?: string;
  /**
   * 'pinned': refuse a state whose verifier keys are not the deployment record's build.
   * 'report': only report the maintenance authority. Default: 'pinned' on mainnet (where it
   * cannot be turned off) and preprod; 'report' on a development network, where the
   * contract is usually your own build.
   */
  readonly verifierKeys?: 'pinned' | 'report';
  /**
   * Refuse unless the maintenance authority's counter is exactly this: every maintenance
   * update raises it, so pinning the value you last saw makes any change since a refusal.
   */
  readonly authorityCounter?: bigint;
  readonly timeoutMs?: number;
};

export type Verdict = { readonly accepted: boolean; readonly reason: string };
export type WhenLanded = { readonly blockHeight?: number; readonly blockTime?: number };
/** The maintenance authority in the state a verdict rests on (absent only when no state was read). */
export type WithAuthority = { readonly authority?: AuthorityReport };

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const namesNetwork = (url: string, n: string): boolean => new RegExp(`(^|[.-])${n}([.-]|$)`).test(hostOf(url));

/**
 * The network, the indexers and the address must agree. A check run as `preprod` skips
 * the mainnet address pin, so a mainnet indexer or a mainnet address under any other
 * network name is refused rather than judged by development rules.
 */
const assertSameNetwork = (o: ReadOptions, indexers: readonly string[], address: string): void => {
  if (o.network === 'mainnet') {
    for (const i of indexers)
      if (['preprod', 'preview'].some((n) => namesNetwork(i, n)))
        throw new Error(`Refusing: the network is mainnet but the indexer ${hostOf(i)} is not. Nothing was read.`);
    return;
  }
  for (const i of indexers)
    if (namesNetwork(i, 'mainnet'))
      throw new Error(
        `Refusing: the network is ${o.network} but the indexer ${hostOf(i)} is a mainnet one. ` +
          "Use network: 'mainnet', where only VeilCore's pinned contracts are accepted. Nothing was read.",
      );
  if (Object.values(MAINNET_ADDRESSES).some((m) => m !== '' && m.toLowerCase() === address))
    throw new Error(
      `Refusing: ${address} is VeilCore's mainnet contract, but the network is ${o.network}. ` +
        "Use network: 'mainnet'. Nothing was read.",
    );
};

const where = (o: ReadOptions, kind: ContractKind): { indexer: string; address: string; check: LookupCheck } => {
  if (!isNetwork(o.network)) throw new Error(`Unknown network ${String(o.network)}.`);
  const indexer = o.indexer ?? endpointsFor(o.network, {}, { blockfrostProjectId: o.blockfrostProjectId }).indexer;
  const address = resolveAddress(o.network, kind, o.address);
  assertSameNetwork(o, o.secondIndexer === undefined ? [indexer] : [indexer, o.secondIndexer], address);
  if (o.network === 'mainnet' && o.verifierKeys === 'report')
    throw new Error("On mainnet the verifier keys are always checked against the deployment record ('pinned').");
  const pinned =
    o.verifierKeys === undefined ? o.network === 'mainnet' || o.network === 'preprod' : o.verifierKeys === 'pinned';
  return {
    indexer,
    address,
    check: {
      verifierKeys: pinned ? pinnedVerifierKeys(kind === 'veilcore' ? 'veilcore' : 'veilcore-claims') : undefined,
      authorityCounter: o.authorityCounter,
      secondIndexer: o.secondIndexer,
    },
  };
};

/** A refusal for a state that is not the pinned build: a verdict, not an exception. */
const refusedState = (e: unknown): (Verdict & WithAuthority) | undefined =>
  e instanceof ContractStateMismatchError ? { accepted: false, reason: e.message, authority: e.authority } : undefined;

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
): Promise<Verdict & WhenLanded & WithAuthority> => {
  const w = where(o, 'veilcore');
  let found: Awaited<ReturnType<typeof presentationWithTime>>;
  try {
    found = await presentationWithTime(w.indexer, w.address, o.txId, o.timeoutMs, w.check);
  } catch (e) {
    const r = refusedState(e);
    if (r !== undefined) return r;
    throw e;
  }
  const v = acceptPresentationAt(found.ledger, o.issuer, o.challenge, {
    landedAt: found.blockTime,
    blockHeight: found.blockHeight,
    issuedAt: o.issuedAt,
  });
  return { ...v, blockHeight: found.blockHeight, blockTime: found.blockTime, authority: found.authority };
};

/**
 * Rule 8: an ownership proof. Accepted only if that transaction answered your
 * `challenge` for `record`'s identity from its live head, and that head has not moved
 * since (rotated, or recovered away from whoever made the proof). With a second indexer,
 * the head must not have moved by either indexer's account of the state now.
 */
export const checkOwnership = async (
  o: ReadOptions & { readonly txId: string; readonly record: Uint8Array; readonly challenge: Uint8Array },
): Promise<Verdict & WhenLanded & WithAuthority> => {
  const w = where(o, 'veilcore');
  let found: Awaited<ReturnType<typeof singleCallState>>;
  const nows: ContractState[] = [];
  try {
    found = await singleCallState(
      w.indexer,
      w.address,
      o.txId,
      ['proveOwnership'],
      'That transaction is not a single proveOwnership call on this contract.',
      o.timeoutMs,
      w.check,
    );
    for (const i of o.secondIndexer === undefined ? [w.indexer] : [w.indexer, o.secondIndexer]) {
      const s = await stateNow(i, w.address, o.timeoutMs);
      checkContractState(s, w.check, 'the current state');
      nows.push(s);
    }
  } catch (e) {
    const r = refusedState(e);
    if (r !== undefined) return r;
    throw e;
  }
  const after = Veilcore.ledger(found.state.data);
  let v: Verdict = { accepted: false, reason: 'no current state was read' };
  for (const s of nows) {
    v = acceptOwnership(after, o.record, o.challenge, Veilcore.ledger(s.data));
    if (!v.accepted) break;
  }
  return { ...v, blockHeight: found.blockHeight, blockTime: found.blockTime, authority: found.authority };
};

/**
 * Rule 7: was `root` (an SDK batch root) timestamped by transaction `txId`? Says when, by
 * the block. It does not say who: anchoring a batch is unauthenticated, and inclusion in
 * a batch is not possession.
 */
export const checkBatchAnchor = async (
  o: ReadOptions & { readonly txId: string; readonly root: Uint8Array },
): Promise<Verdict & WhenLanded & WithAuthority> => {
  const w = where(o, 'veilcore');
  let found: Awaited<ReturnType<typeof singleCallState>>;
  try {
    found = await singleCallState(
      w.indexer,
      w.address,
      o.txId,
      ['anchorBatch'],
      'That transaction is not a single anchorBatch call on this contract.',
      o.timeoutMs,
      w.check,
    );
  } catch (e) {
    const r = refusedState(e);
    if (r !== undefined) return r;
    throw e;
  }
  const onChain = Buffer.from(Veilcore.ledger(found.state.data).lastBatchRoot).toString('hex');
  const ok = onChain === Buffer.from(o.root).toString('hex');
  return {
    accepted: ok,
    reason: ok
      ? `the root was timestamped${found.blockHeight === undefined ? '' : ` in block ${found.blockHeight}`}${found.blockTime === undefined ? '' : `, ${new Date(found.blockTime).toISOString()}`}`
      : 'that transaction timestamped a different root',
    blockHeight: found.blockHeight,
    blockTime: found.blockTime,
    authority: found.authority,
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
  {
    readonly claim: Claim;
    readonly cells: ReturnType<typeof claimsLedger>;
    readonly entryPoint: string;
    readonly authority: AuthorityReport;
  } & WhenLanded
> => {
  const w = where(o, 'claims');
  // A state that is not the pinned build throws ContractStateMismatchError: nothing is read.
  const found = await singleCallState(
    w.indexer,
    w.address,
    o.txId,
    CLAIMS_PROVABLE_CIRCUITS,
    'That transaction is not a single claim on this claims contract.',
    o.timeoutMs,
    w.check,
  );
  const cells = claimsLedger(found.state.data);
  return {
    claim: claimFromCells(cells),
    cells,
    entryPoint: found.entryPoint,
    authority: found.authority,
    blockHeight: found.blockHeight,
    blockTime: found.blockTime,
  };
};

/** The claims contract's maintenance authority now. `retired`: an empty committee, so nobody can change its circuits. */
export const readClaimsAuthority = async (
  o: ReadOptions,
): Promise<{
  readonly retired: boolean;
  readonly keys: number;
  readonly threshold: number;
  readonly counter: bigint;
}> => {
  const w = where(o, 'claims');
  const a = (await stateNow(w.indexer, w.address, o.timeoutMs)).maintenanceAuthority;
  return { retired: isProvablyRetired(a), keys: a.committee.length, threshold: a.threshold, counter: a.counter };
};

/**
 * VeilCore's main contract's maintenance authority now: committee size, threshold and
 * counter. Every maintenance update raises the counter; compare it with the value the
 * latest deployment record revision gives.
 */
export const readAuthority = async (o: ReadOptions): Promise<AuthorityReport> => {
  const w = where(o, 'veilcore');
  return checkContractState(await stateNow(w.indexer, w.address, o.timeoutMs), {}).authority;
};
