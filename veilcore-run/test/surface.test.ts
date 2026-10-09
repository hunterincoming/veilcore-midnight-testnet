// VeilCore-run is built on the partner kit's PUBLIC surface only: every import in its
// sources is Node's own, its own files, or '@veilcore/contracts', and every name it takes
// from the kit is one the kit exports. It reaches none of VeilCore's operator code
// (deploy, circuit keys, maintenance authority) and none of the kit's internals.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const KIT_INDEX = path.join(SRC, '..', '..', 'partner-kit', 'src', 'index.ts');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

/** Every `import … from '<spec>'` (and dynamic import) in a source, with what it names. */
const importsOf = (text: string): { spec: string; names: { name: string; type: boolean }[] }[] => {
  const out: { spec: string; names: { name: string; type: boolean }[] }[] = [];
  for (const m of text.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/g)) {
    const whole = m[1] !== undefined;
    const braces = /\{([\s\S]*)\}/.exec(m[2]);
    const names = (braces?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map((s) => ({ name: s.replace(/^type\s+/, '').split(/\s+as\s+/)[0], type: whole || s.startsWith('type ') }));
    out.push({ spec: m[3], names });
  }
  for (const m of text.matchAll(/import\(\s*'([^']+)'\s*\)/g)) out.push({ spec: m[1], names: [] });
  return out;
};

describe('the operator code’s imports', () => {
  it('are Node’s, its own files, and @veilcore/contracts only', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      for (const { spec } of importsOf(readFileSync(path.join(SRC, f), 'utf8'))) {
        const ok = spec.startsWith('node:') || spec === '@veilcore/contracts' || /^\.\/[a-z-]+\.ts$/.test(spec);
        expect(ok, `${f} imports ${spec}`).toBe(true);
      }
    }
  });

  it('name only what the kit exports, and nothing of VeilCore’s operator work', async () => {
    const kit = (await import('@veilcore/contracts')) as Record<string, unknown>;
    const indexText = readFileSync(KIT_INDEX, 'utf8');
    const used = new Set<string>();
    for (const f of files)
      for (const imp of importsOf(readFileSync(path.join(SRC, f), 'utf8')))
        if (imp.spec === '@veilcore/contracts')
          for (const n of imp.names) {
            used.add(n.name);
            // A type may be an exported type, or the type of an exported class.
            if (n.type && kit[n.name] === undefined)
              expect(indexText, `type ${n.name} (${f})`).toMatch(new RegExp(`\\btype ${n.name}\\b`));
            else expect(kit[n.name], `${n.name} (${f})`).toBeDefined();
          }
    // The operator flow is the kit's partner operations: the clients, commitments, the readers.
    for (const need of [
      'VeilCore',
      'VeilCoreClaims',
      'commit',
      'newSecret',
      'sealFields',
      'connect',
      'memoryPrivateState',
    ])
      expect(used, need).toContain(need);
    for (const bad of [...used])
      expect(bad).not.toMatch(
        /deploy(?!TxId)|maintenance|retire|fragment|signingkey|verifierkey|replaceauthority|VeilcoreAPI|ClaimsAPI/i,
      );
  });

  it('loads nothing any other way (no require, no createRequire, no computed import)', () => {
    for (const f of files) {
      const text = readFileSync(path.join(SRC, f), 'utf8');
      expect(text, f).not.toMatch(/\brequire\(|createRequire|import\(\s*[^'\s]/);
    }
  });
});
