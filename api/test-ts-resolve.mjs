// Lets the plain-node tests (test-*.mjs, run with --experimental-strip-types) load the
// sources as the bundlers do: an import of `./x.js` from a source file finds `./x.ts`.
// Only for files outside node_modules, and only when the .js file does not exist.
// SPDX-License-Identifier: Apache-2.0
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (/^\\.{1,2}\\//.test(specifier) && specifier.endsWith('.js') && context.parentURL?.startsWith('file:') && !context.parentURL.includes('/node_modules/')) {
    const js = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(js))) {
      const ts = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
  }
  return next(specifier, context);
}`),
);
