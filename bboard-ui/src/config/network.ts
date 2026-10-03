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

/** Demo mode: no contract address configured, so nothing in the app writes to a chain. */
export const DEMO_MODE = !(import.meta.env.VITE_VEILCORE_CONTRACT_ADDRESS as string | undefined);
