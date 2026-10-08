// The mainnet contract addresses, read from the one place they are pinned:
// MAINNET_VEILCORE_ADDRESS and MAINNET_CLAIMS_ADDRESS in api/src/deploy-guard.ts.
//
// The operator tool imports that file directly. The website cannot (it pulls in Node-only
// Midnight code), so the site's build reads the two constants from the file's text here.
// There is no second copy to keep in step: a test (bboard-ui/src/site-mainnet.test.ts)
// checks that what this reads is exactly what the TypeScript module exports.
//
// Used by bboard-ui/vite.config.ts (a mainnet build refuses to start without the main
// contract's address) and by scripts/site-mainnet-preflight.mjs (npm run deploy:mainnet).
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEPLOY_GUARD = fileURLToPath(
  new URL("../api/src/deploy-guard.ts", import.meta.url),
);

/**
 * Tests only: a stand-in for deploy-guard.ts, so a build can be tried with a made-up
 * address without editing the real pin. npm run deploy:mainnet refuses to run while it is set.
 */
export const TEST_OVERRIDE = "VEILCORE_TEST_DEPLOY_GUARD";

/** 32 bytes of hex, with or without 0x, any case. */
const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;

/** Lower case, no 0x: the form the site shows and compares. */
export const normaliseAddress = (a) =>
  String(a).trim().toLowerCase().replace(/^0x/, "");

/** The string value of `export const NAME = '...'` in the file's text, or null if the line is missing. */
const constantIn = (source, name) => {
  const m = source.match(
    new RegExp(
      `^export const ${name}(?:\\s*:\\s*string)?\\s*=\\s*(['"\`])([^'"\`]*)\\1\\s*;`,
      "m",
    ),
  );
  return m ? m[2] : null;
};

/**
 * Both pins, checked. `veilcore` is required for a mainnet site; `claims` may still be
 * empty (the claims contract deploys after the main one, and the site then says it is
 * not on the main network yet).
 *
 * @param {string} [source] the text of deploy-guard.ts (read from disk when omitted)
 * @returns {{ ok: true, veilcore: string, claims: string } | { ok: false, problem: string }}
 */
export const readMainnetPins = (
  source = readFileSync(process.env[TEST_OVERRIDE] || DEPLOY_GUARD, "utf8"),
) => {
  const veilcore = constantIn(source, "MAINNET_VEILCORE_ADDRESS");
  const claims = constantIn(source, "MAINNET_CLAIMS_ADDRESS");
  if (veilcore === null || claims === null) {
    return {
      ok: false,
      problem:
        "Could not find MAINNET_VEILCORE_ADDRESS and MAINNET_CLAIMS_ADDRESS in api/src/deploy-guard.ts. " +
        "The file has changed shape; ask Claude to update scripts/mainnet-pins.mjs.",
    };
  }
  if (veilcore.trim() === "") {
    return {
      ok: false,
      problem:
        "The main contract address is not pinned yet (MAINNET_VEILCORE_ADDRESS in api/src/deploy-guard.ts is empty). " +
        'The website will not say "main network" until the contract exists. Send Claude the address the deploy ' +
        "printed, wait for the pin commit, run git pull, then try again.",
    };
  }
  if (!HEX64.test(veilcore.trim())) {
    return {
      ok: false,
      problem: `MAINNET_VEILCORE_ADDRESS in api/src/deploy-guard.ts is "${veilcore}", which is not a contract address (64 hexadecimal characters). Ask Claude to fix the pin.`,
    };
  }
  if (claims.trim() !== "" && !HEX64.test(claims.trim())) {
    return {
      ok: false,
      problem: `MAINNET_CLAIMS_ADDRESS in api/src/deploy-guard.ts is "${claims}", which is not a contract address (64 hexadecimal characters). Ask Claude to fix the pin.`,
    };
  }
  return {
    ok: true,
    veilcore: normaliseAddress(veilcore),
    claims: claims.trim() ? normaliseAddress(claims) : "",
  };
};
