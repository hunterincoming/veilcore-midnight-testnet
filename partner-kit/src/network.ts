// Networks, their public endpoints, and which VeilCore contract each one has.
// SPDX-License-Identifier: Apache-2.0

import { MAINNET_CLAIMS_ADDRESS, MAINNET_VEILCORE_ADDRESS, RECORD_NOT_REQUIRED } from '../../api/src/deploy-guard.js';

/**
 * The Midnight networks this package knows. `undeployed` is a local standalone chain
 * (partner-kit/local/compose.yml), new each time it starts.
 */
export type Network = 'mainnet' | 'preprod' | 'preview' | 'undeployed';
export const NETWORKS: readonly Network[] = ['mainnet', 'preprod', 'preview', 'undeployed'];

export const isNetwork = (n: unknown): n is Network => typeof n === 'string' && (NETWORKS as string[]).includes(n);

/** Where to reach a network. */
export type Endpoints = {
  /** The indexer's GraphQL URL (https://…/graphql). */
  readonly indexer: string;
  /** The indexer's GraphQL subscription URL (wss://…/graphql/ws). */
  readonly indexerWS: string;
  /** A node's RPC URL (https://…). */
  readonly node: string;
  /** The same node over WebSocket (wss://…). */
  readonly nodeWS: string;
  /**
   * A proof server. Run your own, next to your code: the private inputs of every proof
   * (record secrets, licence secrets, hidden field values) are sent to it.
   */
  readonly proofServer: string;
};

/** A proof server on this machine: `docker run -p 6300:6300 midnightntwrk/proof-server:8.0.3 midnight-proof-server -v`. */
export const DEFAULT_PROOF_SERVER = 'http://127.0.0.1:6300';

/** The proof server image VeilCore's own tools run, by tag. */
export const PROOF_SERVER_IMAGE = 'midnightntwrk/proof-server:8.0.3';

const PUBLIC: Record<Exclude<Network, 'mainnet'>, Omit<Endpoints, 'proofServer'>> = {
  preprod: {
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    nodeWS: 'wss://rpc.preprod.midnight.network',
  },
  preview: {
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    nodeWS: 'wss://rpc.preview.midnight.network',
  },
  // partner-kit/local/compose.yml publishes these ports.
  undeployed: {
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    node: 'http://127.0.0.1:9944',
    nodeWS: 'ws://127.0.0.1:9944',
  },
};

/**
 * Mainnet's indexer and node through Blockfrost, the public provider since Midnight shut
 * its own mainnet endpoints on 30 September 2026. The project id rides in the query
 * string (midnight-js cannot set headers), so treat these URLs as secrets: never log them.
 */
export const blockfrostMainnet = (projectId: string): Omit<Endpoints, 'proofServer'> => {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(projectId))
    throw new Error('That is not a Blockfrost project id. Create a Midnight Mainnet project at blockfrost.io.');
  const q = `?project_id=${encodeURIComponent(projectId)}`;
  return {
    indexer: `https://midnight-mainnet.blockfrost.io/api/v0${q}`,
    indexerWS: `wss://midnight-mainnet.blockfrost.io/api/v0/ws${q}`,
    node: `https://rpc.midnight-mainnet.blockfrost.io/${q}`,
    nodeWS: `wss://rpc.midnight-mainnet.blockfrost.io/${q}`,
  };
};

/**
 * The endpoints for `network`, with any of them replaced by `overrides`. Mainnet needs a
 * Blockfrost project id, or all four of indexer, indexerWS, node and nodeWS given.
 */
export const endpointsFor = (
  network: Network,
  overrides: Partial<Endpoints> = {},
  options: { readonly blockfrostProjectId?: string } = {},
): Endpoints => {
  if (!isNetwork(network)) throw new Error(`Unknown network ${String(network)}. Use one of ${NETWORKS.join(', ')}.`);
  const given = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== ''));
  let base: Omit<Endpoints, 'proofServer'>;
  if (network === 'mainnet') {
    const all = ['indexer', 'indexerWS', 'node', 'nodeWS'].every((k) => typeof given[k] === 'string');
    if (options.blockfrostProjectId !== undefined) base = blockfrostMainnet(options.blockfrostProjectId);
    else if (all) base = given as unknown as Omit<Endpoints, 'proofServer'>;
    else
      throw new Error(
        'Mainnet has no public endpoints of its own: give a Blockfrost project id (blockfrostProjectId), or all of ' +
          'indexer, indexerWS, node and nodeWS for a provider you trust.',
      );
  } else base = PUBLIC[network];
  return { ...base, proofServer: DEFAULT_PROOF_SERVER, ...given };
};

// ─────────────────────────────────────────────────────────── addresses

export type ContractKind = 'veilcore' | 'claims';

/**
 * VeilCore's contracts on preprod: the pair deployed by the 5 October 2026 smoke test
 * (docs/preprod-run-5oct.md), from the build in the deployment record. Test network: the
 * main contract's maintenance key was random and discarded; the claims contract's
 * authority is an empty committee. Anything there is test data.
 */
export const PREPROD_ADDRESSES: Readonly<Record<ContractKind, string>> = {
  veilcore: '93c062e10863ee8d4d72694a42908aa6c55036645fcc327fafc533bc827dc294',
  claims: '29d3ea80e121518f8fd8bd72533d856cf29cdbddbda1b6f322a661aa4f2484b6',
};

/**
 * VeilCore's contracts on mainnet, as the filed deployment record names them. Empty
 * until the mainnet deploy; until then, nothing on mainnet is accepted as VeilCore's.
 */
export const MAINNET_ADDRESSES: Readonly<Record<ContractKind, string>> = {
  veilcore: MAINNET_VEILCORE_ADDRESS,
  claims: MAINNET_CLAIMS_ADDRESS,
};

const norm = (a: string): string => a.trim().toLowerCase().replace(/^0x/, '');

/** The address to use when none is given: the pinned one on mainnet, the known one on preprod. */
export const defaultAddress = (network: Network, kind: ContractKind): string | undefined => {
  if (network === 'mainnet') return MAINNET_ADDRESSES[kind] === '' ? undefined : MAINNET_ADDRESSES[kind];
  if (network === 'preprod') return PREPROD_ADDRESSES[kind];
  return undefined;
};

/**
 * Throw unless `address` may be treated as VeilCore's `kind` contract on `network`: on a
 * development network any address (you deployed it, or someone told you which); on every
 * other network, mainnet included, only the pinned address, and nothing while that is
 * empty. The same rule as api/src/deploy-guard.ts (assertJoinAllowed,
 * assertClaimsJoinAllowed), with the network passed in rather than read from the process.
 */
export const assertAddressFor = (network: Network, kind: ContractKind, address: string): 'development' | 'pinned' => {
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(address.trim())) throw new Error('That is not a contract address (64 hex).');
  if (RECORD_NOT_REQUIRED.has(network)) return 'development';
  const pinned = norm(MAINNET_ADDRESSES[kind]);
  const name = kind === 'veilcore' ? 'VeilCore' : 'VeilCore claims';
  if (pinned === '')
    throw new Error(
      `Refusing ${address}: on ${network} no ${name} contract is pinned in this version of @veilcore/contracts yet ` +
        '(the mainnet address goes in with the deploy). Nothing was read or sent.',
    );
  if (norm(address) !== pinned)
    throw new Error(
      `Refusing ${address}: on ${network} the ${name} contract is ${pinned} (the deployment record). ` +
        'Another address can carry the same circuits with other state. Nothing was read or sent.',
    );
  return 'pinned';
};

/** `address`, or the default for `network`; refused unless it may be treated as VeilCore's. */
export const resolveAddress = (network: Network, kind: ContractKind, address?: string): string => {
  const a = address ?? defaultAddress(network, kind);
  if (a === undefined)
    throw new Error(
      network === 'mainnet'
        ? `No ${kind === 'veilcore' ? 'VeilCore' : 'claims'} contract is pinned for mainnet in this version yet. Nothing was read or sent.`
        : `Give the ${kind === 'veilcore' ? 'VeilCore' : 'claims'} contract's address on ${network}.`,
    );
  assertAddressFor(network, kind, a);
  return norm(a);
};
