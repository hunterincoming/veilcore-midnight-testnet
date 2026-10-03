// The registry (veilcore-api) as the anchoring job sees it. Sealing and recording an
// anchor are operator operations: they carry the operator token, which only this job
// and the operator hold. Listing batches is public.
// SPDX-License-Identifier: Apache-2.0

import type { AnchorRecord, Batch, RegistryClient } from './anchorer.js';

type Fetch = typeof fetch;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
    if (!isObj(b) || typeof b.count !== 'number') throw new Error('registry: unexpected /batches/pending answer');
    return b.count;
  }

  async seal(): Promise<{ batchId: string; root: string } | undefined> {
    try {
      const b = await this.call('/batches/seal', { method: 'POST', operator: true });
      if (!isObj(b) || typeof b.batchId !== 'string' || typeof b.root !== 'string') {
        throw new Error('registry: unexpected /batches/seal answer');
      }
      return { batchId: b.batchId, root: b.root };
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
    return rows.filter(isObj).flatMap((r) =>
      typeof r.batch_id === 'string' && typeof r.root === 'string'
        ? [{ batchId: r.batch_id, root: r.root, sealedAt: Number(r.sealed_at ?? 0), anchored: r.anchor != null }]
        : [],
    );
  }

  async recordAnchor(batchId: string, anchor: AnchorRecord): Promise<void> {
    const b = await this.call(`/batches/${encodeURIComponent(batchId)}/anchor`, { method: 'POST', body: anchor, operator: true });
    if (isObj(b) && typeof b.error === 'string') throw new Error(`registry: ${b.error}`);
  }
}
