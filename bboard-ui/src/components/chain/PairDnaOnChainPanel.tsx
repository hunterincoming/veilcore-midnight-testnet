// After pairing a report: optionally publish its fingerprint on chain against the
// record's anchored identity (pairDna). Says first what that makes public, permanently.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { hexBytes, setDnaOnChain, useRecordKeys } from '../../veilcore/record-keys';
import { getRecord, useRecords } from '../../veilcore/records';
import { chainNotReady } from '../../veilcore/chain/config';
import { useChainCall } from './useChainCall';
import { ChainStatusLine, TxLine } from './ChainStatusLine';

export const PairDnaOnChainPanel: React.FC<{ recordId: string }> = ({ recordId }) => {
  useRecords();
  const record = getRecord(recordId);
  const keys = useRecordKeys()[recordId];
  const call = useChainCall<void>();
  if (!record?.dnaFingerprint || chainNotReady()) return null;

  // Only the report paired now counts: a different file paired since is not published.
  const published = keys?.dnaOnChain?.fingerprint === record.dnaFingerprint ? keys.dnaOnChain : undefined;
  if (published) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2">
          The report’s fingerprint is published on the test network against this record.
        </Typography>
        <TxLine label="Pairing" txHash={published.txHash} blockHeight={published.blockHeight} />
      </Paper>
    );
  }
  if (!keys?.anchor) {
    return (
      <Typography variant="caption" color="text.secondary">
        Anchor the record on the test network first if you also want to publish this pairing there.
      </Typography>
    );
  }
  if (!keys) {
    return (
      <Typography variant="caption" color="text.secondary">
        This browser does not hold the record’s keys, so it cannot publish the pairing. Restore them from your backup.
      </Typography>
    );
  }

  const fingerprint = record.dnaFingerprint;
  const pair = () =>
    call.run(async (progress) => {
      const { pairDnaOnChain } = await import('../../veilcore/chain/actions');
      const r = await pairDnaOnChain(hexBytes(keys.recordSecret), fingerprint, { progress });
      setDnaOnChain(recordId, {
        fingerprint,
        txId: r.txId,
        txHash: r.txHash,
        blockHeight: r.blockHeight,
        at: r.blockTime,
      });
    });

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">Also publish this pairing on the test network (optional)</Typography>
        <Alert severity="warning" variant="outlined">
          This puts the report’s fingerprint on chain, next to this record’s identity, permanently. The file stays on
          your device, but anyone who has the same file can compute the fingerprint and confirm the link. Only do it if
          that is acceptable.
        </Alert>
        <Button variant="outlined" disabled={call.busy} onClick={() => void pair()} sx={{ alignSelf: 'flex-start' }}>
          Publish the pairing
        </Button>
        <ChainStatusLine busy={call.busy} progress={call.progress} error={call.error} />
      </Stack>
    </Paper>
  );
};
