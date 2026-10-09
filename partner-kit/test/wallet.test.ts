// The seed wallet (src/wallet.ts) is the CLI's wallet: same derivation, same saved
// progress file (src/wallet-progress.ts). And private state (src/private-state.ts) keeps
// one-call secrets and signing keys off disk, and claims inputs out of any file.
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- fakes */
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { inspect } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletSeeds, TEST_MNEMONIC } from '@midnight-ntwrk/testkit-js';
import { DustSecretKey } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type Logger } from 'pino';
import { SeedWallet, WalletProgressNotOpenedError } from '../src/wallet';
import { WalletProgressFile } from '../src/wallet-progress';
import { encryptedPrivateState, passwordProblem } from '../src/private-state';
import { endpointsFor } from '../src/network';
import { WalletStateFile } from '../../bboard-cli/src/wallet-state';
import { createVeilcorePrivateState } from '../../contract/src/witnesses';

const SEED = '5e'.repeat(32);
const PASSWORD = 'Partner-Kit-Test-Pw-9q';
const silent = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;
// Wallets made here are never started, so there is nothing to stop (stopping one that never
// started waits forever).
const made: SeedWallet[] = [];
afterEach(() => {
  made.length = 0;
  setNetworkId('undeployed');
});

const cliDustAddress = (seed: string, network: string): string =>
  DustAddress.encodePublicKey(network, DustSecretKey.fromSeed(WalletSeeds.fromMasterSeed(seed).dust).publicKey);

describe('a seed wallet', () => {
  it('is the wallet the CLI makes from the same seed (same DUST address)', async () => {
    setNetworkId('preprod');
    const w = await SeedWallet.create({ network: 'preprod', endpoints: endpointsFor('preprod'), seed: SEED });
    made.push(w);
    expect(w.dustAddress()).toBe(cliDustAddress(SEED, 'preprod'));
    expect(w.dustAddress()).toMatch(/^mn_dust/);
  });

  it('from a recovery phrase is the wallet of that phrase’s seed', async () => {
    setNetworkId('preprod');
    const w = await SeedWallet.create({
      network: 'preprod',
      endpoints: endpointsFor('preprod'),
      mnemonic: TEST_MNEMONIC,
    });
    made.push(w);
    expect(w.dustAddress()).toBe(cliDustAddress(WalletSeeds.fromMnemonic(TEST_MNEMONIC).masterSeed, 'preprod'));
  });

  it('refuses a bad seed or phrase without repeating it, and needs exactly one', async () => {
    const e = endpointsFor('preprod');
    await expect(SeedWallet.create({ network: 'preprod', endpoints: e, seed: 'SECRETzz' })).rejects.toThrow(
      /^A wallet seed is hex/,
    );
    await expect(
      SeedWallet.create({ network: 'preprod', endpoints: e, mnemonic: 'abandon secretword '.repeat(12) }),
    ).rejects.toThrow(/^That is not a valid recovery phrase\.$/);
    await expect(SeedWallet.create({ network: 'preprod', endpoints: e })).rejects.toThrow(/one of them/);
  });

  it('never registers NIGHT for DUST on mainnet', async () => {
    setNetworkId('mainnet');
    const e = endpointsFor('mainnet', {}, { blockfrostProjectId: 'testProjectId123' });
    const w = await SeedWallet.create({ network: 'mainnet', endpoints: e, seed: SEED });
    made.push(w);
    await expect(w.registerNightForDust()).rejects.toThrow(/Not on mainnet/);
  });
});

describe('saved sync progress', () => {
  const wallet = (tag: string) => ({
    shielded: { serializeState: async () => `shielded-${tag}` },
    unshielded: { serializeState: async () => `unshielded-${tag}` },
    dust: { serializeState: async () => `dust-${tag}` },
  });

  it('is the CLI’s file: each reads what the other saved, in the same place', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ws-'));
    const cli = new WalletStateFile(silent, 'preprod', SEED, dir, PASSWORD);
    const kit = new WalletProgressFile('preprod', SEED, PASSWORD, dir);
    expect(kit.path).toBe(cli.path);
    await cli.save(wallet('cli'));
    expect(await kit.read()).toEqual({
      kind: 'ok',
      state: { shielded: 'shielded-cli', unshielded: 'unshielded-cli', dust: 'dust-cli' },
    });
    await kit.save(wallet('kit'));
    expect(await cli.read()).toMatchObject({ kind: 'ok', state: { dust: 'dust-kit' } });
    expect(statSync(kit.path).mode & 0o777).toBe(0o600);
    expect(await new WalletProgressFile('preprod', SEED, 'Another-Password-77x', dir).read()).toEqual({
      kind: 'unreadable',
    });
    expect(new WalletProgressFile('undeployed', SEED, PASSWORD, dir).enabled).toBe(false);
  });
});

describe('a password that does not open saved progress (review M2)', () => {
  const save = (dir: string, seed: string, password: string) =>
    new WalletStateFile(silent, 'preprod', seed, dir, password).save({
      shielded: { serializeState: async () => 's' },
      unshielded: { serializeState: async () => 'u' },
      dust: { serializeState: async () => 'd' },
    });

  it('stops, and changes nothing: the file stays where it is, as it was', async () => {
    setNetworkId('preprod');
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ws-'));
    await save(dir, SEED, PASSWORD);
    const [file] = readdirSync(dir);
    const before = readFileSync(path.join(dir, file));
    await expect(
      SeedWallet.create({
        network: 'preprod',
        endpoints: endpointsFor('preprod'),
        seed: SEED,
        saveProgress: { password: 'A-Different-Pw-417x', dir },
      }),
    ).rejects.toBeInstanceOf(WalletProgressNotOpenedError);
    expect(readdirSync(dir)).toEqual([file]);
    expect(readFileSync(path.join(dir, file))).toEqual(before);
  });

  it('moves the file aside only when asked to', async () => {
    setNetworkId('preprod');
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ws-'));
    await save(dir, SEED, PASSWORD);
    made.push(
      await SeedWallet.create({
        network: 'preprod',
        endpoints: endpointsFor('preprod'),
        seed: SEED,
        saveProgress: { password: 'A-Different-Pw-417x', dir, onUnreadable: 'setAside' },
        logger: silent,
      }),
    );
    expect(readdirSync(dir).some((f) => f.includes('.unopened-'))).toBe(true);
  });

  it('finds the CLI’s file for a seed typed with capitals, as the CLI typed it (review L2)', async () => {
    setNetworkId('preprod');
    const upper = '5E'.repeat(32);
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ws-'));
    await save(dir, upper, PASSWORD);
    const opts = { network: 'preprod' as const, endpoints: endpointsFor('preprod') };
    // Found (so a wrong password stops): the same name as the CLI's.
    await expect(
      SeedWallet.create({ ...opts, seed: upper, saveProgress: { password: 'A-Different-Pw-417x', dir } }),
    ).rejects.toBeInstanceOf(WalletProgressNotOpenedError);
    // The same wallet either way.
    const w = await SeedWallet.create({ ...opts, seed: upper });
    made.push(w);
    expect(w.dustAddress()).toBe(cliDustAddress(SEED, 'preprod'));
  });
});

describe('nothing secret in what a wallet prints (review M3)', () => {
  it('inspect, console.log and JSON show the network and DUST address only', async () => {
    setNetworkId('preprod');
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ws-'));
    const w = await SeedWallet.create({
      network: 'preprod',
      endpoints: endpointsFor('preprod'),
      seed: SEED,
      saveProgress: { password: PASSWORD, dir },
    });
    made.push(w);
    for (const shown of [
      inspect(w),
      inspect(w, { showHidden: true, depth: 20 }),
      JSON.stringify(w),
      inspect(new WalletProgressFile('preprod', SEED, PASSWORD, dir), { showHidden: true, depth: 20 }),
    ]) {
      expect(shown).not.toContain(PASSWORD);
      expect(shown).not.toContain(SEED);
    }
    expect(inspect(w)).toBe(`SeedWallet { network: 'preprod', dustAddress: '${w.dustAddress()}' }`);
    expect(Object.keys(w)).toEqual(['network']);
  });
});

describe('private state', () => {
  const ADDR = 'ab'.repeat(32);

  it('refuses a password midnight-js would refuse, before opening anything', async () => {
    expect(passwordProblem('short')).toMatch(/16 or more/);
    expect(passwordProblem(PASSWORD)).toBeNull();
    await expect(encryptedPrivateState({ network: 'preprod', password: 'short', accountId: 'x' })).rejects.toThrow(
      /will not be accepted: it needs 16 or more/,
    );
  });

  it('keeps one-call secrets and signing keys off disk, and claims inputs in memory only', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'vc-ps-')), 'state');
    const stores = await encryptedPrivateState({ network: 'preprod', password: PASSWORD, accountId: 'lab-1', dir });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const main = stores.veilcore;
    main.setContractAddress(ADDR);
    const recordSecret = new Uint8Array(32).fill(3);
    const recoverySecret = new Uint8Array(32).fill(9);
    await main.set('veilcorePrivateState', { ...createVeilcorePrivateState(recordSecret), recoverySecret });
    expect((await main.get('veilcorePrivateState'))?.recoverySecret).toEqual(recoverySecret);
    await main.setSigningKey(ADDR, 'ee'.repeat(32));

    // What is in the folder, read with the password by anyone with a copy of it.
    const raw = levelPrivateStateProvider<string, { geneticSecret: Uint8Array; recoverySecret: Uint8Array }>({
      midnightDbName: dir,
      privateStateStoreName: 'veilcore-partner',
      signingKeyStoreName: 'veilcore-partner-signing-keys',
      privateStoragePasswordProvider: () => PASSWORD,
      accountId: 'lab-1',
    });
    raw.setContractAddress(ADDR);
    const onDisk = await raw.get('veilcorePrivateState');
    expect(Buffer.from(onDisk!.geneticSecret)).toEqual(Buffer.from(recordSecret));
    expect(Buffer.from(onDisk!.recoverySecret)).toEqual(Buffer.alloc(32));
    expect(await raw.getSigningKey(ADDR)).toBeNull();

    const claims = stores.claims;
    claims.setContractAddress(ADDR);
    await claims.set('veilcoreClaimsPrivateState', { input: { number: 9650n } });
    expect(await claims.get('veilcoreClaimsPrivateState')).toEqual({ input: { number: 9650n } });
    await expect(claims.exportPrivateStates()).rejects.toThrow(/memory only/);
  });
});
