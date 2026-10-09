// Whether the maintenance policy is decided, read from the policy itself.
//
// The mainnet website says who can change the main contract and links to
// docs/maintenance-policy.md. Whether it may call that policy decided is not a separate
// setting: it is the policy's own status line, the one place that says it. The line must
// read either
//   **Status: PROPOSED, ...   (the site says "proposed, not decided")
//   **Status: APPROVED, ...   (the site says the founders have approved it)
// Anything else stops a mainnet build and npm run deploy:mainnet, so a reworded status
// line cannot quietly turn into "decided" or into "proposed".
//
// Used by bboard-ui/vite.config.ts and scripts/site-mainnet-preflight.mjs.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAINTENANCE_POLICY = fileURLToPath(new URL('../docs/maintenance-policy.md', import.meta.url));

/**
 * @param {string} [source] the text of docs/maintenance-policy.md (read from disk when omitted)
 * @returns {{ ok: true, approved: boolean, status: 'PROPOSED' | 'APPROVED', line: string } | { ok: false, problem: string }}
 */
export const readPolicyStatus = (source = readFileSync(MAINTENANCE_POLICY, 'utf8')) => {
  const lines = source.match(/^\*\*Status:[^\n]*/gm) ?? [];
  if (lines.length !== 1) {
    return {
      ok: false,
      problem:
        `docs/maintenance-policy.md should have exactly one line starting "**Status:", and has ${lines.length}. ` +
        'The website reads it to say whether the policy is decided. Ask Claude to fix the status line.',
    };
  }
  const m = lines[0].match(/^\*\*Status: (PROPOSED|APPROVED)\b/);
  if (!m) {
    return {
      ok: false,
      problem:
        `The status line of docs/maintenance-policy.md reads "${lines[0].slice(0, 80)}". The website understands only ` +
        '"**Status: PROPOSED" or "**Status: APPROVED". Ask Claude to fix the status line.',
    };
  }
  return { ok: true, approved: m[1] === 'APPROVED', status: m[1], line: lines[0] };
};
