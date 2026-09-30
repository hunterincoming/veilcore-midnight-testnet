// SPDX-License-Identifier: Apache-2.0
/**
 * Find the state a verifier judges a licence presentation on (design.md, rule 5).
 *
 * The licensee hands over a transaction id. It is not trusted: the transaction must
 * exist, have succeeded, and contain exactly one call to `proveLicense` on THIS
 * contract. Anything else (a later transaction such as a seal, a call on a look-alike
 * contract, a failed call) is refused. The state returned is the one right after that
 * call, as the indexer recorded it.
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
const PROVE_LICENSE = new Set(['provelicense', Buffer.from('proveLicense', 'utf8').toString('hex')]);

export const presentationState = async (
  indexerUri: string,
  contractAddress: string,
  txId: string,
  timeoutMs = 20_000,
): Promise<Veilcore.Ledger> => {
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
  const calls = (tx.contractActions ?? []).filter(
    (a) =>
      a.address !== undefined &&
      norm(a.address) === norm(contractAddress) &&
      PROVE_LICENSE.has(norm(a.entryPoint ?? '')),
  );
  if (calls.length !== 1 || calls[0].state === undefined) {
    throw new Error('That transaction is not a single licence presentation on this contract.');
  }
  return Veilcore.ledger(ContractState.deserialize(Uint8Array.from(Buffer.from(norm(calls[0].state), 'hex'))).data);
};
