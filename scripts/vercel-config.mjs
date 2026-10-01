// Writes .vercel/output/config.json for the prebuilt deploy (npm run deploy:prod).
// Security headers on every page, then files, then the single-page app fallback.
// The content security policy is deliberately narrow: it forbids framing the site,
// plugins and <base> tricks, which cannot break the app; a full script policy needs
// testing against MUI's inline styles and the contract's WebAssembly first.
// SPDX-License-Identifier: Apache-2.0
import { writeFileSync } from 'node:fs';

const headers = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
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
