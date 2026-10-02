// SPDX-License-Identifier: Apache-2.0
/**
 * Saved wallet sync progress, so a restart resumes instead of reading the whole chain again.
 *
 * Midnight wallets find their coins by trying every transaction, which on a long chain
 * takes an hour or more. The wallet SDK can serialise each part of a wallet's state and
 * restore it. This saves those states to a file, encrypted with AES-256-GCM under a key
 * derived (scrypt) from VEILCORE_PRIVATE_STATE_PASSWORD, one file per network and wallet.
 *
 * The file holds what the wallet learned while syncing (its coins), not the seed. It is
 * still private: written with mode 0600 under ~/.veilcore/wallet-state, never logged.
 * Without the password nothing is saved and every start syncs from the beginning.
 * VEILCORE_FRESH_SYNC=1 ignores a saved file. A file this password cannot open is never
 * written over: it is moved aside (and on mainnet the CLI stops and asks first).
 * Never used on the local chain, which is new on every run.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from 'pino';

export type SavedWalletState = {
  readonly shielded: string;
  readonly unshielded: string;
  readonly dust: string;
};

type Serialisable = { serializeState(): Promise<string> };
export type SavableWallet = { shielded: Serialisable; unshielded: Serialisable; dust: Serialisable };

const MAGIC = Buffer.from('VCWS1');

export class WalletStateFile {
  readonly path: string;
  private readonly password: string | undefined;

  constructor(
    private readonly logger: Logger,
    networkId: string,
    masterSeed: string,
    directory = path.join(os.homedir(), '.veilcore', 'wallet-state'),
    password = process.env.VEILCORE_PRIVATE_STATE_PASSWORD,
  ) {
    // The name says which wallet without revealing the seed.
    const id = createHash('sha256').update(`veilcore:wallet-state:${networkId}:${masterSeed}`).digest('hex');
    this.path = path.join(directory, `${networkId}-${id.slice(0, 24)}.bin`);
    this.password = password === undefined || password === '' ? undefined : password;
    // The local chain ('undeployed') starts from nothing on every run, so progress saved
    // from an earlier run describes coins on a chain that no longer exists.
    this.local = networkId === 'undeployed';
  }

  private readonly local: boolean;

  get enabled(): boolean {
    return this.password !== undefined && !this.local;
  }

  private key(salt: Buffer): Buffer {
    return scryptSync(this.password ?? '', salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  /**
   * What is saved: nothing, progress this password opens, or a file it cannot open (a
   * different password, or damage; AES-GCM cannot tell the two apart).
   */
  async read(): Promise<{ kind: 'none' } | { kind: 'ok'; state: SavedWalletState } | { kind: 'unreadable' }> {
    if (!this.enabled || process.env.VEILCORE_FRESH_SYNC === '1') return { kind: 'none' };
    let blob: Buffer;
    try {
      blob = await readFile(this.path);
    } catch {
      return { kind: 'none' }; // nothing saved yet
    }
    try {
      if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a wallet-state file');
      const salt = blob.subarray(5, 21);
      const iv = blob.subarray(21, 33);
      const tag = blob.subarray(33, 49);
      const decipher = createDecipheriv('aes-256-gcm', this.key(salt), iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(blob.subarray(49)), decipher.final()]);
      const parsed = JSON.parse(plain.toString('utf8')) as Partial<SavedWalletState>;
      if (
        typeof parsed.shielded !== 'string' ||
        typeof parsed.unshielded !== 'string' ||
        typeof parsed.dust !== 'string'
      ) {
        throw new Error('incomplete');
      }
      return { kind: 'ok', state: parsed as SavedWalletState };
    } catch {
      return { kind: 'unreadable' };
    }
  }

  /**
   * Saved progress, or null. A file that cannot be opened is moved aside, never written
   * over: with the right password it is still good. (On mainnet the CLI asks first.)
   */
  async load(): Promise<SavedWalletState | null> {
    const r = await this.read();
    if (r.kind === 'ok') return r.state;
    if (r.kind === 'unreadable') {
      const kept = await this.setAside();
      this.logger.warn(
        `Saved wallet progress could not be read (wrong password or damaged); syncing from the start. The old file is kept as ${kept}.`,
      );
    }
    return null;
  }

  /**
   * Move a saved file this password cannot open out of the way, so the progress saved
   * from now on does not replace it. Returns where it went.
   */
  async setAside(): Promise<string> {
    const kept = `${this.path}.unopened-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await rename(this.path, kept);
    return kept;
  }

  /** Saves run one after another: two at once would share the temporary file. */
  private saving: Promise<void> = Promise.resolve();

  save(wallet: SavableWallet): Promise<void> {
    const run = this.saving.then(() => this.saveNow(wallet));
    this.saving = run.catch(() => undefined);
    return run;
  }

  private async saveNow(wallet: SavableWallet): Promise<void> {
    if (!this.enabled) return;
    const state: SavedWalletState = {
      shielded: await wallet.shielded.serializeState(),
      unshielded: await wallet.unshielded.serializeState(),
      dust: await wallet.dust.serializeState(),
    };
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(salt), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    const blob = Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    // Write then rename, so a crash mid-write never leaves a half file in place.
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, blob, { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
