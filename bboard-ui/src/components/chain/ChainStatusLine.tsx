// The progress line under a real call, and its error. Says what is happening, in order:
// preparing, proving on this device, the sponsor paying the fee, waiting for the network.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Alert, CircularProgress, Stack, Typography } from '@mui/material';

export const ChainStatusLine: React.FC<{ busy: boolean; progress?: string; error?: string }> = ({
  busy,
  progress,
  error,
}) => (
  <>
    {busy && (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} role="status" aria-live="polite">
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          {progress ?? 'Working…'}
        </Typography>
      </Stack>
    )}
    {error && (
      <Alert severity="error" variant="outlined">
        {error}
      </Alert>
    )}
  </>
);

/** Transaction details, shown in full: Midnight's explorers have no per-transaction link. */
export const TxLine: React.FC<{ label: string; txHash: string; blockHeight: number }> = ({
  label,
  txHash,
  blockHeight,
}) => (
  <Typography
    variant="caption"
    color="text.secondary"
    sx={{ display: 'block', wordBreak: 'break-all', fontFamily: 'monospace' }}
  >
    {label}: transaction {txHash} · block {blockHeight}
  </Typography>
);
