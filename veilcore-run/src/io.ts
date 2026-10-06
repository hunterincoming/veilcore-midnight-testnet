// The terminal: questions, hidden questions, and output that never carries a secret.
// SPDX-License-Identifier: Apache-2.0

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { errorChain } from '@veilcore/contracts';

export type Io = {
  /** Print a line. Every line goes through `scrub` in the CLI first. */
  print(s: string): void;
  ask(question: string): Promise<string>;
  /** Read a line without showing it. */
  askHidden(question: string): Promise<string>;
};

const read = (question: string, hidden: boolean): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(`Asked "${question.trim()}", but there is no terminal to type it in.`));
      return;
    }
    const muted = new Writable({ write: (_c, _e, done) => done() });
    const rl = createInterface({ input: process.stdin, output: hidden ? muted : process.stdout, terminal: true });
    if (hidden) process.stdout.write(question);
    rl.question(hidden ? '' : question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('Stopped.'));
    });
  });

export const terminalIo: Io = {
  print: (s) => void process.stdout.write(s + '\n'),
  ask: (q) => read(q, false),
  askHidden: (q) => read(q, true),
};

/**
 * Replace every known secret in `text` with [redacted]: hex secrets in any case, and
 * passwords as typed. Secrets shorter than 8 characters are not looked for.
 */
export const scrub = (text: string, secrets: Iterable<string>): string => {
  let out = text;
  for (const s of secrets) {
    if (s.length < 8) continue;
    const hex = /^[0-9a-fA-F]+$/.test(s);
    out = out.replace(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), hex ? 'gi' : 'g'), '[redacted]');
  }
  return out;
};

/** An error, as the operator sees it: every cause, de-duplicated, with any secret removed. */
export const describeError = (e: unknown, secrets: Iterable<string>): string =>
  scrub(
    errorChain(e)
      .filter((t) => !/^[A-Za-z]*Error$/.test(t)) // class names; the messages say what happened
      .join('\n  cause: '),
    secrets,
  );
