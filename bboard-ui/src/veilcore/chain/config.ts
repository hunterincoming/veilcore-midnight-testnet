// Whether this build sends real transactions, and where. Everything here comes from the
// build's environment (bboard-ui/.env.<mode>), so a build without VITE_REAL_CHAIN=1
// behaves exactly as the demo always has: nothing is sent to any network.
//
//   VITE_REAL_CHAIN=1                     turn the real-chain features on
//   VITE_REAL_CHAIN_CONTRACT_ADDRESS=…    the demo contract on preprod (64 hex characters)
//   VITE_SPONSOR_URL=https://…            the sponsor service that pays the fees
//   VITE_INDEXER_URL / VITE_INDEXER_WS_URL  the network's indexer (required on preprod: see INDEXERS)
// SPDX-License-Identifier: Apache-2.0

import { NETWORK } from '../../config/network';

const env = import.meta.env as unknown as Record<string, string | undefined>;

/** The flag. Off unless the build says exactly "1". */
export const REAL_CHAIN: boolean = env.VITE_REAL_CHAIN === '1';

const addr = (env.VITE_REAL_CHAIN_CONTRACT_ADDRESS ?? '').trim().toLowerCase().replace(/^0x/, '');
/** The contract the demo writes to, or undefined when none is configured. */
export const CHAIN_CONTRACT: string | undefined = /^[0-9a-f]{64}$/.test(addr) ? addr : undefined;

const sponsor = (env.VITE_SPONSOR_URL ?? '').trim().replace(/\/$/, '');
export const SPONSOR_URL: string | undefined = /^https?:\/\/[^\s]+$/.test(sponsor) ? sponsor : undefined;

// Midnight's own public indexers, where it still runs one. Preprod has none since 9 October
// 2026 (it is served by Blockfrost, which needs a project id): a preprod build must set
// VITE_INDEXER_URL and VITE_INDEXER_WS_URL. A project id in those is a key inside the page,
// so such a build is for this computer only; scripts/vercel-config.mjs refuses to deploy it.
const INDEXERS: Record<string, { http: string; ws: string }> = {
  preview: {
    http: 'https://indexer.preview.midnight.network/api/v4/graphql',
    ws: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  },
};

export const INDEXER_HTTP: string | undefined = env.VITE_INDEXER_URL?.trim() || INDEXERS[NETWORK]?.http;
export const INDEXER_WS: string | undefined = env.VITE_INDEXER_WS_URL?.trim() || INDEXERS[NETWORK]?.ws;

/** Why the real-chain features cannot run in this build, or undefined when they can. */
export const chainNotReady = (): string | undefined => {
  if (!REAL_CHAIN) return 'This build does not send transactions.';
  if (NETWORK === 'mainnet') return 'The website demo only sends transactions on a test network.';
  if (!CHAIN_CONTRACT) return 'No demo contract address is configured (VITE_REAL_CHAIN_CONTRACT_ADDRESS).';
  if (!SPONSOR_URL) return 'No sponsor service is configured (VITE_SPONSOR_URL).';
  if (!INDEXER_HTTP || !INDEXER_WS) return 'No indexer is configured for this network.';
  return undefined;
};

/** True when this build can send real transactions. */
export const CHAIN_READY: boolean = chainNotReady() === undefined;

/** The circuits the browser may call in phase 1, and nothing else. */
export const BROWSER_CIRCUITS = ['anchor', 'proveOwnership', 'pairDna'] as const;
export type BrowserCircuit = (typeof BROWSER_CIRCUITS)[number];
