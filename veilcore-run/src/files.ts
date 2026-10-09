// Files only their owner can read: folders 0700, files 0600, written whole and renamed
// into place so a crash never leaves half a vault.
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** ~/.veilcore/managed/<network>: where VeilCore-run keeps one folder per partner. */
export const defaultRoot = (network: string, home = os.homedir()): string => {
  if (!/^[a-z0-9-]+$/.test(network)) throw new Error(`Unexpected network ${network}.`);
  return path.join(home, '.veilcore', 'managed', network);
};

/** A partner id: lower case letters, digits and dashes, 2 to 63 long. It names a folder. */
export const PARTNER_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;

export const partnerDir = (root: string, partnerId: string): string => {
  if (!PARTNER_ID.test(partnerId))
    throw new Error('A partner id is 2 to 63 lower-case letters, digits or dashes, starting with a letter or digit.');
  return path.join(root, partnerId);
};

/** Make `dir` (and its missing parents) and set it 0700, whatever the umask. */
export const privateDir = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
};

/**
 * Refuse a file or folder that someone other than its owner can read or write, or a
 * symbolic link (which could point anywhere). Says what to check; changes nothing.
 */
export const assertOwnerOnly = async (p: string): Promise<void> => {
  const st = await lstat(p);
  if (st.isSymbolicLink()) throw new Error(`${p} is a symbolic link. Refused: custody files are never links.`);
  if ((st.mode & 0o077) !== 0)
    throw new Error(
      `${p} can be read or changed by other users of this computer (mode ${(st.mode & 0o777).toString(8)}). ` +
        'Refused. Find out how that happened, then: chmod ' +
        (st.isDirectory() ? '700' : '600') +
        ` "${p}"`,
    );
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (uid !== undefined && st.uid !== uid) throw new Error(`${p} belongs to another user. Refused.`);
};

export const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Write `text` to `file` (0600): to a temporary file beside it first, flushed to disk,
 * then renamed over the old one. `exclusive`: refuse if `file` already exists.
 */
export const writePrivate = async (file: string, text: string, { exclusive = false } = {}): Promise<void> => {
  if (exclusive && (await exists(file))) throw new Error(`${file} already exists. Refused: nothing was overwritten.`);
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const fh = await open(tmp, 'wx', 0o600);
  try {
    await fh.writeFile(text, 'utf8');
    await fh.sync();
  } catch (e) {
    await fh.close();
    await rm(tmp, { force: true });
    throw e;
  }
  await fh.close();
  await chmod(tmp, 0o600);
  if (exclusive && (await exists(file))) {
    await rm(tmp, { force: true });
    throw new Error(`${file} already exists. Refused: nothing was overwritten.`);
  }
  await rename(tmp, file);
};

/** Read a custody file, refusing one others can read. */
export const readPrivate = async (file: string): Promise<string> => {
  await assertOwnerOnly(file);
  return readFile(file, 'utf8');
};
