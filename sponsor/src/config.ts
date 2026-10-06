// Configuration, from environment variables only (Railway sets them). Anything missing
// or unsafe stops the service before it touches a wallet, with every problem listed.
// sponsor/README.md documents each variable.
// SPDX-License-Identifier: Apache-2.0

import { allowList, PHASE1_PUBLIC_CIRCUITS } from './policy.js';
import { DEFAULT_LIMITS, type LimitConfig } from './limits.js';

/** One DUST is 10^15 SPECKs. */
export const SPECKS_PER_DUST = 1_000_000_000_000_000n;

export type Network = 'preprod' | 'preview' | 'undeployed';

export const ENDPOINTS: Record<Network, { indexer: string; indexerWS: string; nodeWS: string }> = {
  preprod: {
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeWS: 'wss://rpc.preprod.midnight.network',
  },
  preview: {
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    nodeWS: 'wss://rpc.preview.midnight.network',
  },
  undeployed: {
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    nodeWS: 'ws://127.0.0.1:9944',
  },
};

export type Config = {
  readonly network: Network;
  readonly port: number;
  readonly seed: string;
  readonly forbiddenAddresses: readonly string[];
  readonly contractAddress: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly nodeWS: string;
  readonly proofServer: string;
  readonly stateDir: string;
  readonly artifactsDir: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedCircuits: ReadonlySet<string>;
  readonly maxTxBytes: number;
  readonly maxTtlMs: number;
  readonly maxFeeSpecks: bigint;
  readonly dailyBudgetSpecks: bigint;
  readonly powDifficulty: number;
  readonly queueDepth: number;
  readonly limits: LimitConfig;
  readonly trustProxyHops: number;
  /** Shows the detailed /sponsor/status (exact budget, counters, error text). Empty: public view only. */
  readonly statusToken: string;
  readonly anchorer:
    | { readonly enabled: false; readonly why: string }
    | {
        readonly enabled: true;
        readonly registryUrl: string;
        readonly operatorToken: string;
        readonly everyMs: number;
        readonly sealAtPending: number;
      };
};

/**
 * Variables that mean this process could hold, or unlock, the contract's maintenance
 * key. The sponsor's seed lives on Railway; the maintenance key must never be anywhere
 * near it (design: "Keep the maintenance key off Railway entirely").
 */
const MAINTENANCE_HINTS = [/MAINTENANCE/i, /SIGNING_KEY/i, /AUTHORITY/i, /^VEILCORE_PRIVATE_STATE_PASSWORD$/];

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The sponsor will not start:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

const hex = (s: string | undefined, bytes: number): string | undefined => {
  const v = (s ?? '').trim().toLowerCase().replace(/^0x/, '');
  return new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(v) ? v : undefined;
};

const int = (s: string | undefined, dflt: number, min: number, max: number, name: string, problems: string[]): number => {
  if (s === undefined || s.trim() === '') return dflt;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be a whole number from ${min} to ${max}.`);
    return dflt;
  }
  return n;
};

const dust = (s: string | undefined, dflt: bigint, name: string, problems: string[]): bigint => {
  if (s === undefined || s.trim() === '') return dflt;
  // Accept DUST with up to 15 decimals ("2.5") so nobody has to count SPECK zeros.
  const m = /^(\d{1,9})(?:\.(\d{1,15}))?$/.exec(s.trim());
  if (!m) {
    problems.push(`${name} must be an amount of DUST, like 2 or 0.5.`);
    return dflt;
  }
  return BigInt(m[1]) * SPECKS_PER_DUST + BigInt((m[2] ?? '').padEnd(15, '0') || '0');
};

export const loadConfig = (env: Record<string, string | undefined>): Config => {
  const problems: string[] = [];

  const holdsMaintenance = Object.keys(env).filter((k) => env[k] && MAINTENANCE_HINTS.some((r) => r.test(k)));
  if (holdsMaintenance.length > 0) {
    problems.push(
      `Remove ${holdsMaintenance.join(', ')}: the sponsor must never hold the contract's maintenance key or what unlocks it.`,
    );
  }

  const networkRaw = (env.SPONSOR_NETWORK ?? 'preprod').trim().toLowerCase();
  if (networkRaw === 'mainnet') {
    problems.push('SPONSOR_NETWORK=mainnet is refused: this service pays fees on test networks only until its limits are measured.');
  }
  const network: Network = (['preprod', 'preview', 'undeployed'] as const).includes(networkRaw as Network)
    ? (networkRaw as Network)
    : (problems.push(`SPONSOR_NETWORK must be preprod, preview or undeployed (got "${networkRaw}").`), 'preprod');

  const seed = hex(env.SPONSOR_SEED, 32);
  if (!seed) problems.push('SPONSOR_SEED must be the sponsor wallet’s 64-character hex seed.');

  const forbiddenAddresses = (env.SPONSOR_FORBIDDEN_ADDRESSES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (forbiddenAddresses.length === 0) {
    problems.push(
      'SPONSOR_FORBIDDEN_ADDRESSES must list the deployer wallet’s addresses (comma-separated), so the sponsor can refuse to run as that wallet.',
    );
  }

  const contractAddress = hex(env.VEILCORE_CONTRACT_ADDRESS, 32);
  if (!contractAddress) problems.push('VEILCORE_CONTRACT_ADDRESS must be the 64-character contract address.');

  const proofServer = (env.PROOF_SERVER_URL ?? '').trim();
  if (!/^https?:\/\//.test(proofServer)) {
    problems.push('PROOF_SERVER_URL must be the address of a Midnight proof server this service can reach (http://…).');
  }

  let allowedCircuits: ReadonlySet<string> = new Set(PHASE1_PUBLIC_CIRCUITS);
  if (env.SPONSOR_CIRCUITS?.trim()) {
    try {
      allowedCircuits = allowList(env.SPONSOR_CIRCUITS.split(',').map((s) => s.trim()).filter(Boolean));
    } catch (e) {
      problems.push(`SPONSOR_CIRCUITS: ${(e as Error).message}`);
    }
  }

  const origins = (env.ALLOWED_ORIGINS ?? 'https://veilcore.org,https://www.veilcore.org')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of origins) if (!/^https?:\/\/[^/]+$/.test(o)) problems.push(`ALLOWED_ORIGINS: "${o}" is not an origin.`);

  const registryUrl = (env.REGISTRY_URL ?? '').trim();
  const operatorToken = (env.REGISTRY_OPERATOR_TOKEN ?? '').trim();
  const anchorerOff = env.ANCHORER_ENABLED === '0';
  if (!anchorerOff && registryUrl && !/^https?:\/\//.test(registryUrl)) problems.push('REGISTRY_URL must start with http:// or https://.');

  const statusToken = (env.SPONSOR_STATUS_TOKEN ?? '').trim();
  if (statusToken && !/^[\x21-\x7e]{32,256}$/.test(statusToken)) {
    problems.push('SPONSOR_STATUS_TOKEN must be at least 32 characters with no spaces (for example 64 random hex characters).');
  }

  const ep = ENDPOINTS[network];
  const cfg: Config = {
    network,
    port: int(env.PORT, 8080, 1, 65535, 'PORT', problems),
    seed: seed ?? '',
    forbiddenAddresses,
    contractAddress: contractAddress ?? '',
    indexer: env.INDEXER_URL?.trim() || ep.indexer,
    indexerWS: env.INDEXER_WS_URL?.trim() || ep.indexerWS,
    nodeWS: env.NODE_WS_URL?.trim() || ep.nodeWS,
    proofServer,
    stateDir: env.STATE_DIR?.trim() || './state',
    artifactsDir: env.VEILCORE_ARTIFACTS_DIR?.trim() || '',
    allowedOrigins: origins,
    allowedCircuits,
    maxTxBytes: int(env.MAX_TX_BYTES, 64_000, 1_000, 1_000_000, 'MAX_TX_BYTES', problems),
    maxTtlMs: int(env.MAX_TTL_MINUTES, 30, 1, 120, 'MAX_TTL_MINUTES', problems) * 60_000,
    maxFeeSpecks: dust(env.MAX_FEE_DUST, 5n * SPECKS_PER_DUST, 'MAX_FEE_DUST', problems),
    dailyBudgetSpecks: dust(env.DAILY_BUDGET_DUST, 50n * SPECKS_PER_DUST, 'DAILY_BUDGET_DUST', problems),
    powDifficulty: int(env.POW_DIFFICULTY, 18, 0, 28, 'POW_DIFFICULTY', problems),
    queueDepth: int(env.QUEUE_DEPTH, 20, 1, 500, 'QUEUE_DEPTH', problems),
    limits: {
      requestsPerMinute: int(env.LIMIT_REQUESTS_PER_MINUTE, DEFAULT_LIMITS.requestsPerMinute, 1, 10_000, 'LIMIT_REQUESTS_PER_MINUTE', problems),
      perIpHour: int(env.LIMIT_PER_NETWORK_HOUR, DEFAULT_LIMITS.perIpHour, 1, 10_000, 'LIMIT_PER_NETWORK_HOUR', problems),
      perIpDay: int(env.LIMIT_PER_NETWORK_DAY, DEFAULT_LIMITS.perIpDay, 1, 100_000, 'LIMIT_PER_NETWORK_DAY', problems),
      perTicketDay: DEFAULT_LIMITS.perTicketDay,
    },
    trustProxyHops: int(env.TRUST_PROXY_HOPS, 1, 0, 5, 'TRUST_PROXY_HOPS', problems),
    statusToken,
    anchorer: anchorerOff
      ? { enabled: false, why: 'ANCHORER_ENABLED=0' }
      : !registryUrl || !operatorToken
        ? { enabled: false, why: 'REGISTRY_URL or REGISTRY_OPERATOR_TOKEN is not set' }
        : {
            enabled: true,
            registryUrl,
            operatorToken,
            everyMs: int(env.ANCHOR_EVERY_MINUTES, 60, 5, 24 * 60, 'ANCHOR_EVERY_MINUTES', problems) * 60_000,
            sealAtPending: int(env.ANCHOR_AT_PENDING, 25, 1, 100_000, 'ANCHOR_AT_PENDING', problems),
          },
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return cfg;
};

/**
 * Refuse a wallet that is the deployer's. Compared against every address the operator
 * listed; any match stops the service.
 */
export const assertNotForbidden = (own: readonly string[], forbidden: readonly string[]): void => {
  const f = new Set(forbidden.map((a) => a.trim().toLowerCase()));
  const hit = own.find((a) => f.has(a.trim().toLowerCase()));
  if (hit !== undefined) {
    throw new ConfigError([
      `SPONSOR_SEED is the wallet at ${hit}, which is listed in SPONSOR_FORBIDDEN_ADDRESSES. Use a separate wallet made only for the sponsor.`,
    ]);
  }
};

/**
 * Refuse a seed that, read as a signing key, is a member of the contract's maintenance
 * committee: the maintenance key pasted where the sponsor seed goes.
 */
export const assertNotMaintenanceKey = (
  seed: string,
  committee: readonly string[],
  verifyingKeyOf: (signingKey: string) => string,
): void => {
  let vk: string | undefined;
  try {
    vk = verifyingKeyOf(seed);
  } catch {
    return; // not a valid signing key at all, so it cannot be one
  }
  if (committee.some((c) => c.toLowerCase() === vk.toLowerCase())) {
    throw new ConfigError(['SPONSOR_SEED is the contract’s maintenance key. Never put that key on Railway.']);
  }
};
