// Types for site-prod-preflight.mjs, for the site tests.
// SPDX-License-Identifier: Apache-2.0

export declare const checkTestSiteAllowed: (descriptor: unknown) => { ok: true } | { ok: false; problem: string };
