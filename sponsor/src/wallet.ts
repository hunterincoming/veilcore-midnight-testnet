// The sponsor's own wallet: built from SPONSOR_SEED, synced with the chain, and used for
// one thing — adding a DUST fee payment to a transaction someone else already sealed.
//
// The visitor's part is never changed. balanceFinalizedTransaction builds a SEPARATE fee
// transaction and merges it with the sealed one; a merge refuses a second contract call,
// so the sponsor could not slip one in even if it tried.
//
// Sync progress is saved on the service's volume (STATE_DIR) so a restart resumes
// instead of reading the chain from the start. The file is encrypted with a key derived
// from the seed: it is no more secret than the seed, which sits next to it.
//
// SPDX-License-Identifier: Apache-2.0

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Rx from 'rxjs';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys, type FinalizedTransaction } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade, type FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  DustAddress,
  DustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  createKeystore,
  mergeWalletEntries,
} from '@midnight-ntwrk/wallet-sdk';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import type { SealedTx } from './policy.js';
import { NotSentError, type PayingWallet } from './sponsor.js';
import { log } from './log.js';

type Keystore = ReturnType<typeof createKeystore>;

export type RoleSeeds = { readonly shielded: Uint8Array; readonly unshielded: Uint8Array; readonly dust: Uint8Array };

/**
 * The three role keys of a Midnight HD wallet from its master seed: account 0, index 0,
 * roles Zswap (shielded), NightExternal (unshielded) and Dust. This is what testkit-js's
 * WalletSeeds.fromMasterSeed does, done here so the process holding the seed does not
 * load test infrastructure; wallet-seeds.test.ts checks the two give identical bytes,
 * keys and addresses.
 */
export const deriveRoleSeeds = (seedHex: string): RoleSeeds => {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(seedHex)) throw new Error('The master seed must be hex.');
  const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('Invalid seed: failed to create HD wallet');
  try {
    const at = (role: (typeof Roles)[keyof typeof Roles]): Uint8Array => {
      const r = hd.hdWallet.selectAccount(0).selectRole(role).deriveKeyAt(0);
      if (r.type !== 'keyDerived') throw new Error(`Key derivation out of bounds for role ${role}`);
      return Uint8Array.from(r.key); // a copy, so clearing the HD wallet cannot touch it
    };
    return { shielded: at(Roles.Zswap), unshielded: at(Roles.NightExternal), dust: at(Roles.Dust) };
  } finally {
    hd.hdWallet.clear();
  }
};

/** The node's "1010: Invalid Transaction": never admitted, so it cannot land. */
export const nodeRefusal = (e: unknown): string | undefined => {
  const text = e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : String(e);
  if (!/\b1010\b.*Invalid Transaction|Invalid Transaction.*\b1010\b/i.test(text)) return undefined;
  return /Custom error:\s*(\d+)/i.exec(text)?.[1] ?? 'none';
};

/** Custom error 171, OutOfDustValidityWindow: the indexer is behind. Wait, then rebuild. */
export const isStaleDustTime = (e: unknown): boolean =>
  /Custom error:\s*171\b/i.test(e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : String(e));

const isStrictlyComplete = (progress: unknown): boolean =>
  typeof progress === 'object' &&
  progress !== null &&
  typeof (progress as { isStrictlyComplete?: unknown }).isStrictlyComplete === 'function' &&
  (progress as { isStrictlyComplete: () => boolean }).isStrictlyComplete();

export const isFacadeSynced = (s: FacadeState): boolean =>
  isStrictlyComplete(s.shielded.state.progress) &&
  isStrictlyComplete(s.dust.state.progress) &&
  isStrictlyComplete(s.unshielded.progress);

type Saved = { shielded: string; unshielded: string; dust: string };

/** Encrypted sync progress on the volume. */
class ProgressFile {
  readonly path: string;
  private readonly key: Buffer;
  constructor(dir: string, network: string, seed: string) {
    const id = createHash('sha256').update(`veilcore:sponsor-wallet-state:${network}:${seed}`).digest();
    this.key = createHash('sha256').update(Buffer.concat([Buffer.from('veilcore:sponsor-state-key:'), id])).digest();
    this.path = join(dir, `wallet-${network}-${id.toString('hex').slice(0, 16)}.bin`);
  }
  read(): Saved | undefined {
    let blob: Buffer;
    try {
      blob = readFileSync(this.path);
    } catch {
      return undefined;
    }
    try {
      // iv, a full 16-byte tag, then at least one byte of ciphertext.
      if (blob.length <= 28) return undefined;
      const iv = blob.subarray(0, 12);
      const tag = blob.subarray(12, 28);
      const d = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
      d.setAuthTag(tag);
      const parsed = JSON.parse(Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8')) as Saved;
      return typeof parsed.shielded === 'string' && typeof parsed.unshielded === 'string' && typeof parsed.dust === 'string'
        ? parsed
        : undefined;
    } catch {
      return undefined;
    }
  }
  write(s: Saved): void {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(s), 'utf8'), c.final()]);
    mkdirSync(join(this.path, '..'), { recursive: true });
    writeFileSync(`${this.path}.tmp`, Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}

export type WalletEndpoints = {
  readonly network: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly nodeWS: string;
  readonly proofServer: string;
  readonly stateDir: string;
};

export class FacadeWallet implements PayingWallet {
  private latest: FacadeState | undefined;
  private sub: Rx.Subscription | undefined;
  private saveTimer: NodeJS.Timeout | undefined;

  private constructor(
    readonly facade: WalletFacade,
    private readonly zswap: ZswapSecretKeys,
    private readonly dustKey: DustSecretKey,
    private readonly keystore: Keystore,
    private readonly progress: ProgressFile,
    /** Public addresses of this wallet (not secrets), for the forbidden-wallet check and the logs. */
    readonly addresses: { readonly unshielded: string; readonly dust: string },
  ) {}

  /** Tests only: a wallet around a stand-in facade, with no keys and no network. */
  static forTests(facade: unknown): FacadeWallet {
    return new FacadeWallet(
      facade as WalletFacade,
      {} as ZswapSecretKeys,
      {} as DustSecretKey,
      { signData: () => 'signature' } as unknown as Keystore,
      new ProgressFile('/nonexistent', 'test', 'test'),
      { unshielded: '', dust: '' },
    );
  }

  /** Derive keys and addresses from the seed. Nothing connects to the network yet. */
  static async build(seedHex: string, ep: WalletEndpoints): Promise<FacadeWallet> {
    const seeds = deriveRoleSeeds(seedHex);
    const config = {
      indexerClientConnection: { indexerHttpUrl: ep.indexer, indexerWsUrl: ep.indexerWS },
      provingServerUrl: new URL(ep.proofServer),
      networkId: ep.network,
      relayURL: new URL(ep.nodeWS),
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      costParameters: { feeBlocksMargin: 5 },
    };
    const costParameters = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: ep.network === 'undeployed' ? 500_000_000_000_000_000n : 1_000n,
      feeBlocksMargin: 5,
    };
    const keystore = createKeystore(seeds.unshielded, ep.network as never);
    const progress = new ProgressFile(ep.stateDir, ep.network, seedHex);
    const saved = progress.read();

    const shieldedB = ShieldedWallet(config as never);
    const unshieldedB = UnshieldedWallet({
      ...config,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    } as never);
    const dustB = DustWallet({ ...config, costParameters } as never);

    let parts: { shielded: unknown; unshielded: unknown; dust: unknown } | undefined;
    if (saved) {
      try {
        parts = {
          shielded: shieldedB.restore(saved.shielded),
          unshielded: unshieldedB.restore(saved.unshielded),
          dust: dustB.restore(saved.dust),
        };
        log('info', 'wallet: resuming from saved sync progress');
      } catch (e) {
        log('warn', 'wallet: saved progress unusable; syncing from the start', { error: (e as Error).message });
      }
    }
    parts ??= {
      shielded: shieldedB.startWithSeed(seeds.shielded),
      unshielded: unshieldedB.startWithPublicKey(PublicKey.fromKeyStore(keystore)),
      dust: dustB.startWithSeed(seeds.dust, LedgerParameters.initialParameters().dust),
    };
    const p = parts;
    const facade = await WalletFacade.init({
      configuration: config as never,
      shielded: () => p.shielded as never,
      unshielded: () => p.unshielded as never,
      dust: () => p.dust as never,
    });
    const dustKey = DustSecretKey.fromSeed(seeds.dust);
    return new FacadeWallet(facade, ZswapSecretKeys.fromSeed(seeds.shielded), dustKey, keystore, progress, {
      unshielded: keystore.getBech32Address().asString(),
      dust: DustAddress.encodePublicKey(ep.network, dustKey.publicKey),
    });
  }

  async start(): Promise<void> {
    await this.facade.start(this.zswap, this.dustKey);
    this.sub = this.facade.state().subscribe({
      next: (s) => {
        this.latest = s;
      },
      error: (e: unknown) => {
        this.latest = undefined;
        log('error', 'wallet: state stream failed', { error: e instanceof Error ? e.message : String(e) });
      },
    });
    this.saveTimer = setInterval(() => void this.saveProgress(), 120_000);
    this.saveTimer.unref();
  }

  async saveProgress(): Promise<void> {
    try {
      this.progress.write({
        shielded: await this.facade.shielded.serializeState(),
        unshielded: await this.facade.unshielded.serializeState(),
        dust: await this.facade.dust.serializeState(),
      });
    } catch (e) {
      log('warn', 'wallet: could not save sync progress', { error: (e as Error).message });
    }
  }

  async stop(): Promise<void> {
    if (this.saveTimer) clearInterval(this.saveTimer);
    await Promise.race([this.saveProgress(), new Promise((r) => setTimeout(r, 15_000).unref())]);
    this.sub?.unsubscribe();
    await this.facade.stop();
  }

  get coinPublicKey(): string {
    return this.zswap.coinPublicKey;
  }

  get encryptionPublicKey(): string {
    return this.zswap.encryptionPublicKey;
  }

  isSynced(): boolean {
    return this.latest !== undefined && isFacadeSynced(this.latest);
  }

  async waitSynced(ms: number): Promise<boolean> {
    try {
      await Rx.firstValueFrom(this.facade.state().pipe(Rx.filter(isFacadeSynced), Rx.timeout(ms)));
      return true;
    } catch {
      return false;
    }
  }

  dustBalance(): bigint | undefined {
    return this.latest?.dust.balance(new Date());
  }

  async estimateFee(tx: SealedTx): Promise<bigint> {
    return this.facade.estimateTransactionFee(tx, this.dustKey);
  }

  private sign = (payload: Uint8Array) => this.keystore.signData(payload);

  async payAndSubmit(tx: SealedTx, ttl: Date, approveFee: (fee: bigint) => void): Promise<{ txId: string; fee: bigint }> {
    let recipe;
    try {
      recipe = await this.facade.balanceFinalizedTransaction(
        tx,
        { shieldedSecretKeys: this.zswap, dustSecretKey: this.dustKey },
        { ttl, tokenKindsToBalance: ['dust'] },
      );
    } catch (e) {
      throw new NotSentError('The sponsor could not add its fee payment (it may be out of DUST). Try later.', true, { cause: e });
    }
    let finalized: FinalizedTransaction;
    try {
      finalized = await this.facade.finalizeRecipe(await this.facade.signRecipe(recipe, this.sign));
    } catch (e) {
      await this.facade.revert(recipe).catch(() => undefined);
      throw new NotSentError('The sponsor could not finish its fee payment. Try again.', true, { cause: e });
    }
    // The fee this balanced transaction pays (the same figure estimateFee works out, now for
    // the real coins chosen). The caller approves it before anything is sent.
    let fee: bigint;
    try {
      fee = await this.feeOf(finalized);
      approveFee(fee);
    } catch (e) {
      await this.facade.revert(finalized).catch(() => undefined);
      if (e instanceof NotSentError) throw e;
      throw new NotSentError('The sponsor could not work out its fee payment. Try again.', true, { cause: e });
    }
    return { txId: await this.submit(finalized), fee };
  }

  /** Submit; a node refusal (never admitted) becomes NotSentError and the coins are released. */
  async submit(finalized: FinalizedTransaction): Promise<string> {
    try {
      return await this.facade.submitTransaction(finalized);
    } catch (e) {
      const refused = nodeRefusal(e);
      if (refused !== undefined) {
        await this.facade.revert(finalized).catch(() => undefined);
        if (isStaleDustTime(e)) {
          throw new NotSentError('The network’s indexer is behind. Try again in a few minutes.', true, { cause: e });
        }
        throw new NotSentError(`The network refused the transaction (error ${refused}).`, false, { cause: e });
      }
      throw e; // may have been sent
    }
  }

  /** For the anchoring job, which calls anchorBatch itself: balance an unbound call the CLI way. */
  async balanceUnbound(tx: UnboundTransaction, ttl: Date): Promise<FinalizedTransaction> {
    const recipe = await this.facade.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.zswap, dustSecretKey: this.dustKey },
      { ttl },
    );
    try {
      return await this.facade.finalizeRecipe(await this.facade.signRecipe(recipe, this.sign));
    } catch (e) {
      await this.facade.revert(recipe).catch(() => undefined);
      throw e;
    }
  }

  /** The fee a balanced, finished transaction pays, in SPECKs (the anchoring job's own calls). */
  async feeOf(tx: FinalizedTransaction): Promise<bigint> {
    return this.facade.calculateTransactionFee(tx);
  }

  async revert(tx: FinalizedTransaction): Promise<void> {
    await this.facade.revert(tx);
  }
}
