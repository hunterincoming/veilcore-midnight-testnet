// What a call runs on. In the browser: the proving worker, this site's origin and the
// network's indexer. Tests pass stand-ins (actions.test.ts).
// SPDX-License-Identifier: Apache-2.0

import type { ProvingProvider } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { workerPow, workerProvingProvider } from './prover';

export type CallDeps = {
  readonly proving: (cacheName: string) => ProvingProvider;
  readonly pow: (challenge: string, tx: Uint8Array, difficulty: number) => Promise<string>;
  readonly origin: string;
  readonly fetch: typeof fetch;
  readonly publicData?: PublicDataProvider;
};

export const browserCallDeps = (): CallDeps => ({
  proving: workerProvingProvider,
  pow: workerPow,
  origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
});
