// Where this record's commitment actually sits.
//
// Three honest states, per record, rather than one blanket claim about the whole app:
// not yet batched, batched and awaiting an anchor, or anchored on chain with a
// transaction you can look up.
//
// The proof is downloadable because it is the holder's, not ours. They can verify it
// with the published package and a chain lookup, with no dependency on this registry
// still running — which is the only basis on which a record outlives the company.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import LinkIcon from '@mui/icons-material/LaunchOutlined';
import { proofFor, downloadProof, type ProofState } from '../veilcore/proofs';
import type { StrainRecord } from '../veilcore/records';
import { TEAL } from '../config/theme';

export const SettlementStatus: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [state, setState] = useState<ProofState>({ status: 'none' });

  useEffect(() => {
    void proofFor(record.recordFingerprint).then(setState);
  }, [record.recordFingerprint]);

  if (state.status === 'none') {
    return (
      <Stack spacing={1}>
        <Typography variant="overline" sx={{ display: 'block' }}>Settlement</Typography>
        <Typography variant="body2" color="text.secondary">
          Sealed on your device and held in the registry. Not yet included in an anchored batch —
          records are anchored together, so one transaction covers many and you never need a wallet.
        </Typography>
      </Stack>
    );
  }

  const { proof } = state;
  const anchored = state.status === 'anchored';

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="overline">Settlement</Typography>
        <Chip
          size="small"
          variant="outlined"
          color={anchored ? 'primary' : 'default'}
          label={anchored ? 'Anchored on Midnight' : 'Batched, awaiting anchor'}
        />
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {anchored
          ? 'This record is part of a batch whose root is recorded on Midnight. The proof below shows the path from your record to that root — anyone can check it without asking us.'
          : 'This record is in a sealed batch. When the batch root is anchored, this proof upgrades to reference the transaction. Nothing about your record changes.'}
      </Typography>

      <Box sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
        <div>batch {proof.batchId}</div>
        <div>root {proof.root.slice(0, 32)}…</div>
        {anchored && proof.anchor?.txHash && <div style={{ color: TEAL }}>tx {proof.anchor.txHash.slice(0, 32)}…</div>}
      </Box>

      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
          onClick={() => downloadProof(proof, record.id)}>
          Download proof
        </Button>
        {anchored && proof.anchor?.txHash && (
          <Button size="small" variant="text" startIcon={<LinkIcon />}
            href={`https://explorer.preview.midnight.network/tx/${proof.anchor.txHash}`}
            target="_blank" rel="noopener">
            View transaction
          </Button>
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Keep this proof. It verifies with the open-source package and a chain lookup — it does not
        depend on us being here.
      </Typography>
    </Stack>
  );
};
