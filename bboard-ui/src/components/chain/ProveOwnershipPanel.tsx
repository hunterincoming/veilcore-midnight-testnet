// "Prove you held it": answer a verifier's challenge from this browser (proveOwnership).
// The challenge must come from the verifier (32 random bytes they made); a proof that
// answers a challenge the holder chose shows nothing, since anyone could replay it.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { hexBytes, useRecordKeys } from '../../veilcore/record-keys';
import { getRecord, useRecords } from '../../veilcore/records';
import { chainNotReady } from '../../veilcore/chain/config';
import type { ChainReceipt } from '../../veilcore/chain/actions';
import { useChainCall } from './useChainCall';
import { ChainStatusLine } from './ChainStatusLine';

export const ProveOwnershipPanel: React.FC<{ recordId: string }> = ({ recordId }) => {
  useRecords();
  const record = getRecord(recordId);
  const keys = useRecordKeys()[recordId];
  const [challenge, setChallenge] = useState('');
  const call = useChainCall<ChainReceipt>();
  if (!record || chainNotReady()) return null;

  const valid = /^(0x)?[0-9a-fA-F]{64}$/.test(challenge.trim());
  const anchored = keys?.anchor;
  const checkerLink = anchored ? `/verify/${record.id}?chain=${anchored.identity}&anchorTx=${anchored.txId}` : '';
  const prove = () =>
    call.run(async (progress) => {
      if (!keys) throw new Error('This browser does not hold the record’s keys.');
      const { proveOwnershipOnChain } = await import('../../veilcore/chain/actions');
      return proveOwnershipOnChain(hexBytes(keys.recordSecret), challenge.trim().replace(/^0x/, ''), { progress });
    });

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1">
          Prove you have held this record since it was anchored (test network)
        </Typography>
        {!anchored ? (
          <Typography variant="body2" color="text.secondary">
            Anchor the record first (step 1). The proof is about its on-chain identity.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              The person checking makes a challenge on the record’s verify page and sends it to you. You answer it here;
              your browser proves you hold the record’s secret without revealing it, and you send them the transaction
              id. Together with the anchor, that shows you have held it since block {anchored.blockHeight}.
            </Typography>
            <Box>
              <Button
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${checkerLink}`)}
              >
                Copy the checker’s link (it names the record’s on-chain identity)
              </Button>
              <Button size="small" component={RouterLink} to={checkerLink} target="_blank" rel="noopener">
                Try it yourself: open it as the checker
              </Button>
            </Box>
            <TextField
              label="The checker’s challenge (64 characters)"
              value={challenge}
              onChange={(e) => setChallenge(e.target.value)}
              error={challenge.trim() !== '' && !valid}
              size="small"
              fullWidth
            />
            <Button
              variant="contained"
              disabled={!valid || call.busy}
              onClick={() => void prove()}
              sx={{ alignSelf: 'flex-start' }}
            >
              Answer the challenge
            </Button>
            <ChainStatusLine busy={call.busy} progress={call.progress} error={call.error} />
            {call.result && (
              <Alert severity="success" variant="outlined">
                <Typography variant="body2">Done. Send the checker this transaction id:</Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', my: 0.5 }}>
                  {call.result.txId}
                </Typography>
                <Button
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => void navigator.clipboard.writeText(call.result?.txId ?? '')}
                >
                  Copy
                </Button>
              </Alert>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
};
