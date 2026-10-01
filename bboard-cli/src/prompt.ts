// SPDX-License-Identifier: Apache-2.0
/**
 * The CLI's one readline, and secret input on it without echo.
 *
 * Secrets used to be typed through `rli.question`, which echoes every character to the
 * terminal (and its scrollback). The interface is now built over an output stream that
 * can be muted: askHidden prints the prompt, mutes the stream for exactly the one answer,
 * and unmutes it. One interface on stdin, so there is no second reader to race the first.
 * History is off, so an earlier answer cannot come back with the up arrow.
 */
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { redactThisSession } from './logger-utils.js';

export type Prompt = { readonly rli: Interface; askHidden: (question: string) => Promise<string> };

export const createPrompt = (
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Prompt => {
  let muted = false;
  const screen = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) output.write(chunk);
      done();
    },
  }) as Writable & { columns?: number; rows?: number; isTTY?: boolean };
  // readline sizes its line editing from these.
  Object.defineProperty(screen, 'columns', { get: () => output.columns });
  Object.defineProperty(screen, 'rows', { get: () => output.rows });
  const rli = createInterface({ input, output: screen, terminal: true, historySize: 0 });
  const askHidden = async (question: string): Promise<string> => {
    output.write(question);
    muted = true;
    try {
      return (await rli.question('')).trim();
    } finally {
      muted = false;
      output.write('  (hidden)\n');
    }
  };
  return { rli, askHidden };
};

/**
 * A 32-byte secret typed in hidden: exactly 64 hex characters. Nothing is stripped
 * silently: a leading 0x is refused with a message saying so. The value is added to the
 * session's redaction list, so it can never reach the screen log or the log file.
 */
export const parseSecret32 = (text: string): { value: Uint8Array } | { problem: string } => {
  const t = text.trim();
  if (/^0x/i.test(t)) return { problem: 'Leave out the 0x at the start: type only the 64 hex characters.' };
  if (!/^[0-9a-fA-F]{64}$/.test(t))
    return {
      problem: `That is ${t.length} characters; it must be exactly 64, each 0-9 or a-f. Nothing was sent.`,
    };
  redactThisSession(t);
  return { value: new Uint8Array(Buffer.from(t, 'hex')) };
};

/** A maintenance authority signing key: 64 hex characters, checked the same way. */
export const parseSigningKey = (text: string): { value: string } | { problem: string } => {
  const r = parseSecret32(text);
  return 'problem' in r ? r : { value: text.trim().toLowerCase() };
};
