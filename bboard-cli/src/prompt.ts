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

export type Prompt = {
  readonly rli: Interface;
  askHidden: (question: string) => Promise<string>;
  /**
   * Hidden, over as many lines as it takes: keeps reading until `enough` says so or an
   * empty line is entered. Lines pasted together all land here, none at the next prompt.
   * `progress` may return a line to show between lines (it must not show the answer).
   */
  askHiddenLines: (
    question: string,
    enough: (lines: readonly string[]) => boolean,
    progress: (lines: readonly string[]) => string | undefined,
  ) => Promise<string[]>;
  /** True while a question (shown or hidden) is waiting for an answer. */
  asking: () => boolean;
};

/** The prompt was closed (Ctrl+C, or the input ended) while waiting for an answer. */
export class PromptClosedError extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'PromptClosedError';
  }
}

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

  // Every question is counted, and rejected if the prompt closes under it (Node 22 leaves
  // it pending for ever), so Ctrl+C at a prompt unwinds through the normal clean-up.
  let waiting = 0;
  const onClose = new Set<() => void>();
  rli.on('close', () => {
    for (const f of [...onClose]) f();
    onClose.clear();
  });
  const question = rli.question.bind(rli);
  const counted = (query: string, options?: { signal?: AbortSignal }): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const closed = (): void => reject(new PromptClosedError());
      onClose.add(closed);
      waiting++;
      question(query, options ?? {})
        .then(resolve, reject)
        .finally(() => {
          onClose.delete(closed);
          waiting--;
        });
    });
  (rli as { question: typeof counted }).question = counted;

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

  const askHiddenLines: Prompt['askHiddenLines'] = (question, enough, progress) =>
    new Promise<string[]>((resolve, reject) => {
      output.write(question);
      muted = true;
      waiting++;
      const lines: string[] = [];
      // No readline question is pending while this collects, so every line, however many
      // arrive in one paste, comes as a 'line' event here and nowhere else.
      const finish = (): void => {
        rli.off('line', onLine);
        onClose.delete(closed);
        waiting--;
        muted = false;
        output.write('  (hidden)\n');
      };
      const closed = (): void => {
        finish();
        reject(new PromptClosedError());
      };
      const onLine = (line: string): void => {
        const t = line.trim();
        if (t === '') {
          finish();
          resolve(lines);
          return;
        }
        lines.push(t);
        if (enough(lines)) {
          finish();
          resolve(lines);
          return;
        }
        const p = progress(lines);
        if (p !== undefined) output.write(`\n  ${p}\n`);
      };
      onClose.add(closed);
      rli.on('line', onLine);
    });

  return { rli, askHidden, askHiddenLines, asking: () => waiting > 0 };
};

/** A 64-hex key shown in groups of 8, easier to copy onto paper and to read back. */
export const groupKey = (key: string): string => (key.match(/.{1,8}/g) ?? []).join(' ');

/** A key typed back from paper: the same hex, any case, spaces or dashes between groups allowed. */
export const sameKey = (typed: string, key: string): boolean =>
  typed.replace(/[\s-]/g, '').toLowerCase() === key.trim().toLowerCase();

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
