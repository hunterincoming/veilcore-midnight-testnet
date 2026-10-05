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
 * that matters, ask a second indexer or your own node and compare.
 */
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';

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

export const presentationState = (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  timeoutMs = 20_000,
): Promise<Veilcore.Ledger> => callState(indexerUri, contractAddress, txId, 'proveLicense', timeoutMs);

/**
 * presentationState, with when the presentation landed: the block's height and time,
 * from the same indexer answer. Rule 5 needs the time: a presentation shows the licence
 * was live when it landed, so the verifier refuses one that is too old (verify.ts,
 * acceptPresentationAt).
 */
export const presentationWithTime = async (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  timeoutMs = 20_000,
): Promise<{ ledger: Veilcore.Ledger; blockHeight?: number; blockTime?: number }> => {
  const found = await singleCallState(
    indexerUri,
    contractAddress,
    txId,
    ['proveLicense'],
    'That transaction is not a single licence presentation on this contract.',
    timeoutMs,
  );
  return { ledger: Veilcore.ledger(found.state.data), blockHeight: found.blockHeight, blockTime: found.blockTime };
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
  );
  return Veilcore.ledger(found.state.data);
};

/**
 * The contract state the indexer recorded for the ONE call a transaction made on a
 * contract, when that call is one of `entryPoints`. Any contract's state, so the claims
 * contract uses it too (claims-api.ts, readClaim). Refused, with `refusal`, when the
 * transaction made no call or several on this contract, or a call of another kind.
 */
export const singleCallState = async (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  entryPoints: readonly string[],
  refusal: string,
  timeoutMs = 20_000,
): Promise<{ entryPoint: string; state: ContractState; blockHeight?: number; blockTime?: number }> => {
  if (!/^(0x)?[0-9a-fA-F]+$/.test(txId)) throw new Error('That is not a transaction id.');
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
    state: ContractState.deserialize(Uint8Array.from(Buffer.from(norm(calls[0].state), 'hex'))),
    blockHeight: typeof tx.block?.height === 'number' ? tx.block.height : undefined,
    blockTime: blockTimeMs(tx.block?.timestamp),
  };
};
