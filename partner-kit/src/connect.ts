// connect(): everything midnight-js needs to call VeilCore's contracts, from what a
// partner supplies (a wallet, private state, keys) and the network's endpoints.
// SPDX-License-Identifier: Apache-2.0

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { type MidnightProvider, type PublicDataProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { type Logger } from 'pino';
import { type VeilcoreCircuitKeys, type VeilcoreProviders } from '../../api/src/veilcore-types.js';
import { type ClaimsCircuitKeys, type ClaimsProviders } from '../../api/src/claims-types.js';
import { DEFAULT_KEYS_URL, type KeySource, VerifiedZkConfigProvider } from './keys.js';
import { type Endpoints, type Network, endpointsFor, isNetwork } from './network.js';
import { type PrivateStateStores } from './private-state.js';

export type ConnectOptions = {
  /** Which Midnight network. One process works on one network (midnight-js keeps it process-wide). */
  readonly network: Network;
  /** The wallet that pays fees: a SeedWallet (seedWallet()), or your own WalletProvider + MidnightProvider. */
  readonly wallet: WalletProvider & MidnightProvider;
  /** Private state for each contract: encryptedPrivateState(), or your own providers. */
  readonly privateState: PrivateStateStores;
  /** Where proving keys and circuits come from. Default: VeilCore's published files, checked and cached. */
  readonly keys?: KeySource;
  /** Replace any endpoint (the proof server above all, if yours is not on this machine). */
  readonly endpoints?: Partial<Endpoints>;
  /** Mainnet only: a Blockfrost project id, unless all four chain endpoints are given. */
  readonly blockfrostProjectId?: string;
  readonly logger?: Logger;
  /** Use this public data provider instead of one built from the endpoints (tests). */
  readonly publicDataProvider?: PublicDataProvider;
};

/** A network and the providers for both contracts. Pass it to VeilCore.join and VeilCoreClaims.join. */
export type Connection = {
  readonly network: Network;
  readonly endpoints: Endpoints;
  readonly logger?: Logger;
  readonly providers: { readonly veilcore: VeilcoreProviders; readonly claims: ClaimsProviders };
};

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Whether a URL is on this machine. A proof server anywhere else receives every proof's private inputs. */
export const isLocalUrl = (url: string): boolean => {
  try {
    return LOCAL.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const connect = (o: ConnectOptions): Connection => {
  if (!isNetwork(o.network)) throw new Error(`Unknown network ${String(o.network)}.`);
  const endpoints = endpointsFor(o.network, o.endpoints, { blockfrostProjectId: o.blockfrostProjectId });
  if (!isLocalUrl(endpoints.proofServer))
    o.logger?.warn(
      'The proof server is not on this machine. Every proof sends it its private inputs (record and licence ' +
        'secrets, hidden field values): use only one you run yourself, over a private network.',
    );
  setNetworkId(o.network);
  const publicDataProvider = o.publicDataProvider ?? indexerPublicDataProvider(endpoints.indexer, endpoints.indexerWS);
  const keys = o.keys ?? { url: DEFAULT_KEYS_URL };
  const veilcoreZk = new VerifiedZkConfigProvider<VeilcoreCircuitKeys>('veilcore', keys);
  const claimsZk = new VerifiedZkConfigProvider<ClaimsCircuitKeys>('veilcore-claims', keys);
  return {
    network: o.network,
    endpoints,
    logger: o.logger,
    providers: {
      veilcore: {
        privateStateProvider: o.privateState.veilcore,
        publicDataProvider,
        zkConfigProvider: veilcoreZk,
        proofProvider: httpClientProofProvider(endpoints.proofServer, veilcoreZk),
        walletProvider: o.wallet,
        midnightProvider: o.wallet,
      },
      claims: {
        privateStateProvider: o.privateState.claims,
        publicDataProvider,
        zkConfigProvider: claimsZk,
        proofProvider: httpClientProofProvider(endpoints.proofServer, claimsZk),
        walletProvider: o.wallet,
        midnightProvider: o.wallet,
      },
    },
  };
};
