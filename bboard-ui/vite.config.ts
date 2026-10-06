// This file is part of midnightntwrk/example-counter.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { defineConfig, loadEnv, type Plugin } from 'vite';
// The published documents (SPEC, EVIDENCE, INTEGRATING) are vendored in src/docs from an
// exact SDK commit (see src/veilcore/docs.ts); nothing is resolved from a package for them.
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { readMainnetPins } from '../scripts/mainnet-pins.mjs';
import { readPolicyStatus } from '../scripts/maintenance-policy.mjs';

// What the site says about where records are dated depends on the build mode, never on
// hand-edited strings: `--mode mainnet` describes Midnight's main network, every other
// mode a test network (src/config/network.ts, src/config/copy.ts, i18n/en-mainnet.ts).
//
// A mainnet build refuses to start until the main contract's address is pinned in
// api/src/deploy-guard.ts, the one place it is kept (scripts/mainnet-pins.mjs). The
// addresses are shown on the site (display only: nothing in this site sends a
// transaction) and come from that file, not from an environment variable that could say
// something else.
//
// Whether the site may call the maintenance policy decided comes from the policy's own
// status line (docs/maintenance-policy.md, scripts/maintenance-policy.mjs): only
// "**Status: APPROVED" turns off "proposed, not decided", and a status line it cannot
// read stops the build.
const mainnetBuild = (mode: string, command: string) => {
  if (mode !== 'mainnet') return { veilcore: '', claims: '', policyApproved: false };
  const pins = readMainnetPins();
  if (!pins.ok) throw new Error(`\n\nThe mainnet website was not built. ${pins.problem}\n`);
  const policy = readPolicyStatus();
  if (!policy.ok) throw new Error(`\n\nThe mainnet website was not built. ${policy.problem}\n`);
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  if (env.VITE_NETWORK_ID !== 'mainnet') {
    throw new Error(
      '\n\nThe mainnet website was not built: bboard-ui/.env.mainnet must set VITE_NETWORK_ID=mainnet.\n',
    );
  }
  if (command === 'build' && !/^https:\/\//.test(env.VITE_API_BASE ?? '')) {
    throw new Error(
      '\n\nThe mainnet website was not built: VITE_API_BASE (the registry address) is not set. Use npm run deploy:mainnet from the repository folder.\n',
    );
  }
  return { veilcore: pins.veilcore, claims: pins.claims, policyApproved: policy.approved };
};

// The page description search engines and link previews show, by mode.
const DESCRIPTION = {
  test: 'An open record format for plant and animal genetics. Seal a record on your own computer; only its fingerprint is dated on Midnight. Pre-launch: tested on a Midnight test network, no independent audit yet.',
  mainnet:
    "An open record format for plant and animal genetics. Seal a record on your own computer; only its fingerprint is dated, on Midnight's main network. Free to check. No independent audit yet.",
};

const siteDescription = (mode: string): Plugin => ({
  name: 'veilcore-site-description',
  transformIndexHtml: (html) =>
    html.replace('%VEILCORE_DESCRIPTION%', mode === 'mainnet' ? DESCRIPTION.mainnet : DESCRIPTION.test),
});

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const pins = mainnetBuild(mode, command);
  return {
    cacheDir: './.vite',
    build: {
      target: 'esnext',
      minify: false,
      // No source maps in the published bundle.
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // Separate chunk for WASM modules to avoid top-level await issues
            if (id.includes('onchain-runtime-v3')) return 'wasm';
          },
        },
      },
      commonjsOptions: {
        // Transform CommonJS to ESM more aggressively
        transformMixedEsModules: true,
        extensions: ['.js', '.cjs'],
        // Needed for Node.js modules
        ignoreDynamicRequires: true,
      },
    },
    plugins: [
      siteDescription(mode),
      react(),
      // Configure WASM plugin with more options
      wasm(),
      topLevelAwait({
        // Be more permissive with top-level await
        promiseExportName: '__tla',
        promiseImportName: (i) => `__tla_${i}`,
      }),
      // Custom resolver for handling problematic modules
      {
        name: 'wasm-module-resolver',
        resolveId(source, importer) {
          // Special handling for the problematic module
          if (
            source === '@midnight-ntwrk/onchain-runtime-v3' &&
            importer &&
            importer.includes('@midnight-ntwrk/compact-runtime')
          ) {
            // Force dynamic import for this case
            return {
              id: source,
              external: false,
              moduleSideEffects: true,
            };
          }
          return null;
        },
      },
    ],
    optimizeDeps: {
      rolldownOptions: {
        target: 'esnext',
        supported: { 'top-level-await': true },
        // Configure ESBuild to handle Node.js-style modules
        platform: 'browser',
        format: 'esm',
        loader: {
          '.wasm': 'binary',
        },
      },
      // Explicitly include these packages for pre-bundling, but force ESM
      include: ['@midnight-ntwrk/compact-runtime'],
      // Exclude WASM files and modules with top-level await from optimization
      exclude: [
        '@midnight-ntwrk/onchain-runtime-v3',
        '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
        '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
      ],
    },
    define: {
      'import.meta.env.VITE_MAINNET_CONTRACT_ADDRESS': JSON.stringify(pins.veilcore),
      'import.meta.env.VITE_MAINNET_CLAIMS_ADDRESS': JSON.stringify(pins.claims),
      'import.meta.env.VITE_MAINTENANCE_POLICY_APPROVED': JSON.stringify(pins.policyApproved ? 'true' : ''),
    },
    checks: {
      importIsUndefined: false,
      pluginTimings: false,
    },
    // Add specific import configuration for more control
    resolve: {
      // Ensure WASM files are loaded properly
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
      mainFields: ['browser', 'module', 'main'],
    },
  };
});
