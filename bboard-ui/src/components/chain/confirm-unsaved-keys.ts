// Before "start over" (Dashboard): if this browser holds on-chain record keys with no
// backup, say so first. Starting over does not delete them, but a browser that is later
// cleared would, and nobody (VeilCore included) could prove those records again.
// Real-chain builds only (real-chain/slots.mjs).
// SPDX-License-Identifier: Apache-2.0

import { keysWithoutBackup } from '../../veilcore/record-keys';

/** True to go on with starting over. */
export const confirmUnsavedChainKeys = (): boolean => {
  const n = keysWithoutBackup().length;
  if (n === 0) return true;
  return window.confirm(
    `${n} record${n === 1 ? ' has' : 's have'} on-chain keys in this browser with no backup.\n\n` +
      'Starting over keeps them here, but clearing this browser later would lose them for good. ' +
      'Cancel to download their backups first (each record’s page), or OK to go on.',
  );
};
