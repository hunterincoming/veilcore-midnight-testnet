// SPDX-License-Identifier: Apache-2.0
import os from 'node:os';

/**
 * The folder under which .veilcore/ lives: VEILCORE_HOME if set, else the home folder.
 * Lets a second copy of the program (another wallet, for a test) keep its saved state
 * apart without changing HOME, which Docker and npm read too.
 */
export const veilcoreHome = (): string => {
  const v = (process.env.VEILCORE_HOME ?? '').trim();
  return v === '' ? os.homedir() : v;
};
