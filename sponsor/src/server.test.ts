import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { startServer } from './server.js';
import type { SponsorRequest } from './sponsor.js';

let server: Server | undefined;
afterEach(() => server?.close());

/** What the edge proxy adds to every request it forwards (TRUST_PROXY_HOPS=1). */
const XFF = { 'x-forwarded-for': '203.0.113.9' };
const OPERATOR_TOKEN = 'o'.repeat(40);

const start = (handle: (r: SponsorRequest) => Promise<{ status: number; body: Record<string, unknown> }>) => {
  const seen: SponsorRequest[] = [];
  const statusCalls: boolean[] = [];
  server = startServer(
    {
      sponsor: {
        handle: (r) => {
          seen.push(r);
          return handle(r);
        },
        status: (detail?: boolean) => {
          statusCalls.push(detail === true);
          return detail ? { synced: true, budgetRemainingSpecks: '5' } : { synced: true };
        },
      },
      pow: { issue: () => ({ challenge: 'c', difficulty: 1, expiresAt: 0 }) },
      limits: { request: () => ({ ok: true }) },
      extraStatus: (detail: boolean) => ({ anchorer: detail ? { enabled: false, note: 'off: some error' } : { enabled: false } }),
      statusToken: OPERATOR_TOKEN,
      allowedOrigins: ['https://veilcore.org'],
      trustProxyHops: 1,
      maxBodyBytes: 2_000,
    },
    0,
  );
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, seen, statusCalls };
};

describe('HTTP routes', () => {
  it('status and challenge, with CORS only for the site', async () => {
    const { url } = start(() => Promise.resolve({ status: 200, body: {} }));
    const st = await fetch(`${url}/sponsor/status`, { headers: { origin: 'https://veilcore.org' } });
    expect(st.headers.get('access-control-allow-origin')).toBe('https://veilcore.org');
    expect(await st.json()).toEqual({ synced: true, anchorer: { enabled: false } });
    const other = await fetch(`${url}/sponsor/challenge`, { headers: { origin: 'https://evil.example', ...XFF } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(await other.json()).toMatchObject({ challenge: 'c' });
  });

  it('passes the JSON body and the forwarded client address to the sponsor', async () => {
    const { url, seen } = start(() => Promise.resolve({ status: 200, body: { ok: true, txId: 't' } }));
    const r = await fetch(`${url}/sponsor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
      body: JSON.stringify({ tx: 'AA==' }),
    });
    expect(r.status).toBe(200);
    expect(seen[0]).toEqual({ ip: '203.0.113.9', body: { tx: 'AA==' } });
  });

  it('refuses non-JSON, oversize bodies and unknown paths', async () => {
    const { url } = start(() => Promise.resolve({ status: 200, body: {} }));
    expect((await fetch(`${url}/sponsor`, { method: 'POST', headers: XFF, body: 'x' })).status).toBe(415);
    const big = await fetch(`${url}/sponsor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...XFF },
      body: JSON.stringify({ tx: 'A'.repeat(5_000) }),
    }).catch(() => undefined);
    expect(big === undefined || big.status === 413).toBe(true);
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });

  it('answers a CORS preflight', async () => {
    const { url } = start(() => Promise.resolve({ status: 200, body: {} }));
    const r = await fetch(`${url}/sponsor`, { method: 'OPTIONS', headers: { origin: 'https://veilcore.org' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('status: public view by default, detail only with the operator token, 401 for a wrong one', async () => {
    const { url, statusCalls } = start(() => Promise.resolve({ status: 200, body: {} }));
    const pub = await fetch(`${url}/sponsor/status`);
    expect(await pub.json()).toEqual({ synced: true, anchorer: { enabled: false } });
    const op = await fetch(`${url}/sponsor/status`, { headers: { 'x-operator-token': OPERATOR_TOKEN } });
    expect(await op.json()).toEqual({ synced: true, budgetRemainingSpecks: '5', anchorer: { enabled: false, note: 'off: some error' } });
    const wrong = await fetch(`${url}/sponsor/status`, { headers: { 'x-operator-token': 'x'.repeat(40) } });
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(await wrong.json())).not.toMatch(/budget|note/);
    expect(statusCalls).toEqual([false, true]);
  });

  it('refuses a challenge or a sponsor request that did not come through the proxy (no forwarded address)', async () => {
    const { url, seen } = start(() => Promise.resolve({ status: 200, body: { ok: true } }));
    const ch = await fetch(`${url}/sponsor/challenge`);
    expect(ch.status).toBe(400);
    const post = await fetch(`${url}/sponsor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(post.status).toBe(400);
    expect(seen).toHaveLength(0); // never reached the sponsor, so never fell into a shared bucket
    expect((await fetch(`${url}/health`)).status).toBe(200); // the health check needs no proxy header
  });
});
