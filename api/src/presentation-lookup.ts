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
    ... on RegularTransaction {
      identifiers
      transactionResult { status }
      contractActions { address state ... on ContractCall { entryPoint } }
    }
  }
}`;

type Action = { address?: string; state?: string; entryPoint?: string };
type Tx = { identifiers?: string[]; transactionResult?: { status?: string }; contractActions?: Action[] };

const norm = (h: string): string => h.toLowerCase().replace(/^0x/, '');
const entryNames = (name: string): Set<string> =>
  new Set([name.toLowerCase(), Buffer.from(name, 'utf8').toString('hex')]);

export const presentationState = (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  timeoutMs = 20_000,
): Promise<Veilcore.Ledger> => callState(indexerUri, contractAddress, txId, 'proveLicense', timeoutMs);

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
): Promise<{ entryPoint: string; state: ContractState }> => {
  const byName = new Map<string, string>();
  for (const e of entryPoints) for (const n of entryNames(e)) byName.set(n, e);
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
  const entryPoint = calls.length === 1 ? byName.get(norm(calls[0].entryPoint ?? '')) : undefined;
  if (entryPoint === undefined || calls[0].state === undefined) throw new Error(refusal);
  return {
    entryPoint,
    state: ContractState.deserialize(Uint8Array.from(Buffer.from(norm(calls[0].state), 'hex'))),
  };
};
