// Round D hardening (4 Oct 2026): the operator-tooling findings of round D
// (review-out/roundD-main-contract.md), each asserting its FIX. The attacks are the
// round D proofs of concept (attack-roundD.test.ts in the review copy), re-run against
// the fixed code. Run: cd bboard-cli && npx vitest run --maxWorkers=1 src/hardening-roundD.test.ts
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await -- fakes */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEVER, Observable, config as rxConfig, throwError } from 'rxjs';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { StorageEncryption, levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import {
  ChargedState,
  ContractState,
  StateValue,
  createConstructorContext,
  sampleSigningKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractDeploy,
  ContractState as LedgerContractState,
  Intent,
  MaintenanceUpdate,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';

// The provable retirement sends one transaction through midnight-js's submitTx; here it
// is recorded, and the chain (a fake) flips to an empty committee when it is "sent".
const sent = vi.hoisted(() => ({ txs: [] as unknown[], onSubmit: (): void => undefined }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    submitTx: async (_p: unknown, o: { unprovenTx: unknown }) => {
      sent.txs.push(o.unprovenTx);
      sent.onSubmit();
      return { status: SucceedEntirely, txId: 'retire', txHash: 'h', blockHeight: 9 };
    },
  };
});

const { LandedButUnconfirmedError, RecoveryReplacedButUnconfirmedError, VeilcoreAPI } =
  await import('../../api/src/veilcore-api');
const { assertJoinAllowed, MAINNET_VEILCORE_ADDRESS } = await import('../../api/src/deploy-guard');
const { StartingStateUnreachableError, checkStartingState } = await import('../../api/src/starting-state');
const { matchEntryPoint, singleCallState } = await import('../../api/src/presentation-lookup');
const { memorySigningKeys, transientSecrets } = await import('../../api/src/memory-overlays');
const { veilcorePrivateStateKey } = await import('../../api/src/veilcore-types');
const { createVeilcorePrivateState } = await import('../../contract/src/witnesses');
const { Contract } = await import('../../contract/src/managed/veilcore/contract/index.js');
const { startsFromConstructor } = await import('../../contract/src/veilcore');
const { C, VeilcoreSimulator, as, secret, freshRecovery } = await import('../../contract/src/test/veilcore-simulator');
const { chooseStore, copyLiveStore, openStores, scrubTransient, storeDirFor } = await import('./private-store');
const { oneAtATime } = await import('./one-at-a-time');
const { assertKeysMatchRecord, gitEnvironment } = await import('./keys-check');
const { forgetPassword, privateStatePassword, settlePassword } = await import('./password');
const { guardProcess, watchState } = await import('./state-watch');
const { deployOrJoin, joinChecked } = await import('./index');

type Api = Awaited<ReturnType<typeof VeilcoreAPI.join>>;
const PASSWORD = 'Veilcore-Mainnet-Pw-7q'; // passes midnight-js validatePassword
const ADDR = 'ab'.repeat(32);
const STORE = 'veilcore-mainnet-private-state';
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const silent = { error: () => undefined, info: () => undefined, warn: () => undefined } as unknown as Logger;
const recording = () => {
  const lines: string[] = [];
  const push = (m: unknown) => void lines.push(typeof m === 'string' ? m : JSON.stringify(m));
  return { lines, logger: { info: push, warn: push, error: push, debug: push } as unknown as Logger };
};

/**
 * What someone with a copy of the folder (a backup, a synced Desktop, a stolen disk) and
 * the password gets: every encrypted value still in the LevelDB files, live or deleted.
 * (The round D proof of concept's scanner.)
 */
const everyValueOnDisk = async (db: string): Promise<string[]> => {
  const out: string[] = [];
  for (const f of readdirSync(db)) {
    const file = path.join(db, f);
    if (!statSync(file).isFile()) continue;
    const text = readFileSync(file).toString('latin1');
    for (const m of text.matchAll(/[A-Za-z0-9+/]{80,}={0,2}/g)) {
      try {
        const raw = Buffer.from(m[0], 'base64');
        const enc = await StorageEncryption.create(PASSWORD, { existingSalt: raw.subarray(1, 33) });
        out.push(await enc.decrypt(m[0]));
      } catch {
        /* not one of ours */
      }
    }
  }
  return out;
};

/** A superjson-serialized private state's field, as hex, whatever shape it was stored in. */
const fieldHex = (serialized: string, field: string): string | undefined => {
  try {
    const p = JSON.parse(serialized) as Record<string, unknown> & { json?: Record<string, unknown> };
    const v: unknown = (p.json ?? p)[field];
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'string') return v.toLowerCase();
    return hex(Uint8Array.from(Object.values(v as Record<string, number>)));
  } catch {
    return undefined;
  }
};

/** The CLI's own store (openStores, as run() builds it) in a temporary home. */
const cliStore = async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
  const dir = storeDirFor('mainnet', home);
  const stores = await openStores<string, any, string, any>({
    dir,
    storeName: STORE,
    password: () => PASSWORD,
    accountId: 'cd'.repeat(32),
    home,
  });
  return { home, dir, store: stores.main as any, claims: stores.claims as any };
};

/** The store as an OLDER CLI built it: no overlays, the default folder name. */
const oldCliStore = (dir: string) =>
  oneAtATime(
    levelPrivateStateProvider<string, any>({
      midnightDbName: path.join(dir, 'midnight-level-db'),
      privateStateStoreName: STORE,
      signingKeyStoreName: `${STORE}-signing-keys`,
      privateStoragePasswordProvider: () => PASSWORD,
      accountId: 'cd'.repeat(32),
    }),
  ) as any;

/** A VeilcoreAPI over `store`; `calls` stands in for the chain's callTx. */
const apiOver = (store: any, calls: Record<string, (...a: unknown[]) => Promise<unknown>>, extra: object = {}) => {
  const providers = {
    privateStateProvider: store,
    publicDataProvider: { contractStateObservable: () => NEVER },
    ...extra,
  };
  const deployed = { deployTxData: { public: { contractAddress: ADDR } }, callTx: calls };
  const api = new (VeilcoreAPI as any)(deployed, providers) as Api;
  api.landedCheck = { tries: 2, intervalMs: 1, confirmGapMs: 1 };
  return api;
};

/** An in-memory private-state store, as the round-11 tests use. */
const memoryStore = (initial: Record<string, unknown>) => {
  let ps = initial;
  return {
    setContractAddress: () => undefined,
    get: async () => ps,
    set: async (_: string, v: Record<string, unknown>) => void (ps = v),
    state: () => ps,
  };
};

const txOk = { public: { txId: 't', txHash: 'h', blockHeight: 1 }, private: { result: new Uint8Array(32) } };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setNetworkId('undeployed');
});

// ─────────────────────────────────────────────── D-2

/** What is in a network's folder, less the store lock this process holds while it runs (store-lock.ts). */
const besideStore = (dir: string): string[] => readdirSync(dir).filter((f) => f !== 'private-state.lock');

describe('D-2 FIXED: the maintenance key and one-call secrets never reach the store on disk', () => {
  it('the deploy store calls, replayed through the CLI store: the maintenance key is in no file, live or deleted', async () => {
    const { dir, store } = await cliStore();
    const maintenanceKey = 'e7'.repeat(32);
    // The store calls VeilcoreAPI.deploy makes, in order (round D PoC):
    store.setContractAddress(ADDR);
    await store.set(veilcorePrivateStateKey, createVeilcorePrivateState(secret('rd-deployer')));
    await store.setSigningKey(ADDR, maintenanceKey);
    for (let i = 0; i < 16; i++) expect(await store.getSigningKey(ADDR)).toBe(maintenanceKey); // usable in-process
    await store.getSigningKey(ADDR);
    await store.set(veilcorePrivateStateKey, createVeilcorePrivateState(secret('rd-deployer')));
    await store.removeSigningKey(ADDR);
    expect(await store.getSigningKey(ADDR)).toBeNull();
    await store.get(veilcorePrivateStateKey);

    const values = await everyValueOnDisk(dir);
    expect(values.length).toBeGreaterThan(0); // the scanner does read this store...
    expect(values.filter((v) => v.includes(maintenanceKey))).toEqual([]); // ...and the key was never in it
  });

  it('control: the same calls on the store as an older CLI built it leave the key on disk (the original finding)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-hd-old-'));
    const store = oldCliStore(dir);
    const maintenanceKey = 'e7'.repeat(32);
    store.setContractAddress(ADDR);
    await store.set(veilcorePrivateStateKey, createVeilcorePrivateState(secret('rd-deployer')));
    await store.setSigningKey(ADDR, maintenanceKey);
    await store.removeSigningKey(ADDR);
    expect((await everyValueOnDisk(path.join(dir, 'midnight-level-db'))).some((v) => v.includes(maintenanceKey))).toBe(
      true,
    );
  });

  it('a recovery that did not land: the recovery secret reached the call, but no file holds it', async () => {
    const { dir, store } = await cliStore();
    const sim = new VeilcoreSimulator();
    const own = secret('rd-owner');
    const rcvSecret = secret('rd-owner-recovery');
    sim.call(as(own), 'anchor', C.recoveryCommit(rcvSecret));
    store.setContractAddress(ADDR);
    await store.set(veilcorePrivateStateKey, createVeilcorePrivateState(own));
    let seenByCall: string | undefined;
    const api = apiOver(store, {
      recoverRecordSecret: async () => {
        // midnight-js reads the private state for the witnesses: the secret must be there.
        seenByCall = hex((await store.get(veilcorePrivateStateKey)).recoverySecret);
        throw new Error('proof server unreachable');
      },
    });
    (api as any).currentLedger = async () => sim.state; // nothing moved on chain
    const next = secret('rd-next');
    await expect(
      api.recoverRecordSecret(C.commit(own), C.commit(next), freshRecovery(), rcvSecret, next),
    ).rejects.toThrow('proof server unreachable');
    expect(seenByCall).toBe(hex(rcvSecret));
    expect(hex((await store.get(veilcorePrivateStateKey)).recoverySecret)).toBe('00'.repeat(32));
    const values = await everyValueOnDisk(dir);
    expect(values.some((v) => fieldHex(v, 'geneticSecret') === hex(own))).toBe(true); // the record secret is stored
    expect(values.filter((v) => fieldHex(v, 'recoverySecret') === hex(rcvSecret))).toEqual([]);
    expect(values.filter((v) => fieldHex(v, 'incomingGeneticSecret') === hex(next))).toEqual([]);
  });

  it('a licence secret and a presentation challenge stay in memory too', async () => {
    const { dir, store } = await cliStore();
    store.setContractAddress(ADDR);
    await store.set(veilcorePrivateStateKey, createVeilcorePrivateState(secret('rd-lic-owner')));
    const lic = secret('rd-licence-secret');
    const ch = secret('rd-challenge');
    const api = apiOver(store, { proveLicense: async () => txOk });
    await api.proveLicense(lic, secret('rd-issuer'), ch);
    expect(hex((await store.get(veilcorePrivateStateKey)).licenseSecret)).toBe(hex(lic)); // this process still has it
    const values = await everyValueOnDisk(dir);
    expect(values.filter((v) => fieldHex(v, 'licenseSecret') === hex(lic))).toEqual([]);
    expect(values.filter((v) => fieldHex(v, 'presentationChallenge') === hex(ch))).toEqual([]);
  });

  it('memory is per contract address: a one-call secret set under one contract is not read under another', async () => {
    const inner = new Map<string, unknown>();
    let addr = '';
    const base = {
      setContractAddress: (a: string) => void (addr = a),
      get: async (id: string) => inner.get(`${addr}:${id}`) ?? null,
      set: async (id: string, v: unknown) => void inner.set(`${addr}:${id}`, v),
    };
    const store = transientSecrets(base) as any;
    store.setContractAddress('aa');
    await store.set('k', { geneticSecret: new Uint8Array(32).fill(1), recoverySecret: new Uint8Array(32).fill(9) });
    store.setContractAddress('bb');
    await store.set('k', { geneticSecret: new Uint8Array(32).fill(2), recoverySecret: new Uint8Array(32) });
    store.setContractAddress('aa');
    expect((await store.get('k')).recoverySecret).toEqual(new Uint8Array(32).fill(9));
    expect((inner.get('aa:k') as any).recoverySecret).toEqual(new Uint8Array(32)); // zeros on "disk"
    const keys = memorySigningKeys({}) as any;
    await keys.setSigningKey('aa', 'k1');
    expect(await keys.getSigningKey('bb')).toBeNull();
    await expect(keys.exportSigningKeys()).rejects.toThrow(/memory only/);
  });

  it('the store lives in ~/.veilcore/<network>/private-state: folders 0700, files 0600, even under a 022 umask', async () => {
    const old = process.umask(0o022); // the macOS default
    try {
      const { home, dir, store } = await cliStore();
      store.setContractAddress(ADDR);
      await store.set(veilcorePrivateStateKey, createVeilcorePrivateState(secret('rd-perm')));
      expect(dir).toBe(path.join(home, '.veilcore', 'mainnet', 'private-state'));
      for (const d of [path.join(home, '.veilcore'), path.join(home, '.veilcore', 'mainnet'), dir])
        expect(statSync(d).mode & 0o777).toBe(0o700);
      const files = readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isFile());
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) expect(statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(old);
    }
  });

  it('scrubTransient zeroes the one-call fields of a stored state, whatever shape the bytes have, and nothing else', () => {
    const s = JSON.stringify({
      json: {
        geneticSecret: { 0: 5, 1: 6 },
        recoverySecret: { 0: 7, 1: 8 },
        incomingGeneticSecret: [1, 2],
        presentationChallenge: 'abcd',
      },
      meta: { values: { geneticSecret: [['custom', 'Uint8Array']] } },
    });
    const out = JSON.parse(scrubTransient(s));
    expect(out.json.geneticSecret).toEqual({ 0: 5, 1: 6 });
    expect(out.json.recoverySecret).toEqual({ 0: 0, 1: 0 });
    expect(out.json.incomingGeneticSecret).toEqual([0, 0]);
    expect(out.json.presentationChallenge).toBe('0000');
    expect(out.meta).toEqual({ values: { geneticSecret: [['custom', 'Uint8Array']] } });
  });

  describe('an existing store at the old path', () => {
    /** An old CLI's folder: a record secret, a stale recovery secret, a live and a deleted maintenance key. */
    const oldFolder = async () => {
      const cwd = mkdtempSync(path.join(tmpdir(), 'vc-hd-oldcwd-'));
      const store = oldCliStore(cwd);
      store.setContractAddress(ADDR);
      const own = secret('rd-migrate-owner');
      await store.set(veilcorePrivateStateKey, {
        ...createVeilcorePrivateState(own),
        recoverySecret: secret('rd-stale'),
      });
      await store.setSigningKey(ADDR, 'e7'.repeat(32)); // a deploy that stopped partway left it live
      await store.setSigningKey('cd'.repeat(32), 'e8'.repeat(32));
      await store.removeSigningKey('cd'.repeat(32)); // a "removed" one
      const old = path.join(cwd, 'midnight-level-db');
      const snapshot = Object.fromEntries(
        readdirSync(old).map((f) => [f, readFileSync(path.join(old, f)).toString('hex')]),
      );
      return { cwd, old, own, snapshot };
    };

    it('MOVE: told, copied to the new place without the maintenance keys or one-call secrets; the old folder is left as it was', async () => {
      const { old, own, snapshot } = await oldFolder();
      const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
      const { lines, logger } = recording();
      const asked: string[] = [];
      const choice = await chooseStore({
        networkId: 'mainnet',
        storeName: STORE,
        password: PASSWORD,
        ask: async (q) => (asked.push(q), 'MOVE'),
        logger,
        home,
        candidates: [old],
      });
      const dir = storeDirFor('mainnet', home);
      expect(choice).toEqual({ dir, old });
      expect(asked).toHaveLength(1);
      const said = lines.join('\n');
      expect(said).toContain(`Found a private-state store from an older version of this program in ${old}`);
      expect(said).toMatch(/2 maintenance key\(s\)|1 maintenance key\(s\)/);
      expect(said).toMatch(/may contain an old copy of a maintenance key/);
      expect(said).toMatch(/delete the old folder securely/);
      expect(said).toMatch(/never deletes it for you/);
      // The old folder: still there, byte for byte.
      expect(existsSync(old)).toBe(true);
      expect(
        Object.fromEntries(readdirSync(old).map((f) => [f, readFileSync(path.join(old, f)).toString('hex')])),
      ).toEqual(snapshot);
      // The new store: the record secret, read back the way the CLI reads it...
      const stores = await openStores<string, any, string, any>({
        dir,
        storeName: STORE,
        password: () => PASSWORD,
        accountId: 'cd'.repeat(32),
        home,
      });
      const main = stores.main as any;
      main.setContractAddress(ADDR);
      const ps = await main.get(veilcorePrivateStateKey);
      expect(hex(ps.geneticSecret)).toBe(hex(own));
      expect(hex(ps.recoverySecret)).toBe('00'.repeat(32));
      // ...and no maintenance key, live or deleted, and no stale recovery secret, in its files.
      const values = await everyValueOnDisk(dir);
      expect(values.filter((v) => v.includes('e7'.repeat(32)) || v.includes('e8'.repeat(32)))).toEqual([]);
      expect(values.filter((v) => fieldHex(v, 'recoverySecret') === hex(secret('rd-stale')))).toEqual([]);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    });

    it('Enter: nothing is copied or changed; this run uses the old folder', async () => {
      const { old, snapshot } = await oldFolder();
      const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
      const { lines, logger } = recording();
      const choice = await chooseStore({
        networkId: 'mainnet',
        storeName: STORE,
        password: PASSWORD,
        ask: async () => '',
        logger,
        home,
        candidates: [old],
      });
      expect(choice.dir).toBe(old);
      expect(existsSync(storeDirFor('mainnet', home))).toBe(false);
      expect(lines.join('\n')).toContain('Nothing was copied.');
      expect(
        Object.fromEntries(readdirSync(old).map((f) => [f, readFileSync(path.join(old, f)).toString('hex')])),
      ).toEqual(snapshot);
    });

    it('a wrong password copies nothing, leaves the old folder, and leaves no half-made store', async () => {
      const { old, snapshot } = await oldFolder();
      const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
      await expect(
        chooseStore({
          networkId: 'mainnet',
          storeName: STORE,
          password: 'Another-Password-9x',
          ask: async () => 'MOVE',
          logger: silent,
          home,
          candidates: [old],
        }),
      ).rejects.toThrow(/does not open the old store/);
      expect(existsSync(old)).toBe(true);
      expect(
        Object.fromEntries(readdirSync(old).map((f) => [f, readFileSync(path.join(old, f)).toString('hex')])),
      ).toEqual(snapshot); // not even opened
      expect(besideStore(path.join(home, '.veilcore', 'mainnet'))).toEqual([]);
    });

    it('a new store already in use: no question; the old folder is named, not touched', async () => {
      const { old } = await oldFolder();
      const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
      mkdirSync(storeDirFor('mainnet', home), { recursive: true });
      writeFileSync(path.join(storeDirFor('mainnet', home), 'CURRENT'), 'x');
      const { lines, logger } = recording();
      const ask = vi.fn(async () => 'MOVE');
      const choice = await chooseStore({
        networkId: 'mainnet',
        storeName: STORE,
        password: PASSWORD,
        ask,
        logger,
        home,
        candidates: [old],
      });
      expect(ask).not.toHaveBeenCalled();
      expect(choice.dir).toBe(storeDirFor('mainnet', home));
      expect(lines.join('\n')).toMatch(/may contain an old copy of a maintenance key/);
      expect(existsSync(old)).toBe(true);
    });

    it('no old folder: the new place, no question', async () => {
      const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
      const ask = vi.fn(async () => '');
      const choice = await chooseStore({
        networkId: 'preprod',
        storeName: 'bboard-private-state',
        password: PASSWORD,
        ask,
        logger: silent,
        home,
        candidates: [path.join(home, 'nothing-here')],
      });
      expect(choice).toEqual({ dir: path.join(home, '.veilcore', 'preprod', 'private-state') });
      expect(ask).not.toHaveBeenCalled();
    });

    it('copyLiveStore never writes into an existing folder', async () => {
      const { old } = await oldFolder();
      const target = mkdtempSync(path.join(tmpdir(), 'vc-hd-target-'));
      writeFileSync(path.join(target, 'CURRENT'), 'x');
      await expect(copyLiveStore(old, target, STORE, PASSWORD)).rejects.toThrow();
    });

    // Round D verification, Low: a MOVE killed mid-copy left a full copy of the old store
    // (maintenance key included) in ~/.veilcore/<net>/, never removed or mentioned.
    it('MOVE reads from a scratch copy in the temp folder, never the home folder, and removes it however the copy ends', async () => {
      const { old } = await oldFolder();
      const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
      const tmp = mkdtempSync(path.join(tmpdir(), 'vc-hd-tmp-'));
      const base = { networkId: 'mainnet', storeName: STORE, logger: silent, home, candidates: [old], tmp };
      // The copy fails partway (after the scratch copy is made): nothing is left anywhere.
      await expect(chooseStore({ ...base, password: 'Another-Password-9x', ask: async () => 'MOVE' })).rejects.toThrow(
        /does not open the old store/,
      );
      expect(readdirSync(tmp)).toEqual([]);
      expect(besideStore(path.join(home, '.veilcore', 'mainnet'))).toEqual([]);
      // The scratch copy is made in `tmp`: with no usable temp folder, MOVE cannot start.
      await expect(
        chooseStore({ ...base, tmp: path.join(tmp, 'absent'), password: PASSWORD, ask: async () => 'MOVE' }),
      ).rejects.toThrow(/ENOENT/);
      expect(besideStore(path.join(home, '.veilcore', 'mainnet'))).toEqual([]);
      // A MOVE that works: only the new store in the home folder, nothing in `tmp`.
      await chooseStore({ ...base, password: PASSWORD, ask: async () => 'MOVE' });
      expect(readdirSync(tmp)).toEqual([]);
      expect(besideStore(path.join(home, '.veilcore', 'mainnet'))).toEqual(['private-state']);
    });

    it('a MOVE killed mid-copy: the next start removes what it left, says so, and offers MOVE again', async () => {
      const { old } = await oldFolder();
      const home = mkdtempSync(path.join(tmpdir(), 'vc-hd-home-'));
      const tmp = mkdtempSync(path.join(tmpdir(), 'vc-hd-tmp-'));
      const dead = spawnSync(process.execPath, ['-e', '']).pid; // a process that has exited
      const net = path.join(home, '.veilcore', 'mainnet');
      mkdirSync(net, { recursive: true });
      // What a kill left: the scratch copy (where this version and the one before made it)
      // and the unfinished new store.
      const leftovers = [
        path.join(tmp, `veilcore-old-store-${dead}-Ab12Cd`),
        path.join(net, `private-state.copying-${dead}.reading`),
        path.join(net, `private-state.copying-${dead}`),
      ];
      cpSync(old, path.join(leftovers[0], 'db'), { recursive: true });
      cpSync(old, leftovers[1], { recursive: true });
      mkdirSync(leftovers[2]);
      writeFileSync(path.join(leftovers[2], 'CURRENT'), 'x');
      // Not leftovers: a copy still running (this process), and anything else in the temp folder.
      const running = path.join(tmp, `veilcore-old-store-${process.pid}-Zz99Yy`);
      mkdirSync(running);
      writeFileSync(path.join(tmp, 'unrelated.txt'), 'x');
      const keyOnDisk = async (dir: string) => (await everyValueOnDisk(dir)).some((v) => v.includes('e7'.repeat(32)));
      expect(await keyOnDisk(leftovers[1])).toBe(true); // the old maintenance key really was there

      const { lines, logger } = recording();
      const ask = vi.fn(async () => 'MOVE');
      const choice = await chooseStore({
        networkId: 'mainnet',
        storeName: STORE,
        password: PASSWORD,
        ask,
        logger,
        home,
        candidates: [old],
        tmp,
      });
      for (const p of leftovers) {
        expect(existsSync(p)).toBe(false);
        expect(lines.some((l) => l.startsWith(`Removed ${p}: `))).toBe(true);
      }
      expect(lines.filter((l) => l.includes('could hold an old maintenance key'))).toHaveLength(2);
      expect(existsSync(running)).toBe(true);
      expect(existsSync(path.join(tmp, 'unrelated.txt'))).toBe(true);
      // The unfinished store did not count as "in use": MOVE was offered again and done.
      expect(ask).toHaveBeenCalledTimes(1);
      expect(choice.dir).toBe(storeDirFor('mainnet', home));
      expect(besideStore(net)).toEqual(['private-state']);
      expect(await keyOnDisk(choice.dir)).toBe(false);
    });
  });

  describe('"Finish a deploy" takes the key from paper every time, and drops it however it ends', () => {
    const keyStore = (held?: string) => {
      const keys = new Map<string, string>(held === undefined ? [] : [[ADDR, held]]);
      return {
        keys,
        privateStateProvider: {
          setContractAddress: () => undefined,
          get: async () => null,
          set: async () => undefined,
          getSigningKey: async (a: string) => keys.get(a) ?? null,
          setSigningKey: async (a: string, k: string) => void keys.set(a, k),
          removeSigningKey: async (a: string) => void keys.delete(a),
        },
      };
    };
    const KEY = 'ef'.repeat(32);

    it('asked for even when the provider claims to hold one, and joined as a deploy (not by the mainnet pin)', async () => {
      setNetworkId('preview');
      const store = keyStore('11'.repeat(32));
      const add = vi.spyOn(VeilcoreAPI, 'addMissingCircuitKeys').mockImplementation(async () => {
        expect(store.keys.get(ADDR)).toBe(KEY); // the paper key, not the one "held"
      });
      const join = vi.spyOn(VeilcoreAPI, 'join').mockResolvedValue({ deployedContractAddress: ADDR } as never);
      const answers = ['4', ADDR, ''];
      const rli = { question: async () => answers.shift() ?? '' } as unknown as Interface;
      const hidden = vi.fn(async () => KEY);
      await deployOrJoin(store as never, rli, silent, '.', '', hidden);
      expect(hidden).toHaveBeenCalledOnce();
      expect(join).toHaveBeenCalledWith(store, ADDR, silent, { deploying: true });
      expect(store.keys.has(ADDR)).toBe(false);
      add.mockRestore();
      join.mockRestore();
    });

    it('a failure drops the typed key too', async () => {
      setNetworkId('preview');
      const store = keyStore();
      const add = vi.spyOn(VeilcoreAPI, 'addMissingCircuitKeys').mockRejectedValue(new Error('not the authority'));
      const answers = ['4', ADDR];
      const rli = { question: async () => answers.shift() ?? '' } as unknown as Interface;
      await expect(deployOrJoin(store as never, rli, silent, '.', '', async () => KEY)).rejects.toThrow(
        'not the authority',
      );
      expect(store.keys.has(ADDR)).toBe(false);
      add.mockRestore();
    });

    it('the deploy itself tells the operator the key is on paper, not on this computer', () => {
      const api = readFileSync(path.join(HERE, '..', '..', 'api', 'src', 'veilcore-api.ts'), 'utf8');
      expect(api).toContain('keyOnPaper: true');
      expect(api).toContain('type the maintenance key from your paper');
    });
  });
});

// ─────────────────────────────────────────────── D-3

describe('D-3 FIXED: replacing the recovery secret has the "did it land?" check', () => {
  const setup = (lands: boolean) => {
    const sim = new VeilcoreSimulator();
    const own = secret('rd3-owner');
    const oldRcv = secret('rd3-old-recovery');
    const newRcv = secret('rd3-new-recovery');
    sim.call(as(own), 'anchor', C.recoveryCommit(oldRcv));
    const ps = memoryStore(createVeilcorePrivateState(own));
    const api = apiOver(ps, {
      replaceRecoveryCommitment: async (o: unknown, n: unknown) => {
        if (lands)
          sim.call(as(own, { recovery: oldRcv }), 'replaceRecoveryCommitment', o as Uint8Array, n as Uint8Array);
        throw new Error('indexer timeout while confirming');
      },
    });
    (api as any).currentLedger = async () => sim.state;
    return { sim, own, oldRcv, newRcv, ps, api, origin: C.commit(own) };
  };

  it('a replacement that LANDED is reported as landed: only the new recovery secret works', async () => {
    const { api, origin, newRcv, oldRcv, ps } = setup(true);
    const err = await api.replaceRecoveryCommitment(origin, C.recoveryCommit(newRcv), oldRcv).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecoveryReplacedButUnconfirmedError);
    expect((err as Error).message).toMatch(/Only the NEW recovery secret works now/);
    expect(((err as Error).cause as Error).message).toBe('indexer timeout while confirming');
    expect(await api.recoverySecretIsCurrent(origin, newRcv)).toBe(true);
    expect(await api.recoverySecretIsCurrent(origin, oldRcv)).toBe(false);
    expect((ps.state() as any).recoverySecret).toEqual(new Uint8Array(32)); // still cleared
  });

  it('one that did not land keeps the original error, and the old secret is still current', async () => {
    const { api, origin, newRcv, oldRcv } = setup(false);
    const err = await api.replaceRecoveryCommitment(origin, C.recoveryCommit(newRcv), oldRcv).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(RecoveryReplacedButUnconfirmedError);
    expect((err as Error).message).toBe('indexer timeout while confirming');
    expect(await api.recoverySecretIsCurrent(origin, oldRcv)).toBe(true);
  });

  it('a single read that shows it landed is not enough (the second disagrees)', async () => {
    const { api, origin, newRcv, oldRcv, sim } = setup(false);
    let reads = 0;
    const landedView = {
      originOf: sim.state.originOf,
      recoveryOf: { member: () => true, lookup: () => C.recoveryCommit(newRcv) },
    };
    (api as any).currentLedger = async () => (reads++ % 2 === 0 ? landedView : sim.state);
    const err = await api.replaceRecoveryCommitment(origin, C.recoveryCommit(newRcv), oldRcv).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(RecoveryReplacedButUnconfirmedError);
  });

  it('option 6 tells the operator what to keep in each case, and option 42 checks', () => {
    const cli = readFileSync(path.join(HERE, 'index.ts'), 'utf8');
    expect(cli).toContain('RecoveryReplacedButUnconfirmedError');
    expect(cli).toContain('Keep BOTH recovery secrets, the old and the new shown above');
    expect(cli).toContain('Keep the NEW one shown above. Option 42 checks it any time.');
    expect(cli).toContain('42. Check which recovery secret is current');
  });
});

// ─────────────────────────────────────────────── D-1

describe('D-1 FIXED: join checks the starting state, and on mainnet the pinned address', () => {
  /** The round D look-alike: this build's operations, a ledger where B is an anchored parent. */
  const forgedDeployState = () => {
    const B = secret('rd-famous-breeder');
    const X = secret('rd-stand-in');
    const CHILD = secret('rd-counterfeit');
    const sim = new VeilcoreSimulator();
    sim.call(as(X), 'anchor', freshRecovery());
    sim.call(as(CHILD), 'anchor', freshRecovery());
    sim.call(as(CHILD), 'proposeParent', C.commit(X));
    sim.call(as(X), 'confirmParent', C.commit(CHILD));
    const built = (sim as any).ctx.currentQueryContext.state as ChargedState;
    const swap = (v: unknown): unknown => {
      if (v instanceof Uint8Array) return hex(v) === hex(C.commit(X)) ? C.commit(B) : v;
      if (v instanceof Map) return new Map([...v.entries()].map(([k, x]) => [swap(k), swap(x)]));
      if (Array.isArray(v)) return v.map(swap);
      if (v !== null && typeof v === 'object')
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
      return v;
    };
    const genuine = genuineDeployState();
    const forged = new ContractState();
    forged.data = new ChargedState(StateValue.decode(swap(built.state.encode()) as never));
    for (const op of genuine.operations()) forged.setOperation(op, genuine.operation(op)!);
    return forged;
  };
  const genuineDeployState = (): ContractState => {
    const z = new Uint8Array(32);
    const w = (v: unknown) => (c: { privateState: unknown }) => [c.privateState, v];
    return new Contract({
      localGeneticSecret: w(z),
      incomingGeneticSecret: w(z),
      recoverySecret: w(z),
      licenseSecret: w(z),
      licenseRecord: w(z),
      licensePath: w(null),
      presentationChallenge: w(z),
    } as never).initialState(createConstructorContext({}, '0'.repeat(64))).currentContractState;
  };

  /** A genuine contract after record activity: the constructor's operations, a used ledger. */
  const usedState = (): ContractState => {
    const sim = new VeilcoreSimulator();
    sim.call(as(secret('rd1-used-a')), 'anchor', freshRecovery());
    sim.call(as(secret('rd1-used-b')), 'anchor', freshRecovery());
    const genuine = genuineDeployState();
    const built = (sim as any).ctx.currentQueryContext.state as ChargedState;
    const used = new ContractState();
    used.data = new ChargedState(StateValue.decode(built.state.encode()));
    for (const op of genuine.operations()) used.setOperation(op, genuine.operation(op)!);
    return used;
  };

  type Act = { readonly kind: 'deploy' | 'call' | 'update'; readonly state: ContractState; readonly txId: string };
  const toLedger = (s: ContractState) => LedgerContractState.deserialize(s.serialize());
  const unprovenTx = (intent: unknown) => Transaction.fromParts('undeployed', undefined, undefined, intent as never);

  /**
   * One contract's history on a fake indexer, behind a public data provider that answers
   * as midnight-js-indexer-public-data-provider 4.1.1 does (dist/index.mjs): the
   * "contractAction" it asks for is the LATEST action; for a call it follows the call's
   * `deploy` link, for a deploy or a maintenance update it takes that action as it is.
   * The transactions are real ledger transactions (a ContractDeploy; a MaintenanceUpdate).
   */
  const chain = (deployState: ContractState, later: readonly Omit<Act, 'txId'>[] = []) => {
    const deploy = new ContractDeploy(toLedger(deployState));
    const address = deploy.address;
    const ttl = new Date(Date.now() + 3_600_000);
    const acts: Act[] = [
      { kind: 'deploy', state: deployState, txId: 'd0' },
      ...later.map((a, i) => ({ ...a, txId: `a${i + 1}` })),
    ];
    const txs = new Map<string, unknown>([['d0', unprovenTx(Intent.new(ttl).addDeploy(deploy))]]);
    for (const a of acts.slice(1))
      txs.set(
        a.txId,
        a.kind === 'update'
          ? unprovenTx(Intent.new(ttl).addMaintenanceUpdate(new MaintenanceUpdate(address, [], 0n)))
          : unprovenTx(Intent.new(ttl)), // a call: no deploy in it (its call is not needed here)
      );
    const finalized = (txId: string) => ({ tx: txs.get(txId), status: SucceedEntirely, txId, identifiers: [txId] });
    const latest = (): Act => acts[acts.length - 1];
    const writes: string[] = [];
    const providers = {
      privateStateProvider: {
        setContractAddress: () => void writes.push('setContractAddress'),
        get: async () => (writes.push('get'), null),
        set: async () => void writes.push('set'),
        getSigningKey: async () => null,
        setSigningKey: async () => void writes.push('setSigningKey'),
      },
      publicDataProvider: {
        queryContractState: async (a: string) => (a === address ? latest().state : null),
        // DEPLOY_CONTRACT_STATE_TX_QUERY: `if (!('deploy' in contract)) return contract.state`.
        queryDeployContractState: async (a: string) =>
          a !== address ? null : latest().kind === 'call' ? acts[0].state : latest().state,
        // DEPLOY_TX_QUERY: `'deploy' in contract ? contract.deploy.transaction : contract.transaction`.
        watchForDeployTxData: async (a: string) =>
          a !== address ? new Promise(() => undefined) : finalized(latest().kind === 'call' ? 'd0' : latest().txId),
        // Polls until the transaction exists: never resolves for an unknown id.
        watchForTxData: async (id: string) => (txs.has(id) ? finalized(id) : new Promise(() => undefined)),
        contractStateObservable: () => NEVER,
      },
    };
    return { address, providers, writes };
  };
  /** join got past the starting-state check: it wrote for the address, then failed later on the fake. */
  const pastTheCheck = async (p: Promise<unknown>, writes: string[]) => {
    const e = await p.then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(String(e)).not.toMatch(/did not start from|not a genuine|Could not check|cannot be checked/);
    expect(writes[0]).toBe('setContractAddress');
  };
  const refusedUntouched = async (p: Promise<unknown>, writes: string[], why: RegExp) => {
    await expect(p).rejects.toThrow(why);
    expect(writes).toEqual([]);
  };

  it('the genuine constructor state passes the comparison; the look-alike does not', () => {
    expect(startsFromConstructor(genuineDeployState())).toBe(true);
    expect(startsFromConstructor(forgedDeployState())).toBe(false);
  });

  it('join refuses the look-alike before writing anything for its address', async () => {
    setNetworkId('preprod');
    const { address, providers, writes } = chain(forgedDeployState());
    await refusedUntouched(
      VeilcoreAPI.join(providers as never, address, silent),
      writes,
      /did not start from the VeilCore constructor's state/,
    );
  });

  it('join refuses an address the indexer has no contract at', async () => {
    setNetworkId('preprod');
    const { providers, writes } = chain(genuineDeployState());
    await refusedUntouched(VeilcoreAPI.join(providers as never, ADDR, silent), writes, /has no contract at/);
  });

  // Round D verification, Medium: the check used midnight-js's queryDeployContractState,
  // which, when the latest action is a maintenance update, returns the CURRENT state. After
  // record activity and then a key change, the genuine contract was refused as forged.
  it('a genuine contract whose latest action is a key change after record activity is NOT refused as forged', async () => {
    setNetworkId('preprod');
    const used = usedState();
    expect(startsFromConstructor(used)).toBe(false); // its ledger has moved on
    const c = chain(genuineDeployState(), [
      { kind: 'call', state: used },
      { kind: 'update', state: used },
    ]);
    // Exactly the situation: midnight-js's "deploy state" here is the current state.
    expect(startsFromConstructor((await c.providers.publicDataProvider.queryDeployContractState(c.address))!)).toBe(
      false,
    );
    // Without the deploy transaction id: not called forged; told why, and what to give.
    await refusedUntouched(
      VeilcoreAPI.join(c.providers as never, c.address, silent),
      c.writes,
      /NOT a finding that the contract is forged/,
    );
    await expect(VeilcoreAPI.join(c.providers as never, c.address, silent)).rejects.toBeInstanceOf(
      StartingStateUnreachableError,
    );
    // With it: the deploy transaction is read, and the contract passes.
    await pastTheCheck(VeilcoreAPI.join(c.providers as never, c.address, silent, { deployTxId: 'd0' }), c.writes);
  });

  it('a look-alike whose latest action is a key change: still refused, as forged once its deploy is read', async () => {
    setNetworkId('preprod');
    const forged = forgedDeployState();
    const c = chain(forged, [{ kind: 'update', state: forged }]);
    // Its ledger is not the constructor's now either, so nothing lets it through unread.
    await refusedUntouched(VeilcoreAPI.join(c.providers as never, c.address, silent), c.writes, /NOT a finding/);
    await refusedUntouched(
      VeilcoreAPI.join(c.providers as never, c.address, silent, { deployTxId: 'd0' }),
      c.writes,
      /did not start from the VeilCore constructor's state/,
    );
  });

  it("a deploy transaction id that is not this contract's deploy is refused, and nothing is written", async () => {
    setNetworkId('preprod');
    const used = usedState();
    const c = chain(genuineDeployState(), [
      { kind: 'call', state: used },
      { kind: 'update', state: used },
    ]);
    const other = chain(genuineDeployState());
    for (const id of ['a2', 'a1']) // the key change itself; a call
      await refusedUntouched(
        VeilcoreAPI.join(c.providers as never, c.address, silent, { deployTxId: id }),
        c.writes,
        /is not a successful deploy of the contract at/,
      );
    // Another contract's deploy (looked up on that contract's indexer, same id 'd0', different address).
    const mixed = {
      ...c.providers,
      publicDataProvider: {
        ...c.providers.publicDataProvider,
        watchForTxData: other.providers.publicDataProvider.watchForTxData,
      },
    };
    await refusedUntouched(
      VeilcoreAPI.join(mixed as never, c.address, silent, { deployTxId: 'd0' }),
      c.writes,
      /is not a successful deploy/,
    );
    await refusedUntouched(
      VeilcoreAPI.join(c.providers as never, c.address, silent, { deployTxId: 'not hex' }),
      c.writes,
      /not a transaction id/,
    );
    // An id the indexer never finds: midnight-js polls for ever; the check gives up, says so.
    await expect(
      checkStartingState({
        publicDataProvider: c.providers.publicDataProvider as never,
        address: c.address,
        deployTxId: 'ee',
        pinned: false,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/did not find transaction ee within/);
  });

  it("midnight-js failing to map a key change's transaction (IndexerDataError) is where the latest action is, not a verdict", async () => {
    setNetworkId('preprod');
    const fresh = genuineDeployState();
    const c = chain(fresh, [{ kind: 'update', state: fresh }]);
    const failing = (e: Error) => ({
      ...c.providers.publicDataProvider,
      watchForDeployTxData: async () => {
        throw e;
      },
    });
    const dataError = Object.assign(new Error('Missing identifier'), { name: 'IndexerDataError' });
    expect(
      await checkStartingState({ publicDataProvider: failing(dataError) as never, address: c.address, pinned: false }),
    ).toEqual({
      checked: 'current-state',
    });
    // The indexer never handing the transaction over: a time-out, not a verdict; the pin still decides.
    const used = usedState();
    const u = chain(genuineDeployState(), [
      { kind: 'call', state: used },
      { kind: 'update', state: used },
    ]);
    const hanging = { ...u.providers.publicDataProvider, watchForDeployTxData: () => new Promise(() => undefined) };
    await expect(
      checkStartingState({ publicDataProvider: hanging as never, address: u.address, pinned: false, timeoutMs: 20 }),
    ).rejects.toThrow(/did not hand over the deploy transaction/);
    expect(
      await checkStartingState({
        publicDataProvider: hanging as never,
        address: u.address,
        pinned: true,
        timeoutMs: 20,
      }),
    ).toEqual({ checked: 'pinned-address' });
    // Any other failure (the indexer down) is passed on as it is.
    await expect(
      checkStartingState({
        publicDataProvider: failing(new Error('socket hang up')) as never,
        address: c.address,
        pinned: false,
      }),
    ).rejects.toThrow(/socket hang up/);
  });

  it('read from the deploy transaction whenever the latest action leads to it: deploy, call, or call after a key change', async () => {
    setNetworkId('preprod');
    const used = usedState();
    for (const later of [
      [],
      [{ kind: 'call' as const, state: used }],
      [
        { kind: 'update' as const, state: genuineDeployState() },
        { kind: 'call' as const, state: used },
      ],
    ]) {
      const c = chain(genuineDeployState(), later);
      const { lines, logger } = recording();
      await pastTheCheck(VeilcoreAPI.join(c.providers as never, c.address, logger), c.writes);
      expect(lines).toContain(
        "Starting state checked: deploy transaction d0 carries the VeilCore constructor's state.",
      );
    }
  });

  it('a fresh deploy with its keys added (latest action a key change, no record activity): accepted, as "Finish a deploy" needs', async () => {
    setNetworkId('preprod');
    const fresh = genuineDeployState();
    const c = chain(fresh, [
      { kind: 'update', state: fresh },
      { kind: 'update', state: fresh },
    ]);
    const { lines, logger } = recording();
    await pastTheCheck(VeilcoreAPI.join(c.providers as never, c.address, logger, { deploying: true }), c.writes);
    expect(lines.join('\n')).toMatch(/ledger is still exactly the VeilCore constructor's/);
  });

  it('mainnet, the pinned address, latest action a key change after record activity: joined, and the log says the pin decided', async () => {
    const used = usedState();
    const c = chain(genuineDeployState(), [
      { kind: 'call', state: used },
      { kind: 'update', state: used },
    ]);
    setNetworkId('mainnet');
    try {
      const { lines, logger } = recording();
      const r = await checkStartingState({
        publicDataProvider: c.providers.publicDataProvider as never,
        address: c.address,
        pinned: assertJoinAllowed(c.address, silent, c.address) === 'pinned',
        logger,
      });
      expect(r).toEqual({ checked: 'pinned-address' });
      expect(lines.join('\n')).toMatch(
        /Starting state not re-checked: .*that pin is what identifies VeilCore's contract/,
      );
      // The pin never excuses a deploy that WAS read and is forged.
      const forged = chain(forgedDeployState());
      await expect(
        checkStartingState({
          publicDataProvider: forged.providers.publicDataProvider as never,
          address: forged.address,
          pinned: true,
        }),
      ).rejects.toThrow(/did not start from/);
    } finally {
      setNetworkId('preprod');
    }
  });

  it('the CLI asks for the deploy transaction id when the deploy cannot be reached, and checks from it', async () => {
    setNetworkId('preprod');
    const used = usedState();
    const c = chain(genuineDeployState(), [
      { kind: 'call', state: used },
      { kind: 'update', state: used },
    ]);
    const asked: string[] = [];
    const rli = { question: async (q: string) => (asked.push(q), 'd0') } as unknown as Interface;
    await pastTheCheck(joinChecked(rli, c.providers as never, c.address, silent), c.writes);
    expect(asked).toEqual(['Deploy transaction id (hex; Enter to stop): ']);
    // Enter stops, with the explanation, and nothing written.
    const c2 = chain(genuineDeployState(), [
      { kind: 'call', state: used },
      { kind: 'update', state: used },
    ]);
    const stop = { question: async () => '' } as unknown as Interface;
    await refusedUntouched(joinChecked(stop, c2.providers as never, c2.address, silent), c2.writes, /NOT a finding/);
  });

  it('mainnet: no join while no address is pinned; only the pinned one once it is; deploy and finish are not joins by address', async () => {
    expect(MAINNET_VEILCORE_ADDRESS).toBe('a04de0a2684f3713276325649540c7278ffd07cba8b014e7489844f319a02347'); // pinned 8 Oct 2026
    setNetworkId('mainnet');
    const { providers, writes } = chain(genuineDeployState());
    await expect(VeilcoreAPI.join(providers as never, ADDR, silent)).rejects.toThrow(
      /the VeilCore contract is a04de0a2/,
    );
    expect(writes).toEqual([]);
    expect(() => assertJoinAllowed(ADDR, silent, 'cd'.repeat(32))).toThrow(/the VeilCore contract is cdcd/);
    expect(assertJoinAllowed(ADDR.toUpperCase(), silent, `0x${ADDR}`)).toBe('pinned');
    // A deploy's own join skips only the pin: the state check still runs (and refuses a forgery).
    const forged = chain(forgedDeployState());
    await expect(
      VeilcoreAPI.join(forged.providers as never, forged.address, silent, { deploying: true }),
    ).rejects.toThrow(/did not start from the VeilCore constructor's state/);
    // Development networks: any address.
    for (const n of ['preprod', 'preview', 'undeployed']) {
      setNetworkId(n);
      expect(assertJoinAllowed(ADDR, silent)).toBe('development');
    }
  });
});

// ─────────────────────────────────────────────── D-4

describe('D-4 FIXED: no switch of record secret on one indexer read, and a way back', () => {
  const rotating = () => {
    const sim = new VeilcoreSimulator();
    const own = secret('rd4-owner');
    const next = secret('rd4-next');
    sim.call(as(own), 'anchor', freshRecovery());
    const ps = memoryStore(createVeilcorePrivateState(own));
    const api = apiOver(ps, {
      rotateRecordSecret: async () => {
        throw new Error('websocket closed'); // never landed
      },
    });
    const origin = C.commit(own);
    const lyingView = {
      recoveryOf: sim.state.recoveryOf,
      originOf: { member: (r: Uint8Array) => hex(r) === hex(C.commit(next)), lookup: () => origin },
      headOf: { member: (o: Uint8Array) => hex(o) === hex(origin), lookup: () => C.commit(next) },
    };
    return { sim, own, next, ps, api, lyingView };
  };

  it('one lagging read that says it landed, then the truth: the client keeps its secret', async () => {
    const { api, ps, own, next, sim, lyingView } = rotating();
    let reads = 0;
    (api as any).currentLedger = async () => (reads++ === 0 ? lyingView : sim.state);
    const err = await api.rotateRecordSecret(C.commit(next), next).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(LandedButUnconfirmedError);
    expect(hex((ps.state() as any).geneticSecret)).toBe(hex(own));
  });

  it('two reads, apart, that agree: adopted, and the operator is told to keep BOTH secrets', async () => {
    const { api, ps, next, lyingView } = rotating();
    (api as any).currentLedger = async () => lyingView;
    const err = await api.rotateRecordSecret(C.commit(next), next).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LandedButUnconfirmedError);
    expect((err as Error).message).toMatch(/Keep BOTH record secrets/);
    expect(hex((ps.state() as any).geneticSecret)).toBe(hex(next));
  });

  it('the default waits 30 s between the two reads', () => {
    const fresh = new (VeilcoreAPI as any)(
      { deployTxData: { public: { contractAddress: ADDR } } },
      { privateStateProvider: memoryStore({}), publicDataProvider: { contractStateObservable: () => NEVER } },
    );
    expect(fresh.landedCheck.confirmGapMs).toBe(30_000);
  });

  it('the way back: useRecordSecret returns to the old secret when the chain shows it is still the head', async () => {
    const { api, ps, own, next, sim, lyingView } = rotating();
    (api as any).currentLedger = async () => lyingView;
    await api.rotateRecordSecret(C.commit(next), next).catch(() => undefined);
    expect(hex((ps.state() as any).geneticSecret)).toBe(hex(next)); // the indexer misled it
    (api as any).currentLedger = async () => sim.state; // the truth
    expect(await api.useRecordSecret(own)).toEqual({ anchored: true });
    expect(hex((ps.state() as any).geneticSecret)).toBe(hex(own));
  });

  it('useRecordSecret refuses a secret that was rotated away, and changes nothing', async () => {
    const sim = new VeilcoreSimulator();
    const own = secret('rd4b-owner');
    const next = secret('rd4b-next');
    sim.call(as(own), 'anchor', freshRecovery());
    sim.call(as(own, { incoming: next }), 'rotateRecordSecret', C.commit(next));
    const ps = memoryStore(createVeilcorePrivateState(next));
    const api = apiOver(ps, {});
    (api as any).currentLedger = async () => sim.state;
    await expect(api.useRecordSecret(own)).rejects.toThrow(/controls nothing/);
    expect(hex((ps.state() as any).geneticSecret)).toBe(hex(next));
    expect(await api.useRecordSecret(secret('rd4b-fresh'))).toEqual({ anchored: false }); // a fresh one is fine
  });

  it('the CLI no longer tells the operator to discard the old secret, and has option 41', () => {
    const cli = readFileSync(path.join(HERE, 'index.ts'), 'utf8');
    expect(cli).not.toContain('the old one can do nothing now');
    expect(cli).toContain('41. Use a record secret you hold');
    expect(cli).toContain('api.useRecordSecret(s)');
  });
});

// ─────────────────────────────────────────────── D-5

describe('D-5 FIXED: circuit names are matched exactly', () => {
  const genuineState = () => {
    const z = new Uint8Array(32);
    const w = (v: unknown) => (c: { privateState: unknown }) => [c.privateState, v];
    const st = new Contract({
      localGeneticSecret: w(z),
      incomingGeneticSecret: w(z),
      recoverySecret: w(z),
      licenseSecret: w(z),
      licenseRecord: w(z),
      licensePath: w(null),
      presentationChallenge: w(z),
    } as never).initialState(createConstructorContext({}, '0'.repeat(64))).currentContractState;
    return Buffer.from(st.serialize()).toString('hex');
  };
  const answer = (entryPoint: string) =>
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        data: {
          transactions: [
            {
              identifiers: ['aa'],
              transactionResult: { status: 'SUCCESS' },
              block: { height: 7, timestamp: 1_790_000_000_000 },
              contractActions: [{ address: ADDR, state: genuineState(), entryPoint }],
            },
          ],
        },
      }),
    }));

  it('"ProveLicense" is refused where "proveLicense" is asked for', async () => {
    answer('ProveLicense');
    await expect(singleCallState('http://indexer', ADDR, 'aa', ['proveLicense'], 'refused')).rejects.toThrow('refused');
  });

  it('the exact name, and its UTF-8 hex in either case, are accepted; the block height and time come back', async () => {
    for (const e of [
      'proveLicense',
      Buffer.from('proveLicense').toString('hex'),
      `0x${Buffer.from('proveLicense').toString('hex').toUpperCase()}`,
    ]) {
      answer(e);
      const found = await singleCallState('http://indexer', ADDR, 'aa', ['proveLicense'], 'refused');
      expect(found.entryPoint).toBe('proveLicense');
      expect(found.blockHeight).toBe(7);
      expect(found.blockTime).toBe(1_790_000_000_000);
    }
  });

  it('matchEntryPoint never folds case', () => {
    expect(matchEntryPoint('PROVELICENSE', ['proveLicense'])).toBeUndefined();
    expect(matchEntryPoint(Buffer.from('ProveLicense').toString('hex'), ['proveLicense'])).toBeUndefined();
    expect(matchEntryPoint('face', ['FACE'])).toBeUndefined();
  });
});

// ─────────────────────────────────────────────── D-6

describe('D-6 FIXED: the password stays out of the environment and away from child processes', () => {
  it('git runs with only PATH, HOME and GIT_CONFIG_NOSYSTEM: a git on PATH sees no password and no Blockfrost id', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-hd-git-'));
    const dump = path.join(dir, 'env.txt');
    writeFileSync(path.join(dir, 'git'), `#!/bin/sh\nenv > "${dump}"\necho "$@" >> "${dump}"\nexit 1\n`);
    chmodSync(path.join(dir, 'git'), 0o755);
    const saved = {
      PATH: process.env.PATH,
      PW: process.env.VEILCORE_PRIVATE_STATE_PASSWORD,
      BF: process.env.VEILCORE_BLOCKFROST_PROJECT_ID,
    };
    process.env.PATH = `${dir}:${process.env.PATH}`;
    process.env.VEILCORE_PRIVATE_STATE_PASSWORD = PASSWORD;
    process.env.VEILCORE_BLOCKFROST_PROJECT_ID = 'mainnetSECRETPROJECTID';
    try {
      expect(() => assertKeysMatchRecord(dir, dir)).toThrow();
    } finally {
      process.env.PATH = saved.PATH;
      for (const [k, v] of [
        ['VEILCORE_PRIVATE_STATE_PASSWORD', saved.PW],
        ['VEILCORE_BLOCKFROST_PROJECT_ID', saved.BF],
      ] as const)
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    const seen = readFileSync(dump, 'utf8');
    expect(seen).not.toContain(PASSWORD);
    expect(seen).not.toContain('SECRETPROJECTID');
    expect(seen).toContain('core.fsmonitor=false');
    expect(seen).toContain('core.hooksPath=/dev/null');
    expect(Object.keys(gitEnvironment()).sort()).toEqual(
      ['GIT_CONFIG_NOSYSTEM', 'HOME', 'PATH'].filter((k) => k !== 'HOME' || process.env.HOME !== undefined),
    );
  });

  it('a typed password is held in memory, never put in the environment', async () => {
    const saved = process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
    delete process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
    forgetPassword();
    try {
      const answers = [PASSWORD, PASSWORD];
      expect(await settlePassword(async () => answers.shift() ?? '', silent)).toBe(true);
      expect(process.env.VEILCORE_PRIVATE_STATE_PASSWORD).toBeUndefined();
      expect(privateStatePassword()).toBe(PASSWORD);
    } finally {
      forgetPassword();
      if (saved !== undefined) process.env.VEILCORE_PRIVATE_STATE_PASSWORD = saved;
    }
  });

  it('a password from the environment is taken, then removed from it', async () => {
    const saved = process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
    process.env.VEILCORE_PRIVATE_STATE_PASSWORD = PASSWORD;
    forgetPassword();
    try {
      expect(await settlePassword(async () => '', silent)).toBe(true);
      expect(process.env.VEILCORE_PRIVATE_STATE_PASSWORD).toBeUndefined();
      expect(privateStatePassword()).toBe(PASSWORD);
    } finally {
      forgetPassword();
      if (saved !== undefined) process.env.VEILCORE_PRIVATE_STATE_PASSWORD = saved;
      else delete process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
    }
  });

  it('nothing in the CLI reads the password from the environment except settlePassword', () => {
    for (const f of ['index.ts', 'wallet-state.ts', 'challenge-file.ts', 'claims-menu.ts']) {
      expect(readFileSync(path.join(HERE, f), 'utf8')).not.toContain('process.env.VEILCORE_PRIVATE_STATE_PASSWORD');
    }
  });
});

// ─────────────────────────────────────────────── D-7 (API side)

describe('D-7 FIXED: a licence check reports the presentation time and refuses a stale one', () => {
  const presentation = (timestampMs: number) => {
    const sim = new VeilcoreSimulator();
    const I = secret('rd7-issuer');
    sim.call(as(I), 'anchor', freshRecovery());
    const I_REC = C.commit(I);
    const s = secret('rd7-licensee');
    sim.call(as(I), 'issueLicense', C.licenseCommit(s, I_REC));
    sim.withLicence({ secret: s, record: I_REC }, () =>
      sim.call(as(secret('anyone')), 'countersignLicense', I_REC, sim.freeSlot()),
    );
    const challenge = secret('rd7-challenge');
    sim.withLicence({ secret: s, record: I_REC, challenge }, () => sim.call(as(secret('anyone')), 'proveLicense'));
    const cs = new ContractState();
    cs.data = (sim as any).ctx.currentQueryContext.state as ChargedState;
    const state = Buffer.from(cs.serialize()).toString('hex');
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        data: {
          transactions: [
            {
              identifiers: ['aa'],
              transactionResult: { status: 'SUCCESS' },
              block: { height: 42, timestamp: timestampMs },
              contractActions: [{ address: ADDR, state, entryPoint: 'proveLicense' }],
            },
          ],
        },
      }),
    }));
    return { I_REC, challenge, api: apiOver(memoryStore({}), {}) };
  };

  it('fresh: accepted, saying it was live WHEN PRESENTED, with block and time', async () => {
    const t = Date.now() - 5 * 60_000;
    const { api, I_REC, challenge } = presentation(t);
    const v = await api.checkPresentation('http://indexer', 'aa', I_REC, challenge, t - 60_000);
    expect(v.accepted).toBe(true);
    expect(v.reason).toMatch(/^the licence was live when presented \(block 42, /);
    expect(v.reason).toContain(new Date(t).toISOString());
  });

  it('three days old (the round D attack): refused, ask for a new one', async () => {
    const t = Date.now() - 3 * 86_400_000;
    const { api, I_REC, challenge } = presentation(t);
    const v = await api.checkPresentation('http://indexer', 'aa', I_REC, challenge, t - 60_000);
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/minutes old .*Ask for a new one/);
  });

  it('landed before the challenge was issued: refused', async () => {
    const t = Date.now() - 10 * 60_000;
    const { api, I_REC, challenge } = presentation(t);
    const v = await api.checkPresentation('http://indexer', 'aa', I_REC, challenge, t + 5 * 60_000);
    expect(v).toMatchObject({ accepted: false, reason: 'the presentation landed before you issued this challenge' });
  });

  it("option 27 passes the challenge book's issue time", () => {
    expect(readFileSync(path.join(HERE, 'index.ts'), 'utf8')).toContain(
      'api.checkPresentation(indexerUri, txId, issuer, ch, book.issuedAt(ch))',
    );
  });
});

// ─────────────────────────────────────────────── D-8

describe('D-8 FIXED: a state-stream error is handled, not a crash', () => {
  it('an indexer error: no unhandled error, option 31 cleared, one warning, and the stream comes back', async () => {
    const unhandled: unknown[] = [];
    const prev = rxConfig.onUnhandledError;
    rxConfig.onUnhandledError = (e) => void unhandled.push(e);
    try {
      let subscriptions = 0;
      const flaky = new Observable<number>((sub) => {
        subscriptions++;
        if (subscriptions <= 2) sub.error(new Error('websocket closed by indexer'));
        else sub.next(7);
      });
      const seen: (number | undefined)[] = [];
      const { lines, logger } = recording();
      const s = watchState(flaky, logger, (v) => seen.push(v), 1);
      // Wait for the outcome, not for a fixed time: the two retries are 1 ms and 2 ms
      // timers, and a fixed 50 ms wait failed whenever the event loop stalled ~50 ms (a GC
      // pause, a WASM call, a busy machine). Busy-blocking here proves the wait survives one.
      const end = Date.now() + 80;
      while (Date.now() < end) {
        /* a stalled event loop */
      }
      await vi.waitFor(() => expect(seen).toEqual([undefined, undefined, 7]), { timeout: 5000, interval: 5 });
      s.unsubscribe();
      expect(unhandled).toEqual([]);
      expect(seen).toEqual([undefined, undefined, 7]);
      expect(lines.filter((l) => l.includes('Updates from the indexer stopped'))).toHaveLength(1);
      expect(lines).toContain('Updates from the indexer are back.');
    } finally {
      rxConfig.onUnhandledError = prev;
    }
  });

  it("the real state$ of the API, failing for good, never reaches rxjs's unhandled-error path", async () => {
    const unhandled: unknown[] = [];
    const prev = rxConfig.onUnhandledError;
    rxConfig.onUnhandledError = (e) => void unhandled.push(e);
    try {
      const providers = {
        privateStateProvider: memoryStore(createVeilcorePrivateState(secret('rd8'))),
        publicDataProvider: {
          contractStateObservable: () => throwError(() => new Error('websocket closed by indexer')),
        },
      };
      const api = new (VeilcoreAPI as any)(
        { deployTxData: { public: { contractAddress: ADDR } }, callTx: {} },
        providers,
      );
      const sub = watchState(api.state$, silent, () => undefined, 1);
      await new Promise((r) => setTimeout(r, 30));
      sub.unsubscribe();
      expect(unhandled).toEqual([]);
    } finally {
      rxConfig.onUnhandledError = prev;
    }
  });

  it('guardProcess logs a stray error and says to check a transaction in progress; it is removed afterwards', () => {
    const before = process.listenerCount('uncaughtException');
    const logged: unknown[] = [];
    const { lines, logger } = recording();
    const unguard = guardProcess(
      (e) => logged.push(e),
      logger,
      () => 1,
    );
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
    process.emit('uncaughtException', new Error('stray'));
    expect((logged[0] as Error).message).toBe('stray');
    expect(lines.join('\n')).toMatch(/Check whether it landed/);
    unguard();
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });

  it('the main menu subscribes through watchState', () => {
    const cli = readFileSync(path.join(HERE, 'index.ts'), 'utf8');
    expect(cli).toContain('watchState(api.state$, logger, (s) => (derived = s))');
    expect(cli).not.toContain('api.state$.subscribe(');
  });
});

// ─────────────────────────────────────────────── retirement

describe('Low FIXED: the main contract retires provably, and no replacement key is made or stored', () => {
  it('option 33 path: an empty committee is sent; replaceAuthority is never called; the typed key is gone afterwards', async () => {
    setNetworkId('undeployed');
    sent.txs = [];
    let retired = false;
    sent.onSubmit = () => void (retired = true);
    const keys = new Map<string, string>();
    const setKey = vi.fn(async (a: string, k: string) => void keys.set(a, k));
    const store = {
      setContractAddress: () => undefined,
      get: async () => null,
      set: async () => undefined,
      setSigningKey: setKey,
      getSigningKey: async (a: string) => keys.get(a) ?? null,
      removeSigningKey: async (a: string) => void keys.delete(a),
    };
    const replaceAuthority = vi.fn(async () => ({}));
    const typed = sampleSigningKey();
    const providers = {
      privateStateProvider: store,
      publicDataProvider: {
        contractStateObservable: () => NEVER,
        queryContractState: async () => ({
          maintenanceAuthority: retired
            ? { committee: [], threshold: 1, counter: 1n }
            : { committee: ['k'], threshold: 1, counter: 0n },
        }),
      },
    };
    const deployed = {
      deployTxData: { public: { contractAddress: ADDR } },
      callTx: {},
      contractMaintenanceTx: { replaceAuthority },
    };
    const api = new (VeilcoreAPI as any)(deployed, providers) as Api;
    await api.retireMaintenanceAuthority(typed);
    expect(sent.txs).toHaveLength(1);
    expect(replaceAuthority).not.toHaveBeenCalled();
    expect(setKey.mock.calls).toEqual([[ADDR, typed]]); // only the typed key, never a replacement
    expect(keys.size).toBe(0);
  });

  it('a retirement that fails leaves no key either', async () => {
    const keys = new Map<string, string>();
    const store = {
      setContractAddress: () => undefined,
      get: async () => null,
      set: async () => undefined,
      setSigningKey: async (a: string, k: string) => void keys.set(a, k),
      getSigningKey: async (a: string) => keys.get(a) ?? null,
      removeSigningKey: async (a: string) => void keys.delete(a),
    };
    const providers = {
      privateStateProvider: store,
      publicDataProvider: {
        contractStateObservable: () => NEVER,
        queryContractState: async () => {
          throw new Error('indexer down');
        },
      },
    };
    const api = new (VeilcoreAPI as any)(
      { deployTxData: { public: { contractAddress: ADDR } }, callTx: {} },
      providers,
    );
    await expect(api.retireMaintenanceAuthority(sampleSigningKey())).rejects.toThrow('indexer down');
    expect(keys.size).toBe(0);
  });
});
