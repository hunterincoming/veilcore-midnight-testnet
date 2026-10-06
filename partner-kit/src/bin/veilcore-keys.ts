// veilcore-keys: get and check the proving keys, verifier keys and circuits of VeilCore's
// contracts against the fingerprints in the deployment record.
//
//   veilcore-keys fetch [--url <url>] [--to <dir>]   download every file, check each, keep them in <dir>
//   veilcore-keys check --dir <dir>                  check a folder (a build's contract/src/managed, or a fetch)
//
// SPDX-License-Identifier: Apache-2.0

import * as path from 'node:path';
import { DEFAULT_KEYS_URL, type KeySource, checkKeys, defaultCacheDir } from '../keys.js';
import { FINGERPRINTS_BUILT } from '../fingerprints.js';

const USAGE = `Usage:
  veilcore-keys fetch [--url <url>] [--to <dir>]
      Download every key and circuit of both VeilCore contracts, check each against the
      deployment record's fingerprints, and keep them in <dir> (default ${defaultCacheDir()}).
      Then connect with keys: { dir: '<dir>' }.
  veilcore-keys check --dir <dir>
      Check a folder laid out as contract/src/managed (veilcore/keys, veilcore/zkir, and the
      same under veilcore-claims/).`;

const arg = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const main = async (argv: string[]): Promise<number> => {
  const [cmd, ...rest] = argv;
  let source: KeySource;
  if (cmd === 'fetch') {
    const to = path.resolve(arg(rest, '--to') ?? defaultCacheDir());
    source = { url: arg(rest, '--url') ?? DEFAULT_KEYS_URL, cacheDir: to };
    console.log(`Fetching into ${to}`);
  } else if (cmd === 'check' && arg(rest, '--dir') !== undefined) {
    source = { dir: path.resolve(arg(rest, '--dir') as string) };
  } else {
    console.log(USAGE);
    return cmd === undefined || cmd === '--help' ? 0 : 2;
  }
  try {
    const n = await checkKeys(source, { onFile: (f) => console.log(`  ok  ${f}`) });
    console.log(
      `All ${n} files match the deployment record (main contract built at ${FINGERPRINTS_BUILT.veilcore.commit}, ` +
        `claims contract at ${FINGERPRINTS_BUILT['veilcore-claims'].commit}, compiler ${FINGERPRINTS_BUILT.veilcore.compiler}).`,
    );
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
};

process.exitCode = await main(process.argv.slice(2));
