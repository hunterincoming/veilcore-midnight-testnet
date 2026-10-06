// The midnight-js providers for one call from this browser.
//
//   proofs     made in the proving worker, on this device (prover.ts)
//   keys       this site's /keys and /zkir, fetched by the worker
//   chain      Midnight's public indexer (read only)
//   private    in memory for the length of the call, then dropped
//   wallet     none: fresh throwaway keys for this one call (VeilCore's circuits use
//              no coins and never ask for the caller's public key), and "balancing"
//              means sealing the transaction here and handing it to the sponsor, which
//              adds the fee in a separate part it cannot use to change this one.
// SPDX-License-Identifier: Apache-2.0

import { ZswapSecretKeys, type FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { createProofProvider, type UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { inMemoryPrivateStateProvider } from '../../in-memory-private-state-provider';
import type { VeilcorePrivateState } from '../../../../contract/src/witnesses';
import { browserCallDeps } from './prover-choice';
import { sendToSponsor } from './sponsor-client';
import { INDEXER_HTTP, INDEXER_WS } from './config';

export const PRIVATE_STATE_ID = 'veilcorePrivateState';

export type Hooks = {
  readonly progress: (msg: string) => void;
  /** The sealed bytes, just before they go to the sponsor (tests read them). */
  readonly onSealed?: (bytes: Uint8Array) => void;
  /** The sponsor accepted the transaction and sent it to the network. */
  readonly onSent?: (txId: string) => void;
};

export const makeProviders = (cacheName: string, hooks: Hooks, deps = browserCallDeps()) => {
  // Throwaway keys for this call only.
  const ephemeral = ZswapSecretKeys.fromSeed(crypto.getRandomValues(new Uint8Array(32)));
  let submitted: string | undefined;

  const walletProvider = {
    getCoinPublicKey: () => ephemeral.coinPublicKey,
    getEncryptionPublicKey: () => ephemeral.encryptionPublicKey,
    balanceTx: async (tx: UnboundTransaction): Promise<FinalizedTransaction> => {
      // Sealing (binding) is irreversible: nobody, the sponsor included, can change the
      // call after this. The sponsor can only add its fee part next to it, or refuse.
      const sealed = tx.bind();
      const bytes = sealed.serialize();
      hooks.onSealed?.(bytes);
      hooks.progress('Sending it to VeilCore, which pays the network fee…');
      await sendToSponsor(bytes, deps.pow, deps.fetch);
      // Watch for this transaction by its own identifier, not by what the sponsor says.
      submitted = sealed.identifiers()[0];
      hooks.onSent?.(submitted);
      return sealed;
    },
  };

  return {
    privateStateProvider: inMemoryPrivateStateProvider<typeof PRIVATE_STATE_ID, VeilcorePrivateState>(),
    publicDataProvider:
      deps.publicData ?? indexerPublicDataProvider(INDEXER_HTTP ?? '', INDEXER_WS ?? '', globalThis.WebSocket as never),
    zkConfigProvider: new FetchZkConfigProvider<string>(deps.origin, deps.fetch),
    proofProvider: createProofProvider(deps.proving(cacheName)),
    walletProvider,
    midnightProvider: {
      submitTx: (): Promise<string> =>
        submitted ? Promise.resolve(submitted) : Promise.reject(new Error('Nothing was sent to the sponsor.')),
    },
  };
};
