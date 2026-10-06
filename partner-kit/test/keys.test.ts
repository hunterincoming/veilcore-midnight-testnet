// Keys and circuits are served only when they are the files the deployment record names
// (src/keys.ts), and the package's table is the record's (src/fingerprints.ts).
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseFingerprints } from '../../bboard-cli/src/keys-check';
import { PROVABLE_CIRCUITS } from '../../contract/src/veilcore';
import { CLAIMS_PROVABLE_CIRCUITS } from '../../contract/src/claims';
import { FINGERPRINTS } from '../src/fingerprints';
import {
  DEFAULT_KEYS_URL,
  KeyFingerprintError,
  VerifiedZkConfigProvider,
  artefactPath,
  assetName,
  checkKeys,
  circuitsOf,
} from '../src/keys';

const DOC = readFileSync(new URL('../../docs/fingerprints.md', import.meta.url), 'utf8');
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('the table', () => {
  it('is exactly docs/fingerprints.md, both contracts', () => {
    expect(Object.entries(FINGERPRINTS.veilcore).sort()).toEqual([...parseFingerprints(DOC, 'main')].sort());
    expect(Object.entries(FINGERPRINTS['veilcore-claims']).sort()).toEqual(
      [...parseFingerprints(DOC, 'claims')].sort(),
    );
  });

  it('names a proving key, a verifier key and a circuit for every circuit of this build', () => {
    expect(circuitsOf('veilcore')).toEqual([...PROVABLE_CIRCUITS].sort());
    expect(circuitsOf('veilcore-claims')).toEqual([...CLAIMS_PROVABLE_CIRCUITS].sort());
    for (const [contract, circuits] of [
      ['veilcore', PROVABLE_CIRCUITS],
      ['veilcore-claims', CLAIMS_PROVABLE_CIRCUITS],
    ] as const)
      for (const c of circuits)
        for (const kind of ['prover', 'verifier', 'bzkir'] as const)
          expect(FINGERPRINTS[contract][artefactPath(kind, c) as keyof (typeof FINGERPRINTS)[typeof contract]]).toMatch(
            /^[0-9a-f]{64}$/,
          );
  });

  it('matches the contract code this build compiles', () => {
    for (const c of ['veilcore', 'veilcore-claims'] as const) {
      const f = new URL(`../../contract/src/managed/${c}/contract/index.js`, import.meta.url);
      expect(sha(readFileSync(f))).toBe(FINGERPRINTS[c]['contract/index.js']);
    }
  });
});

/** A folder of made-up artefacts and a table that names them. */
const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-keys-'));
  const table: Record<string, string> = {};
  const files: Record<string, Uint8Array> = {};
  for (const kind of ['prover', 'verifier', 'bzkir'] as const) {
    const bytes = new Uint8Array(Buffer.from(`anchor ${kind} bytes`));
    const rel = artefactPath(kind, 'anchor');
    mkdirSync(path.join(dir, 'veilcore', path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(dir, 'veilcore', rel), bytes);
    table[rel] = sha(bytes);
    files[assetName('veilcore', kind, 'anchor')] = bytes;
  }
  return { dir, table, files };
};

describe('a folder source', () => {
  it('serves a file whose SHA-256 is in the table, and refuses one that is not', async () => {
    const { dir, table } = fixture();
    const p = new VerifiedZkConfigProvider<string>('veilcore', { dir }, {}, table);
    expect(Buffer.from(await p.getProverKey('anchor')).toString()).toBe('anchor prover bytes');
    expect(Buffer.from(await p.getVerifierKey('anchor')).toString()).toBe('anchor verifier bytes');
    expect(Buffer.from(await p.getZKIR('anchor')).toString()).toBe('anchor bzkir bytes');
    writeFileSync(path.join(dir, 'veilcore', 'keys', 'anchor.prover'), 'a different key');
    await expect(p.getProverKey('anchor')).rejects.toThrow(KeyFingerprintError);
    await expect(p.getProverKey('anchor')).rejects.toThrow(/SHA-256 differs/);
  });

  it('refuses a circuit the record does not name, and anything that is not a circuit name', async () => {
    const { dir, table } = fixture();
    const p = new VerifiedZkConfigProvider<string>('veilcore', { dir }, {}, table);
    await expect(p.getProverKey('pairDna')).rejects.toThrow(/no keys\/pairDna\.prover in the deployment record/);
    await expect(p.getProverKey('../../etc/passwd')).rejects.toThrow(/not a circuit name/);
  });

  it('says what to do when the keys are missing (a build made without them)', async () => {
    const managed = new URL('../../contract/src/managed', import.meta.url).pathname;
    const p = new VerifiedZkConfigProvider<string>('veilcore', { dir: managed });
    if (existsSync(path.join(managed, 'veilcore', 'keys', 'anchor.prover'))) {
      expect(await p.getProverKey('anchor')).toHaveLength(
        readFileSync(path.join(managed, 'veilcore/keys/anchor.prover')).length,
      );
    } else {
      await expect(p.getProverKey('anchor')).rejects.toThrow(/missing\. Point keys\.dir at a full build/);
      await expect(checkKeys({ dir: managed })).rejects.toBeInstanceOf(KeyFingerprintError);
    }
  });
});

describe('a URL source', () => {
  const served = (files: Record<string, Uint8Array>) =>
    vi.fn(async (url: string) => {
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
      const body = files[name];
      return {
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer,
      };
    });

  it('fetches each file once, checks it, and keeps it in the cache', async () => {
    const { table, files } = fixture();
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'vc-cache-'));
    const fetch = served(files);
    const p = new VerifiedZkConfigProvider<string>(
      'veilcore',
      { url: 'https://keys.example/zk-r4', cacheDir },
      { fetch },
      table,
    );
    await p.getProverKey('anchor');
    expect(fetch).toHaveBeenCalledWith('https://keys.example/zk-r4/veilcore.anchor.prover');
    await p.getProverKey('anchor');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(cacheDir, 'veilcore', 'keys', 'anchor.prover'))).toBe(true);
    // A damaged cached copy is replaced, never used.
    writeFileSync(path.join(cacheDir, 'veilcore', 'keys', 'anchor.prover'), 'damaged');
    expect(Buffer.from(await p.getProverKey('anchor')).toString()).toBe('anchor prover bytes');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses a wrong file from the server and keeps nothing of it', async () => {
    const { table } = fixture();
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'vc-cache-'));
    const fetch = served({ 'veilcore.anchor.prover': new Uint8Array(Buffer.from('tampered')) });
    const p = new VerifiedZkConfigProvider<string>(
      'veilcore',
      { url: 'https://keys.example/', cacheDir },
      { fetch },
      table,
    );
    await expect(p.getProverKey('anchor')).rejects.toThrow(/not the file the deployment record names/);
    expect(existsSync(path.join(cacheDir, 'veilcore', 'keys', 'anchor.prover'))).toBe(false);
    await expect(p.getVerifierKey('anchor')).rejects.toThrow(/Could not fetch veilcore\.anchor\.verifier \(HTTP 404\)/);
  });

  it('the published location is https', () => {
    expect(new URL(DEFAULT_KEYS_URL).protocol).toBe('https:');
    expect(() => new VerifiedZkConfigProvider('veilcore', { url: 'file:///etc/' })).toThrow(/http/);
  });
});
