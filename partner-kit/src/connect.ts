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
import { scrubTerminal, urlSecrets } from './terminal.js';

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
  /**
   * By default, a credential carried in an endpoint URL (a Blockfrost project id) is
   * redacted from everything written through process.stdout and process.stderr, since
   * libraries print those URLs past any logger (terminal.ts; a logger that writes to the
   * file descriptors directly, such as pino's default destination, is not covered).
   * `false` leaves the terminal alone.
   */
  readonly scrubTerminal?: boolean;
  /**
   * Every proof sends the proof server its private inputs: record secrets, licence
   * secrets, hidden field values. So a proof server that is not on this machine is
   * refused unless this is `true`, and even then only over https. Set it only for a
   * proof server you run yourself, on a network you control.
   */
  readonly allowRemoteProofServer?: boolean;
};

/** A network and the providers for both contracts. Pass it to VeilCore.join and VeilCoreClaims.join. */
export type Connection = {
  readonly network: Network;
  readonly endpoints: Endpoints;
  readonly logger?: Logger;
  readonly providers: { readonly veilcore: VeilcoreProviders; readonly claims: ClaimsProviders };
};

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** A proof server URL refused: not on this machine and not allowed, or remote over plain http. */
export class ProofServerRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofServerRefusedError';
  }
}

/** Whether a URL is on this machine. A proof server anywhere else receives every proof's private inputs. */
export const isLocalUrl = (url: string): boolean => {
  try {
    return LOCAL.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * Throw ProofServerRefusedError unless `url` may receive proofs' private inputs: a proof
 * server on this machine, or, with `allowRemote`, one elsewhere over https. Nothing is
 * sent before this is checked.
 */
export const assertProofServer = (url: string, allowRemote = false): void => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProofServerRefusedError(`${url} is not a proof server URL.`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new ProofServerRefusedError(`A proof server is reached over http or https, not ${u.protocol}.`);
  if (isLocalUrl(url)) return;
  if (!allowRemote)
    throw new ProofServerRefusedError(
      `Refused proof server ${u.host}: it is not on this machine, and every proof sends it its private inputs ` +
        '(record and licence secrets, hidden field values). Run one on this machine (DEFAULT_PROOF_SERVER), or, for ' +
        'one you run yourself elsewhere, pass allowRemoteProofServer: true and an https URL. Nothing was sent.',
    );
  if (u.protocol !== 'https:')
    throw new ProofServerRefusedError(
      `Refused proof server ${u.host}: a proof server that is not on this machine must be reached over https, ` +
        'or its private inputs cross the network in the clear. Nothing was sent.',
    );
};

export const connect = (o: ConnectOptions): Connection => {
  if (!isNetwork(o.network)) throw new Error(`Unknown network ${String(o.network)}.`);
  const endpoints = endpointsFor(o.network, o.endpoints, { blockfrostProjectId: o.blockfrostProjectId });
  if (o.scrubTerminal !== false) scrubTerminal(urlSecrets(Object.values(endpoints)));
  assertProofServer(endpoints.proofServer, o.allowRemoteProofServer === true);
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
