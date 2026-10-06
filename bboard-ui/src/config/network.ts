// Which Midnight network this build talks to, and how to name it. Every network label in
// the app comes from here, so a preprod build never says "Preview" and a test network is
// never presented as the live one.
//
// Explorer addresses are the ones Midnight lists in its network documentation
// (docs.midnight.network/relnotes/network). Midnight does not document a per-transaction
// URL for them, so the app links to the explorer and shows the full transaction hash.
// SPDX-License-Identifier: Apache-2.0

export type NetworkId = 'mainnet' | 'preprod' | 'preview' | 'undeployed';

const KNOWN: NetworkId[] = ['mainnet', 'preprod', 'preview', 'undeployed'];

const configured = (import.meta.env.VITE_NETWORK_ID as string | undefined)?.toLowerCase();

/** This build's network. An unknown or missing value is treated as a local, undeployed one. */
export const NETWORK: NetworkId = KNOWN.includes(configured as NetworkId) ? (configured as NetworkId) : 'undeployed';

/** True for every network except mainnet. */
export const isTestNetwork = (n: string = NETWORK): boolean => n !== 'mainnet';

/** Plain name for a network, e.g. "Midnight preprod (test network)". */
export const networkLabel = (n: string = NETWORK): string => {
  switch (n) {
    case 'mainnet':
      return 'Midnight mainnet';
    case 'preprod':
      return 'Midnight preprod (test network)';
    case 'preview':
      return 'Midnight Preview (test network)';
    default:
      return 'a local development network';
  }
};

/** The explorer for a network, if Midnight lists one. */
export const explorerFor = (n: string = NETWORK): string | undefined => {
  switch (n) {
    case 'mainnet':
      return 'https://midnightexplorer.com/';
    case 'preprod':
      return 'https://preprod.midnightexplorer.com/';
    case 'preview':
      return 'https://preview.midnightexplorer.com/';
    default:
      return undefined;
  }
};

/**
 * Which network the site DESCRIBES: Midnight's main network in a `--mode mainnet` build,
 * a test network in every other build. It decides wording, labels and the explorer the
 * site links to. It switches on nothing else: the site never sends a transaction in any
 * build (records are dated by the registry's operator, in batches; licenses and lab
 * agreements in the web demo are simulated). There is deliberately no switch here that
 * turns on chain-writing code.
 */
export const IS_MAINNET: boolean = NETWORK === 'mainnet';

/**
 * The main contract's address on mainnet, for display. Set only in a mainnet build, from
 * MAINNET_VEILCORE_ADDRESS in api/src/deploy-guard.ts (vite.config.ts; a mainnet build
 * refuses to start without it). Empty in every other build.
 */
export const MAINNET_CONTRACT_ADDRESS: string = import.meta.env.VITE_MAINNET_CONTRACT_ADDRESS ?? '';

/** The claims contract's address on mainnet, for display; empty until it is pinned. */
export const MAINNET_CLAIMS_ADDRESS: string = import.meta.env.VITE_MAINNET_CLAIMS_ADDRESS ?? '';

/** The claims contract is on mainnet (its address is pinned) and this is a mainnet build. */
export const CLAIMS_ON_MAINNET: boolean = IS_MAINNET && MAINNET_CLAIMS_ADDRESS !== '';

/**
 * The origin every shared link and QR code points at. Links used to be built from
 * window.location.origin, so a certificate printed from a preview deployment, or from
 * a copy of the static bundle hosted anywhere, sent whoever scanned it to that host.
 */
export const CANONICAL_ORIGIN = 'https://veilcore.org';

/** An absolute link on the canonical site, for a path that starts with "/". */
export const canonicalUrl = (path: string): string => `${CANONICAL_ORIGIN}${path}`;
