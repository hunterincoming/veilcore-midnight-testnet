// Unit tests run in Node, without the browser build's plugins. The real-chain flag and a
// test contract address are set here so the chain module is exercised; nothing in the
// tests reaches a network (fetch and the indexer are stand-ins).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    env: {
      VITE_NETWORK_ID: 'preprod',
      VITE_API_BASE: 'https://registry.test',
      VITE_REAL_CHAIN: '1',
      VITE_REAL_CHAIN_CONTRACT_ADDRESS: 'c0'.repeat(32),
      VITE_SPONSOR_URL: 'https://sponsor.test',
    },
  },
});
