// Download the public proving parameters the browser prover needs (k=13 and k=14, the
// sizes of anchor, proveOwnership and pairDna) into public/params, so the site serves
// them itself: the page's security policy allows only its own origin for these, and the
// site does not depend on a third-party host at proving time.
//
// The files are public and the same for everyone (Midnight publishes them). Not kept in
// git: run this once before `npm run build` for a real-chain deploy.
//
// Usage: node scripts/fetch-params.mjs
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';
const K = [13, 14];
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'params');
mkdirSync(out, { recursive: true });

for (const k of K) {
  const file = join(out, `bls_midnight_2p${k}`);
  if (existsSync(file)) {
    console.log(`k=${k}: already here (${readFileSync(file).length} bytes)`);
    continue;
  }
  const res = await fetch(`${SOURCE}/bls_midnight_2p${k}`);
  if (!res.ok) throw new Error(`k=${k}: the download answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  console.log(`k=${k}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
console.log(`Saved in ${out}. They are copied into dist/params by the build.`);
