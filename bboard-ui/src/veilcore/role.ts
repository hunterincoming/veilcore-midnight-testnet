// Who is using this.
//
// A breeder and a lab need different things and were being shown the same screen. A
// breeder was offered "receive a cultivar" and "set up as an attester" — controls for a
// job they do not have — while a lab's own record told it to send itself to a lab.
//
// Asked once, changeable later, stored locally. Not a permission system: nothing here
// grants or restricts anything, because the cryptography does that. This only decides
// what to put in front of someone.
//
// SPDX-License-Identifier: Apache-2.0

export type Role = 'breeder' | 'lab' | 'both';

const KEY = 'veilcore.role.v1';

export const getRole = (): Role | null => {
  try {
    const r = localStorage.getItem(KEY);
    return r === 'breeder' || r === 'lab' || r === 'both' ? r : null;
  } catch {
    return null;
  }
};

export const setRole = (r: Role): void => {
  try { localStorage.setItem(KEY, r); } catch { /* private mode */ }
};

/** Whether to show the things a breeder does: log, send, license. */
export const isBreeder = (r: Role | null): boolean => r === 'breeder' || r === 'both' || r === null;

/** Whether to show the things a lab does: receive, attest, retract. */
export const isLab = (r: Role | null): boolean => r === 'lab' || r === 'both';

export const ROLE_COPY: Record<Role, { label: string; blurb: string }> = {
  breeder: {
    label: 'I breed or hold genetics',
    blurb: 'Log cultivars, send samples for testing, and license what you have bred.',
  },
  lab: {
    label: 'I test or receive material',
    blurb: 'Receive samples, confirm what arrived, and return signed reports.',
  },
  both: {
    label: 'Both',
    blurb: 'You breed and you also receive material from others.',
  },
};
