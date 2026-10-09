// Endpoints and the address rule (src/network.ts). The rule must be the deploy guard's
// (api/src/deploy-guard.ts, assertJoinAllowed / assertClaimsJoinAllowed) with the network
// passed in: here it is checked against the real guard with an address pinned.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const PIN = vi.hoisted(() => ({ veilcore: 'a1'.repeat(32), claims: 'c1'.repeat(32) }));
vi.mock('../../api/src/deploy-guard.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  MAINNET_VEILCORE_ADDRESS: PIN.veilcore,
  MAINNET_CLAIMS_ADDRESS: PIN.claims,
}));

const real = await vi.importActual<typeof import('../../api/src/deploy-guard.js')>('../../api/src/deploy-guard.js');
const { NETWORKS, PREPROD_ADDRESSES, assertAddressFor, defaultAddress, endpointsFor, resolveAddress } =
  await import('../src/network');

afterEach(() => setNetworkId('undeployed'));

const outcome = (f: () => unknown): string => {
  try {
    return `ok:${String(f())}`;
  } catch {
    return 'refused';
  }
};

describe('the address rule', () => {
  it('is the deploy guard’s, network by network, for both contracts', () => {
    const addresses = [PIN.veilcore, PIN.claims, `0x${PIN.veilcore.toUpperCase()}`, 'b2'.repeat(32)];
    for (const n of NETWORKS) {
      setNetworkId(n);
      for (const a of addresses) {
        expect(outcome(() => assertAddressFor(n, 'veilcore', a))).toBe(
          outcome(() => real.assertJoinAllowed(a, undefined, PIN.veilcore)),
        );
        expect(outcome(() => assertAddressFor(n, 'claims', a))).toBe(
          outcome(() => real.assertClaimsJoinAllowed(a, undefined, PIN.claims)),
        );
      }
    }
  });

  it('on mainnet takes the pinned address by default and refuses any other', () => {
    expect(resolveAddress('mainnet', 'veilcore')).toBe(PIN.veilcore);
    expect(resolveAddress('mainnet', 'claims')).toBe(PIN.claims);
    expect(() => resolveAddress('mainnet', 'veilcore', 'b2'.repeat(32))).toThrow(/the deployment record/);
    expect(() => resolveAddress('mainnet', 'veilcore', PIN.claims)).toThrow(/Refusing/);
  });

  it('on preprod defaults to the 5 October contracts, as the run record names them', () => {
    const record = readFileSync(new URL('../../docs/preprod-run-5oct.md', import.meta.url), 'utf8');
    expect(record).toContain(`\`${PREPROD_ADDRESSES.veilcore}\``);
    expect(record).toContain(`\`${PREPROD_ADDRESSES.claims}\``);
    expect(defaultAddress('preprod', 'veilcore')).toBe(PREPROD_ADDRESSES.veilcore);
    expect(defaultAddress('undeployed', 'veilcore')).toBeUndefined();
    expect(() => resolveAddress('preview', 'claims')).toThrow(/Give the claims contract's address on preview/);
    expect(() => resolveAddress('undeployed', 'veilcore', 'not an address')).toThrow(/not a contract address/);
  });
});

describe('endpoints', () => {
  it('are the ones the CLI uses, and a proof server on this machine', () => {
    const cli = readFileSync(new URL('../../bboard-cli/src/config.ts', import.meta.url), 'utf8');
    for (const n of ['preprod', 'preview'] as const) {
      const e = endpointsFor(n);
      for (const url of [e.indexer, e.indexerWS, e.node, e.nodeWS]) expect(cli).toContain(`'${url}'`);
      expect(e.proofServer).toBe('http://127.0.0.1:6300');
    }
    expect(endpointsFor('preprod', { proofServer: 'http://10.0.0.5:6300' }).proofServer).toBe('http://10.0.0.5:6300');
  });

  it('on mainnet need a Blockfrost project id or every chain endpoint', () => {
    expect(() => endpointsFor('mainnet')).toThrow(/Blockfrost project id/);
    expect(() => endpointsFor('mainnet', {}, { blockfrostProjectId: 'x' })).toThrow(/not a Blockfrost project id/);
    const e = endpointsFor('mainnet', {}, { blockfrostProjectId: 'mainnetAbCdEf123' });
    expect(e.indexer).toBe('https://midnight-mainnet.blockfrost.io/api/v0?project_id=mainnetAbCdEf123');
    const own = { indexer: 'https://i/graphql', indexerWS: 'wss://i/ws', node: 'https://n', nodeWS: 'wss://n' };
    expect(endpointsFor('mainnet', own)).toMatchObject(own);
    expect(() => endpointsFor('devnet' as never)).toThrow(/Unknown network/);
  });
});

// 8 October 2026 review: every proof sends the proof server record and licence secrets;
// connect() used to accept any URL with only a warning to an optional logger.
const { ProofServerRefusedError, assertProofServer, connect } = await import('../src/connect');
const { SeedWallet } = await import('../src/wallet');
describe('the proof server', () => {
  const base = {
    network: 'preprod' as const,
    wallet: {} as never,
    privateState: { veilcore: {} as never, claims: {} as never },
    publicDataProvider: {} as never,
    scrubTerminal: false,
  };

  it('on this machine: accepted', () => {
    for (const u of ['http://127.0.0.1:6300', 'http://localhost:6300', 'http://[::1]:6300'])
      expect(() => assertProofServer(u)).not.toThrow();
    expect(connect(base).endpoints.proofServer).toBe('http://127.0.0.1:6300');
  });

  it('elsewhere: REFUSED unless allowed, and then only over https; nothing is built', () => {
    expect(() => connect({ ...base, endpoints: { proofServer: 'http://10.0.0.5:6300' } })).toThrow(
      ProofServerRefusedError,
    );
    expect(() => connect({ ...base, endpoints: { proofServer: 'https://proofs.example.com' } })).toThrow(
      /not on this machine.*allowRemoteProofServer/,
    );
    expect(() =>
      connect({ ...base, endpoints: { proofServer: 'http://proofs.example.com' }, allowRemoteProofServer: true }),
    ).toThrow(/must be reached over https/);
    const warn = vi.fn();
    const c = connect({
      ...base,
      endpoints: { proofServer: 'https://proofs.example.com' },
      allowRemoteProofServer: true,
      logger: { warn } as never,
    });
    expect(c.endpoints.proofServer).toBe('https://proofs.example.com');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not on this machine/));
    expect(() => assertProofServer('ftp://127.0.0.1:6300')).toThrow(/http or https/);
    expect(() => assertProofServer('not a url')).toThrow(/not a proof server URL/);
  });

  it("the seed wallet's own proof server follows the same rule", async () => {
    const endpoints = { ...endpointsFor('preprod'), proofServer: 'http://10.0.0.5:6300' };
    await expect(SeedWallet.create({ network: 'preprod', endpoints, seed: '5e'.repeat(32) })).rejects.toThrow(
      ProofServerRefusedError,
    );
  });
});
