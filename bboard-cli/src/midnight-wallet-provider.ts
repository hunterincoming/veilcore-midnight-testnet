/*
 * This file is part of example-bboard.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { showSecret } from './secret-out';
import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type MidnightProvider, type UnboundTransaction, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { Logger } from 'pino';

import { getInitialShieldedState } from './wallet-utils';
import { type DustWalletOptions, type EnvironmentConfiguration, FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';

type UnshieldedKeystore = {
  getPublicKey(): unknown;
  signData(payload: Uint8Array): string;
};

/**
 * Provider class that implements wallet functionality for the Midnight network.
 * Handles transaction balancing, submission, and wallet state management.
 */
export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  logger: Logger;
  readonly env: EnvironmentConfiguration;
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;
  readonly zswapSecretKeys: ZswapSecretKeys;
  readonly dustSecretKey: DustSecretKey;
  /** The HD master seed, used to key this wallet's private-state store. A secret. */
  readonly masterSeed: string;

  private constructor(
    logger: Logger,
    environmentConfiguration: EnvironmentConfiguration,
    wallet: WalletFacade,
    zswapSecretKeys: ZswapSecretKeys,
    dustSecretKey: DustSecretKey,
    unshieldedKeystore: UnshieldedKeystore,
    masterSeed: string,
  ) {
    this.masterSeed = masterSeed;
    this.logger = logger;
    this.env = environmentConfiguration;
    this.wallet = wallet;
    this.zswapSecretKeys = zswapSecretKeys;
    this.dustSecretKey = dustSecretKey;
    this.unshieldedKeystore = unshieldedKeystore;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.zswapSecretKeys, dustSecretKey: this.dustSecretKey },
      { ttl },
    );
    const signedRecipe = await this.wallet.signRecipe(recipe, (payload) => this.unshieldedKeystore.signData(payload));
    return this.wallet.finalizeRecipe(signedRecipe);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  // We do not wait for funds here; the CLI flow handles it explicitly.
  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  /**
   * The DUST address this wallet pays fees from, as a wallet app shows it (mn_dust1…).
   * Not a secret. Computed from the keys alone, so it can be checked BEFORE a sync that
   * may take hours: on mainnet, a wallet whose DUST address is not the one registered
   * for DUST generation has nothing to pay with.
   */
  dustAddress(networkId: string): string {
    return DustAddress.encodePublicKey(networkId, this.dustSecretKey.publicKey);
  }

  /**
   * Build from a hex master seed, a 24-word recovery phrase (the same derivation
   * Midnight wallets use), or neither for a fresh random wallet.
   */
  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    source: { seed?: string; mnemonic?: string } = {},
  ): Promise<MidnightWalletProvider> {
    const { seed, mnemonic } = source;
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: env.walletNetworkId === 'undeployed' ? 500_000_000_000_000_000n : 1_000n,
      feeBlocksMargin: 5,
    };
    const builder = FluentWalletBuilder.forEnvironment(env).withDustOptions(dustOptions);
    const buildResult = mnemonic
      ? await builder.withMnemonic(mnemonic).buildWithoutStarting()
      : seed
        ? await builder.withSeed(seed).buildWithoutStarting()
        : await builder.withRandomSeed().buildWithoutStarting();
    const { wallet, seeds, keystore } = buildResult as unknown as {
      wallet: WalletFacade;
      seeds: { masterSeed: string; shielded: Uint8Array; dust: Uint8Array };
      keystore: UnshieldedKeystore;
    };

    const initialState = await getInitialShieldedState(logger, wallet.shielded);
    // A fresh wallet's seed is shown once so it can be kept. A wallet restored from a
    // seed or a recovery phrase is not echoed back: its owner already holds it.
    if (!seed && !mnemonic) showSecret('YOUR NEW WALLET SEED — SAVE IT:', seeds.masterSeed);
    logger.info(`Your address is: ${initialState.address.coinPublicKeyString()}`);

    return new MidnightWalletProvider(
      logger,
      env,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
      seeds.masterSeed,
    );
  }
}
