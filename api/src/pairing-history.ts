// SPDX-License-Identifier: Apache-2.0
/**
 * The contract's pairDna history, read from the indexer (design.md, rule 9).
 *
 * Two questions need it, and no single lookup answers them:
 *  - was a report's own hash paired RAW before a bound pairing of it? Then the hash was
 *    public from that moment, and anyone could have made a bound pairing of it without
 *    ever seeing the report (the 9 October review, M1);
 *  - which transaction paired a binding, when the call that sent it failed to confirm and
 *    never returned a transaction id (review low (a))?
 *
 * The indexer streams every call on a contract, one state per call, over its GraphQL
 * subscription (`contractActions`, graphql-transport-ws). The stream does not end by
 * itself: it is read up to the contract's latest call at the time of asking, then until
 * it has been quiet for `idleMs`. The history is read from ONE indexer, which is trusted
 * for it: one that hides a raw pairing hides the warning. It gets no second-indexer
 * comparison.
 */
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import * as Veilcore from '../../contract/src/managed/veilcore/contract/index.js';
import { matchEntryPoint, blockTimeMs } from './presentation-lookup.js';

/** One call on the contract, as the indexer streams it. */
export type ContractActionRecord = {
  /** The transaction's identifiers (a txId a holder gives is one of them). */
  readonly identifiers: readonly string[];
  readonly blockHeight?: number;
  /** Block time, ms. */
  readonly blockTime?: number;
  /** The circuit called; undefined for a deploy or a maintenance update. */
  readonly entryPoint?: string;
  /** The contract state right after this call (hex). */
  readonly stateHex: string;
};

/** Every call on `address`, oldest first. Finite: it ends at the contract's latest call. */
export type ActionSource = (address: string) => AsyncIterable<ContractActionRecord>;

/** A pairDna call found in the history. */
export type PairingSeen = {
  readonly txId?: string;
  readonly identifiers: readonly string[];
  readonly blockHeight?: number;
  readonly blockTime?: number;
  /** What it paired (lastPairedDna) and under which commitment (lastPairedRecord). */
  readonly paired: Uint8Array;
  readonly record: Uint8Array;
};

const norm = (h: string): string => h.toLowerCase().replace(/^0x/, '');
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** The pairDna calls in a history, decoded, oldest first. */
export async function* pairDnaCalls(actions: AsyncIterable<ContractActionRecord>): AsyncGenerator<PairingSeen> {
  for await (const a of actions) {
    if (a.entryPoint === undefined || matchEntryPoint(a.entryPoint, ['pairDna']) === undefined) continue;
    const l = Veilcore.ledger(ContractState.deserialize(Uint8Array.from(Buffer.from(norm(a.stateHex), 'hex'))).data);
    yield {
      txId: a.identifiers[0],
      identifiers: a.identifiers,
      blockHeight: a.blockHeight,
      blockTime: a.blockTime,
      paired: l.lastPairedDna,
      record: l.lastPairedRecord,
    };
  }
}

const isTx = (p: { identifiers: readonly string[] }, txId: string): boolean =>
  p.identifiers.map(norm).includes(norm(txId));

/**
 * Raw pairings of `reportHash` (pairDna given the hash itself) that came before the pairing
 * made by `boundTxId`, oldest first. Throws when the history never reaches that pairing:
 * an indexer that cannot show it cannot vouch that nothing came before it.
 */
export const rawPairingsBefore = async (
  history: AsyncIterable<ContractActionRecord>,
  reportHash: Uint8Array,
  boundTxId: string,
): Promise<PairingSeen[]> => {
  const found: PairingSeen[] = [];
  for await (const p of pairDnaCalls(history)) {
    if (isTx(p, boundTxId)) return found;
    if (hex(p.paired) === hex(reportHash)) found.push(p);
  }
  throw new Error("The indexer's history of the contract did not reach that pairing; ask again.");
};

/**
 * The first pairDna call that paired `binding`, if any: the way to the transaction of a
 * pairing whose confirmation failed. The caller checks it was made under its own identity.
 */
export const findBindingPairings = async (
  history: AsyncIterable<ContractActionRecord>,
  bindings: readonly Uint8Array[],
): Promise<Map<string, PairingSeen[]>> => {
  const want = new Set(bindings.map(hex));
  const out = new Map<string, PairingSeen[]>();
  for await (const p of pairDnaCalls(history)) {
    const k = hex(p.paired);
    if (want.has(k)) out.set(k, [...(out.get(k) ?? []), p]);
  }
  return out;
};

const TIP_QUERY = `query VEILCORE_TIP($address: HexEncoded!) {
  contractAction(address: $address) { transaction { block { height } } }
}`;

const HISTORY_SUBSCRIPTION = `subscription VEILCORE_HISTORY($address: HexEncoded!, $offset: BlockOffset) {
  contractActions(address: $address, offset: $offset) {
    state
    transaction {
      block { height timestamp }
      ... on RegularTransaction { identifiers transactionResult { status } }
    }
    ... on ContractCall { entryPoint }
  }
}`;

type RawAction = {
  state?: string;
  entryPoint?: string;
  transaction?: {
    block?: { height?: number; timestamp?: number };
    identifiers?: string[];
    transactionResult?: { status?: string };
  };
};

/** The block height of the contract's latest call, or undefined if it has none. */
const tipHeight = async (indexer: string, address: string, timeoutMs: number): Promise<number | undefined> => {
  const res = await fetch(indexer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: TIP_QUERY, variables: { address } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`The indexer answered ${res.status}.`);
  const body = (await res.json()) as {
    data?: { contractAction?: { transaction?: { block?: { height?: number } } } | null };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(`The indexer refused the query: ${body.errors[0].message}`);
  const h = body.data?.contractAction?.transaction?.block?.height;
  return typeof h === 'number' ? h : undefined;
};

type MinimalSocket = {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
};

/**
 * The history from an indexer: its GraphQL URL (for the latest call's height) and its
 * subscription URL (wss://…/graphql/ws). Uses the runtime's WebSocket (Node 22+; the CLI
 * installs `ws`).
 */
export const indexerHistory =
  (
    indexer: string,
    indexerWS: string,
    options: { readonly idleMs?: number; readonly timeoutMs?: number } = {},
  ): ActionSource =>
  (address: string) => ({
    async *[Symbol.asyncIterator]() {
      const idleMs = options.idleMs ?? 2_000;
      const timeoutMs = options.timeoutMs ?? 120_000;
      const tip = await tipHeight(indexer, norm(address), Math.min(timeoutMs, 20_000));
      if (tip === undefined) return;
      const WS = (globalThis as { WebSocket?: new (url: string, protocol: string) => MinimalSocket }).WebSocket;
      if (WS === undefined) throw new Error('This runtime has no WebSocket, so the contract history cannot be read.');
      const sock = new WS(indexerWS, 'graphql-transport-ws');
      const queue: (ContractActionRecord | Error | null)[] = [];
      let wake: (() => void) | undefined;
      const push = (x: ContractActionRecord | Error | null): void => {
        queue.push(x);
        wake?.();
      };
      let reachedTip = false;
      let idle: ReturnType<typeof setTimeout> | undefined;
      const armIdle = (): void => {
        if (idle !== undefined) clearTimeout(idle);
        idle = setTimeout(() => push(null), idleMs);
      };
      const overall = setTimeout(
        () => push(new Error("The indexer took too long to send the contract's history.")),
        timeoutMs,
      );
      sock.onopen = () => sock.send(JSON.stringify({ type: 'connection_init', payload: {} }));
      sock.onerror = () => push(new Error("Could not read the contract's history from the indexer."));
      sock.onclose = () =>
        push(reachedTip ? null : new Error("The indexer closed the contract's history before its latest call."));
      sock.onmessage = (ev) => {
        let m: { type?: string; payload?: { data?: { contractActions?: RawAction }; errors?: unknown } };
        try {
          m = JSON.parse(String(ev.data)) as typeof m;
        } catch {
          push(new Error('The indexer sent something that is not JSON.'));
          return;
        }
        if (m.type === 'connection_ack')
          sock.send(
            JSON.stringify({
              id: '1',
              type: 'subscribe',
              payload: { query: HISTORY_SUBSCRIPTION, variables: { address: norm(address), offset: { height: 0 } } },
            }),
          );
        else if (m.type === 'ping') sock.send(JSON.stringify({ type: 'pong' }));
        else if (m.type === 'error' || (m.type === 'next' && m.payload?.errors !== undefined))
          push(new Error(`The indexer refused the history subscription: ${JSON.stringify(m.payload)}`));
        else if (m.type === 'complete') push(null);
        else if (m.type === 'next') {
          const a = m.payload?.data?.contractActions;
          if (a === undefined || typeof a.state !== 'string') return;
          const height = a.transaction?.block?.height;
          if (typeof height === 'number' && height >= tip) reachedTip = true;
          // A failed call changed nothing; it is not part of the history that counts.
          const status = a.transaction?.transactionResult?.status;
          if (status === undefined || status === 'SUCCESS')
            push({
              identifiers: a.transaction?.identifiers ?? [],
              blockHeight: typeof height === 'number' ? height : undefined,
              blockTime: blockTimeMs(a.transaction?.block?.timestamp),
              entryPoint: a.entryPoint,
              stateHex: a.state,
            });
          if (reachedTip) armIdle();
        }
      };
      try {
        for (;;) {
          if (queue.length === 0) await new Promise<void>((r) => (wake = r));
          wake = undefined;
          const x = queue.shift();
          if (x === null || x === undefined) return;
          if (x instanceof Error) throw x;
          yield x;
        }
      } finally {
        if (idle !== undefined) clearTimeout(idle);
        clearTimeout(overall);
        sock.onclose = null;
        try {
          sock.send(JSON.stringify({ id: '1', type: 'complete' }));
          sock.close();
        } catch {
          // already closed
        }
      }
    },
  });
