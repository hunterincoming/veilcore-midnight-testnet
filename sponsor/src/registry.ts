// The registry (veilcore-api) as the anchoring job sees it. Sealing and recording an
// anchor are operator operations: they carry the operator token, which only this job
// and the operator hold. Listing batches is public.
// SPDX-License-Identifier: Apache-2.0

import type { AnchorRecord, Batch, RegistryClient } from './anchorer.js';

type Fetch = typeof fetch;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// What the anchoring job accepts from the registry, as tightly as the registry's answers
// allow. The registry does not send a batch's leaves, so the root cannot be re-derived
// here; what can be checked is checked: a batch id made only of safe characters (it goes
// into a URL and the log), a root of exactly 32 bytes of hex, not all zero, and a real
// sealing time. A batch waiting to be anchored that fails any of these makes the whole
// answer an error: nothing is anchored from a registry answering in a shape we did not ask for.

/** The registry's ids are like B-20261004-9F3A; this allows that and nothing risky. */
export const isBatchId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);

/** A batch root: 32 bytes of hex (an 0x prefix is allowed), not all zero. Returned lower case, no prefix. */
export const batchRoot = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const h = v.toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(h) && !/^0+$/.test(h) ? h : undefined;
};

export class HttpRegistry implements RegistryClient {
  constructor(
    private readonly base: string,
    private readonly operatorToken: string,
    private readonly fetchFn: Fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  private async call(path: string, init: { method?: string; body?: unknown; operator?: boolean } = {}): Promise<unknown> {
    const res = await this.fetchFn(`${this.base.replace(/\/$/, '')}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.operator ? { 'x-operator-token': this.operatorToken } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const why = isObj(body) && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      const e = new Error(`registry ${path}: ${why}`) as Error & { status?: number; body?: unknown };
      e.status = res.status;
      e.body = body;
      throw e;
    }
    return body;
  }

  async pendingCount(): Promise<number> {
    const b = await this.call('/batches/pending', { operator: true });
    if (!isObj(b) || !Number.isSafeInteger(b.count) || (b.count as number) < 0) {
      throw new Error('registry: unexpected /batches/pending answer');
    }
    return b.count as number;
  }

  async seal(): Promise<{ batchId: string; root: string } | undefined> {
    try {
      const b = await this.call('/batches/seal', { method: 'POST', operator: true });
      const root = isObj(b) ? batchRoot(b.root) : undefined;
      if (!isObj(b) || !isBatchId(b.batchId) || root === undefined) {
        throw new Error('registry: unexpected /batches/seal answer');
      }
      return { batchId: b.batchId, root };
    } catch (e) {
      const body = (e as { body?: unknown }).body;
      if (isObj(body) && body.error === 'nothing pending') return undefined;
      throw e;
    }
  }

  async batches(): Promise<Batch[]> {
    const b = await this.call('/batches');
    const rows = Array.isArray(b) ? b : isObj(b) && Array.isArray(b.batches) ? b.batches : undefined;
    if (!rows) throw new Error('registry: unexpected /batches answer');
    const out: Batch[] = [];
    const ids = new Set<string>();
    for (const r of rows) {
      const anchored = isObj(r) && r.anchor != null;
      const root = isObj(r) ? batchRoot(r.root) : undefined;
      const sealedAt = isObj(r) ? r.sealed_at : undefined;
      const ok =
        isObj(r) && isBatchId(r.batch_id) && root !== undefined && typeof sealedAt === 'number' && Number.isFinite(sealedAt) && sealedAt >= 0;
      if (!ok) {
        // An anchored batch is never acted on, so an odd one is left out. One still
        // waiting would be anchored, so an odd one stops the run.
        if (anchored) continue;
        throw new Error('registry: unexpected /batches answer (a batch waiting to be anchored is malformed)');
      }
      if (ids.has(r.batch_id as string)) throw new Error(`registry: /batches lists ${String(r.batch_id)} twice`);
      ids.add(r.batch_id as string);
      out.push({ batchId: r.batch_id as string, root, sealedAt: sealedAt, anchored });
    }
    return out;
  }

  async recordAnchor(batchId: string, anchor: AnchorRecord): Promise<void> {
    const b = await this.call(`/batches/${encodeURIComponent(batchId)}/anchor`, { method: 'POST', body: anchor, operator: true });
    if (isObj(b) && typeof b.error === 'string') throw new Error(`registry: ${b.error}`);
  }
}
