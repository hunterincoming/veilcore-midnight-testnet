// Storage adapter. The app talks to this, never to localStorage directly, so the
// backing store can be swapped (server API, NIGHTGATE) without touching callers.
// SPDX-License-Identifier: Apache-2.0

export interface Store {
  load<T>(key: string): Promise<T[]>;
  save<T>(key: string, value: T[]): Promise<void>;
}

/** Browser localStorage. Records only exist in the browser that created them. */
export const localStore: Store = {
  async load<T>(key: string): Promise<T[]> {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  async save<T>(key: string, value: T[]): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or availability — stay in memory */
    }
  },
};

import { apiStore } from './api-store';
export const store: Store = apiStore;
