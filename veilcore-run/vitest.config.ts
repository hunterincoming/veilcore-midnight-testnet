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
    // The operator code imports the partner kit by its package name; in tests that is the
    // kit's sources, so the kit's chain stand-in (partner-kit/test/local-chain.ts) applies.
    alias: { '@veilcore/contracts': fileURLToPath(new URL('../partner-kit/src/index.ts', import.meta.url)) },
    extensions: ['.ts', '.js'],
    conditions: ['import', 'node', 'default'],
  },
});
