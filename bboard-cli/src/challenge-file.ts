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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChallengeBook, type ChallengeEntry } from '../../contract/src/verify.js';

const MAGIC = Buffer.from('VCCB1');

export class ChallengeFile {
  readonly path: string;

  constructor(
    networkId: string,
    private readonly password: string,
    directory = path.join(os.homedir(), '.veilcore', 'challenges'),
  ) {
    if (!/^[a-z0-9-]+$/.test(networkId)) throw new Error(`Unexpected network id: ${networkId}`);
    this.path = path.join(directory, `${networkId}.bin`);
  }

  private key(salt: Buffer): Buffer {
    return scryptSync(this.password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  /** The saved book, or an empty one (with `warning`) when there is none or it cannot be read. */
  async load(): Promise<{ book: ChallengeBook; warning?: string }> {
    let blob: Buffer;
    try {
      blob = await readFile(this.path);
    } catch {
      return { book: new ChallengeBook() };
    }
    try {
      if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a challenge file');
      const salt = blob.subarray(5, 21);
      const iv = blob.subarray(21, 33);
      const tag = blob.subarray(33, 49);
      const decipher = createDecipheriv('aes-256-gcm', this.key(salt), iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(blob.subarray(49)), decipher.final()]);
      const entries = JSON.parse(plain.toString('utf8')) as ChallengeEntry[];
      if (!Array.isArray(entries)) throw new Error('damaged');
      return { book: new ChallengeBook({ entries }) };
    } catch {
      return {
        book: new ChallengeBook(),
        warning:
          'Your saved verifier challenges could not be read (wrong password or damaged file). ' +
          'Challenges you issued before are refused; issue new ones with option 26.',
      };
    }
  }

  async save(book: ChallengeBook): Promise<void> {
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
