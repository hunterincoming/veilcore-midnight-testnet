// SPDX-License-Identifier: Apache-2.0
/**
 * Find the state a verifier judges a licence presentation on (design.md, rule 5).
 *
 * The licensee hands over a transaction id. It is not trusted: the transaction must
 * exist, have succeeded, and contain exactly one call on THIS contract, and that call
 * must be `proveLicense`. Anything else (a seal or any other call bundled with it, a
 * later transaction, a call on a look-alike contract, a failed call) is refused. The
 * state returned is the one the indexer recorded for that call.
 *
 * The indexer is trusted for what it reports (design.md, trust model). For a decision
 * that matters, give a second indexer (LookupCheck.secondIndexer): both must agree.
 */
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { type AuthorityReport, type StateRequirements, checkContractState } from './state-check.js';

const QUERY = `query VEILCORE_PRESENTATION($offset: TransactionOffset!) {
  transactions(offset: $offset) {
    block { height timestamp }
    ... on RegularTransaction {
      identifiers
      transactionResult { status }
      contractActions { address state ... on ContractCall { entryPoint } }
    }
  }
}`;

type Action = { address?: string; state?: string; entryPoint?: string };
type Tx = {
  identifiers?: string[];
  transactionResult?: { status?: string };
  contractActions?: Action[];
  block?: { height?: number; timestamp?: number };
};

const norm = (h: string): string => h.toLowerCase().replace(/^0x/, '');

/**
 * The block's time in milliseconds. The indexer gives a UNIX timestamp in milliseconds
 * (the wallet SDK reads it with `new Date(timestamp)`); a value too small to be one is
 * read as seconds rather than as a date in 1970.
 */
export const blockTimeMs = (timestamp: number | undefined): number | undefined => {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
};

/**
 * Which of `entryPoints` an indexer's entry point names, matched EXACTLY. Midnight
 * operation names are case-sensitive: `ProveLicense` is a different operation from
 * `proveLicense` (round D, D-5), so the name is never case-folded. The indexer may give
 * the name as text or as the hex of its UTF-8 bytes; only the hex digits are
 * case-insensitive.
 */
export const matchEntryPoint = (raw: string, entryPoints: readonly string[]): string | undefined => {
  if (entryPoints.includes(raw)) return raw;
  const h = raw.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2 !== 0) return undefined;
  return entryPoints.find((e) => Buffer.from(e, 'utf8').toString('hex') === h.toLowerCase());
};

/**
 * What a lookup checks besides the transaction itself (8 October 2026 review).
 *  - `verifierKeys`, `authorityCounter`: what the state must carry besides its data
 *    (state-check.ts). With `verifierKeys` given, a state whose circuits are not exactly
 *    the pinned build's is refused with ContractStateMismatchError. The maintenance
 *    authority is always reported.
 *  - `secondIndexer`: another indexer, asked the same question. Both must report the same
 *    transaction as succeeded, the same single call, in the same block, with byte-for-byte
 *    the same contract state, or the lookup is refused. One indexer is trusted for
 *    everything it reports; two that must agree make a lie cost two compromises.
 */
export type LookupCheck = StateRequirements & { readonly secondIndexer?: string };

export type FoundCall = {
  readonly entryPoint: string;
  readonly state: ContractState;
  readonly blockHeight?: number;
  readonly blockTime?: number;
  readonly authority: AuthorityReport;
  /** 'pinned': every verifier key was compared with the pinned build and matched. */
  readonly keys: 'pinned' | 'unchecked';
};

export const presentationState = (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  timeoutMs = 20_000,
  check: LookupCheck = {},
): Promise<Veilcore.Ledger> => callState(indexerUri, contractAddress, txId, 'proveLicense', timeoutMs, check);

/**
 * presentationState, with when the presentation landed: the block's height and time,
 * from the same indexer answer. Rule 5 needs the time: a presentation shows the licence
 * was live when it landed, so the verifier refuses one that is too old (verify.ts,
 * acceptPresentationAt). The maintenance authority at that transaction comes back too.
 */
export const presentationWithTime = async (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  timeoutMs = 20_000,
  check: LookupCheck = {},
): Promise<{
  ledger: Veilcore.Ledger;
  blockHeight?: number;
  blockTime?: number;
  authority: AuthorityReport;
  keys: 'pinned' | 'unchecked';
}> => {
  const found = await singleCallState(
    indexerUri,
    contractAddress,
    txId,
    ['proveLicense'],
    'That transaction is not a single licence presentation on this contract.',
    timeoutMs,
    check,
  );
  return {
    ledger: Veilcore.ledger(found.state.data),
    blockHeight: found.blockHeight,
    blockTime: found.blockTime,
    authority: found.authority,
    keys: found.keys,
  };
};

/**
 * The same lookup for any single call: the transaction must have succeeded and its only
 * call on this contract must be `entryPoint` (rule 8 uses it for `proveOwnership`).
 */
export const callState = async (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  entryPoint: string,
  timeoutMs = 20_000,
  check: LookupCheck = {},
): Promise<Veilcore.Ledger> => {
  const found = await singleCallState(
    indexerUri,
    contractAddress,
    txId,
    [entryPoint],
    entryPoint === 'proveLicense'
      ? 'That transaction is not a single licence presentation on this contract.'
      : `That transaction is not a single ${entryPoint} call on this contract.`,
    timeoutMs,
    check,
  );
  return Veilcore.ledger(found.state.data);
};

type RawCall = { entryPoint: string; stateHex: string; blockHeight?: number; blockTime?: number };

/** One indexer's answer for the one call `txId` made on `contractAddress`. */
const askIndexer = async (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  entryPoints: readonly string[],
  refusal: string,
  timeoutMs: number,
): Promise<RawCall> => {
  const res = await fetch(indexerUri, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { offset: { identifier: norm(txId) } } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`The indexer answered ${res.status}.`);
  const body = (await res.json()) as { data?: { transactions?: Tx[] }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`The indexer refused the query: ${body.errors[0].message}`);
  const tx = (body.data?.transactions ?? []).find((t) => (t.identifiers ?? []).map(norm).includes(norm(txId)));
  if (tx === undefined) throw new Error('No such transaction.');
  if (tx.transactionResult?.status !== 'SUCCESS') throw new Error('That transaction did not succeed.');
  // Every action on this contract, whatever it is: a call bundled with anything else (a
  // seal above all) is refused outright, so the verdict never depends on which point in
  // the transaction the indexer's state describes.
  const calls = (tx.contractActions ?? []).filter(
    (a) => a.address !== undefined && norm(a.address) === norm(contractAddress),
  );
  const entryPoint = calls.length === 1 ? matchEntryPoint(calls[0].entryPoint ?? '', entryPoints) : undefined;
  if (entryPoint === undefined || calls[0].state === undefined) throw new Error(refusal);
  return {
    entryPoint,
    stateHex: norm(calls[0].state),
    blockHeight: typeof tx.block?.height === 'number' ? tx.block.height : undefined,
    blockTime: blockTimeMs(tx.block?.timestamp),
  };
};

/**
 * The contract state the indexer recorded for the ONE call a transaction made on a
 * contract, when that call is one of `entryPoints`. Any contract's state, so the claims
 * contract uses it too (claims-api.ts, readClaim). Refused, with `refusal`, when the
 * transaction made no call or several on this contract, or a call of another kind.
 * `check` adds the verifier-key, authority and second-indexer checks (LookupCheck).
 */
export const singleCallState = async (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  entryPoints: readonly string[],
  refusal: string,
  timeoutMs = 20_000,
  check: LookupCheck = {},
): Promise<FoundCall> => {
  if (!/^(0x)?[0-9a-fA-F]+$/.test(txId)) throw new Error('That is not a transaction id.');
  const first = await askIndexer(indexerUri, contractAddress, txId, entryPoints, refusal, timeoutMs);
  if (check.secondIndexer !== undefined) {
    let second: RawCall;
    try {
      second = await askIndexer(check.secondIndexer, contractAddress, txId, entryPoints, refusal, timeoutMs);
    } catch (e) {
      throw new Error(
        `The second indexer does not confirm that transaction (${e instanceof Error ? e.message : String(e)}). Refused.`,
      );
    }
    const differs: string[] = [];
    if (second.entryPoint !== first.entryPoint) differs.push('the call');
    if (second.blockHeight !== first.blockHeight) differs.push('the block');
    // Rule 5 refuses a presentation over an hour old by this time: a first indexer that
    // lied about it could make an old presentation look fresh.
    if (second.blockTime !== first.blockTime) differs.push('the block time');
    if (second.stateHex !== first.stateHex) differs.push('the contract state');
    if (differs.length > 0)
      throw new Error(`The two indexers disagree about that transaction (${differs.join(', ')}). Refused.`);
  }
  const state = ContractState.deserialize(Uint8Array.from(Buffer.from(first.stateHex, 'hex')));
  const checked = checkContractState(state, check);
  return {
    entryPoint: first.entryPoint,
    state,
    blockHeight: first.blockHeight,
    blockTime: first.blockTime,
    authority: checked.authority,
    keys: checked.keys,
  };
};

const STATE_QUERY = `query VEILCORE_STATE($address: HexEncoded!) { contractAction(address: $address) { state } }`;

/** A contract's state now, as one indexer reports it (its latest call's state). */
export const contractStateNow = async (
  indexer: string,
  address: string,
  timeoutMs = 20_000,
): Promise<ContractState> => {
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
