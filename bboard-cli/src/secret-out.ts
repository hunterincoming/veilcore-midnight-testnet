// SPDX-License-Identifier: Apache-2.0
/**
 * Show a secret to the person at the terminal, and NOWHERE ELSE.
 *
 * The logger writes to the terminal AND to a file under bboard-cli/logs/. Every
 * secret that went through it — wallet seed, genetic secret, recovery secret,
 * maintenance authority key — sat in plain text on disk, in every backup and sync of
 * that folder, for as long as the file existed. These bypass the logger entirely.
 */
import { redactThisSession, writeUnscrubbed } from './logger-utils.js';

export const showSecret = (label: string, value: string): void => {
  // Whatever is shown here (a generated recovery secret, a new record secret, a seed) is
  // also redacted from every log line from now on, like a secret typed in. The screen
  // itself is written past the terminal scrubbing, or the secret would show as [redacted].
  redactThisSession(value);
  writeUnscrubbed(`\n  ${label}\n  ${value}\n  (shown on screen only — not written to any log file)\n\n`);
};
