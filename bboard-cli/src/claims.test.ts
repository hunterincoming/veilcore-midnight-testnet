// The claims client (api/src/claims-api.ts) and the CLI's field-set files (fields.ts),
// with the compiled claims contract run locally in place of the chain: each call runs
// the real circuits against the contract's state, with the private input the API put in
// private state. No proofs (they need the proving parameters, which are not here).
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ContractMaintenanceAuthority,
  ContractState,
  createCircuitContext,
  createConstructorContext,
  sampleSigningKey,
  signatureVerifyingKey,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract } from '../../contract/src/managed/veilcore-claims/contract/index.js';
import { type ClaimsPrivateState, claimsWitnesses, emptyClaimsPrivateState } from '../../contract/src/claims.js';
import { type FieldSetFile } from '../../contract/src/field-schema.js';
import { newAttesterKey } from '../../contract/src/attest.js';
import { numberFrom } from '../../contract/src/fields.js';

// findDeployedContract, replaced by the local runner below.
const local = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => local.find!(...a) };
});

const { ClaimsAPI, assertClaimsDeployAllowed } = await import('../../api/src/claims-api');
const { claimsPrivateStateKey } = await import('../../api/src/claims-types');
const {
  loadFieldSet,
  readFieldSetFile,
  scaledBound,
  slotByName,
  readAttestationFile,
  writeAttestation,
  labSignature,
  labPairSignature,
} = await import('./fields');

const ADDR = 'ab'.repeat(32);
const VECTORS = JSON.parse(readFileSync(new URL('../../contract/vectors/fields-v1.json', import.meta.url), 'utf8')) as {
  fieldSets: { input: Omit<FieldSetFile, 'jsonDigest'> }[];
};
const BASE = VECTORS.fieldSets[0].input;
const fileA: FieldSetFile = { ...BASE, jsonDigest: '0a'.repeat(32) };
const fileB: FieldSetFile = {
  ...BASE,
  fieldSecret: '5a'.repeat(32),
  jsonDigest: '0b'.repeat(32),
  values: [{ text: '230/233' }, { text: '180/188' }, { text: '199/201' }, ...BASE.values.slice(3)],
};

/** The claims contract run locally: what midnight-js would prove and submit, minus the proof. */
const chain = (retired = true) => {
  const c = new Contract<ClaimsPrivateState>(claimsWitnesses);
  const init = c.initialState(createConstructorContext(emptyClaimsPrivateState(), '0'.repeat(64)));
  let state = init.currentContractState;
  state.maintenanceAuthority = retired
    ? new ContractMaintenanceAuthority([], 1, 1n)
    : new ContractMaintenanceAuthority([signatureVerifyingKey(sampleSigningKey())], 1, 0n);
  const store = new Map<string, unknown>();
  const seen: unknown[] = [];
  let n = 0;
  const providers = {
    privateStateProvider: {
      setContractAddress: () => undefined,
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => void store.set(k, v),
    },
    publicDataProvider: { queryContractState: async () => state },
  };
  const callTx = new Proxy(
    {},
    {
      get:
        (_t, circuit: string) =>
        async (...args: unknown[]) => {
          const ps = store.get(claimsPrivateStateKey) as ClaimsPrivateState;
          seen.push(ps);
          const ctx: CircuitContext<ClaimsPrivateState> = createCircuitContext(ADDR, '0'.repeat(64), state, ps);
          const fn = (c.impureCircuits as unknown as Record<string, (...a: unknown[]) => { context: typeof ctx }>)[
            circuit
          ];
          const r = fn(ctx, ...args);
          const next = new ContractState();
          next.data = r.context.currentQueryContext.state;
          next.maintenanceAuthority = state.maintenanceAuthority;
          state = next;
          n++;
          return {
            public: {
              txId: `tx${n}`,
              txHash: `hash${n}`,
              blockHeight: n,
              nextContractState: r.context.currentQueryContext.state,
            },
          };
        },
    },
  );
  local.find = async () => ({ deployTxData: { public: { contractAddress: ADDR } }, callTx });
  return { providers, store, seen, state: () => state };
};

const join = async (ch: ReturnType<typeof chain>, logger?: unknown) =>
  ClaimsAPI.join(ch.providers as never, ADDR, logger as never);

describe('field-set files', () => {
  it('seal to the same schema id and commitment as the SDK vectors', () => {
    const a = loadFieldSet(fileA);
    expect(Buffer.from(a.sealed.schemaId).toString('hex')).toBe(
      '53304a427e34f78ebbb162464ca1a2fe67a51ed70b28ac2f1a61bee19c37d754',
    );
    expect(a.record.fieldSet.values).toHaveLength(16);
  });

  it('are refused, naming the problem but never the contents', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fs-'));
    const p = path.join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify({ ...fileA, values: [{ text: '184/180' }, ...fileA.values.slice(1)] }));
    expect(() => readFieldSetFile(p)).toThrow(/refused: an allele pair is written smaller first/);
    writeFileSync(p, 'not json SECRET-VALUE');
    expect(() => readFieldSetFile(p)).toThrow(/^That file is not JSON\.$/);
    expect(() => readFieldSetFile(path.join(dir, 'missing.json'))).toThrow(/No file/);
  });

  it('name slots by number or path, and scale bounds as the schema stores them', () => {
    expect(slotByName(fileA, '12')).toBe(12);
    expect(slotByName(fileA, 'fields.germinationPercent')).toBe(12);
    expect(() => slotByName(fileA, '16')).toThrow();
    expect(scaledBound(fileA, 12, '95')).toBe(9500n);
    expect(scaledBound(fileA, 12, '95.5')).toBe(9550n);
    expect(() => scaledBound(fileA, 12, '95.555')).toThrow(/decimal places/);
    expect(() => scaledBound(fileA, 14, '1')).toThrow(/not a number slot/);
    expect(scaledBound(fileA, 15, '6400')).toBe(6400n);
  });

  it('attestation files round-trip a laboratory signature per record', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'att-'));
    const p = path.join(dir, 'lab.json');
    const lab = newAttesterKey();
    const a = loadFieldSet(fileA);
    const b = loadFieldSet(fileB);
    const key = writeAttestation(p, lab.secret, [a.sealed.commitment]);
    writeAttestation(p, lab.secret, [b.sealed.commitment]); // adds to the same file
    expect(key).toEqual(lab.key);
    const read = readAttestationFile(p);
    expect(read.key).toEqual(lab.key);
    expect(labPairSignature(read, a.sealed, b.sealed).key).toEqual(lab.key);
    expect(() => writeAttestation(p, newAttesterKey().secret, [a.sealed.commitment])).toThrow(/another laboratory/);
    const other = loadFieldSet({ ...fileA, jsonDigest: '0c'.repeat(32) });
    expect(() => labSignature(read, other.sealed)).toThrow(/no signature on record/);
  });
});

describe('ClaimsAPI against the compiled contract', () => {
  beforeEach(() => setNetworkId('undeployed'));

  it('proves a bound; the input is in private state only during the call', async () => {
    const ch = chain();
    const api = await join(ch);
    const a = loadFieldSet(fileA);
    const r = await api.proveRange(a.record, fileA.schema, 12, 'at least', 9500n);
    expect(r.claim.kind).toBe('range');
    expect(r.claim.bound).toBe(9500n);
    expect(Buffer.from(r.claim.record).toString('hex')).toBe(Buffer.from(a.sealed.commitment).toString('hex'));
    expect((ch.seen[0] as ClaimsPrivateState).input.number).toBe(9650n);
    expect(ch.store.get(claimsPrivateStateKey)).toEqual({ input: {} });
    // Read back from the call's own result, and as the indexer would serve it.
    const back = await api.readClaim({ public: { nextContractState: ch.state().data } });
    expect(back.claim.bound).toBe(9500n);
    expect(api.disclosedSoFar(a.record, 12, fileA.schema)).toBe('the number is at least 95.00 percent');
    expect(api.disclosedSoFar(a.record, 13)).toBe('nothing about its value');
  });

  it('a bound the sealed number does not meet is refused by the circuit, and the input is still cleared', async () => {
    const ch = chain();
    const api = await join(ch);
    const a = loadFieldSet(fileA);
    await expect(api.proveRange(a.record, fileA.schema, 12, 'at least', 9651n)).rejects.toThrow(
      /does not meet the bound/,
    );
    expect(ch.store.get(claimsPrivateStateKey)).toEqual({ input: {} });
  });

  it('refuses before sending: another schema, a text slot as a number, a bad slot', async () => {
    const ch = chain();
    const api = await join(ch);
    const a = loadFieldSet(fileA);
    await expect(api.proveRange(a.record, { ...fileA.schema, title: 'other' }, 12, 'at least', 1n)).rejects.toThrow(
      /Nothing was sent/,
    );
    await expect(api.proveRange(a.record, fileA.schema, 14, 'at least', 1n)).rejects.toThrow(
      /does not hold a number\. Nothing was sent/,
    );
    await expect(api.proveValue(a.record, 16)).rejects.toThrow(/0 to 15/);
    expect(ch.seen).toHaveLength(0);
  });

  it('value, distinct, unchanged and the three laboratory-signed claims', async () => {
    const ch = chain();
    const api = await join(ch);
    const a = loadFieldSet(fileA);
    const b = loadFieldSet(fileB);
    const v = await api.proveValue(a.record, 13);
    expect(numberFrom(v.claim.value!)).toBe(9980n);
    expect((await api.proveDistinct(a.record, b.record, fileA.schema)).claim.kind).toBe('distinct');
    const corrected = loadFieldSet({
      ...fileA,
      fieldSecret: '6b'.repeat(32),
      values: [...fileA.values.slice(0, 15), { uint: '4100' }],
    });
    const mask = Array.from({ length: 16 }, (_, i) => i === 15);
    expect((await api.proveUnchanged(a.record, corrected.record, mask)).claim.mayChange).toEqual(mask);
    await expect(
      api.proveUnchanged(
        a.record,
        corrected.record,
        Array.from({ length: 16 }, () => false),
      ),
    ).rejects.toThrow(/outside the mask changed/);

    const dir = mkdtempSync(path.join(tmpdir(), 'att-'));
    const lab = newAttesterKey();
    writeAttestation(path.join(dir, 'lab.json'), lab.secret, [a.sealed.commitment, b.sealed.commitment]);
    const att = readAttestationFile(path.join(dir, 'lab.json'));
    expect((await api.proveAttestedValue(a.record, 13, labSignature(att, a.sealed))).claim.attester).toEqual(lab.key);
    const ar = await api.proveAttestedRange(a.record, fileA.schema, 12, 'at most', 9700n, labSignature(att, a.sealed));
    expect(ar.claim.op).toBe('at most');
    expect(ar.claim.attester).toEqual(lab.key);
    const ad = await api.proveAttestedDistinct(
      a.record,
      b.record,
      fileA.schema,
      labPairSignature(att, a.sealed, b.sealed),
    );
    expect(ad.claim.attester).toEqual(lab.key);
    // A signature on another record does not carry over.
    await expect(
      api.proveAttestedValue(b.record, 13, { key: lab.key, signature: labSignature(att, a.sealed).signature }),
    ).rejects.toThrow();
    expect(ch.store.get(claimsPrivateStateKey)).toEqual({ input: {} });
  });

  it('reads a claim by transaction id through the one-call lookup', async () => {
    const ch = chain();
    const api = await join(ch);
    const a = loadFieldSet(fileA);
    const r = await api.proveValue(a.record, 12);
    const serial = Buffer.from(ch.state().serialize()).toString('hex');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        data: {
          transactions: [
            {
              identifiers: ['cc'.repeat(32)],
              transactionResult: { status: 'SUCCESS' },
              contractActions: [{ address: ADDR, state: serial, entryPoint: 'proveValue' }],
            },
          ],
        },
      }),
    );
    try {
      const back = await api.readClaim('cc'.repeat(32), 'http://indexer');
      expect(back.entryPoint).toBe('proveValue');
      expect(numberFrom(back.claim.value!)).toBe(9650n);
      expect(r.claim.slot).toBe(12);
      fetchSpy.mockImplementation(async () =>
        Response.json({
          data: {
            transactions: [
              {
                identifiers: ['cc'.repeat(32)],
                transactionResult: { status: 'SUCCESS' },
                contractActions: [
                  { address: ADDR, state: serial, entryPoint: 'proveValue' },
                  { address: ADDR, state: serial, entryPoint: 'proveRange' },
                ],
              },
            ],
          },
        }),
      );
      await expect(api.readClaim('cc'.repeat(32), 'http://indexer')).rejects.toThrow(
        'That transaction is not a single claim on this claims contract.',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('joining a claims contract that still has an authority warns', async () => {
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn() };
    const api = await join(chain(false), logger);
    expect((await api.authority()).retired).toBe(false);
    expect(warn.mock.calls[0][0]).toMatch(/still has a maintenance authority/);
    const ok = await join(chain(true), { ...logger, warn: vi.fn() });
    expect((await ok.authority()).retired).toBe(true);
  });

  describe('deploying', () => {
    afterEach(() => setNetworkId('undeployed'));
    it('is allowed on development networks only', () => {
      for (const n of ['undeployed', 'preview', 'preprod']) {
        setNetworkId(n);
        expect(() => assertClaimsDeployAllowed()).not.toThrow();
      }
      setNetworkId('mainnet');
      expect(() => assertClaimsDeployAllowed()).toThrow(/Refusing to deploy the claims contract on mainnet/);
    });
  });
});
