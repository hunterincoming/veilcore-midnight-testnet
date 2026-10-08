// SPDX-License-Identifier: Apache-2.0
/**
 * The verifier's challenge book (contract/src/verify.ts, ChallengeBook) kept across runs,
 * so options 26, 27 and 28 enforce "each challenge used once" (design.md rules 5 and 8)
 * even after the CLI restarts.
 *
 * One file per network under ~/.veilcore/challenges, mode 0600 in a 0700 directory,
 * encrypted with AES-256-GCM under a key derived (scrypt) from the private-state
 * password: licence challenges are meant never to be published. A file that cannot be
 * read is not trusted: the book starts empty, so every earlier challenge is refused
 * (asking the other party for a new answer is the safe failure).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  ChallengeBook,
  type ChallengeEntry,
  type ChallengeKind,
  type ChallengeVerdict,
} from '../../contract/src/verify.js';
import { veilcoreHome } from './veilcore-home.js';

const MAGIC = Buffer.from('VCCB1');

export class ChallengeFile {
  readonly path: string;

  constructor(
    networkId: string,
    private readonly password: string,
    directory = path.join(veilcoreHome(), '.veilcore', 'challenges'),
  ) {
    if (!/^[a-z0-9-]+$/.test(networkId)) throw new Error(`Unexpected network id: ${networkId}`);
    this.path = path.join(directory, `${networkId}.bin`);
  }

  private key(salt: Buffer): Buffer {
    return scryptSync(this.password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  /** The saved entries; [] when there is no file; null when it cannot be read. */
  private async readEntries(): Promise<ChallengeEntry[] | null> {
    let blob: Buffer;
    try {
      blob = await readFile(this.path);
    } catch {
      return [];
    }
    try {
      if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a challenge file');
      // Header, salt, iv and a full 16-byte tag, then at least one byte of ciphertext.
      if (blob.length <= 49) throw new Error('damaged');
      const salt = blob.subarray(5, 21);
      const iv = blob.subarray(21, 33);
      const tag = blob.subarray(33, 49);
      const decipher = createDecipheriv('aes-256-gcm', this.key(salt), iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(blob.subarray(49)), decipher.final()]);
      const entries = JSON.parse(plain.toString('utf8')) as ChallengeEntry[];
      if (!Array.isArray(entries)) throw new Error('damaged');
      return entries;
    } catch {
      return null;
    }
  }

  /** The saved book, or an empty one (with `warning`) when there is none or it cannot be read. */
  async load(): Promise<{ book: ChallengeBook; warning?: string }> {
    const entries = await this.readEntries();
    if (entries === null) {
      return {
        book: new ChallengeBook(),
        warning:
          'Your saved verifier challenges could not be read (wrong password or damaged file). ' +
          'Challenges you issued before are refused; issue new ones with option 26.',
      };
    }
    return { book: new ChallengeBook({ entries }) };
  }

  /** Bring in what other runs saved since this one loaded (a used challenge stays used). */
  async refresh(book: ChallengeBook): Promise<void> {
    const entries = await this.readEntries();
    if (entries !== null) book.absorb(entries);
  }

  /** Save, after merging what is on disk, so another run's "used" marks are kept. */
  async save(book: ChallengeBook): Promise<void> {
    await this.locked(async () => {
      await this.refresh(book);
      await this.write(book);
    });
  }

  /**
   * Use a challenge, with the file locked: re-read, consume, write. Refused when another
   * run used it first.
   */
  async consume(book: ChallengeBook, challenge: Uint8Array, kind: ChallengeKind): Promise<ChallengeVerdict> {
    return this.locked(async () => {
      await this.refresh(book);
      const v = book.consume(challenge, kind);
      if (v.ok) await this.write(book);
      return v;
    });
  }

  private async locked<T>(work: () => Promise<T>): Promise<T> {
    const lock = `${this.path}.lock`;
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    for (let tries = 0; ; tries++) {
      try {
        await mkdir(lock, { mode: 0o700 });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        // A lock left by a run that crashed is cleared after 30 seconds.
        const age = await stat(lock).then(
          (st) => Date.now() - st.mtimeMs,
          () => 0,
        );
        if (age > 30_000) await rmdir(lock).catch(() => undefined);
        if (tries > 200) throw new Error('the challenge file is locked by another run of this program');
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try {
      return await work();
    } finally {
      await rmdir(lock).catch(() => undefined);
    }
  }

  private async write(book: ChallengeBook): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(salt), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(book.entries()), 'utf8'), cipher.final()]);
    const blob = Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, blob, { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
