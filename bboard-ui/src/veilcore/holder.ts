// The holder key identifies whose records these are. It is generated in the browser and
// sent to VeilCore's registry with every request (x-holder-key), where it is stored to
// find this holder's records. Anyone who has it can read and change those records.
// VeilCore cannot recover it for a holder who loses it.
//
// A key is made only when someone first saves something (attack round D). It used to be
// made on any page load, so every visitor, including someone who only scanned a
// certificate's QR code, got a persistent identifier sent to the API every 20 seconds.
// SPDX-License-Identifier: Apache-2.0

const KEY = 'veilcore.holder.v1';
// Case-insensitive: restores accepted upper case before, and the stored key is sent as
// stored, so an existing key must keep reading as one.
const HEX64 = /^[0-9a-f]{64}$/i;

const generate = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Session-only key for a browser that cannot store one (private browsing). */
let sessionKey: string | null = null;

/** The key this browser already has, or null. Never creates one. */
export const holderKeyIfAny = (): string | null => {
  try {
    const k = localStorage.getItem(KEY);
    return k && HEX64.test(k) ? k : sessionKey;
  } catch {
    return sessionKey;
  }
};

/** The current holder key, creating one. Call only when the holder is saving something. */
export const holderKey = (): string => {
  const existing = holderKeyIfAny();
  if (existing) return existing;
  const k = generate();
  try {
    localStorage.setItem(KEY, k);
  } catch {
    sessionKey = k; // private browsing — session-only, records will not persist
  }
  return k;
};

/** Adopt an existing holder key, e.g. restoring on a new device. */
export const setHolderKey = (k: string): void => {
  const v = k.trim();
  if (!HEX64.test(v)) throw new Error('A holder key is 64 hexadecimal characters.');
  localStorage.setItem(KEY, v);
};

/**
 * Stop using the current key in this browser. Nothing on the registry changes: the
 * records stay there under the old key and come back only with it.
 */
export const forgetHolderKey = (): void => {
  sessionKey = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

/** Save the key as a text file, so it can be restored on another device. */
export const downloadHolderKey = (key: string): void => {
  const blob = new Blob(
    [
      'VeilCore holder key\n\n',
      `${key}\n\n`,
      "This key is how you get back to your records. VeilCore's server receives it\n",
      'with every save and stores it to find your records. Anyone with this key can\n',
      'read and change your records. We cannot recover it for you, so store it\n',
      'somewhere safe.\n',
    ],
    { type: 'text/plain' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'veilcore-holder-key.txt';
  a.click();
  URL.revokeObjectURL(url);
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
