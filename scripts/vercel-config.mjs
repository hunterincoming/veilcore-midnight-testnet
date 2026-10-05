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

// The content security policy. Checked against the built site in headless Chromium
// (every main page, zero violations; bboard-ui/src/hardening-roundD.test.ts) before each
// tightening:
//   script-src   only our own bundles. 'wasm-unsafe-eval' lets the Midnight on-chain
//                runtime compile its WebAssembly; it does not allow eval() of strings.
//   style-src    MUI and Emotion inject <style> tags at runtime, so 'unsafe-inline' is
//                needed for styles (not for scripts). Rendered documents can no longer
//                carry style attributes (DocPage forbids them), which is what made this
//                a phishing-overlay risk.
//   font-src     the Inter and Space Grotesk files are bundled by @fontsource; no
//                Google Fonts. data: for any small font Vite inlines.
//   img-src      data: and blob: for QR codes and certificate images (html-to-image).
//   connect-src  our own origin (the .wasm file) and the registry API. Nothing on GitHub:
//                the documents are bundled at build time now (attack round D), and the
//                old entry allowed every repository on raw.githubusercontent.com. If the
//                app starts talking to a Midnight indexer or proof server, those origins
//                have to be added here.
//   Trusted Types  the one HTML sink (DocPage) goes through a policy that sanitises, so
//                no other code can hand a string to innerHTML and have it run.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${API_ORIGIN}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  // 'self', not 'none': html-to-image sets a same-origin <base> while it inlines the
  // fonts for the certificate PNG.
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "require-trusted-types-for 'script'",
  // veilcore-docs: DocPage's sanitising policy. dompurify: the policy DOMPurify makes for
  // its own parsing, created once when it loads.
  'trusted-types veilcore-docs dompurify',
  'upgrade-insecure-requests',
].join('; ');

export const headers = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': csp,
  // Vercel adds HSTS on its own domains; whether it does on the veilcore.org alias was
  // not verified, so it is set here. Two years, subdomains included. Not "preload": that
  // is a submission to browser vendors and hard to undo, so it is Hunter's call.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  // No other origin gets a handle on a veilcore.org window, where the keys live.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
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
