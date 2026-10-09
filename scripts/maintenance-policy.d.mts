// Types for maintenance-policy.mjs, so bboard-ui/vite.config.ts and the site tests can import it.
// SPDX-License-Identifier: Apache-2.0

export declare const MAINTENANCE_POLICY: string;
export declare const readPolicyStatus: (
  source?: string,
) =>
  | { ok: true; approved: boolean; status: 'PROPOSED' | 'APPROVED'; line: string }
  | { ok: false; problem: string };
