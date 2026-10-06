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

import { useSyncExternalStore } from 'react';

export type Role = 'breeder' | 'lab' | 'both';

const KEY = 'veilcore.role.v1';

// Screens that show or hide things by role follow a change at once, rather than on the
// next page load (a lab used to see the breeder's screen until it navigated).
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

/** The current role, kept up to date. */
export const useRole = (): Role | null => useSyncExternalStore(subscribe, getRole, () => null);

/** Ask the role picker to open again (the "change" link in the app footer). */
export const CHANGE_ROLE_EVENT = 'veilcore:change-role';
export const requestRoleChange = (): void => {
  window.dispatchEvent(new Event(CHANGE_ROLE_EVENT));
};

export const getRole = (): Role | null => {
  try {
    const r = localStorage.getItem(KEY);
    return r === 'breeder' || r === 'lab' || r === 'both' ? r : null;
  } catch {
    return null;
  }
};

export const setRole = (r: Role): void => {
  try {
    localStorage.setItem(KEY, r);
  } catch {
    /* private mode */
  }
  notify();
};

/** Whether to show the things a breeder does: log, send, license. */
export const isBreeder = (r: Role | null): boolean => r === 'breeder' || r === 'both' || r === null;

/** Whether to show the things a lab does: receive, attest, retract. */
export const isLab = (r: Role | null): boolean => r === 'lab' || r === 'both';

export const ROLE_COPY: Record<Role, { label: string; blurb: string }> = {
  breeder: {
    label: 'I breed or hold genetics',
    blurb: 'Seal records of what you hold, send samples to labs, and license what you have bred.',
  },
  lab: {
    label: 'I run a lab or receive material',
    blurb: 'Receive material from clients, confirm what arrived, and sign your reports with your own key.',
  },
  both: {
    label: 'Both',
    blurb: 'You breed, and you also receive material from others.',
  },
};

/** Short names for the footer's "change" link. */
export const ROLE_VIEW: Record<Role, string> = {
  breeder: 'Breeder view',
  lab: 'Lab view',
  both: 'Breeder and lab view',
};
