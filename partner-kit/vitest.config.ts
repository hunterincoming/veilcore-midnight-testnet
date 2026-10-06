// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 5 * 60_000,
    hookTimeout: 5 * 60_000,
  },
  resolve: {
    // The examples import the package by name; in tests that is the sources (so the
    // chain stand-in in test/local-chain.ts applies to them too).
    alias: { '@veilcore/contracts': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    extensions: ['.ts', '.js'],
    conditions: ['import', 'node', 'default'],
  },
});
