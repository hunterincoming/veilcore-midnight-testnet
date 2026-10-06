// Types for site-mainnet-preflight.mjs, for the site tests.
// SPDX-License-Identifier: Apache-2.0

export declare const DEFAULT_API: string;
export declare const checkDescriptor: (
  descriptor: unknown,
  pinned: string,
) => { ok: true } | { ok: false; problem: string };
