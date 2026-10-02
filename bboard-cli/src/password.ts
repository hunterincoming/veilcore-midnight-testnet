// SPDX-License-Identifier: Apache-2.0
/**
 * The private-state password, checked at startup with the same rule midnight-js applies
 * when it opens the store (validatePassword). Checking only the length let through
 * passwords midnight-js then refused after the sync, an hour or more in.
 */
import { PasswordValidationError, validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { type Logger } from 'pino';
import { redactThisSession } from './logger-utils.js';

/** Null when midnight-js will accept the password; otherwise what to fix, in plain words. */
export const passwordProblem = (password: string): string | null => {
  try {
    validatePassword(password);
    return null;
  } catch (e) {
    const reason = e instanceof PasswordValidationError ? e.reason : undefined;
    switch (reason) {
      case 'missing':
        return 'No password was given.';
      case 'too_short':
        return `It is ${password.length} characters; it needs 16 or more.`;
      case 'repeated_characters':
        return 'It has the same character more than 3 times in a row (like "aaaa").';
      case 'insufficient_classes':
        return 'It needs at least 3 of these 4: capital letters, small letters, numbers, symbols.';
      case 'sequential_pattern':
        return 'It has 4 or more characters in a row in order, like "1234", "abcd" or "dcba".';
      default:
        return 'midnight-js does not accept it as a password.';
    }
  }
};

export const PASSWORD_RULES =
  'The password needs: 16 or more characters; at least 3 of capital letters, small letters, ' +
  'numbers and symbols; no character more than 3 times in a row; no run of 4 in order like 1234 or abcd.';

/**
 * The private-state password, settled before anything starts: from
 * VEILCORE_PRIVATE_STATE_PASSWORD, or typed (hidden) twice. Either way it must pass the
 * rule midnight-js applies when it opens the store, or nothing is started. Returns false
 * when the CLI should stop.
 */
export const settlePassword = async (ask: (q: string) => Promise<string>, logger: Logger): Promise<boolean> => {
  const fromEnv = process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
  if (fromEnv) {
    const problem = passwordProblem(fromEnv);
    if (problem !== null) {
      logger.error(`The password in VEILCORE_PRIVATE_STATE_PASSWORD will not be accepted: ${problem}`);
      logger.error(PASSWORD_RULES);
      logger.error('Nothing was started.');
      return false;
    }
    redactThisSession(fromEnv);
    // Said, so nobody wonders why they were not asked; the value itself is never shown.
    logger.info('Using the password from VEILCORE_PRIVATE_STATE_PASSWORD.');
    return true;
  }
  const typed = await ask('Private-state password (paste it, nothing will show, then press Enter): ');
  const problem = passwordProblem(typed);
  if (problem !== null) {
    logger.error(`That password will not be accepted: ${problem}`);
    logger.error(PASSWORD_RULES);
    logger.error('Nothing was started.');
    return false;
  }
  const again = await ask('The same password again, to check it: ');
  if (again !== typed) {
    logger.error('The two passwords are different. Nothing was started.');
    return false;
  }
  redactThisSession(typed);
  process.env.VEILCORE_PRIVATE_STATE_PASSWORD = typed;
  return true;
};
