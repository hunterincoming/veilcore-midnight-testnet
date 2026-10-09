// This file is part of midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import pinoPretty from 'pino-pretty';
import pino from 'pino';
import { createWriteStream } from 'node:fs';

/**
 * A destination that replaces every secret in each finished log line before passing it
 * on. Scrubbing the serialised line, rather than each argument, also covers child
 * loggers' bindings, Errors and objects that cannot be turned into JSON.
 */
const scrubbing = (secrets: readonly string[], target: { write: (line: string) => unknown }) => ({
  write: (line: string): void => {
    void target.write(scrub(line, secrets));
  },
});

/** Secrets typed in during this session (keys, seeds, recovery and licence secrets). */
const typedHex = new Set<string>();
const typedText = new Set<string>();

/**
 * Add a secret typed or shown in this session to what every logger created here redacts,
 * from now on. Hex of 32 characters or more (a 64-hex key or secret, a 128-hex wallet
 * seed) is redacted whatever its case, so an error message that quotes it back in another
 * form (compact-js upper- or lower-cases) is caught too.
 */
export const redactThisSession = (value: string): void => {
  const t = value.trim();
  const h = t.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]+$/.test(h) && h.length >= 32) typedHex.add(h.toLowerCase());
  else if (t.length >= 8) typedText.add(t);
};

/** One log line with every configured and typed secret replaced by [redacted]. */
export const scrub = (line: string, secrets: readonly string[] = []): string => {
  // Lines arrive as JSON, where " and \ are escaped: match that form too.
  const forms = (t: string): string[] => [t, JSON.stringify(t).slice(1, -1)];
  let out = secrets.flatMap(forms).reduce((acc, sec) => acc.split(sec).join('[redacted]'), line);
  for (const h of typedHex) out = out.replace(new RegExp(h, 'gi'), '[redacted]');
  for (const t of [...typedText].flatMap(forms)) out = out.split(t).join('[redacted]');
  return out;
};

/**
 * A logger for the terminal and a log file. `secrets` (for example an API token carried
 * in a URL) are replaced in everything logged, by this logger and its children, before
 * it reaches either.
 */
export const createLogger = async (logPath: string, secrets: readonly string[] = []): Promise<pino.Logger> => {
  await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  // Readable by its owner only (0600), even if the file already existed with wider rights.
  await fs.writeFile(logPath, '', { flag: 'a', mode: 0o600 });
  await fs.chmod(logPath, 0o600);
  const pretty: pinoPretty.PrettyStream = pinoPretty({
    colorize: true,
    sync: true,
  });
  const level =
    process.env.DEBUG_LEVEL !== undefined && process.env.DEBUG_LEVEL !== null && process.env.DEBUG_LEVEL !== ''
      ? process.env.DEBUG_LEVEL
      : 'info';
  const wanted = secrets.filter((x) => x.length > 0);
  return pino(
    { level, depthLimit: 20 },
    pino.multistream([
      { stream: scrubbing(wanted, pretty), level },
      { stream: scrubbing(wanted, createWriteStream(logPath, { mode: 0o600 })), level },
    ]),
  );
};

let stdioScrubbed = false;
/** The terminal's own write, from before scrubTerminal wrapped it. */
let unscrubbedStdout: ((chunk: string) => boolean) | undefined;

/**
 * Write to the terminal past scrubTerminal: for showSecret alone, whose whole purpose is
 * to show the person at the terminal a secret that every log line redacts.
 */
export const writeUnscrubbed = (text: string): boolean =>
  (unscrubbedStdout ?? ((t: string) => process.stdout.write(t)))(text);

/**
 * Scrub everything written to the terminal, not only what this logger writes. Libraries
 * print through console on their own: polkadot's websocket provider, for one, prints
 * "disconnected from wss://…?project_id=<id>" on every reconnect, past the logger. With
 * this, the configured secrets and anything typed in this session are replaced there too.
 */
export const scrubTerminal = (secrets: readonly string[]): void => {
  if (stdioScrubbed) return;
  stdioScrubbed = true;
  const wanted = secrets.filter((x) => x.length > 0);
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    if (stream === process.stdout) unscrubbedStdout = (t: string) => write(t);
    stream.write = (chunk: unknown, ...rest: unknown[]): boolean => {
      if (typeof chunk === 'string') return write(scrub(chunk, wanted), ...rest);
      if (chunk instanceof Uint8Array) {
        const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        const text = bytes.toString('utf8');
        // Only a chunk that is whole UTF-8 is rewritten; one cut mid-character passes as is.
        if (Buffer.from(text, 'utf8').equals(bytes)) return write(scrub(text, wanted), ...rest);
      }
      return write(chunk, ...rest);
    };
  }
};
