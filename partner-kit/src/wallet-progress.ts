// Saved wallet sync progress, so a restart resumes instead of reading the whole chain again.
// SPDX-License-Identifier: Apache-2.0
//
// The same file, in the same place and format, as the VeilCore CLI's
// (bboard-cli/src/wallet-state.ts; test/wallet-progress.test.ts checks each reads the
// other's): a wallet the CLI has synced resumes here, and the other way round. The file
// holds what the wallet learned while syncing (its coins), not the seed. It is encrypted
// with AES-256-GCM under a key derived (scrypt) from the password, written 0600 under
// ~/.veilcore/wallet-state, one file per network and wallet. A file the password cannot
// open is moved aside, never written over. Never used on a local chain ('undeployed'),
// which is new on every start.

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export type SavedWalletState = { readonly shielded: string; readonly unshielded: string; readonly dust: string };
type Serialisable = { serializeState(): Promise<string> };
export type SavableWallet = { shielded: Serialisable; unshielded: Serialisable; dust: Serialisable };

const MAGIC = Buffer.from('VCWS1');

export const defaultProgressDir = (): string => path.join(os.homedir(), '.veilcore', 'wallet-state');

export class WalletProgressFile {
  readonly path: string;
  private readonly local: boolean;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    networkId: string,
    masterSeed: string,
    private readonly password: string,
    directory: string = defaultProgressDir(),
  ) {
    // The name says which wallet without revealing the seed.
    const id = createHash('sha256').update(`veilcore:wallet-state:${networkId}:${masterSeed}`).digest('hex');
    this.path = path.join(directory, `${networkId}-${id.slice(0, 24)}.bin`);
    this.local = networkId === 'undeployed';
  }

  get enabled(): boolean {
    return this.password !== '' && !this.local;
  }

  private key(salt: Buffer): Buffer {
    return scryptSync(this.password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  /** Nothing saved, progress this password opens, or a file it cannot open. */
  async read(): Promise<{ kind: 'none' } | { kind: 'ok'; state: SavedWalletState } | { kind: 'unreadable' }> {
    if (!this.enabled || process.env.VEILCORE_FRESH_SYNC === '1') return { kind: 'none' };
    let blob: Buffer;
    try {
      blob = await readFile(this.path);
    } catch {
      return { kind: 'none' };
    }
    try {
      if (!blob.subarray(0, MAGIC.length).equals(MAGIC) || blob.length <= 49) throw new Error('not ours');
      const decipher = createDecipheriv('aes-256-gcm', this.key(blob.subarray(5, 21)), blob.subarray(21, 33), {
        authTagLength: 16,
      });
      decipher.setAuthTag(blob.subarray(33, 49));
      const plain = Buffer.concat([decipher.update(blob.subarray(49)), decipher.final()]);
      const s = JSON.parse(plain.toString('utf8')) as Partial<SavedWalletState>;
      if (typeof s.shielded !== 'string' || typeof s.unshielded !== 'string' || typeof s.dust !== 'string')
        throw new Error('incomplete');
      return { kind: 'ok', state: s as SavedWalletState };
    } catch {
      return { kind: 'unreadable' };
    }
  }

  /** Saved progress, or null. A file this password cannot open is moved aside first. */
  async load(warn: (m: string) => void = () => undefined): Promise<SavedWalletState | null> {
    const r = await this.read();
    if (r.kind === 'ok') return r.state;
    if (r.kind === 'unreadable') {
      const kept = `${this.path}.unopened-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await rename(this.path, kept);
      warn(
        `Saved wallet progress could not be read (wrong password or damaged); syncing from the start. Kept as ${kept}.`,
      );
    }
    return null;
  }

  /** Save now. Saves run one after another. */
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
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
