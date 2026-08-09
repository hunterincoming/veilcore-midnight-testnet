// Server-backed Store. Metadata only — cultivar, breeder, dates, fingerprints,
// parents, terms. Genetics and DNA report files never leave the browser.
// SPDX-License-Identifier: Apache-2.0

import type { Store } from './store';

const BASE = import.meta.env.VITE_API_BASE ?? '';
const TOKEN = import.meta.env.VITE_HOLDER_TOKEN ?? '';

/** Server storage. Falls back to whatever is in memory if the API is unreachable. */
export const apiStore: Store = {
  async load<T>(key: string): Promise<T[]> {
    try {
      const res = await fetch(`${BASE}/api/${encodeURIComponent(key)}`, { headers: { 'x-holder-token': TOKEN } });
      if (!res.ok) return [];
      const parsed = await res.json();
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async save<T>(key: string, value: T[]): Promise<void> {
    try {
      await fetch(`${BASE}/api/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-holder-token': TOKEN },
        body: JSON.stringify(value),
      });
    } catch {
      /* offline — in-memory state stays authoritative for this session */
    }
  },
};
