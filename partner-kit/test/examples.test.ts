// The examples' flows (examples/lab.mjs, breeder-licence.mjs, claims.mjs), the same code
// `npm run partner-check` runs on preprod, run here against the compiled contracts and a
// stand-in indexer (test/local-chain.ts): every step and every check they make, minus
// wallets and proofs. A flow that would fail its own checks on a live network fails here.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const { VeilCore } = await import('../src/veilcore');
const { VeilCoreClaims } = await import('../src/claims');
const { CLAIMS_ADDR, VEILCORE_ADDR, fakeChain } = await import('./local-chain');
const { labFlow } = (await import('../examples/lab.mjs')) as { labFlow: Flow };
const { licenceFlow } = (await import('../examples/breeder-licence.mjs')) as { licenceFlow: Flow };
const { claimsFlow } = (await import('../examples/claims.mjs')) as { claimsFlow: Flow };

type Ctx = { vc: unknown; claims: unknown; network: string; endpoints: { indexer: string; indexerWS: string } };
type Flow = (
  ctx: Ctx,
  io: { check: (ok: boolean, what: string) => void; say: (m: string) => void },
) => Promise<unknown>;

let ctx: Ctx;
beforeEach(async () => {
  setNetworkId('undeployed');
  const chain = fakeChain(fake as never);
  ctx = {
    vc: await VeilCore.join(chain.conn, { address: VEILCORE_ADDR }),
    claims: await VeilCoreClaims.join(chain.conn, { address: CLAIMS_ADDR }),
    network: 'undeployed',
    endpoints: chain.endpoints,
  };
});
afterEach(() => vi.unstubAllGlobals());

const run = async (flow: Flow): Promise<string[]> => {
  const lines: string[] = [];
  await flow(ctx, {
    check: (ok, what) => {
      lines.push(`${ok ? 'PASS' : 'FAIL'} ${what}`);
      if (!ok) throw new Error(`check failed: ${what}`);
    },
    say: () => undefined,
  });
  return lines;
};

describe('the examples, run as partner-check runs them', () => {
  it('lab: intake, anchor, batch root, signed report, bound pairing, control proof', async () => {
    const lines = await run(labFlow);
    expect(lines).toHaveLength(9);
    expect(lines.join('\n')).toMatch(
      /checks the pairing from the evidence file: whoever controlled this record's identity at .* had this report, or its SHA-256, by then/,
    );
    expect(lines.every((l) => l.startsWith('PASS'))).toBe(true);
  });

  it('breeder licence: issue, countersign, prove, verify once, revoke', async () => {
    const lines = await run(licenceFlow);
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.startsWith('PASS'))).toBe(true);
  });

  it('claims: seal (the SDK agrees), prove a bound and a lab signature, verify', async () => {
    const lines = await run(claimsFlow);
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toMatch(/at least 95\.00 percent.*on values a laboratory signed/);
  });
});
