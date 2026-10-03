// The holder key identifies whose records these are. It is generated in the browser and
// sent to VeilCore's registry with every request (x-holder-key), where it is stored to
// find this holder's records. Anyone who has it can read and change those records.
// VeilCore cannot recover it for a holder who loses it.
// SPDX-License-Identifier: Apache-2.0

const KEY = 'veilcore.holder.v1';

const generate = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The current holder key, creating one on first use. */
export const holderKey = (): string => {
  try {
    let k = localStorage.getItem(KEY);
    if (!k) {
      k = generate();
      localStorage.setItem(KEY, k);
    }
    return k;
  } catch {
    return generate(); // private browsing — session-only, records will not persist
  }
};

/** Adopt an existing holder key, e.g. restoring on a new device. */
export const setHolderKey = (k: string): void => {
  localStorage.setItem(KEY, k.trim());
};

/**
 * How this holder is named to anyone else: a one-way hash of the key, the same
 * derivation the registry uses for party ids (lineage/routes.mjs partyId). Exported
 * envelopes and corrections used to carry holderKey().slice(0, 16) — 64 bits of the
 * credential itself, handed to whoever received the file (attack round 11).
 */
export const holderPartyId = async (): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`veilcore:party:${holderKey()}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};
