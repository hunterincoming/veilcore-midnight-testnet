// The partner client for the claims contract (src/claims.ts), sealing (sealFields) and
// the wallet-free claim reader (src/verify.ts), against the compiled claims contract run
// locally (test/local-chain.ts): seal a field set, prove a bound, have a laboratory sign,
// and a verifier read both back by transaction id and judge them.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type FieldSetFile } from '../../contract/src/field-schema.js';

const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const { VeilCoreClaims, sealFields } = await import('../src/claims');
const { readClaim, readClaimsAuthority } = await import('../src/verify');
const { toHex } = await import('../src/commitments');
const { isContractRefusal } = await import('../src/errors');
const { newAttesterKey, signRecord } = await import('../../contract/src/attest');
const { verifyClaim } = await import('../../contract/src/verify-claims');
const { CLAIMS_ADDR, chainLog, fakeChain } = await import('./local-chain');

const VECTORS = JSON.parse(readFileSync(new URL('../../contract/vectors/fields-v1.json', import.meta.url), 'utf8')) as {
  fieldSets: { input: Omit<FieldSetFile, 'jsonDigest'> }[];
};
const file: FieldSetFile = { ...VECTORS.fieldSets[0].input, jsonDigest: '0a'.repeat(32) };
const schema = file.schema;

let chain: ReturnType<typeof fakeChain>;
beforeEach(() => {
  setNetworkId('undeployed');
  chain = fakeChain(fake as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setNetworkId('undeployed');
});
const read = () => ({ network: 'undeployed' as const, indexer: chain.endpoints.indexer, address: CLAIMS_ADDR });

describe('sealing a field set', () => {
  it('gives the SDK’s schema id and a commitment, and refuses what the SDK refuses', () => {
    const s = sealFields(file);
    expect(toHex(s.schemaId)).toBe('875d8a6c21137ec1aae6d2c8ad6b929c4ef53b09a247a834f39b126dc910f5f9');
    expect(s.record.fieldSet.values).toHaveLength(16);
    expect(s.commitment).toHaveLength(32);
    expect(() => sealFields({ ...file, values: [{ text: '184/180' }, ...file.values.slice(1)] })).toThrow(
      /smaller first/,
    );
  });
});

describe('joining the claims contract', () => {
  it('is refused on mainnet while no address is pinned, before anything is read', async () => {
    setNetworkId('mainnet');
    const conn = { ...chain.conn, network: 'mainnet' as const };
    await expect(VeilCoreClaims.join(conn)).rejects.toThrow(/No claims contract is pinned for mainnet/);
    await expect(VeilCoreClaims.join(conn, { address: CLAIMS_ADDR })).rejects.toThrow(/is pinned/);
    expect(chainLog).toHaveLength(0);
  });

  it('shows whether the maintenance authority is retired, and warns when it is not', async () => {
    expect((await (await VeilCoreClaims.join(chain.conn, { address: CLAIMS_ADDR })).authority()).retired).toBe(true);
    expect((await readClaimsAuthority(read())).retired).toBe(true);
    const kept = fakeChain(fake as never, 'undeployed', false);
    const warn = vi.fn();
    const conn = { ...kept.conn, logger: { info: () => undefined, warn, error: () => undefined } as never };
    expect((await (await VeilCoreClaims.join(conn, { address: CLAIMS_ADDR })).authority()).retired).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Do not rely on its claims/);
  });
});

describe('a claim, end to end', () => {
  it('proves a bound and a laboratory signature; a verifier with no wallet reads and judges both', async () => {
    const cl = await VeilCoreClaims.join(chain.conn, { address: CLAIMS_ADDR });
    const sealed = sealFields(file);
    const lab = newAttesterKey();

    const range = await cl.proveRange(sealed.record, schema, 12, 'at least', 9500n);
    expect(range.claim.kind).toBe('range');
    const attested = await cl.proveAttested(sealed.record, {
      key: lab.key,
      signature: signRecord(lab.secret, sealed.commitment),
    });

    const r = await readClaim({ ...read(), txId: range.txId });
    expect(r.entryPoint).toBe('proveRange');
    expect(r.claim).toMatchObject({ kind: 'range', op: 'at least', bound: 9500n, slot: 12 });
    expect(toHex(r.claim.record)).toBe(toHex(sealed.commitment));
    const a = await readClaim({ ...read(), txId: attested.txId });
    expect(a.claim.attester).toEqual(lab.key);

    const verdict = verifyClaim({ claim: r.cells, schema, attestations: [a.claim], trustedAttesters: [lab.key] });
    expect(verdict.passed).toBe(true);
    expect(verdict.statement).toMatch(/on values a laboratory signed/);
    const untrusted = verifyClaim({ claim: r.cells, schema, attestations: [a.claim], trustedAttesters: [] });
    expect(untrusted.statement).not.toMatch(/on values a laboratory signed/);
  });

  it('refuses before sending: a bound the number does not meet, a signature that does not verify', async () => {
    const cl = await VeilCoreClaims.join(chain.conn, { address: CLAIMS_ADDR });
    const sealed = sealFields(file);
    expect(
      await cl.proveRange(sealed.record, schema, 12, 'at least', 9651n).then(
        () => false,
        (e: unknown) => isContractRefusal(e),
      ),
    ).toBe(true);
    const lab = newAttesterKey();
    const other = sealFields({ ...file, fieldSecret: '5a'.repeat(32) });
    await expect(
      cl.proveAttested(sealed.record, { key: lab.key, signature: signRecord(lab.secret, other.commitment) }),
    ).rejects.toThrow(/does not verify .* Nothing was sent/);
    expect(chainLog).toHaveLength(0);
    // Nothing a claim was proved from stays in private state.
    expect(await chain.claimsStore.get('veilcoreClaimsPrivateState')).toEqual({ input: {} });
  });

  it('a verifier is refused a transaction that made no claim here', async () => {
    await expect(readClaim({ ...read(), txId: 'ee'.repeat(32) })).rejects.toThrow(/No such transaction/);
  });
});
