// Proving keys, verifier keys and circuits, checked against the published fingerprints.
// SPDX-License-Identifier: Apache-2.0
//
// Midnight proves on a proof server, but the proof server holds no contract's keys: for
// every proof, midnight-js reads the circuit (.bzkir) and its proving and verifier keys
// from a ZK config provider and sends them with the request
// (midnight-js-http-client-proof-provider, zkConfigToProvingKeyMaterial). Joining a
// contract also compares every verifier key on chain with the local one. So a client
// needs all three files for every circuit it calls.
//
// They are large, so they are not in the npm package. This provider gets them from a
// folder (a build of this repository, or one filled by `veilcore-keys fetch`) or from a
// URL, and refuses any file whose SHA-256 is not the one in the deployment record
// (fingerprints.ts). Where the files come from therefore does not have to be trusted.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
} from '@midnight-ntwrk/midnight-js-types';
import { FINGERPRINTS } from './fingerprints.js';

export type ContractName = keyof typeof FINGERPRINTS;
export const CONTRACT_NAMES: readonly ContractName[] = ['veilcore', 'veilcore-claims'];

/**
 * Where keys and circuits come from.
 *  - `{ dir }`: a folder laid out as `contract/src/managed` is (`veilcore/keys/*.prover`,
 *    `veilcore/zkir/*.bzkir`, the same under `veilcore-claims/`): a build of this
 *    repository, or a folder `veilcore-keys fetch` filled.
 *  - `{ url }`: a folder of files named `<contract>.<circuit>.<prover|verifier|bzkir>`
 *    (veilcore.anchor.prover, veilcore-claims.proveRange.bzkir, …), as VeilCore publishes
 *    them. Each is checked, then kept in `cacheDir` (default ~/.veilcore/zk/<table id>).
 */
export type KeySource = { readonly dir: string } | { readonly url: string; readonly cacheDir?: string };

/**
 * Where VeilCore publishes the files for this build: one release asset per file, named as
 * above. Every file is checked against FINGERPRINTS, so a wrong or tampered copy is refused.
 */
export const DEFAULT_KEYS_URL = 'https://github.com/hunterincoming/veilcore-midnight-testnet/releases/download/zk-r4/';

export type ArtefactKind = 'prover' | 'verifier' | 'bzkir';
export const ARTEFACT_KINDS: readonly ArtefactKind[] = ['prover', 'verifier', 'bzkir'];

/** A file's path under its contract's folder, as docs/fingerprints.md names it. */
export const artefactPath = (kind: ArtefactKind, circuit: string): string =>
  kind === 'bzkir' ? `zkir/${circuit}.bzkir` : `keys/${circuit}.${kind}`;

/** A file's name where VeilCore publishes it. */
export const assetName = (contract: ContractName, kind: ArtefactKind, circuit: string): string =>
  `${contract}.${circuit}.${kind}`;

/** The circuits of `contract` that have keys, from the table. */
export const circuitsOf = (contract: ContractName): string[] =>
  Object.keys(FINGERPRINTS[contract])
    .map((f) => /^keys\/(.+)\.prover$/.exec(f)?.[1])
    .filter((c): c is string => c !== undefined)
    .sort();

/** A short id of the whole table, so a cache made for another build is never mixed in. */
export const tableId = (table: object = FINGERPRINTS): string =>
  createHash('sha256').update(JSON.stringify(table)).digest('hex').slice(0, 16);

export const defaultCacheDir = (): string => path.join(os.homedir(), '.veilcore', 'zk', tableId());

/** A file was not the one the deployment record names, or could not be had. Nothing was proved or sent with it. */
export class KeyFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyFingerprintError';
  }
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Circuit names are identifiers; anything else would be a path. */
const CIRCUIT = /^[A-Za-z_][A-Za-z0-9_]*$/;

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * A ZK config provider for one VeilCore contract that serves only files whose SHA-256 is
 * in the deployment record's table.
 */
export class VerifiedZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  private readonly table: Readonly<Record<string, string>>;
  private readonly fetchFn: FetchLike;

  constructor(
    readonly contract: ContractName,
    readonly source: KeySource,
    options: { readonly fetch?: FetchLike } = {},
    /** The table to check against. Tests only; everything else uses FINGERPRINTS. */
    table: Readonly<Record<string, string>> = FINGERPRINTS[contract],
  ) {
    super();
    if (!CONTRACT_NAMES.includes(contract)) throw new Error(`Unknown contract ${String(contract)}.`);
    if ('url' in source) {
      const u = new URL(source.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The keys URL must be http(s).');
    }
    this.table = table;
    this.fetchFn = options.fetch ?? ((url) => fetch(url));
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    return createProverKey(await this.load('prover', circuitId));
  }

  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return createVerifierKey(await this.load('verifier', circuitId));
  }

  async getZKIR(circuitId: K): Promise<ZKIR> {
    return createZKIR(await this.load('bzkir', circuitId));
  }

  /** The bytes of one file, checked. Throws KeyFingerprintError otherwise. */
  async load(kind: ArtefactKind, circuit: string): Promise<Uint8Array> {
    if (!CIRCUIT.test(circuit)) throw new KeyFingerprintError(`${JSON.stringify(circuit)} is not a circuit name.`);
    const rel = artefactPath(kind, circuit);
    const want = this.table[rel];
    if (want === undefined)
      throw new KeyFingerprintError(`The ${this.contract} contract has no ${rel} in the deployment record.`);
    if ('dir' in this.source) {
      const file = path.join(this.source.dir, this.contract, rel);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await readFile(file));
      } catch {
        throw new KeyFingerprintError(
          `${file} is missing. Point keys.dir at a full build (contract/src/managed after npm run compact) or at a ` +
            'folder filled by `veilcore-keys fetch`.',
        );
      }
      if (sha256(bytes) !== want)
        throw new KeyFingerprintError(
          `${file} is not the file the deployment record names (SHA-256 differs). Rebuild with compiler 0.31.1 at ` +
            'the recorded commit, or fetch the published files.',
        );
      return bytes;
    }
    const cacheDir = this.source.cacheDir ?? defaultCacheDir();
    const cached = path.join(cacheDir, this.contract, rel);
    try {
      const bytes = new Uint8Array(await readFile(cached));
      if (sha256(bytes) === want) return bytes;
      // A damaged or foreign file in the cache is replaced, never used.
    } catch {
      // not cached yet
    }
    const base = this.source.url.endsWith('/') ? this.source.url : `${this.source.url}/`;
    const url = new URL(assetName(this.contract, kind, circuit), base).toString();
    let bytes: Uint8Array;
    try {
      const res = await this.fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new KeyFingerprintError(
        `Could not fetch ${assetName(this.contract, kind, circuit)} (${why}).` +
          (why === 'HTTP 404'
            ? ` Nothing is published at ${base} yet: use keys: { dir } with a build of the contracts ` +
              '(cd contract && npm run compact), or a folder filled by `veilcore-keys fetch --url <where they are>`.'
            : ''),
      );
    }
    if (sha256(bytes) !== want)
      throw new KeyFingerprintError(
        `${assetName(this.contract, kind, circuit)} from ${base} is not the file the deployment record names ` +
          '(SHA-256 differs). It was not used or kept.',
      );
    await mkdir(path.dirname(cached), { recursive: true });
    const tmp = `${cached}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, cached);
    return bytes;
  }
}

/**
 * Load and check every key and circuit of both contracts from `source` (fetching, and
 * caching, what a URL source does not have yet). Returns how many files were checked.
 * Throws KeyFingerprintError at the first one that is missing or wrong.
 */
export const checkKeys = async (
  source: KeySource,
  options: { readonly fetch?: FetchLike; readonly onFile?: (name: string) => void } = {},
): Promise<number> => {
  let n = 0;
  for (const contract of CONTRACT_NAMES) {
    const p = new VerifiedZkConfigProvider<string>(contract, source, options);
    for (const circuit of circuitsOf(contract))
      for (const kind of ARTEFACT_KINDS) {
        await p.load(kind, circuit);
        options.onFile?.(assetName(contract, kind, circuit));
        n++;
      }
  }
  return n;
};
