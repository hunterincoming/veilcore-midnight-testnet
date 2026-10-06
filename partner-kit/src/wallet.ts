// A Midnight wallet built from a seed, to pay fees: the WalletProvider and
// MidnightProvider midnight-js needs. Bring your own instead if you have one.
// SPDX-License-Identifier: Apache-2.0
//
// Built the way the VeilCore CLI builds its wallet (bboard-cli/src/midnight-wallet-provider.ts):
// the three Midnight wallets (shielded, unshielded, DUST) from one master seed, with the
// same derivation Midnight wallet apps use, and nothing written to any log. Fees are paid
// in DUST, which a wallet holding NIGHT generates once its NIGHT is registered for DUST
// generation (docs/PARTNERS.md, "Fees").

import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
  unshieldedToken,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type MidnightProvider, type UnboundTransaction, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import {
  DustAddress,
  DustWallet,
  type FacadeState,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedAddress,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  createKeystore,
  generateRandomSeed,
  mergeWalletEntries,
} from '@midnight-ntwrk/wallet-sdk';
import { type Logger } from 'pino';
import { firstValueFrom, filter } from 'rxjs';
import { type Endpoints, type Network, isNetwork } from './network.js';
import { WalletProgressFile } from './wallet-progress.js';

type Keystore = { getPublicKey(): unknown; signData(payload: Uint8Array): string };

export type SeedWalletOptions = {
  readonly network: Network;
  readonly endpoints: Endpoints;
  /** The wallet's master seed, hex. Give this or `mnemonic`. */
  readonly seed?: string;
  /** A 24-word recovery phrase, as Midnight wallet apps show it. Give this or `seed`. */
  readonly mnemonic?: string;
  /**
   * Save sync progress, encrypted with `password`, so the next start resumes instead of
   * reading the whole chain again (an hour or more on preprod). Same file as the VeilCore CLI.
   */
  readonly saveProgress?: { readonly password: string; readonly dir?: string };
  readonly logger?: Logger;
};

export type WalletBalances = {
  /** DUST available for fees now, in its smallest unit. */
  readonly dust: bigint;
  /** Unshielded NIGHT, in its smallest unit. */
  readonly night: bigint;
};

const strictlyComplete = (progress: unknown): boolean => {
  const p = progress as { isStrictlyComplete?: () => boolean } | undefined;
  return typeof p?.isStrictlyComplete === 'function' && p.isStrictlyComplete();
};

/** Whether every part of the wallet has caught up with the chain. */
export const isSynced = (s: FacadeState): boolean =>
  strictlyComplete(s.shielded.state.progress) &&
  strictlyComplete(s.dust.state.progress) &&
  strictlyComplete(s.unshielded.progress);

const balancesOf = (s: FacadeState): WalletBalances => ({
  dust: s.dust.balance(new Date()) ?? 0n,
  night: s.unshielded.balances[unshieldedToken().raw] ?? 0n,
});

const deriveRole = (seedHex: string, role: number): Uint8Array => {
  const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('That seed does not make a wallet.');
  const k = hd.hdWallet
    .selectAccount(0)
    .selectRole(role as never)
    .deriveKeyAt(0);
  if (k.type === 'keyOutOfBounds') throw new Error('That seed does not make a wallet.');
  return k.key;
};

/** The wallet configuration midnight-js's test kit derives from endpoints. */
const configurationFor = (network: Network, e: Endpoints): Record<string, unknown> => ({
  indexerClientConnection: { indexerHttpUrl: e.indexer, indexerWsUrl: e.indexerWS },
  provingServerUrl: new URL(e.proofServer),
  networkId: network,
  relayURL: new URL(e.nodeWS),
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  costParameters: { feeBlocksMargin: 5 },
});

/**
 * A wallet from a seed. `SeedWallet.create` builds it, `start()` starts syncing, and
 * `synced()` waits until it has caught up with the chain. Pass it as `wallet` to connect().
 */
export class SeedWallet implements WalletProvider, MidnightProvider {
  private timer: NodeJS.Timeout | undefined;
  private started = false;

  private constructor(
    readonly network: Network,
    readonly facade: WalletFacade,
    private readonly zswap: ZswapSecretKeys,
    private readonly dustKey: DustSecretKey,
    private readonly keystore: Keystore,
    private readonly progress: WalletProgressFile | undefined,
    private readonly logger?: Logger,
  ) {}

  static async create(o: SeedWalletOptions): Promise<SeedWallet> {
    if (!isNetwork(o.network)) throw new Error(`Unknown network ${String(o.network)}.`);
    if ((o.seed === undefined) === (o.mnemonic === undefined))
      throw new Error('Give the wallet a seed or a recovery phrase (one of them).');
    let master: string;
    if (o.seed !== undefined) {
      master = o.seed.trim().replace(/^0x/i, '');
      if (!/^([0-9a-fA-F]{2}){16,64}$/.test(master)) throw new Error('A wallet seed is hex, 32 to 128 characters.');
      master = master.toLowerCase();
    } else {
      const words = (o.mnemonic ?? '').trim().split(/\s+/).join(' ');
      // The message never repeats the phrase.
      if (!validateMnemonic(words, wordlist)) throw new Error('That is not a valid recovery phrase.');
      master = Buffer.from(mnemonicToSeedSync(words)).toString('hex');
    }
    const seeds = {
      shielded: deriveRole(master, Roles.Zswap),
      unshielded: deriveRole(master, Roles.NightExternal),
      dust: deriveRole(master, Roles.Dust),
    };
    const dustOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: o.network === 'undeployed' ? 500_000_000_000_000_000n : 1_000n,
      feeBlocksMargin: 5,
    };
    const config = configurationFor(o.network, o.endpoints);
    const keystore = createKeystore(seeds.unshielded, o.network) as unknown as Keystore;
    const unshieldedConfig = {
      ...config,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
    const dustConfig = {
      ...config,
      costParameters: {
        ledgerParams: dustOptions.ledgerParams,
        additionalFeeOverhead: dustOptions.additionalFeeOverhead,
        feeBlocksMargin: dustOptions.feeBlocksMargin,
      },
    };

    const progress =
      o.saveProgress === undefined
        ? undefined
        : new WalletProgressFile(o.network, master, o.saveProgress.password, o.saveProgress.dir);
    const saved = progress === undefined ? null : await progress.load((m) => o.logger?.warn(m));

    let facade: WalletFacade | undefined;
    if (saved !== null) {
      try {
        const shielded = ShieldedWallet(config as never).restore(saved.shielded);
        const unshielded = UnshieldedWallet(unshieldedConfig as never).restore(saved.unshielded);
        const dust = DustWallet(dustConfig as never).restore(saved.dust);
        facade = await WalletFacade.init({
          configuration: config as never,
          shielded: () => shielded,
          unshielded: () => unshielded,
          dust: () => dust,
        });
        o.logger?.info('Resuming from saved wallet sync progress.');
      } catch (e) {
        o.logger?.warn(
          `Saved sync progress could not be used (${e instanceof Error ? e.message : String(e)}); syncing from the start.`,
        );
      }
    }
    if (facade === undefined) {
      const shielded = ShieldedWallet(config as never).startWithSeed(seeds.shielded);
      const unshielded = UnshieldedWallet(unshieldedConfig as never).startWithPublicKey(
        PublicKey.fromKeyStore(keystore as never),
      );
      const dust = DustWallet(dustConfig as never).startWithSeed(seeds.dust, LedgerParameters.initialParameters().dust);
      facade = await WalletFacade.init({
        configuration: config as never,
        shielded: () => shielded,
        unshielded: () => unshielded,
        dust: () => dust,
      });
    }
    return new SeedWallet(
      o.network,
      facade,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
      progress,
      o.logger,
    );
  }

  /** A new random master seed (hex). Keep it like a password; it controls the wallet's funds. */
  static newSeed(): string {
    return Buffer.from(generateRandomSeed()).toString('hex');
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswap.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswap.encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.facade.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.zswap, dustSecretKey: this.dustKey },
      { ttl },
    );
    const signed = await this.facade.signRecipe(recipe, (payload) => this.keystore.signData(payload));
    return this.facade.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.facade.submitTransaction(tx);
  }

  /** Start syncing with the chain. Progress is saved every two minutes when saveProgress was given. */
  async start(): Promise<void> {
    await this.facade.start(this.zswap, this.dustKey);
    this.started = true;
    if (this.progress?.enabled) {
      this.timer = setInterval(() => void this.saveProgress(), 120_000);
      this.timer.unref();
    }
  }

  /** Wait until the wallet has caught up with the chain; returns its balances then. */
  async synced(): Promise<WalletBalances> {
    const s = await firstValueFrom(this.facade.state().pipe(filter(isSynced)));
    await this.saveProgress();
    return balancesOf(s);
  }

  /** Balances as the wallet knows them now (synced or not). */
  async balances(): Promise<WalletBalances> {
    return balancesOf(await firstValueFrom(this.facade.state()));
  }

  /** The address that receives NIGHT (from a faucet on a test network). Not a secret. */
  async nightAddress(): Promise<string> {
    const s = await firstValueFrom(this.facade.state());
    return UnshieldedAddress.codec.encode(this.network, s.unshielded.address).toString();
  }

  /** The DUST address this wallet pays fees from (mn_dust…), as wallet apps show it. Not a secret. */
  dustAddress(): string {
    return DustAddress.encodePublicKey(this.network, this.dustKey.publicKey);
  }

  /**
   * Register this wallet's unregistered NIGHT for DUST generation (one transaction), then
   * wait until it has DUST. Test networks only: on mainnet, register once, from the wallet
   * app that holds your NIGHT, and never again (a second registration of the same NIGHT is
   * what VeilCore's own tools guard against). Returns the transaction id, or undefined if
   * there was nothing to register.
   */
  async registerNightForDust(): Promise<string | undefined> {
    if (this.network === 'mainnet')
      throw new Error(
        'Not on mainnet: register NIGHT for DUST once, from the wallet app that holds it. Nothing was sent.',
      );
    const state = await this.facade.waitForSyncedState();
    const utxos = state.unshielded.availableCoins.filter(
      (c: { meta: { registeredForDustGeneration: boolean } }) => !c.meta.registeredForDustGeneration,
    );
    if (utxos.length === 0) return undefined;
    const recipe = await this.facade.registerNightUtxosForDustGeneration(
      utxos,
      this.keystore.getPublicKey() as never,
      (payload) => this.keystore.signData(payload),
      state.dust.address,
    );
    const txId = await this.facade.submitTransaction(await this.facade.finalizeRecipe(recipe));
    await firstValueFrom(this.facade.state().pipe(filter((s) => (s.dust.balance(new Date()) ?? 0n) > 0n)));
    return txId;
  }

  /** Save sync progress now. Never throws: a failed save only costs a slower restart. */
  async saveProgress(): Promise<void> {
    if (!this.progress?.enabled) return;
    try {
      await this.progress.save(this.facade);
    } catch (e) {
      this.logger?.warn(`Could not save wallet sync progress: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Save progress and stop. A wallet never started has nothing to stop. */
  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    if (!this.started) return;
    this.started = false;
    await Promise.race([this.saveProgress(), new Promise((r) => setTimeout(r, 15_000).unref())]);
    await this.facade.stop();
  }
}

/** Build a wallet from a seed or recovery phrase. See SeedWallet. */
export const seedWallet = (o: SeedWalletOptions): Promise<SeedWallet> => SeedWallet.create(o);
