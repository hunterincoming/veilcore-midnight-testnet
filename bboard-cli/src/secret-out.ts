// SPDX-License-Identifier: Apache-2.0
/**
 * Show a secret to the person at the terminal, and NOWHERE ELSE.
 *
 * The logger writes to the terminal AND to a file under bboard-cli/logs/. Every
 * secret that went through it — wallet seed, genetic secret, recovery secret,
 * maintenance authority key — sat in plain text on disk, in every backup and sync of
 * that folder, for as long as the file existed. These bypass the logger entirely.
 */
export const showSecret = (label: string, value: string): void => {
  process.stdout.write(`\n  ${label}\n  ${value}\n  (shown on screen only — not written to any log file)\n\n`);
};
