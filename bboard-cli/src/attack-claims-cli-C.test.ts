// Attack round C on the CLI's claims options (37, 38, 39) and the ClaimsAPI reads behind
// them, with the compiled claims contract run locally in place of the chain (as in
// claims.test.ts) and the indexer answered from that local chain. Each break found is now
// a FIXED test: it states what the tool should do, and fails on the code before the fix.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ContractMaintenanceAuthority,
  ContractState,
  createCircuitContext,
  createConstructorContext,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract } from '../../contract/src/managed/veilcore-claims/contract/index.js';
import { type ClaimsPrivateState, claimsWitnesses, emptyClaimsPrivateState } from '../../contract/src/claims.js';
import { type FieldSetFile } from '../../contract/src/field-schema.js';
import { JUBJUB_ORDER, attesterKeyOf, newAttesterKey } from '../../contract/src/attest.js';

const local = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => local.find!(...a) };
});

const { ClaimsAPI } = await import('../../api/src/claims-api');
const { claimsPrivateStateKey } = await import('../../api/src/claims-types');
const { loadFieldSet, writeAttestation } = await import('./fields');
const { handleClaimsChoice, parseLabSecret } = await import('./claims-menu');

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
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** The claims contract run locally; every call's state is kept for the fake indexer. */
const chain = (fail: (circuit: string, n: number) => boolean = () => false) => {
  const c = new Contract<ClaimsPrivateState>(claimsWitnesses);
  const init = c.initialState(createConstructorContext(emptyClaimsPrivateState(), '0'.repeat(64)));
  let state = init.currentContractState;
  state.maintenanceAuthority = new ContractMaintenanceAuthority([], 1, 1n);
  const store = new Map<string, unknown>();
  const sent: string[] = [];
  const txs = new Map<string, { serial: string; entryPoint: string }>();
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
          if (fail(circuit, n)) throw new Error('the network dropped the transaction');
          const ps = store.get(claimsPrivateStateKey) as ClaimsPrivateState;
          const ctx: CircuitContext<ClaimsPrivateState> = createCircuitContext(ADDR, '0'.repeat(64), state, ps);
          const fn = (c.impureCircuits as unknown as Record<string, (...a: unknown[]) => { context: typeof ctx }>)[
            circuit
          ];
          const r = fn(ctx, ...args); // throws when the circuit refuses: nothing lands
          const next = new ContractState();
          next.data = r.context.currentQueryContext.state;
          next.maintenanceAuthority = state.maintenanceAuthority;
          state = next;
          n++;
          const txId = n.toString(16).padStart(64, '0');
          txs.set(txId, { serial: hex(next.serialize()), entryPoint: circuit });
          sent.push(circuit);
          return {
            public: {
              txId,
              txHash: `hash${n}`,
              blockHeight: n,
              nextContractState: r.context.currentQueryContext.state,
            },
          };
        },
    },
  );
  local.find = async () => ({ deployTxData: { public: { contractAddress: ADDR } }, callTx });
  /** The indexer, answering from the local chain. */
  const indexer = () =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      const id = (JSON.parse(init?.body as string) as { variables: { offset: { identifier: string } } }).variables
        .offset.identifier;
      const t = txs.get(id);
      return Response.json({
        data: {
          transactions:
            t === undefined
              ? []
              : [
                  {
                    identifiers: [id],
                    transactionResult: { status: 'SUCCESS' },
                    contractActions: [{ address: ADDR, state: t.serial, entryPoint: t.entryPoint }],
                  },
                ],
        },
      });
    });
  return { providers, sent, txs, indexer };
};

const menu = (answers: string[], over: Record<string, unknown> = {}) => {
  const lines: string[] = [];
  const questions: string[] = [];
  const logger = {
    info: (m: unknown) => void lines.push(String(m)),
    warn: (m: unknown) => void lines.push(String(m)),
    error: (m: unknown) => void lines.push(String(m)),
  };
  const ctx = {
    rli: {
      question: async (q: string) => {
        questions.push(q);
        return answers.shift() ?? '';
      },
    },
    logger,
    providers: {},
    indexerUri: 'http://indexer',
    hidden: async () => '',
    during: <T>(f: () => Promise<T>) => f(),
    api: undefined,
    ...over,
  };
  return { ctx: ctx as never, lines, questions };
};

const tmp = (name: string, content: unknown): string => {
  const p = path.join(mkdtempSync(path.join(tmpdir(), 'attC-')), name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};

const keysFile = (keys: { x: bigint; y: bigint }[]): string =>
  tmp(
    'trusted.json',
    keys.map((k) => ({ x: k.x.toString(), y: k.y.toString() })),
  );

describe('attack round C: the CLI claims options', () => {
  beforeEach(() => setNetworkId('undeployed'));

  /** A value claim on slot 13 of A with a self-made key's attested claim, both landed. */
  const selfSigned = async () => {
    const ch = chain();
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    const a = loadFieldSet(fileA);
    const self = newAttesterKey(); // the holder's own key
    const attPath = path.join(mkdtempSync(path.join(tmpdir(), 'attC-')), 'self.json');
    writeAttestation(attPath, self.secret, [a.sealed.commitment]);
    const made = menu(['v', tmp('a.json', fileA), attPath, 'fields.purityPercent', 'yes'], { api });
    await handleClaimsChoice('37', made.ctx);
    return { ch, api, self, made, ids: [...ch.txs.keys()] };
  };

  // K1 (HIGH). A self-made "laboratory" key used to be reported as a laboratory's by
  // options 37 and 38, which never asked which keys the verifier trusts.
  it('FIXED K1: option 38 asks for trusted keys; without them the key is named, never a laboratory', async () => {
    const { ch, api, self, made, ids } = await selfSigned();
    expect(ids).toHaveLength(2);
    // Option 37 states the key the same way.
    const out37 = made.lines.join('\n');
    expect(out37).not.toContain('laboratory signed');
    expect(out37).toContain("not checked against a laboratory's published key");
    const spy = ch.indexer();
    try {
      const read = menu([ids[0], '', ids[1], ''], { api });
      await handleClaimsChoice('38', read.ctx);
      expect(read.questions.join('\n')).toMatch(/Laboratory keys you trust/);
      const out = read.lines.join('\n');
      expect(out).not.toContain('laboratory signed');
      expect(out).toContain(`on values signed by key (${self.key.x.toString(16).slice(0, 12)}…`);
      expect(out).toContain("not checked against a laboratory's published key");
      // With the key listed as trusted: a laboratory's.
      const trusted = menu([ids[0], '', ids[1], keysFile([self.key])], { api });
      await handleClaimsChoice('38', trusted.ctx);
      expect(trusted.lines.join('\n')).toContain('on values a laboratory signed (key (');
      expect(trusted.lines.join('\n')).toContain('Every check that could be made here passed.');
      // Listing another key: refused, and not a laboratory's.
      const other = menu([ids[0], '', ids[1], keysFile([newAttesterKey().key])], { api });
      await handleClaimsChoice('38', other.ctx);
      expect(other.lines.join('\n')).toContain('NOT ACCEPTED');
      expect(other.lines.join('\n')).not.toContain('laboratory signed');
    } finally {
      spy.mockRestore();
    }
  });

  it('FIXED K1b: a trusted-keys file that is not JSON, not keys, or not signing keys is refused, never echoed', async () => {
    const { api, ids } = await selfSigned();
    for (const [content, why] of [
      ['SECRET-WORDS not json', /^That file is not JSON\.$/],
      [{ x: 1 }, /not a list of laboratory keys/],
      [[{ x: '0', y: '1' }], /Key 1 in that file is not a laboratory signing key/],
      [[{ x: '5', y: '7' }], /not a laboratory signing key/],
      [[], /lists no keys/],
    ] as const) {
      const m = menu([ids[0], '', '', tmp('k.json', content)], { api });
      expect(await handleClaimsChoice('38', m.ctx)).toBe(true);
      expect(m.lines.join('\n')).toMatch(why);
      expect(m.lines.join('\n')).not.toContain('SECRET-WORDS');
      expect(m.lines.join('\n')).not.toMatch(/CLAIM:/);
    }
  });

  // K2 (MEDIUM). A wrong attestation entry used to be found only by the circuit, after the
  // value claim had landed, and the tx id was never shown. Every signature is now checked
  // off-chain first.
  it('FIXED K2: a bad attestation entry is refused before anything is sent', async () => {
    const ch = chain();
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    const a = loadFieldSet(fileA);
    const b = loadFieldSet(fileB);
    const lab = newAttesterKey();
    const attPath = path.join(mkdtempSync(path.join(tmpdir(), 'attC-')), 'lab.json');
    writeAttestation(attPath, lab.secret, [b.sealed.commitment]);
    // The laboratory's entry for B, filed under A (a copy-paste slip, or a swapped file).
    const f = JSON.parse(readFileSync(attPath, 'utf8')) as {
      key: { x: string; y: string };
      signatures: Record<string, unknown>;
    };
    f.signatures = { [hex(a.sealed.commitment)]: f.signatures[hex(b.sealed.commitment)] };
    writeFileSync(attPath, JSON.stringify(f));
    const m = menu(['v', tmp('a.json', fileA), attPath, '13', 'yes'], { api });
    expect(await handleClaimsChoice('37', m.ctx)).toBe(true);
    expect(ch.sent).toEqual([]);
    expect(m.lines.join('\n')).toMatch(/does not verify under its key\. Nothing was sent\./);
    // The right signatures under another (valid) key: refused the same way.
    const other = newAttesterKey().key;
    writeAttestation(attPath + '2', lab.secret, [a.sealed.commitment]);
    const right = JSON.parse(readFileSync(attPath + '2', 'utf8')) as typeof f;
    writeFileSync(attPath, JSON.stringify({ ...right, key: { x: other.x.toString(), y: other.y.toString() } }));
    const m2 = menu(['b', tmp('a.json', fileA), attPath, '12', 'l', '95', 'yes'], { api });
    await handleClaimsChoice('37', m2.ctx);
    expect(ch.sent).toEqual([]);
    expect(m2.lines.join('\n')).toMatch(/does not verify under its key/);
    // A file whose key is not a signing key at all is refused when read.
    writeFileSync(attPath, JSON.stringify({ ...right, key: { x: '0', y: '1' } }));
    await expect(handleClaimsChoice('37', menu(['v', tmp('a.json', fileA), attPath], { api }).ctx)).rejects.toThrow(
      /not a laboratory signing key/,
    );
    expect(ch.sent).toEqual([]);
  });

  it('FIXED K2b: an attested claim that fails after the claim landed: every landed tx id and the failure are shown', async () => {
    // The second proveAttested is lost on the way (the network, a fee): the signature was good.
    const ch = chain((circuit, n) => circuit === 'proveAttested' && n === 2);
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    const a = loadFieldSet(fileA);
    const b = loadFieldSet(fileB);
    const lab = newAttesterKey();
    const attPath = path.join(mkdtempSync(path.join(tmpdir(), 'attC-')), 'lab.json');
    writeAttestation(attPath, lab.secret, [a.sealed.commitment, b.sealed.commitment]);
    const m = menu(['d', tmp('a.json', fileA), attPath, tmp('b.json', fileB), 'yes'], { api });
    expect(await handleClaimsChoice('37', m.ctx)).toBe(true);
    expect(ch.sent).toEqual(['proveDistinct', 'proveAttested']);
    const [mainId, attId] = [...ch.txs.keys()];
    const out = m.lines.join('\n');
    expect(out).toContain(`Give the verifier this transaction id: ${mainId}`);
    expect(out).toContain(`attested claim on record ${hex(a.sealed.commitment)}: ${attId}`);
    expect(out).toContain(`attested claim on record ${hex(b.sealed.commitment)} FAILED`);
    expect(out).toContain(`The claim itself IS published (transaction id ${mainId})`);
    expect(out).toContain(`Attested claims that landed: ${attId}`);
    // The verdict shown is the one a verifier would reach: B carries no signature.
    expect(out).toContain('NOT ACCEPTED');
    expect(out).not.toMatch(/on values (a laboratory|laboratories) signed/);
  });

  // K4 (MEDIUM). A value claim on an EMPTY slot is now flagged before the holder agrees.
  it('FIXED K4: option 37 warns that a slot is empty before asking, and states it as empty', async () => {
    const ch = chain();
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    const empty: FieldSetFile = { ...fileA, values: [...fileA.values.slice(0, 14), null, fileA.values[15]] };
    const stop = menu(['v', tmp('e.json', empty), '', 'fields.varietyName', 'no'], { api });
    await handleClaimsChoice('37', stop.ctx);
    expect(stop.lines.join('\n')).toMatch(/slot 14 \(fields\.varietyName, text\) is EMPTY: no value was sealed there/);
    expect(stop.questions.find((q) => /Publish/.test(q))).toMatch(/\(EMPTY\)\?/);
    expect(ch.sent).toEqual([]);
    const go = menu(['v', tmp('e.json', empty), '', 'fields.varietyName', 'yes'], { api });
    await handleClaimsChoice('37', go.ctx);
    const out = go.lines.join('\n');
    expect(out).toContain('as sealed, is empty (no value sealed).');
    expect(out).not.toContain(`SHA-256 is ${'0'.repeat(64)}`);
    expect(out).toContain('Every check that could be made here passed.');
  });

  // K8 (LOW/MEDIUM). Confirmations now name the slot's path and type.
  it('FIXED K8: every confirmation names the slot path and type being published', async () => {
    const ch = chain();
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    const v = menu(['v', tmp('a.json', fileA), '', '14', 'no'], { api });
    await handleClaimsChoice('37', v.ctx);
    expect(v.questions.find((q) => /Publish/.test(q))).toContain('slot 14 (fields.varietyName, text)');
    const b = menu(['b', tmp('a.json', fileA), '', '12', 'l', '95', 'no'], { api });
    await handleClaimsChoice('37', b.ctx);
    expect(b.questions.find((q) => /Publish/.test(q))).toContain(
      '"slot 12 (fields.germinationPercent, uint) is at least 95 percent"',
    );
    const corrected: FieldSetFile = {
      ...fileA,
      fieldSecret: '6b'.repeat(32),
      values: [...fileA.values.slice(0, 15), { uint: '4100' }],
    };
    const u = menu(['u', tmp('a.json', fileA), tmp('c.json', corrected), '15', 'no'], { api });
    await handleClaimsChoice('37', u.ctx);
    expect(u.questions.find((q) => /Publish/.test(q))).toContain('slot 15 (fields.yieldKgPerHa, uint)');
    expect(ch.sent).toEqual([]);
  });

  // K7 (LOW). The direction is read strictly.
  it('FIXED K7: "at most" means at most; anything but l/least/m/most is refused', async () => {
    const ch = chain();
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    const m = menu(['b', tmp('a.json', fileA), '', '12', 'at most', '97', 'yes'], { api });
    await handleClaimsChoice('37', m.ctx);
    expect(m.lines.join('\n')).toContain('is at most 97.00 percent');
    for (const ans of ['MOST', ' At  Most ', 'm']) {
      const x = menu(['b', tmp('a.json', fileA), '', '12', ans, '97', 'no'], { api });
      await handleClaimsChoice('37', x.ctx);
      expect(x.questions.find((q) => /Publish/.test(q))).toContain('is at most 97');
    }
    for (const ans of ['least', 'L', 'at least']) {
      const x = menu(['b', tmp('a.json', fileA), '', '12', ans, '90', 'no'], { api });
      await handleClaimsChoice('37', x.ctx);
      expect(x.questions.find((q) => /Publish/.test(q))).toContain('is at least 90');
    }
    const sent = ch.sent.length;
    for (const ans of ['', 'x', 'maybe', 'atmost', 'lm']) {
      const bad = menu(['b', tmp('a.json', fileA), '', '12', ans, '90', 'yes'], { api });
      expect(await handleClaimsChoice('37', bad.ctx)).toBe(true);
      expect(bad.lines).toContain('Answer L (at least) or M (at most). Nothing was sent.');
    }
    expect(ch.sent.length).toBe(sent);
  });

  // K5 (LOW). Option 38's schema file no longer reaches a bare JSON.parse.
  it("FIXED K5: option 38 refuses a non-JSON 'schema' file without quoting it", async () => {
    const p = tmp('words.txt', 'abandon ability able about above absent absorb');
    const m = menu(['00'.repeat(32), p, ''], { api: {} });
    expect(await handleClaimsChoice('38', m.ctx)).toBe(true);
    expect(m.lines).toContain('That file is not JSON.');
    expect(m.lines.join('\n')).not.toContain('abandon');
    const missing = menu(['00'.repeat(32), p + '.missing', ''], { api: {} });
    expect(await handleClaimsChoice('38', missing.ctx)).toBe(true);
    expect(missing.lines).toContain('No file at that path.');
  });

  // K6 (LOW). Hex needs 0x or a letter a-f; digits alone are decimal; the prompt says so.
  it('FIXED K6: a 64-digit decimal laboratory secret is read as decimal, and the prompt says how hex is written', async () => {
    const decimal = '0' + '1'.repeat(63);
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'attC-')), 'lab.json');
    let prompt = '';
    const m = menu([out, tmp('a.json', fileA)], {
      hidden: async (q: string) => {
        prompt = q;
        return decimal;
      },
    });
    await handleClaimsChoice('39', m.ctx);
    expect(prompt).toMatch(/decimal digits, or hex starting 0x/);
    expect(m.lines.join('\n')).toContain(`x=${attesterKeyOf(BigInt(decimal)).x}`);
    // 10^63 is a valid secret that used to be refused (read as 2^252, above the order).
    expect(parseLabSecret('1' + '0'.repeat(63))).toBe(10n ** 63n);
    expect(10n ** 63n < JUBJUB_ORDER).toBe(true);
    expect(parseLabSecret('0x' + 'ab'.repeat(32))).toBe(BigInt('0x' + 'ab'.repeat(32)));
    expect(parseLabSecret('ff')).toBe(255n);
    expect(parseLabSecret('255')).toBe(255n);
    expect(parseLabSecret('0x')).toBe(0n);
    expect(parseLabSecret('12g')).toBe(0n);
    // A generated TEST secret is shown with 0x, so typing it back is read as hex.
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const gen = menu([path.join(mkdtempSync(path.join(tmpdir(), 'attC-')), 'g.json'), tmp('a.json', fileA)]);
    try {
      await handleClaimsChoice('39', gen.ctx);
      const shown = write.mock.calls.map((c) => String(c[0])).join('');
      const sec = /\n {2}(0x[0-9a-f]{64})\n/.exec(shown)![1];
      expect(gen.lines.join('\n')).toContain(`x=${attesterKeyOf(parseLabSecret(sec)).x}`);
      expect(gen.lines.join('\n')).not.toContain(sec.slice(2));
    } finally {
      write.mockRestore();
    }
  });

  it('holds: no field secret, private value or laboratory secret reaches the log in 37, 38 or 39', async () => {
    const ch = chain();
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    const lab = newAttesterKey();
    const attOut = path.join(mkdtempSync(path.join(tmpdir(), 'attC-')), 'lab.json');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const sign = menu([attOut, tmp('a.json', fileA)], { hidden: async () => lab.secret.toString() });
    try {
      await handleClaimsChoice('39', sign.ctx);
    } finally {
      write.mockRestore();
    }
    const m = menu(['b', tmp('a.json', fileA), attOut, '12', 'l', '95', 'yes'], { api });
    await handleClaimsChoice('37', m.ctx);
    const spy = ch.indexer();
    let r;
    try {
      r = menu([[...ch.txs.keys()][0], '', [...ch.txs.keys()][1], keysFile([lab.key])], { api });
      await handleClaimsChoice('38', r.ctx);
    } finally {
      spy.mockRestore();
    }
    const all = [...sign.lines, ...m.lines, ...r.lines].join('\n');
    expect(all).not.toContain(fileA.fieldSecret);
    expect(all).not.toContain(lab.secret.toString());
    expect(all).not.toContain(lab.secret.toString(16));
    expect(all).not.toContain('Harbour Mist');
    expect(all).not.toContain('96.50');
    expect(all).not.toContain('9650');
    expect(ch.txs.size).toBe(2);
    expect(r.lines.join('\n')).toContain('on values a laboratory signed');
  });

  it('holds: option 38 refuses a malformed id, and a claim on another contract, before any verdict', async () => {
    const ch = chain();
    const api = await ClaimsAPI.join(ch.providers as never, ADDR);
    await api.proveValue(loadFieldSet(fileA).record, 13);
    const [id] = [...ch.txs.keys()];
    const spy = ch.indexer();
    try {
      const bad = menu(['zz-not-hex', '', '', ''], { api });
      await expect(handleClaimsChoice('38', bad.ctx)).rejects.toThrow(/not a transaction id/);
      // The attestation id points at a transaction on ANOTHER contract address.
      spy.mockImplementation(async (_u, init) => {
        const q = (JSON.parse(init?.body as string) as { variables: { offset: { identifier: string } } }).variables
          .offset.identifier;
        const t = ch.txs.get(id)!;
        return Response.json({
          data: {
            transactions: [
              {
                identifiers: [q],
                transactionResult: { status: 'SUCCESS' },
                contractActions: [
                  { address: q === id ? ADDR : 'cd'.repeat(32), state: t.serial, entryPoint: 'proveAttested' },
                ],
              },
            ],
          },
        });
      });
      const other = menu([id, '', 'ee'.repeat(32), ''], { api });
      await expect(handleClaimsChoice('38', other.ctx)).rejects.toThrow(/not a single claim on this claims contract/);
      expect(other.lines.join('\n')).not.toMatch(/CLAIM:/);
    } finally {
      spy.mockRestore();
    }
  });
});
