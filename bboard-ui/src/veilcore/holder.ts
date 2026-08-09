// The holder key identifies whose records these are. It is generated in the browser,
// never leaves it except as an opaque identifier, and is the only thing that can
// retrieve this holder's record set. Losing it means losing access — the same
// trade-off every non-custodial system makes.
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
