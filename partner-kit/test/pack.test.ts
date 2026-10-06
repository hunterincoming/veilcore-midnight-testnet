// What `npm pack` would publish: only the built package, no keys, no secrets, no test
// material, a sane size, and the contract code byte for byte as the deployment record
// fingerprints it.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FINGERPRINTS } from '../src/fingerprints';

const PKG = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const NPM = process.env.npm_execpath?.endsWith('.js') ? [process.execPath, process.env.npm_execpath] : ['npm'];

type Packed = { files: { path: string; size: number }[]; size: number; unpackedSize: number; name: string };
let packed: Packed;

beforeAll(() => {
  execFileSync(process.execPath, [path.join(PKG, 'scripts', 'build.mjs')], { stdio: 'pipe' });
  // Scripts are skipped: prepack would only build again.
  const out = execFileSync(NPM[0], [...NPM.slice(1), 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: PKG,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'silent' },
  });
  packed = (JSON.parse(out) as Packed[])[0];
}, 180_000);

const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^dist\/index\.js$/,
  /^dist\/veilcore-keys\.js$/,
  /^dist\/managed\/(veilcore|veilcore-claims)\/contract\/index\.(js|js\.map|d\.ts)$/,
  /^dist\/types\/(partner-kit|api|contract|bboard-cli)\/src\/[A-Za-z0-9/_-]+\.d\.ts$/,
];

describe('npm pack', () => {
  it('is @veilcore/contracts and holds only the built package', () => {
    expect(packed.name).toBe('@veilcore/contracts');
    const stray = packed.files.map((f) => f.path).filter((p) => !ALLOWED.some((re) => re.test(p)));
    expect(stray).toEqual([]);
    for (const need of ['dist/index.js', 'dist/veilcore-keys.js', 'dist/types/partner-kit/src/index.d.ts', 'LICENSE'])
      expect(packed.files.map((f) => f.path)).toContain(need);
  });

  it('holds no keys, circuits, test files, sources or local state', () => {
    for (const { path: p } of packed.files) {
      expect(p).not.toMatch(/\.(prover|verifier|bzkir|zkir|compact)$/);
      expect(p).not.toMatch(/(^|\/)(keys|zkir|test|tests|examples|local|node_modules|midnight-level-db|\.veilcore)\//);
      expect(p).not.toMatch(/(^|\/)\.env|\.test\.|\.tgz$|\.log$/);
      expect(p.endsWith('.ts') && !p.endsWith('.d.ts')).toBe(false);
    }
  });

  it('holds no secret material in any file', () => {
    for (const { path: p } of packed.files) {
      const text = readFileSync(path.join(PKG, p), 'utf8');
      expect(text, p).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(text, p).not.toMatch(/project_id=[A-Za-z0-9_-]{8,}/);
      expect(text, p).not.toMatch(/VEILCORE_PRIVATE_STATE_PASSWORD\s*=\s*\S/);
      // The local chain's funded genesis seed, and anything else seed-shaped with a name.
      expect(text, p).not.toContain('0'.repeat(63) + '1');
      expect(text, p).not.toMatch(/(seed|mnemonic|password|secret)\s*[:=]\s*['"][0-9a-f]{32,}['"]/i);
      // No path from the machine that built it.
      expect(text, p).not.toMatch(/\/(Users|home|tmp|private\/var)\/[A-Za-z0-9._-]+\//);
    }
  });

  it('ships the contract code exactly as fingerprinted', () => {
    for (const c of ['veilcore', 'veilcore-claims'] as const) {
      const bytes = readFileSync(path.join(PKG, 'dist', 'managed', c, 'contract', 'index.js'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(FINGERPRINTS[c]['contract/index.js']);
    }
  });

  it('is a sane size: under 1 MB packed, 3 MB unpacked', () => {
    expect(packed.size).toBeLessThan(1_000_000);
    expect(packed.unpackedSize).toBeLessThan(3_000_000);
  });
});
