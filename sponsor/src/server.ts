// The HTTP surface: three small routes and nothing else.
//   GET  /sponsor/challenge  a proof-of-work challenge
//   POST /sponsor            { tx, ticket, challenge, nonce } -> { txId } or a refusal
//   GET  /sponsor/status     public: synced, accepting, queue depth, anchoring job outcome code.
//                            With the operator token (x-operator-token): exact budget
//                            figures, counters and the anchoring job's own words.
// Plain node:http, no framework. Request bodies are never logged.
// SPDX-License-Identifier: Apache-2.0

import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Sponsor } from './sponsor.js';
import type { ProofOfWork } from './pow.js';
import { clientBucket, type Limits } from './limits.js';
import { log } from './log.js';

export type ServerDeps = {
  readonly sponsor: Pick<Sponsor, 'handle' | 'status'>;
  readonly pow: Pick<ProofOfWork, 'issue'>;
  readonly limits: Pick<Limits, 'request'>;
  /** More status, merged in. `detail` is true only for a request with the operator token. */
  readonly extraStatus: (detail: boolean) => Record<string, unknown>;
  /** The operator token for the detailed status. Unset: there is only the public view. */
  readonly statusToken?: string;
  readonly allowedOrigins: readonly string[];
  /** How many proxies in front add an X-Forwarded-For entry (Railway: 1). */
  readonly trustProxyHops: number;
  readonly maxBodyBytes: number;
};

/**
 * The client address: the entry the nearest trusted proxy added. Undefined when a proxy is
 * expected (hops > 0) but the request carries fewer forwarded entries than that: it did
 * not come through the edge (or hops is set wrong), and falling back to the socket would
 * put every such request in the proxy's one shared bucket.
 */
export const clientIp = (req: IncomingMessage, hops: number): string | undefined => {
  const socket = req.socket.remoteAddress ?? 'unknown';
  if (hops <= 0) return socket;
  const fwd = req.headers['x-forwarded-for'];
  const list = (Array.isArray(fwd) ? fwd.join(',') : (fwd ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length >= hops ? list[list.length - hops] : undefined;
};

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Whether the request carries the operator token: true, false, or undefined when it carries none. */
const operatorTokenMatches = (req: IncomingMessage, token: string | undefined): boolean | undefined => {
  const given = req.headers['x-operator-token'];
  if (given === undefined) return undefined;
  if (!token || typeof given !== 'string') return false;
  return timingSafeEqual(digest(given), digest(token));
};

let warnedNoForward = false;

const send = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
  const text = JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(text);
};

const readBody = (req: IncomingMessage, max: number): Promise<string | undefined> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

export const handler = (deps: ServerDeps) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const cors: Record<string, string> =
    origin !== undefined && deps.allowedOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin' }
      : { vary: 'Origin' };
  const path = (req.url ?? '/').split('?')[0];

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && path === '/sponsor/status') {
      const operator = operatorTokenMatches(req, deps.statusToken);
      if (operator === false) return send(res, 401, { ok: false, code: 'unauthorized', reason: 'Wrong operator token.' }, cors);
      const detail = operator === true;
      return send(res, 200, { ...deps.sponsor.status(detail), ...deps.extraStatus(detail) }, cors);
    }
    const ip = clientIp(req, deps.trustProxyHops);
    if (ip === undefined && (path === '/sponsor/challenge' || path === '/sponsor')) {
      if (!warnedNoForward) {
        warnedNoForward = true;
        log('warn', 'a request arrived without the forwarded address the proxy adds; refused (check TRUST_PROXY_HOPS)');
      }
      return send(res, 400, { ok: false, code: 'bad-request', reason: 'This request did not come through the expected proxy.' }, cors);
    }
    if (req.method === 'GET' && path === '/sponsor/challenge') {
      const rate = deps.limits.request(clientBucket(ip as string));
      if (!rate.ok) return send(res, 429, { ok: false, code: 'rate', reason: rate.reason }, { ...cors, 'retry-after': String(rate.retryAfterSeconds) });
      return send(res, 200, deps.pow.issue(), cors);
    }
    if (req.method === 'POST' && path === '/sponsor') {
      const ct = req.headers['content-type'] ?? '';
      if (!ct.startsWith('application/json')) return send(res, 415, { ok: false, code: 'bad-request', reason: 'Send JSON.' }, cors);
      const text = await readBody(req, deps.maxBodyBytes);
      if (text === undefined) return send(res, 413, { ok: false, code: 'too-large', reason: 'The request is too large.' }, cors);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return send(res, 400, { ok: false, code: 'bad-request', reason: 'The body is not JSON.' }, cors);
      }
      const out = await deps.sponsor.handle({ ip: ip as string, body });
      return send(res, out.status, out.body, {
        ...cors,
        ...(out.retryAfterSeconds !== undefined ? { 'retry-after': String(out.retryAfterSeconds) } : {}),
      });
    }
    return send(res, 404, { ok: false, reason: 'Not found.' }, cors);
  } catch {
    if (!res.headersSent) send(res, 500, { ok: false, code: 'internal', reason: 'Something went wrong on the sponsor.' }, cors);
  }
};

export const startServer = (deps: ServerDeps, port: number): Server => {
  const server = createServer((req, res) => void handler(deps)(req, res));
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;
  server.listen(port);
  return server;
};
