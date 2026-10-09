// Runs first in `npm run deploy:prod`, the test-network website. That site says records are
// dated on a Midnight test network. Once the registry anchors on mainnet, that is no longer
// true, and deploying it would put the old wording back on veilcore.org over the mainnet
// site. So it refuses as soon as the registry's /.well-known/veilcore-registry lists a
// mainnet anchor, and says to use npm run deploy:mainnet instead.
//
// If the registry cannot be read, it refuses too: it cannot tell which site is right.
// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from "node:url";
import { DEFAULT_API, readDescriptor } from "./site-mainnet-preflight.mjs";

/**
 * Whether the test-network site may be deployed against this registry descriptor.
 * @returns {{ ok: true } | { ok: false, problem: string }}
 */
export const checkTestSiteAllowed = (descriptor) => {
  if (!Array.isArray(descriptor?.anchors)) {
    return {
      ok: false,
      problem:
        "The registry descriptor has no list of anchors, so it cannot be told whether the registry " +
        "anchors on mainnet. Not deploying the test-network site over what may be the mainnet site.",
    };
  }
  const isMainnet = (a) =>
    typeof a?.network === "string" &&
    a.network.trim().toLowerCase() === "mainnet";
  if (descriptor.anchors.some(isMainnet)) {
    return {
      ok: false,
      problem:
        "The registry anchors on mainnet now, so veilcore.org must stay the mainnet site. " +
        'deploy:prod builds the test-network site and would put the old "test network" wording back. ' +
        "Use npm run deploy:mainnet instead.",
    };
  }
  return { ok: true };
};

const fail = (problem) => {
  console.error(`\nNOT DEPLOYED. ${problem}\n`);
  process.exit(1);
};

const main = async () => {
  const api = (process.env.VITE_API_BASE || DEFAULT_API).replace(/\/+$/, "");
  const read = await readDescriptor(api);
  if (!read.ok) fail(read.problem);
  const verdict = checkTestSiteAllowed(read.descriptor);
  if (!verdict.ok) fail(verdict.problem);
  console.log(
    `Registry ${api} does not anchor on mainnet. Building the test-network site.`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
