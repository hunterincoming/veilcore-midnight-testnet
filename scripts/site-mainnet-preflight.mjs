// Runs first in `npm run deploy:mainnet`. The mainnet website says records are dated on
// Midnight's main network, so it is built only when that is already true:
//   1. the main contract's address is pinned (api/src/deploy-guard.ts), and
//   2. the registry the site talks to publishes that same contract on mainnet as the
//      place it anchors batches (its /.well-known/veilcore-registry).
// If either is not so, nothing is built or deployed, and it says what to do in plain words.
// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from 'node:url';
import { readMainnetPins, normaliseAddress, TEST_OVERRIDE } from './mainnet-pins.mjs';

export const DEFAULT_API = 'https://veilcore-api-production.up.railway.app';

/**
 * Whether a registry descriptor anchors on mainnet at the pinned contract.
 * @returns {{ ok: true } | { ok: false, problem: string }}
 */
export const checkDescriptor = (descriptor, pinned) => {
  const anchors = Array.isArray(descriptor?.anchors) ? descriptor.anchors : [];
  const mainnet = anchors.filter((a) => a && a.network === 'mainnet');
  if (mainnet.length === 0) {
    const now = anchors.map((a) => a?.network).filter(Boolean);
    return {
      ok: false,
      problem:
        `The registry does not anchor on mainnet yet (it says: ${now.length ? now.join(', ') : 'no anchor set'}). ` +
        'Switch it first: on Railway set VEILCORE_ANCHOR_NETWORK=mainnet and VEILCORE_ANCHOR_CONTRACT to the main ' +
        'contract address, wait for it to redeploy, then run this again.',
    };
  }
  if (!mainnet.some((a) => normaliseAddress(a.contractAddress ?? '') === pinned)) {
    return {
      ok: false,
      problem:
        `The registry anchors on mainnet to ${mainnet.map((a) => a.contractAddress).join(', ')}, but the pinned main ` +
        `contract is ${pinned}. They must be the same. Check VEILCORE_ANCHOR_CONTRACT on Railway against the address ` +
        'on your paper, and ask Claude if they differ.',
    };
  }
  return { ok: true };
};

const fail = (problem) => {
  console.error(`\nNOT DEPLOYED. ${problem}\n`);
  process.exit(1);
};

const main = async () => {
  if (process.env[TEST_OVERRIDE])
    fail(`${TEST_OVERRIDE} is set. It is for tests only; close this Terminal window and open a new one.`);
  const pins = readMainnetPins();
  if (!pins.ok) fail(pins.problem);

  const api = (process.env.VITE_API_BASE || DEFAULT_API).replace(/\/+$/, '');
  let descriptor;
  try {
    const res = await fetch(`${api}/.well-known/veilcore-registry`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`it answered ${res.status}`);
    descriptor = await res.json();
  } catch (e) {
    fail(
      `Could not read the registry at ${api} (${e instanceof Error ? e.message : String(e)}). ` +
        'Check your internet connection and that the registry is up on Railway, then run this again.',
    );
  }
  const verdict = checkDescriptor(descriptor, pins.veilcore);
  if (!verdict.ok) fail(verdict.problem);

  console.log(`Main contract pinned: ${pins.veilcore}`);
  console.log(
    pins.claims
      ? `Claims contract pinned: ${pins.claims}`
      : 'Claims contract: not pinned yet. The site will say it is not on the main network yet.',
  );
  console.log(`Registry ${api} anchors on mainnet to the same contract. Building the mainnet site.`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
