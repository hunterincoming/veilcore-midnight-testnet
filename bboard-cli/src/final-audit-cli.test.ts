// Final pre-mainnet audit: the operator-tool findings, each asserting its fix (FIXED).
// The original proofs of concept showed B1 (the recovery phrase logged as an "Invalid
// choice"); they now assert it cannot happen.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';

// Feed the CLI's one readline from a stream instead of the keyboard, and keep what it shows.
const input = new PassThrough();
const screen = vi.hoisted(() => ({ text: '' }));
vi.mock('./prompt', async (orig) => {
  const real = await orig<typeof import('./prompt')>();
  const { PassThrough: Sink } = await import('node:stream');
  const sink = Object.assign(new Sink(), {
    columns: 80,
    rows: 24,
    isTTY: true,
  }) as unknown as NodeJS.WriteStream;
  sink.on('data', (c: Buffer) => void (screen.text += c.toString()));
  return { ...real, createPrompt: () => real.createPrompt(input, sink) };
});

// The fingerprint check reads the real build; here it passes or fails on demand.
const keys = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock('./keys-check', () => ({
  assertKeysMatchRecord: () => {
    keys.calls++;
    if (keys.fail) throw new Error('keys/anchor.prover does not match the record.');
    return 24;
  },
}));

// Wallet construction: by default it records what it was given and stops the run there
// (no network in a test). `real` uses the real one.
const wallet: { real: boolean; source: unknown } = vi.hoisted(() => ({ real: false, source: undefined }));
vi.mock('./midnight-wallet-provider', async (orig) => {
  const real = await orig<typeof import('./midnight-wallet-provider')>();
  const build: typeof real.MidnightWalletProvider.build = async (...args) => {
    if (wallet.real) return real.MidnightWalletProvider.build(...args);
    wallet.source = args[2];
    throw new real.SavedProgressNotOpenedError();
  };
  return { ...real, MidnightWalletProvider: { ...real.MidnightWalletProvider, build } };
});

// The deploy transaction, so VeilcoreAPI.deploy can be run with no chain.
const chain = vi.hoisted(() => ({
  createUnprovenDeployTx: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
  submitTxAsync: undefined as undefined | ((...a: unknown[]) => Promise<unknown>),
}));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    createUnprovenDeployTx: (...a: unknown[]) => chain.createUnprovenDeployTx!(...a),
    submitTxAsync: (...a: unknown[]) => chain.submitTxAsync!(...a),
  };
});

const { run, deployOrJoin, askMaintenanceAuthority, NOT_AN_OPTION } = await import('./index');
const { createLogger } = await import('./logger-utils');
const { VeilcoreAPI } = await import('../../api/src/veilcore-api');
const { WalletStateFile } = await import('./wallet-state');
const { MidnightWalletProvider, SavedProgressNotOpenedError } = await import('./midnight-wallet-provider');

// 24 words, standing in for the mainnet recovery phrase.
const WORDS = (
  'legal winner thank year wave sausage worth useful legal winner thank yellow ' +
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'
).split(' ');
const PW = 'Correct-Horse-Battery-9!';

/** No three consecutive words of the phrase anywhere in `text`. */
const noPhrase = (text: string): void => {
  for (let i = 0; i + 3 <= WORDS.length; i++) expect(text).not.toContain(WORDS.slice(i, i + 3).join(' '));
};

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

/** One run of the CLI on mainnet settings, answering each prompt in turn. `chunks` are written as given. */
const runCli = async (
  chunks: string[],
  env: { networkId?: string } = { networkId: 'mainnet' },
): Promise<{ log: string; logPath: string; started: () => boolean }> => {
  process.env.VEILCORE_PRIVATE_STATE_PASSWORD = PW;
  screen.text = '';
  const logPath = path.join(mkdtempSync(path.join(tmpdir(), 'vc-final-')), 'mainnet.log');
  const logger = await createLogger(logPath);
  const config = { mainnet: true, generateDust: false, privateStateStoreName: 'x', logDir: logPath, zkConfigPath: '.' };
  let started = false;
  const testEnv = {
    start: async () => {
      started = true;
      return env;
    },
    shutdown: async () => undefined,
  };
  const done = run(config as never, testEnv as never, logger);
  for (const c of chunks) {
    await tick();
    input.write(c);
  }
  await done;
  await tick(200);
  return { log: readFileSync(logPath, 'utf8'), logPath, started: () => started };
};

afterEach(() => {
  keys.fail = false;
  wallet.real = false;
  wallet.source = undefined;
});

describe('B1 FIXED: menu answers are never echoed or logged', () => {
  it('the phrase pasted at the wallet menu: not logged, not repeated; "Not an option" instead', async () => {
    setNetworkId('mainnet');
    const { log } = await runCli([`${WORDS.join(' ')}\n`, '4\n']);
    expect(log).toContain(NOT_AN_OPTION);
    expect(log).not.toContain('Invalid choice');
    noPhrase(log);
    // A visible prompt shows the keys as they are typed, as every terminal does; the
    // program itself never prints the answer back.
    expect(screen.text.split(WORDS.join(' '))).toHaveLength(2);
  });

  it('a phrase copied as two lines, typed one line at a time: all 24 words are collected', async () => {
    const { log } = await runCli(['3\n', `${WORDS.slice(0, 12).join(' ')}\n`, `${WORDS.slice(12).join(' ')}\n`]);
    expect(wallet.source).toEqual({ mnemonic: WORDS.join(' ') });
    expect(screen.text).toContain('12 of 24 words so far');
    expect(log).not.toContain(NOT_AN_OPTION); // nothing reached the menu
    noPhrase(log);
    noPhrase(screen.text);
  });

  it('a phrase copied as two lines, pasted at once: all 24 words are collected', async () => {
    const { log } = await runCli([
      '3\n',
      `${WORDS.slice(0, 12).join(' ')}\n${WORDS.slice(12).join(' ').toUpperCase()}\n`,
    ]);
    expect(wallet.source).toEqual({ mnemonic: WORDS.join(' ') });
    noPhrase(log);
    noPhrase(screen.text.toLowerCase());
  });

  it('too few words then an empty line: refused by count, words not shown; back at the menu', async () => {
    const { log } = await runCli(['3\n', `${WORDS.slice(0, 12).join(' ')}\n`, '\n', '4\n']);
    expect(log).toContain('That is 12 words, not 24.');
    expect(wallet.source).toBeUndefined();
    noPhrase(log);
    noPhrase(screen.text);
  });

  it('deploy-or-join menu: a wrong answer is not repeated', async () => {
    setNetworkId('preview');
    const lines: string[] = [];
    const logger = { info: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } as unknown as Logger;
    const answers = [WORDS.join(' '), '5'];
    const rli = { question: async () => answers.shift() ?? '5' } as unknown as Interface;
    expect(await deployOrJoin({} as never, rli, logger, '.', '')).toBeNull();
    expect(lines).toEqual([NOT_AN_OPTION]);
  });

  it('no source line echoes a menu choice into the logger', () => {
    const code = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'index.ts'), 'utf8');
    expect(code).not.toMatch(/logger\.\w+\([^)]*\$\{choice\}/);
    expect(code).not.toMatch(/Invalid choice/);
  });
});

describe('M2 FIXED: on mainnet the build and the record gate are checked before the wallet sync', () => {
  it('both are reported right after the password, before the environment starts', async () => {
    setNetworkId('mainnet');
    const saved = process.env.VEILCORE_DEPLOYMENT_RECORD_REVISION;
    delete process.env.VEILCORE_DEPLOYMENT_RECORD_REVISION;
    try {
      const { log } = await runCli(['4\n']);
      const fp = log.indexOf('All 24 build artefacts match');
      const gate = log.indexOf('Deployment record:');
      const env = log.indexOf('Environment started');
      expect(fp).toBeGreaterThan(-1);
      expect(gate).toBeGreaterThan(fp);
      expect(env).toBeGreaterThan(gate);
      expect(log).toContain('Deploying (option 1) will be refused');
    } finally {
      if (saved !== undefined) process.env.VEILCORE_DEPLOYMENT_RECORD_REVISION = saved;
    }
  });

  it('a build that does not match stops before anything starts', async () => {
    keys.fail = true;
    const { log, started } = await runCli([]);
    expect(log).toContain('does not match the record');
    expect(log).toContain('Nothing was started.');
    expect(started()).toBe(false);
  });
});

describe('m2, m6, M5', () => {
  it('m2: the password from the environment is announced, never shown', async () => {
    const { log } = await runCli(['4\n']);
    expect(log).toContain('Using the password from VEILCORE_PRIVATE_STATE_PASSWORD.');
    expect(log).not.toContain(PW);
  });

  it('m6: the log file is readable by its owner only', async () => {
    const { logPath } = await runCli(['4\n']);
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
  });

  it('M5: Ctrl+C at a prompt stops cleanly, with no error', async () => {
    const { log } = await runCli(['\x03']);
    expect(log).toContain('Stopping…');
    expect(log).not.toContain('Found error');
    expect(log).toContain('Stopping test environment');
  });
});

describe('B2 FIXED: a generated maintenance key must be typed back from paper', () => {
  it('shown in groups of 8; a wrong copy is refused; SHOW shows it again; the right one (any case, dashes) is taken', async () => {
    const shown: string[] = [];
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
      shown.push(c.toString());
      return true;
    });
    try {
      const errors: string[] = [];
      const logger = {
        info: () => undefined,
        error: (m: string) => errors.push(m),
      } as unknown as Logger;
      const rliAnswers = ['y', 'WRITTEN'];
      const rli = { question: async () => rliAnswers.shift() ?? '' } as unknown as Interface;
      const grouped = (): string => {
        const m = shown.join('').match(/((?:[0-9a-f]{8} ){7}[0-9a-f]{8})/);
        if (m === null) throw new Error('key not shown in groups of 8');
        return m[1];
      };
      let asked = 0;
      const hidden = async (): Promise<string> => {
        asked++;
        if (asked === 1) return ''; // generate one
        if (asked === 2) return grouped().replace(/^./, (c) => (c === '0' ? '1' : '0')); // one character wrong
        if (asked === 3) return 'SHOW';
        return grouped().toUpperCase().replace(/ /g, '-');
      };
      const key = await askMaintenanceAuthority(rli, logger, hidden);
      expect(key).toBe(grouped().replace(/ /g, ''));
      expect(asked).toBe(4);
      expect(errors).toEqual([
        'That does not match the key shown. Check your paper copy, correct it, and type it again.',
      ]);
      expect(shown.join('').match(/MAINTENANCE AUTHORITY SIGNING KEY/g)).toHaveLength(2); // shown again on SHOW
    } finally {
      out.mockRestore();
    }
  });
});

describe('M1 FIXED: a deploy whose confirmation fails can still be finished', () => {
  const ADDR = 'cd'.repeat(32);
  const KEY = 'ef'.repeat(32);
  const fakeStore = (held?: string) => {
    const signingKeys = new Map<string, string>(held === undefined ? [] : [[ADDR, held]]);
    const order: string[] = [];
    let ps: unknown;
    return {
      signingKeys,
      order,
      privateState: () => ps,
      privateStateProvider: {
        setContractAddress: () => undefined,
        get: async () => ps,
        set: async (_: string, v: unknown) => {
          order.push('set private state');
          ps = v;
        },
        getSigningKey: async (a: string) => signingKeys.get(a) ?? null,
        setSigningKey: async (a: string, k: string) => {
          order.push(`set key ${a}`);
          signingKeys.set(a, k);
        },
        removeSigningKey: async (a: string) => {
          order.push(`remove key ${a}`);
          signingKeys.delete(a);
        },
      },
    };
  };
  const quiet = () => {
    const lines: string[] = [];
    const push = (m: unknown) => void lines.push(typeof m === 'string' ? m : JSON.stringify(m));
    return { lines, logger: { info: push, warn: push, error: push } as unknown as Logger };
  };

  it('M1(b): finish-a-deploy asks for the paper key when this machine has none, then removes it again', async () => {
    setNetworkId('preview');
    const store = fakeStore();
    const add = vi.spyOn(VeilcoreAPI, 'addMissingCircuitKeys').mockImplementation(async () => {
      store.order.push(`add keys (key held: ${store.signingKeys.has(ADDR)})`);
    });
    const join = vi.spyOn(VeilcoreAPI, 'join').mockResolvedValue({ deployedContractAddress: ADDR } as never);
    try {
      const { lines, logger } = quiet();
      const answers = ['4', ADDR, ''];
      const rli = { question: async () => answers.shift() ?? '' } as unknown as Interface;
      const typed = [
        'not a key',
        KEY.toUpperCase()
          .replace(/(.{8})/g, '$1 ')
          .trim(),
      ];
      const api = await deployOrJoin(store as never, rli, logger, '.', '', async () => typed.shift() ?? '');
      expect(api).not.toBeNull();
      expect(store.order).toEqual([`set key ${ADDR}`, 'add keys (key held: true)', `remove key ${ADDR}`]);
      expect(store.signingKeys.get(ADDR)).toBeUndefined();
      expect(lines).toContain(`Contract address: ${ADDR}`);
      expect(lines.join('\n')).not.toContain(KEY);
    } finally {
      add.mockRestore();
      join.mockRestore();
    }
  });

  it('M1(b): a key typed in is removed again if finishing fails', async () => {
    setNetworkId('preview');
    const store = fakeStore();
    const add = vi.spyOn(VeilcoreAPI, 'addMissingCircuitKeys').mockRejectedValue(new Error('not the authority'));
    try {
      const answers = ['4', ADDR];
      const rli = { question: async () => answers.shift() ?? '' } as unknown as Interface;
      await expect(deployOrJoin(store as never, rli, quiet().logger, '.', '', async () => KEY)).rejects.toThrow(
        'not the authority',
      );
      expect(store.signingKeys.has(ADDR)).toBe(false);
    } finally {
      add.mockRestore();
    }
  });

  // Round D (D-2) replaced "a key already held is used without asking": the CLI never
  // keeps the maintenance key on disk, so it is always typed from paper, and a key the
  // provider claims to hold is not relied on.
  it('M1(b), round D: the paper key is asked for even when the provider claims to hold one', async () => {
    setNetworkId('preview');
    const store = fakeStore(KEY);
    const add = vi.spyOn(VeilcoreAPI, 'addMissingCircuitKeys').mockResolvedValue();
    const join = vi.spyOn(VeilcoreAPI, 'join').mockResolvedValue({ deployedContractAddress: ADDR } as never);
    try {
      const answers = ['4', ADDR, ''];
      const rli = { question: async () => answers.shift() ?? '' } as unknown as Interface;
      const hidden = vi.fn(async () => '');
      expect(await deployOrJoin(store as never, rli, quiet().logger, '.', '', hidden)).toBeNull();
      expect(hidden).toHaveBeenCalledOnce();
      expect(add).not.toHaveBeenCalled(); // blank at the key prompt: nothing sent
    } finally {
      add.mockRestore();
      join.mockRestore();
    }
  });

  it('M1(a): the address is logged and the key and private state stored BEFORE the deploy is sent', async () => {
    setNetworkId('preview');
    const store = fakeStore();
    const { lines, logger } = quiet();
    chain.createUnprovenDeployTx = async () => ({
      public: { contractAddress: ADDR },
      private: { signingKey: KEY, initialPrivateState: { geneticSecret: new Uint8Array(32) }, unprovenTx: {} },
    });
    chain.submitTxAsync = async () => {
      store.order.push('submitted');
      return 'tx1';
    };
    const providers = {
      ...store,
      publicDataProvider: {
        watchForTxData: async () => {
          throw new Error('indexer timeout while confirming');
        },
      },
    };
    await expect(VeilcoreAPI.deploy(providers as never, KEY, logger)).rejects.toThrow('indexer timeout');
    expect(store.order).toEqual(['set private state', `set key ${ADDR}`, 'submitted']);
    expect(store.signingKeys.get(ADDR)).toBe(KEY); // kept, for "Finish a deploy"
    expect(lines.indexOf(`Contract address: ${ADDR}`)).toBeGreaterThan(-1);
    expect(lines.join('\n')).toMatch(/may still have landed at contract address/);
  });

  it('M1(a): a deploy refused for size drops that key, retries smaller, and ends with no key on this machine', async () => {
    setNetworkId('preview');
    const store = fakeStore();
    const { logger } = quiet();
    const second = 'ab'.repeat(32);
    let n = 0;
    chain.createUnprovenDeployTx = async () => ({
      public: { contractAddress: n++ === 0 ? ADDR : second },
      private: { signingKey: KEY, initialPrivateState: {}, unprovenTx: {} },
    });
    let sent = 0;
    chain.submitTxAsync = async () => {
      if (sent++ === 0) throw new Error('1010: Invalid Transaction: BlockLimitExceeded');
      return 'tx2';
    };
    const add = vi.spyOn(VeilcoreAPI, 'addMissingCircuitKeys').mockResolvedValue();
    const join = vi.spyOn(VeilcoreAPI, 'join').mockResolvedValue({ deployedContractAddress: second } as never);
    try {
      const providers = {
        ...store,
        publicDataProvider: { watchForTxData: async () => ({ status: SucceedEntirely, txId: 'tx2' }) },
      };
      await VeilcoreAPI.deploy(providers as never, KEY, logger);
      expect(store.order).toEqual([
        'set private state',
        `set key ${ADDR}`,
        `remove key ${ADDR}`,
        'set private state',
        `set key ${second}`,
        `remove key ${second}`,
      ]);
      expect(add).toHaveBeenCalledWith(providers, second, logger);
      // join reads the starting state from the deploy that landed (round D verification).
      expect(join).toHaveBeenCalledWith(providers, second, logger, { deploying: true, deployTxId: 'tx2' });
    } finally {
      add.mockRestore();
      join.mockRestore();
    }
  });
});

describe('M3 FIXED: saved wallet progress the password cannot open is never written over', () => {
  const fakeWallet = (tag: string) => ({
    shielded: { serializeState: async () => `s-${tag}` },
    unshielded: { serializeState: async () => `u-${tag}` },
    dust: { serializeState: async () => `d-${tag}` },
  });
  const silentLogger = { warn: () => undefined, info: () => undefined } as unknown as Logger;

  it('a wrong password reads as unreadable; load() moves the file aside; the new save does not replace it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ws-'));
    const good = new WalletStateFile(silentLogger, 'mainnet', 'ab'.repeat(32), dir, PW);
    await good.save(fakeWallet('good'));
    const original = readFileSync(good.path);

    const wrong = new WalletStateFile(silentLogger, 'mainnet', 'ab'.repeat(32), dir, 'Other#Pass9!word2');
    expect((await wrong.read()).kind).toBe('unreadable');
    expect(await wrong.load()).toBeNull();
    await wrong.save(fakeWallet('new'));

    const aside = readdirSync(dir).filter((f) => f.includes('.unopened-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(path.join(dir, aside[0]))).toEqual(original); // the good progress, untouched
    expect((await wrong.read()).kind).toBe('ok'); // the new one, under the usual name
  });

  it('on mainnet the build stops and asks; without CONTINUE nothing is touched', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'vc-home-'));
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    process.env.VEILCORE_PRIVATE_STATE_PASSWORD = 'Other#Pass9!word2';
    wallet.real = true;
    try {
      setNetworkId('mainnet');
      const { WalletSeeds } = await import('@midnight-ntwrk/testkit-js');
      const seed = 'ab'.repeat(32);
      const masterSeed = WalletSeeds.fromMasterSeed(seed).masterSeed;
      const file = new WalletStateFile(silentLogger, 'mainnet', masterSeed, undefined, PW);
      await file.save(fakeWallet('good'));
      const before = readFileSync(file.path);
      const env = {
        walletNetworkId: 'mainnet',
        networkId: 'mainnet',
        indexer: 'https://indexer.invalid/api',
        indexerWS: 'wss://indexer.invalid/ws',
        node: 'https://node.invalid/',
        nodeWS: 'wss://node.invalid/',
        faucet: '',
        proofServer: 'http://127.0.0.1:6300',
      };
      const asked = vi.fn(async () => false);
      await expect(
        MidnightWalletProvider.build(silentLogger, env as never, { seed }, { confirmFreshSync: asked }),
      ).rejects.toBeInstanceOf(SavedProgressNotOpenedError);
      expect(asked).toHaveBeenCalledOnce();
      expect(readFileSync(file.path)).toEqual(before);
      expect(readdirSync(path.dirname(file.path))).toHaveLength(1);
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      process.env.VEILCORE_PRIVATE_STATE_PASSWORD = PW;
    }
  });

  it('the CLI asks in plain words on mainnet', () => {
    const code = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'index.ts'), 'utf8');
    expect(code).toContain(
      'That password does not open your saved progress. If you are sure, type CONTINUE to sync from the start',
    );
  });
});
