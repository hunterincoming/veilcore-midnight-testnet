// What the indexer says about one transaction: did it land, did it succeed, and what was
// the contract state right after its call. The same lookup the operator tool's verifier
// uses for licence presentations (api/src/presentation-lookup.ts): the state is the one
// the indexer recorded for that call, not the latest state, so another anchorBatch in
// the same block (anyone may call it) cannot be mistaken for ours.
//
// The indexer is trusted for what it reports. For a decision that matters, ask a second
// indexer or your own node.
// SPDX-License-Identifier: Apache-2.0

import type { Landing } from './anchorer.js';

const QUERY = `query VEILCORE_TX($offset: TransactionOffset!) {
  transactions(offset: $offset) {
    hash
    block { height timestamp }
    ... on RegularTransaction {
      identifiers
      fees { paidFees }
      transactionResult { status }
      contractActions { address state ... on ContractCall { entryPoint } }
    }
  }
}`;

type Action = { address?: string; state?: string; entryPoint?: string };
type Tx = {
  hash?: string;
  block?: { height?: number; timestamp?: number };
  identifiers?: string[];
  fees?: { paidFees?: string };
  transactionResult?: { status?: string };
  contractActions?: Action[];
};

const norm = (h: string): string => h.toLowerCase().replace(/^0x/, '');
const entryNames = (name: string): Set<string> => new Set([name.toLowerCase(), Buffer.from(name, 'utf8').toString('hex')]);

export type StateReader = (stateHex: string) => { lastBatchRoot: string; batchSeq: bigint };

export const lookupCall = async (
  indexer: string,
  contractAddress: string,
  txId: string,
  entryPoint: string,
  readState: StateReader,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<Landing> => {
  const res = await fetchFn(indexer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { offset: { identifier: norm(txId) } } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`the indexer answered ${res.status}`);
  const body = (await res.json()) as { data?: { transactions?: Tx[] }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`the indexer refused the query: ${body.errors[0].message}`);
  const tx = (body.data?.transactions ?? []).find((t) => (t.identifiers ?? []).map(norm).includes(norm(txId)));
  if (tx === undefined) return { state: 'unknown' };
  if (tx.transactionResult?.status !== 'SUCCESS') return { state: 'failed' };
  const wanted = entryNames(entryPoint);
  const calls = (tx.contractActions ?? []).filter((a) => a.address !== undefined && norm(a.address) === norm(contractAddress));
  const landed = {
    state: 'landed' as const,
    txHash: norm(tx.hash ?? ''),
    blockHeight: Number(tx.block?.height ?? 0),
    blockTime: typeof tx.block?.timestamp === 'number' ? tx.block.timestamp : undefined,
    paidFees: tx.fees?.paidFees,
  };
  if (calls.length !== 1 || !wanted.has(norm(calls[0].entryPoint ?? '')) || calls[0].state === undefined) return landed;
  const after = readState(norm(calls[0].state));
  return { ...landed, lastBatchRoot: after.lastBatchRoot, batchSeq: after.batchSeq };
};
