// SPDX-License-Identifier: Apache-2.0
/**
 * Where the CLI keeps its private-state store, and how it is opened (round D, D-2).
 *
 * The store is a LevelDB folder holding each contract's private state (the record
 * secret above all), encrypted with the private-state password. It used to be
 * `midnight-level-db` in the folder the CLI ran from, inside the repository, created
 * with the process umask (world-readable files), where backups and Desktop/Documents
 * sync pick it up. It now lives in ~/.veilcore/<network>/private-state: the folders
 * 0700, the files 0600.
 *
 * What goes into it changed too: the maintenance key and one-call secrets never do
 * (api/src/memory-overlays.ts). But a folder written by an older version can still hold
 * a maintenance key, in a live entry or in a deleted one LevelDB has not compacted away.
 * So an old folder is never reused in place and never deleted by this program: when one
 * is found, the operator is told, and offered a copy of its LIVE entries into the new
 * place, leaving out any maintenance key and with one-call secrets zeroed. The old folder
 * is left exactly where it was, for the operator to delete securely once the new store
 * has been seen to work.
 */
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { type Logger } from 'pino';
import {
  type LevelFactory,
  StorageEncryption,
  decryptValue,
  levelPrivateStateProvider,
} from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { TRANSIENT_FIELDS, memorySigningKeys, transientSecrets } from '../../api/src/memory-overlays';
import { oneAtATime } from './one-at-a-time.js';

/** The folder name midnight-js used by default, relative to wherever the CLI ran. */
export const OLD_STORE_NAME = 'midnight-level-db';

/** ~/.veilcore/<network>/private-state. */
export const storeDirFor = (networkId: string, home = os.homedir()): string => {
  if (!/^[a-z0-9-]+$/.test(networkId)) throw new Error(`Unexpected network id: ${networkId}`);
  return path.join(home, '.veilcore', networkId, 'private-state');
};

/** The places an older CLI kept its store: the working folder, and bboard-cli/. */
export const oldStoreCandidates = (cwd = process.cwd()): string[] => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return [...new Set([path.resolve(cwd, OLD_STORE_NAME), path.resolve(here, '..', OLD_STORE_NAME)])];
};

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const isEmptyDir = async (p: string): Promise<boolean> => {
  try {
    return (await readdir(p)).length === 0;
  } catch {
    return true; // absent counts as empty
  }
};

/**
 * Make `dir` and its parents up to ~/.veilcore private (0700), and every file already in
 * `dir` 0600. mkdir's mode is masked by the umask and leaves existing folders alone, so
 * each is chmod'ed as well.
 */
export const makePrivate = async (dir: string, home = os.homedir()): Promise<void> => {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const top = path.join(home, '.veilcore');
  for (let d = dir; d.startsWith(top); d = path.dirname(d)) {
    await chmod(d, 0o700);
    if (d === top) break;
  }
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    await chmod(p, f.isDirectory() ? 0o700 : 0o600);
  }
};

// ─────────────────────────────────────────────────────────── copying an old store

type LevelLike = {
  open(): Promise<void>;
  close(): Promise<void>;
  iterator(): AsyncIterable<[string, string]>;
  put(key: string, value: string): Promise<void>;
};
type LevelClass = new (location: string, options?: object) => LevelLike;

/** The `level` package, as midnight-js's level provider resolves it (no dependency of our own). */
const levelClass = (): LevelClass => {
  const req = createRequire(import.meta.url);
  const provider = req.resolve('@midnight-ntwrk/midnight-js-level-private-state-provider');
  return (createRequire(provider)('level') as { Level: LevelClass }).Level;
};

const METADATA_KEY = '__midnight_encryption_metadata__';

/** A value that holds bytes, in whatever shape superjson gave it, with every byte zero. */
const zeroedLike = (v: unknown): unknown => {
  if (typeof v === 'string') return /^[0-9a-fA-F]*$/.test(v) ? '0'.repeat(v.length) : v;
  if (Array.isArray(v)) return v.map(() => 0);
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v).map((k) => [k, typeof (v as never)[k] === 'number' ? 0 : zeroedLike((v as never)[k])]),
    );
  return v;
};

/** A superjson-serialized private state with its one-call secrets zeroed; other text unchanged. */
export const scrubTransient = (serialized: string): string => {
  let parsed: { json?: Record<string, unknown> } & Record<string, unknown>;
  try {
    parsed = JSON.parse(serialized) as typeof parsed;
  } catch {
    return serialized;
  }
  const body = parsed.json !== undefined && typeof parsed.json === 'object' ? parsed.json : parsed;
  if (body === null || typeof body !== 'object') return serialized;
  for (const f of TRANSIENT_FIELDS) if (f in body) body[f] = zeroedLike(body[f]);
  return JSON.stringify(parsed);
};

export type CopyReport = {
  readonly copied: number;
  /** Live maintenance (signing) keys of the main contract found and NOT copied. */
  readonly keysLeftOut: number;
};

/** The scratch folder a MOVE reads the old store from: <system temp>/veilcore-old-store-<pid>-XXXXXX. */
export const SCRATCH_PREFIX = 'veilcore-old-store-';

/**
 * Remove `p` if this process exits before `dispose` is called: Ctrl+C during a copy ends
 * the CLI with process.exit, which runs 'exit' listeners but not `finally` blocks.
 */
const removeOnExit = (p: string): (() => void) => {
  const remove = (): void => rmSync(p, { recursive: true, force: true });
  process.once('exit', remove);
  return () => process.off('exit', remove);
};

/**
 * Copy the live entries of `oldDir` that belong to `storeName` into a NEW store at
 * `newDir` (which must not exist yet): the main private state with its one-call secrets
 * zeroed, the claims contract's private state and keys as they are, and NOT the main
 * contract's signing keys. Deleted entries are not live, so they do not come across.
 *
 * `oldDir` itself is never opened: LevelDB rewrites a folder when it opens it (it replays
 * the log into a new table and may compact), which would change, and could silently
 * drop, what the operator was told is there. A scratch duplicate is opened instead. It
 * holds everything the old folder does, an old maintenance key included, so it is made
 * in the system's temporary folder (private to this user, 0700; not in the home folder,
 * where backups and sync would pick it up), removed however the copy ends (`finally`,
 * and on process exit), and, if the process was killed outright, removed at the next
 * start (cleanLeftovers).
 */
export const copyLiveStore = async (
  oldDir: string,
  newDir: string,
  storeName: string,
  password: string,
  tmp: string = os.tmpdir(),
): Promise<CopyReport> => {
  const scratch = await mkdtemp(path.join(tmp, `${SCRATCH_PREFIX}${process.pid}-`));
  const keep = removeOnExit(scratch);
  try {
    await chmod(scratch, 0o700);
    const db = path.join(scratch, 'db');
    await cp(oldDir, db, { recursive: true, errorOnExist: true });
    return await copyLiveEntries(db, newDir, storeName, password);
  } finally {
    keep();
    await rm(scratch, { recursive: true, force: true });
  }
};

/** A leftover's process: gone, or so old it cannot be a copy still running (a MOVE takes seconds). */
const abandoned = async (p: string, pid: number): Promise<boolean> => {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') return true;
  }
  try {
    return Date.now() - (await stat(p)).mtimeMs > 60 * 60 * 1000;
  } catch {
    return false;
  }
};

/**
 * Remove what an interrupted MOVE (the process killed mid-copy) left behind, and say so:
 * - <system temp>/veilcore-old-store-<pid>-*: the scratch copy of the old store. It can
 *   hold an old maintenance key.
 * - ~/.veilcore/<network>/private-state.copying-<pid>.reading: the same scratch copy, where
 *   the version before this one made it (in the home folder).
 * - ~/.veilcore/<network>/private-state.copying-<pid>: the unfinished new store. It holds
 *   no maintenance key; the old folder is still there and MOVE is offered again.
 * Only folders of this user whose process is gone are touched.
 */
export const cleanLeftovers = async (args: {
  readonly networkId: string;
  readonly logger: Logger;
  readonly home?: string;
  readonly tmp?: string;
}): Promise<string[]> => {
  const { logger } = args;
  const home = args.home ?? os.homedir();
  const tmp = args.tmp ?? os.tmpdir();
  const dir = storeDirFor(args.networkId, home);
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const removed: string[] = [];
  const scan = async (where: string, pattern: RegExp, say: (p: string) => string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(where);
    } catch {
      return;
    }
    for (const name of names) {
      const m = pattern.exec(name);
      if (m === null) continue;
      const p = path.join(where, name);
      try {
        const st = await stat(p);
        if (uid !== undefined && st.uid !== uid) continue;
      } catch {
        continue;
      }
      if (!(await abandoned(p, Number(m[1])))) continue;
      await rm(p, { recursive: true, force: true });
      removed.push(p);
      logger.warn(say(p));
    }
  };
  const scratchSaid = (p: string): string =>
    `Removed ${p}: a scratch copy of an older private-state store, left by a copy (MOVE) that was interrupted. ` +
    'It could hold an old maintenance key: if a backup or sync service copied it, delete it there too.';
  await scan(tmp, new RegExp(`^${SCRATCH_PREFIX}(\\d+)-`), scratchSaid);
  // storeDirFor's last part is always 'private-state'.
  await scan(path.dirname(dir), /^private-state\.copying-(\d+)\.reading$/, scratchSaid);
  await scan(
    path.dirname(dir),
    /^private-state\.copying-(\d+)$/,
    (p) =>
      `Removed ${p}: an unfinished copy of your private state, left by a copy (MOVE) that was interrupted. ` +
      'It held no maintenance key. Your old folder is unchanged; MOVE is offered again.',
  );
  return removed;
};

const copyLiveEntries = async (
  oldDir: string,
  newDir: string,
  storeName: string,
  password: string,
): Promise<CopyReport> => {
  const Level = levelClass();
  const from = new Level(oldDir, { createIfMissing: false, keyEncoding: 'utf8', valueEncoding: 'utf8' });
  const to = new Level(newDir, {
    createIfMissing: true,
    errorIfExists: true,
    keyEncoding: 'utf8',
    valueEncoding: 'utf8',
  });
  await from.open();
  try {
    await to.open();
    try {
      const entries: [string, string][] = [];
      for await (const kv of from.iterator()) entries.push(kv);
      const levelOf = (key: string): { base: string; scoped: string; inner: string } | undefined => {
        const m = /^!([^!]+)!([\s\S]*)$/.exec(key);
        if (m === null) return undefined;
        return { scoped: m[1], base: m[1].split(':')[0], inner: m[2] };
      };
      const salts = new Map<string, Buffer>();
      for (const [k, v] of entries) {
        const l = levelOf(k);
        if (l !== undefined && l.inner === METADATA_KEY)
          salts.set(l.scoped, Buffer.from((JSON.parse(v) as { salt: string }).salt, 'hex'));
      }
      const wanted = new Set([storeName, `${storeName}-claims`, `${storeName}-claims-signing-keys`]);
      let copied = 0;
      let keysLeftOut = 0;
      for (const [k, v] of entries) {
        const l = levelOf(k);
        if (l === undefined) continue;
        if (l.base === `${storeName}-signing-keys`) {
          if (l.inner !== METADATA_KEY) keysLeftOut++;
          continue;
        }
        if (!wanted.has(l.base)) continue;
        let value = v;
        if (l.base === storeName && l.inner !== METADATA_KEY) {
          const salt = salts.get(l.scoped);
          if (salt === undefined) throw new Error('The old store has a private state with no encryption record.');
          const enc = await StorageEncryption.create(password, { existingSalt: salt });
          let plain: string;
          try {
            plain = await decryptValue(v, enc, password);
          } catch {
            throw new Error('The password does not open the old store. Nothing was copied.');
          }
          value = await enc.encrypt(scrubTransient(plain));
        }
        await to.put(k, value);
        copied++;
      }
      return { copied, keysLeftOut };
    } finally {
      await to.close();
    }
  } finally {
    await from.close();
  }
};

// ─────────────────────────────────────────────────────────── choosing the store

export type StoreChoice = { readonly dir: string; readonly old?: string };

const OLD_STORE_WARNING = (old: string): string =>
  `The old folder ${old} is still there. It may contain an old copy of a maintenance key (an older version of ` +
  'this program kept it there, and LevelDB keeps deleted values in its files for a while). Once this program has ' +
  'run with the new store and you have checked your record (option 31), delete the old folder securely and ' +
  'remove it from any backup. This program never deletes it for you.';

/**
 * Decide which store folder this run uses, before anything else opens one.
 *
 * - No old folder: the new place.
 * - An old folder and an empty new place: say so, and offer to copy (type MOVE). After a
 *   copy, the new place; on Enter, the old folder for this run only (nothing changes).
 * - An old folder and a new place already in use: the new place; the old folder is
 *   mentioned, not touched.
 */
export const chooseStore = async (args: {
  readonly networkId: string;
  readonly storeName: string;
  readonly password: string;
  readonly ask: (question: string) => Promise<string>;
  readonly logger: Logger;
  readonly home?: string;
  /** Where to look for an older version's folder (default: oldStoreCandidates()). */
  readonly candidates?: readonly string[];
  /** Where a MOVE makes its scratch copy (default: the system's temporary folder). */
  readonly tmp?: string;
}): Promise<StoreChoice> => {
  const { logger } = args;
  const home = args.home ?? os.homedir();
  const dir = storeDirFor(args.networkId, home);
  // First, whatever an interrupted copy left behind (it may be what makes `dir` look in use).
  await cleanLeftovers({ networkId: args.networkId, logger, home, tmp: args.tmp });
  const olds: string[] = [];
  for (const c of args.candidates ?? oldStoreCandidates())
    if (path.resolve(c) !== path.resolve(dir) && (await exists(c))) olds.push(c);
  if (olds.length === 0) return { dir };
  const old = olds[0];
  for (const o of olds.slice(1)) logger.warn(OLD_STORE_WARNING(o));
  if (!(await isEmptyDir(dir))) {
    logger.warn(`Using the private-state store in ${dir}.`);
    logger.warn(OLD_STORE_WARNING(old));
    return { dir, old };
  }
  logger.warn(`Found a private-state store from an older version of this program in ${old}.`);
  logger.warn(`This version keeps it in ${dir} instead (private to your user account, outside the repository).`);
  const answer = (
    await args.ask(
      'Type MOVE to copy your private state there now (recommended), or press Enter to use the old folder for this run only: ',
    )
  ).trim();
  if (answer !== 'MOVE') {
    logger.warn(
      `Using the old folder ${old} for this run, as the older version did. Nothing was copied. ` +
        'You will be asked again next time.',
    );
    return { dir: old, old };
  }
  await makePrivate(path.dirname(dir), home);
  const staging = `${dir}.copying-${process.pid}`;
  const keep = removeOnExit(staging);
  try {
    const r = await copyLiveStore(old, staging, args.storeName, args.password, args.tmp);
    await rename(staging, dir);
    keep();
    await makePrivate(dir, home);
    logger.info(`Copied ${r.copied} entries to ${dir}. One-call secrets were left out.`);
    if (r.keysLeftOut > 0)
      logger.warn(
        `${r.keysLeftOut} maintenance key(s) in the old store were NOT copied: this version never keeps one on disk. ` +
          'If a deploy stopped partway, "Finish a deploy" asks for the key from your paper.',
      );
  } catch (e) {
    // Only the partial copy this run just made is removed; the old folder is untouched.
    keep();
    await rm(staging, { recursive: true, force: true });
    logger.error(
      `The copy did not complete (${e instanceof Error ? e.message : String(e)}). The old folder is unchanged.`,
    );
    throw e;
  }
  logger.warn(OLD_STORE_WARNING(old));
  return { dir, old };
};

// ─────────────────────────────────────────────────────────── opening it

/** Every file in `dir` 0600 (LevelDB makes new ones with the process umask). */
export const tightenFiles = async (dir: string): Promise<void> => {
  for (const f of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (f.isFile()) await chmod(path.join(dir, f.name), 0o600).catch(() => undefined);
  }
};

/**
 * midnight-js opens and closes the database for every operation. This factory opens it
 * as midnight-js would, and after each close sets every file in the folder back to 0600,
 * whatever the umask was (the CLI also sets a 077 umask while it runs).
 */
const privateLevelFactory = (dir: string): LevelFactory => {
  const Level = levelClass();
  return (dbName: string) => {
    const level = new Level(dbName, { createIfMissing: true }) as unknown as ReturnType<LevelFactory>;
    const close = level.close.bind(level);
    (level as { close: () => Promise<void> }).close = async () => {
      await close();
      await tightenFiles(dir);
    };
    return level;
  };
};

/**
 * The CLI's private-state providers over the folder `dir`, made private (0700/0600)
 * first. The main contract's store keeps signing keys in memory only and writes one-call
 * secrets as zeros (memory-overlays.ts). The claims contract (every network, mainnet too) keeps
 * its throwaway authority key in its store so an interrupted claims deploy can be
 * finished; that key is retired, provably, when the deploy completes.
 */
export const openStores = async <
  MainId extends string,
  MainState,
  ClaimsId extends string,
  ClaimsState,
  RoyaltiesId extends string = string,
  RoyaltiesState = unknown,
>(args: {
  readonly dir: string;
  readonly storeName: string;
  readonly password: () => string;
  readonly accountId: string;
  readonly home?: string;
}) => {
  const home = args.home ?? os.homedir();
  if (args.dir.startsWith(path.join(home, '.veilcore') + path.sep)) await makePrivate(args.dir, home);
  const levelFactory = privateLevelFactory(args.dir);
  const main = memorySigningKeys(
    transientSecrets(
      oneAtATime(
        levelPrivateStateProvider<MainId, MainState>({
          midnightDbName: args.dir,
          privateStateStoreName: args.storeName,
          signingKeyStoreName: `${args.storeName}-signing-keys`,
          privateStoragePasswordProvider: args.password,
          accountId: args.accountId,
          levelFactory,
        }),
      ),
    ),
  );
  const claims = oneAtATime(
    levelPrivateStateProvider<ClaimsId, ClaimsState>({
      midnightDbName: args.dir,
      privateStateStoreName: `${args.storeName}-claims`,
      signingKeyStoreName: `${args.storeName}-claims-signing-keys`,
      privateStoragePasswordProvider: args.password,
      accountId: args.accountId,
      levelFactory,
    }),
  );
  // The royalties contract keeps offer admin secrets and licence secrets here, encrypted
  // like the rest, so a breeder or grower can act again after a restart.
  const royalties = oneAtATime(
    levelPrivateStateProvider<RoyaltiesId, RoyaltiesState>({
      midnightDbName: args.dir,
      privateStateStoreName: `${args.storeName}-royalties`,
      signingKeyStoreName: `${args.storeName}-royalties-signing-keys`,
      privateStoragePasswordProvider: args.password,
      accountId: args.accountId,
      levelFactory,
    }),
  );
  return { main, claims, royalties };
};
