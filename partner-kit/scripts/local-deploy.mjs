// Runs scripts/local-deploy.ts: bundled first (it imports the repository's TypeScript),
// into a scratch file that is removed afterwards.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(pkg, '.local-deploy-'));
const out = path.join(dir, 'local-deploy.mjs');
try {
  await build({
    entryPoints: [path.join(pkg, 'scripts', 'local-deploy.ts')],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    logLevel: 'warning',
  });
  const { default: main } = await import(pathToFileURL(out).href);
  await main(pkg);
  process.exitCode = 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(), 3_000).unref();
}
