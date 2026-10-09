// Types for site-mainnet-preflight.mjs, for the site tests.
// SPDX-License-Identifier: Apache-2.0

export declare const DEFAULT_API: string;
export declare const readDescriptor: (
  api: string,
) => Promise<{ ok: true; descriptor: unknown } | { ok: false; problem: string }>;
export declare const checkDescriptor: (
  descriptor: unknown,
  pinned: string,
) => { ok: true } | { ok: false; problem: string };
