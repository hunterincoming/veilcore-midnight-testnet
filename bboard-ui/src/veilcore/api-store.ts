// Server-backed Store. Metadata only — cultivar, breeder, dates, fingerprints,
// parents, terms. Genetics and DNA report files never leave the browser.
//
// Every request carries the holder key, and the server returns only that holder's
// records. One holder cannot read another's set.
// SPDX-License-Identifier: Apache-2.0

import type { Store } from './store';
import { holderKey } from './holder';

const BASE = import.meta.env.VITE_API_BASE ?? '';

/** Collection keys map to REST paths. */
const pathFor = (key: string): string =>
  key.includes('license') ? '/api/licenses' : '/api/records';

export const apiStore: Store = {
  async load<T>(key: string): Promise<T[]> {
    try {
      const res = await fetch(`${BASE}${pathFor(key)}`, {
        headers: { 'x-holder-key': holderKey() },
      });
      if (!res.ok) return [];
      const parsed = await res.json();
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async save<T>(key: string, value: T[]): Promise<void> {
    try {
      await fetch(`${BASE}${pathFor(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-holder-key': holderKey() },
        body: JSON.stringify(value),
      });
    } catch {
      /* offline — in-memory state stays authoritative for this session */
    }
  },
};
