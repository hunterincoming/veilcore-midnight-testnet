// Download the public proving parameters the browser prover needs (k=13 and k=14, the
// sizes of anchor, proveOwnership and pairDna) into public/params, so the site serves
// them itself: the page's security policy allows only its own origin for these, and the
// site does not depend on a third-party host at proving time.
//
// The files are public and the same for everyone (Midnight publishes them). Each one is
// checked against the SHA-256 pinned in params.sha256.json before it is used: a file
// that does not match is deleted and the script stops. Midnight's own clients do not
// check these files, so the pins are ours.
//
// Usage:
//   node scripts/fetch-params.mjs           download what is missing, check every file
//   node scripts/fetch-params.mjs --pin     first time only: record the SHA-256 of files
//                                           with no pin yet (then commit params.sha256.json)
//
// Not kept in git (public/params is ignored): run this before `npm run build` for a build
// with VITE_REAL_CHAIN=1.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';
const K = [13, 14];
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'params');
const pinsFile = join(here, 'params.sha256.json');
const pinning = process.argv.includes('--pin');

const pins = existsSync(pinsFile) ? JSON.parse(readFileSync(pinsFile, 'utf8')) : {};
mkdirSync(out, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');

let changed = false;
for (const k of K) {
  const name = `bls_midnight_2p${k}`;
  const file = join(out, name);
  let bytes;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    const res = await fetch(`${SOURCE}/${name}`);
    if (!res.ok) throw new Error(`k=${k}: the download answered ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(file, bytes);
  }
  const got = sha(bytes);
  const want = pins[name];
  if (want === undefined) {
    if (!pinning) {
      rmSync(file, { force: true });
      throw new Error(
        `k=${k}: no pinned SHA-256 for ${name} in scripts/params.sha256.json. Run once with --pin, compare the ` +
          'printed value with a second source (the copy the Compact compiler downloaded), and commit the file.',
      );
    }
    pins[name] = got;
    changed = true;
    console.log(`k=${k}: pinned ${got} (${bytes.length} bytes)`);
  } else if (got !== want) {
    rmSync(file, { force: true });
    throw new Error(`k=${k}: ${name} has SHA-256 ${got}, not the pinned ${want}. Deleted; nothing was built.`);
  } else console.log(`k=${k}: ${bytes.length} bytes, SHA-256 matches the pin`);
}
if (changed) writeFileSync(pinsFile, JSON.stringify(pins, null, 2) + '\n');
console.log(`Saved in ${out}. They are copied into dist/params by the build.`);
