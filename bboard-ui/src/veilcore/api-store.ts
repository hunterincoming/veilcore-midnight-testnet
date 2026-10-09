// Server-backed Store. Metadata only — cultivar, breeder, dates, fingerprints,
// parents, terms. Genetics and DNA report files never leave the browser.
//
// Every request carries the holder key, and the server returns only that holder's
// records. One holder cannot read another's set.
// SPDX-License-Identifier: Apache-2.0

import type { Store, SaveRefusal, SaveResult } from './store';
import { holderKey, holderKeyIfAny } from './holder';
import { readJson, isObject, isString } from './json';

const BASE = import.meta.env.VITE_API_BASE ?? '';

/** Collection keys map to REST paths. */
const pathFor = (key: string): string => (key.includes('license') ? '/api/licenses' : '/api/records');

export const apiStore: Store = {
  async load<T>(key: string, isValid: (v: unknown) => v is T): Promise<T[]> {
    // No key means this browser has never saved anything: nothing to load, and no
    // reason to mint an identifier and send it to the registry (attack round D).
    const k = holderKeyIfAny();
    if (!k) return [];
    // A refusal (rate limit, server error) or no network is NOT an empty set: throw, so the
    // caller keeps what it shows instead of blanking the holder's records.
    const res = await fetch(`${BASE}${pathFor(key)}`, {
      headers: { 'x-holder-key': k },
    });
    if (!res.ok) throw new Error(`the registry answered ${String(res.status)}`);
    const parsed = await readJson(res);
    if (!Array.isArray(parsed)) throw new Error('unexpected response from the registry');
    // Malformed rows are dropped rather than failing the whole set: one bad row
    // should not blank a holder's records, and the rest are still theirs.
    return parsed.filter(isValid);
  },

  /**
   * Save, and report what the registry actually stored. The response used to be thrown
   * away, so an item the registry refused looked saved (attack round 11).
   */
  async save<T>(key: string, value: T[]): Promise<SaveResult> {
    let res: Response;
    try {
      res = await fetch(`${BASE}${pathFor(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-holder-key': holderKey() },
        body: JSON.stringify(value),
      });
    } catch {
      /* offline — in-memory state stays authoritative for this session */
      return { ok: false, refused: [], offline: true };
    }
    let body: unknown = null;
    try {
      body = await readJson(res);
    } catch {
      /* not JSON — handled below */
    }
    if (!res.ok) {
      const reason =
        isObject(body) && isString(body.error) ? body.error : `the registry answered ${String(res.status)}`;
      return { ok: false, refused: [{ id: '*', reason }] };
    }
    if (!isObject(body)) return { ok: false, refused: [{ id: '*', reason: 'unexpected response from the registry' }] };
    const refused: SaveRefusal[] = [];
    if (Array.isArray(body.rejected)) {
      for (const r of body.rejected) {
        if (isObject(r) && isString(r.id) && isString(r.reason)) refused.push({ id: r.id, reason: r.reason });
      }
    }
    if (Array.isArray(body.notWritten)) {
      const reason = isString(body.reason) ? body.reason : 'this id already belongs to another holder';
      for (const id of body.notWritten) if (isString(id)) refused.push({ id, reason });
    }
    return { ok: body.ok === true && refused.length === 0, refused };
  },
};
