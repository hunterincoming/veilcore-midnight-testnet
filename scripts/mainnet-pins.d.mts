// Types for mainnet-pins.mjs, so bboard-ui/vite.config.ts and the site tests can import it.
// SPDX-License-Identifier: Apache-2.0

export declare const DEPLOY_GUARD: string;
export declare const TEST_OVERRIDE: string;
export declare const normaliseAddress: (a: string) => string;
export declare const readMainnetPins: (
  source?: string,
) => { ok: true; veilcore: string; claims: string } | { ok: false; problem: string };
