// Writes .vercel/output/config.json for the prebuilt deploy (npm run deploy:prod).
// Security headers on every page, then files, then the single-page app fallback.
// SPDX-License-Identifier: Apache-2.0
import { writeFileSync } from 'node:fs';

// The registry API the site talks to. Must match the VITE_API_BASE the site was built
// with (deploy:prod sets it on the build step), or every API call is blocked by
// connect-src below. Override with VEILCORE_API_ORIGIN when deploying against another.
const API_ORIGIN = new URL(
  process.env.VEILCORE_API_ORIGIN || process.env.VITE_API_BASE || 'https://veilcore-api-production.up.railway.app',
).origin;

// Real-chain builds (VITE_REAL_CHAIN=1, see bboard-ui/src/veilcore/chain/config.ts) also
// talk to Midnight's indexer (https and wss) and to VeilCore's sponsor service. Proofs
// are made in a worker from this site's own /keys, /zkir and /params, so nothing else
// is needed. A build without the flag gets exactly the policy below and nothing more.
const REAL_CHAIN = process.env.VITE_REAL_CHAIN === '1';
const chainOrigins = [];
if (REAL_CHAIN) {
  const sponsor = process.env.VITE_SPONSOR_URL;
  if (!sponsor) throw new Error('VITE_REAL_CHAIN=1 needs VITE_SPONSOR_URL (the sponsor service), or the site cannot reach it.');
  const network = (process.env.VITE_NETWORK_ID || 'preprod').toLowerCase();
  if (network === 'mainnet') throw new Error('VITE_REAL_CHAIN=1 is for a test network only.');
  const indexer = new URL(process.env.VITE_INDEXER_URL || `https://indexer.${network}.midnight.network/api/v4/graphql`);
  const indexerWs = new URL(process.env.VITE_INDEXER_WS_URL || `wss://indexer.${network}.midnight.network/api/v4/graphql/ws`);
  chainOrigins.push(new URL(sponsor).origin, indexer.origin, `${indexerWs.protocol}//${indexerWs.host}`);
}

// The content security policy. Checked against the built site in headless Chromium
// (every page, zero violations) before it was tightened from the old
// frame/plugin/base-only policy:
//   script-src   only our own bundles. 'wasm-unsafe-eval' lets the Midnight on-chain
//                runtime compile its WebAssembly; it does not allow eval() of strings.
//   style-src    MUI and Emotion inject <style> tags at runtime, so 'unsafe-inline' is
//                needed for styles (not for scripts).
//   font-src     the Inter and Space Grotesk files are bundled by @fontsource; no
//                Google Fonts. data: for any small font Vite inlines.
//   img-src      data: and blob: for QR codes and certificate images (html-to-image).
//   connect-src  our own origin (the .wasm file and docs), the registry API, and
//                raw.githubusercontent.com, which DocPage reads the spec documents from.
//                If the app starts talking to a Midnight wallet's indexer or proof
//                server, those origins have to be added here.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${API_ORIGIN} https://raw.githubusercontent.com${chainOrigins.length ? ` ${chainOrigins.join(' ')}` : ''}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

export const headers = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': csp,
};

writeFileSync(
  '.vercel/output/config.json',
  JSON.stringify(
    {
      version: 3,
      routes: [{ src: '/(.*)', headers, continue: true }, { handle: 'filesystem' }, { src: '/.*', dest: '/index.html' }],
    },
    null,
    2,
  ),
);
console.log('wrote .vercel/output/config.json');
