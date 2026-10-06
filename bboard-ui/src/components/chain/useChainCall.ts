// Running one real call from a component: busy flag, the honest progress line, the error.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react';
import { SponsorRefusal } from '../../veilcore/chain/sponsor-client';

export const useChainCall = <T>() => {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<T>();

  const run = useCallback(async (job: (progress: (m: string) => void) => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    setProgress('Starting…');
    try {
      const r = await job(setProgress);
      setResult(r);
      return r;
    } catch (e) {
      setError(
        e instanceof SponsorRefusal
          ? `${e.message}${e.retryAfterSeconds ? ` (try again in about ${Math.ceil(e.retryAfterSeconds / 60)} min)` : ''}`
          : e instanceof Error
            ? e.message
            : String(e),
      );
      return undefined;
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }, []);

  return { busy, progress, error, result, run };
};
