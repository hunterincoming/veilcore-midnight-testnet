// The files the prover needs, fetched from this site only (CSP connect-src 'self'):
//   /keys/<circuit>.prover, /keys/<circuit>.verifier   from the contract build
//   /zkir/<circuit>.bzkir (or .zkir, converted here)    the circuit
//   /params/bls_midnight_2p<k>                          public parameters, self-hosted
// Kept in the browser's Cache Storage after the first download. Only the three phase-1
// circuits are served: a request for any other key is refused, so this prover cannot be
// used for anything else.
// SPDX-License-Identifier: Apache-2.0

import { jsonIrToBinary, type KeyMaterialProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import { BROWSER_CIRCUITS } from './config';

/** k of each phase-1 circuit (measured with Zkir.getK on the compiled circuits). */
export const PARAMS_K = [13, 14] as const;

export type Progress = (msg: string) => void;

const isHtml = (r: Response): boolean => (r.headers.get('content-type') ?? '').includes('text/html');

const fetchBytes = async (url: string, cache: Cache | undefined): Promise<Uint8Array | undefined> => {
  const hit = cache ? await cache.match(url) : undefined;
  const res = hit ?? (await fetch(url));
  // A single-page-app host answers a missing file with index.html and 200: that is "missing".
  if (!res.ok || isHtml(res)) return undefined;
  if (!hit && cache) await cache.put(url, res.clone()).catch(() => undefined);
  return new Uint8Array(await res.arrayBuffer());
};

export const makeKeyMaterialProvider = (origin: string, cacheName: string, progress: Progress): KeyMaterialProvider => {
  const opened =
    typeof caches !== 'undefined' ? caches.open(cacheName).catch(() => undefined) : Promise.resolve(undefined);
  const memo = new Map<string, Promise<ProvingKeyMaterial | undefined>>();
  const params = new Map<number, Promise<Uint8Array>>();

  const load = async (circuit: string): Promise<ProvingKeyMaterial | undefined> => {
    const cache = await opened;
    progress('Downloading the proving keys (first time only)…');
    const [proverKey, verifierKey] = await Promise.all([
      fetchBytes(`${origin}/keys/${circuit}.prover`, cache),
      fetchBytes(`${origin}/keys/${circuit}.verifier`, cache),
    ]);
    let ir = await fetchBytes(`${origin}/zkir/${circuit}.bzkir`, cache);
    if (!ir) {
      const json = await fetchBytes(`${origin}/zkir/${circuit}.zkir`, cache);
      if (json) ir = jsonIrToBinary(new TextDecoder().decode(json));
    }
    if (!proverKey || !verifierKey || !ir) {
      throw new Error(`The proving files for ${circuit} are not on this site yet.`);
    }
    return { proverKey, verifierKey, ir };
  };

  return {
    lookupKey: (keyLocation: string) => {
      if (!(BROWSER_CIRCUITS as readonly string[]).includes(keyLocation)) return Promise.resolve(undefined);
      let m = memo.get(keyLocation);
      if (!m) {
        m = load(keyLocation);
        memo.set(keyLocation, m);
        m.catch(() => memo.delete(keyLocation));
      }
      return m;
    },
    getParams: (k: number) => {
      if (!(PARAMS_K as readonly number[]).includes(k))
        return Promise.reject(new Error(`No parameters for k=${k} here.`));
      let p = params.get(k);
      if (!p) {
        p = (async () => {
          progress('Downloading the public parameters (first time only)…');
          const b = await fetchBytes(`${origin}/params/bls_midnight_2p${k}`, await opened);
          if (!b) throw new Error(`The public parameters (k=${k}) are not on this site yet.`);
          return b;
        })();
        params.set(k, p);
        p.catch(() => params.delete(k));
      }
      return p;
    },
  };
};
