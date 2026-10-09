import { describe, expect, it } from 'vitest';
import { HttpRegistry } from './registry.js';
import { lookupCall } from './lookup.js';

const fakeFetch = (routes: Record<string, { status?: number; body: unknown }>, calls: { url: string; init?: RequestInit }[] = []) =>
  ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    const r = routes[key] ?? { status: 404, body: { error: 'no route' } };
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status ?? 200 }));
  }) as typeof fetch;

describe('registry client', () => {
  it("reads where the registry anchors, without the operator token, and refuses a malformed answer", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const good = { chain: 'midnight', network: 'preprod', contractAddress: 'ef'.repeat(32) };
    const reg = (body: unknown) =>
      new HttpRegistry('https://reg.example', 'op-token', fakeFetch({ 'GET /.well-known/veilcore-registry': { body } }, calls));
    expect(await reg({ name: 'x', anchors: [good] }).publishedAnchors()).toEqual([good]);
    expect((calls[0].init?.headers as Record<string, string>)['x-operator-token']).toBeUndefined();
    expect(await reg({ anchors: [] }).publishedAnchors()).toEqual([]);
    await expect(reg({ name: 'x' }).publishedAnchors()).rejects.toThrow(/unexpected/);
    await expect(reg({ anchors: [{ ...good, contractAddress: 'zz' }] }).publishedAnchors()).rejects.toThrow(/malformed/);
  });

  it('sends the operator token on operator routes only', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const reg = new HttpRegistry(
      'https://reg.example/',
      'op-token',
      fakeFetch(
        {
          'GET /batches/pending': { body: { count: 4, records: [] } },
          'POST /batches/seal': { body: { batchId: 'B-1', root: 'ab'.repeat(32) } },
          'GET /batches': { body: { batches: [{ batch_id: 'B-1', root: 'ab'.repeat(32), sealed_at: 5, anchor: null }] } },
          'POST /batches/B-1/anchor': { body: { batchId: 'B-1' } },
        },
        calls,
      ),
    );
    expect(await reg.pendingCount()).toBe(4);
    expect(await reg.seal()).toEqual({ batchId: 'B-1', root: 'ab'.repeat(32) });
    expect(await reg.batches()).toEqual([{ batchId: 'B-1', root: 'ab'.repeat(32), sealedAt: 5, anchored: false }]);
    await reg.recordAnchor('B-1', {
      chain: 'midnight',
      network: 'preprod',
      contractAddress: 'ef'.repeat(32),
      txHash: 'cd'.repeat(32),
      blockHeight: 9,
      anchoredAt: 'x',
    });
    const tokenOf = (i: number) => (calls[i].init?.headers as Record<string, string>)['x-operator-token'];
    expect([tokenOf(0), tokenOf(1), tokenOf(2), tokenOf(3)]).toEqual(['op-token', 'op-token', undefined, 'op-token']);
    expect(JSON.parse(String(calls[3].init?.body))).toMatchObject({ network: 'preprod', txHash: 'cd'.repeat(32) });
  });

  it('treats "nothing pending" as nothing to seal, and other errors as errors', async () => {
    const reg = new HttpRegistry('https://reg.example', 't', fakeFetch({ 'POST /batches/seal': { status: 400, body: { error: 'nothing pending' } } }));
    expect(await reg.seal()).toBeUndefined();
    const bad = new HttpRegistry('https://reg.example', 't', fakeFetch({ 'POST /batches/seal': { status: 401, body: { error: 'registry operator token required' } } }));
    await expect(bad.seal()).rejects.toThrow(/operator token/);
  });

  it('a "no such batch" answer is an error', async () => {
    const reg = new HttpRegistry('https://reg.example', 't', fakeFetch({ 'POST /batches/B-2/anchor': { body: { error: 'no such batch' } } }));
    await expect(reg.recordAnchor('B-2', {} as never)).rejects.toThrow(/no such batch/);
  });
});

describe('indexer lookup', () => {
  const CONTRACT = 'ef'.repeat(32);
  const answer = (tx: unknown) => (() => Promise.resolve(new Response(JSON.stringify({ data: { transactions: tx ? [tx] : [] } })))) as unknown as typeof fetch;
  const read = (hex: string) => ({ lastBatchRoot: hex.slice(0, 64), batchSeq: 7n });

  it('unknown, failed, and landed with the state right after the call', async () => {
    expect(await lookupCall('http://i', CONTRACT, 'aa', 'anchorBatch', read, answer(undefined))).toEqual({ state: 'unknown' });
    expect(
      await lookupCall('http://i', CONTRACT, 'aa', 'anchorBatch', read, answer({ identifiers: ['aa'], transactionResult: { status: 'FAILURE' } })),
    ).toEqual({ state: 'failed' });
    const landed = await lookupCall(
      'http://i',
      CONTRACT,
      '0xAA',
      'anchorBatch',
      read,
      answer({
        hash: 'BB'.repeat(32),
        block: { height: 12, timestamp: 1000 },
        identifiers: ['aa'],
        fees: { paidFees: '123' },
        transactionResult: { status: 'SUCCESS' },
        contractActions: [{ address: CONTRACT, entryPoint: 'anchorBatch', state: 'cc'.repeat(40) }],
      }),
    );
    expect(landed).toMatchObject({ state: 'landed', txHash: 'bb'.repeat(32), blockHeight: 12, lastBatchRoot: 'cc'.repeat(32), batchSeq: 7n, paidFees: '123' });
  });

  it('gives no root when the transaction is not a single anchorBatch on this contract', async () => {
    const landed = await lookupCall(
      'http://i',
      CONTRACT,
      'aa',
      'anchorBatch',
      read,
      answer({
        identifiers: ['aa'],
        transactionResult: { status: 'SUCCESS' },
        contractActions: [
          { address: CONTRACT, entryPoint: 'anchorBatch', state: 'cc' },
          { address: CONTRACT, entryPoint: 'sealRevocations', state: 'dd' },
        ],
      }),
    );
    expect(landed).toMatchObject({ state: 'landed' });
    expect((landed as { lastBatchRoot?: string }).lastBatchRoot).toBeUndefined();
  });
});
