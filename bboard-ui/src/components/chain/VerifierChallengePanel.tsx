// On a record's verify page: ask whoever claims this record to prove they hold it.
// The checker makes the challenge here; the holder answers from their browser; the
// checker pastes the transaction id and this page reads the answer from the network.
// Real-chain builds only. Rule 8 of the verifier rules (docs/design.md).
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { chainNotReady } from '../../veilcore/chain/config';
import { useChainCall } from './useChainCall';
import { ChainStatusLine } from './ChainStatusLine';

/** What the holder's link says: the record's on-chain identity and its anchor transaction. */
export type ClaimedChainAnchor = { identity: string; txId?: string };

export const VerifierChallengePanel: React.FC<{ claim?: ClaimedChainAnchor | null }> = ({ claim }) => {
  const [challenge, setChallenge] = useState<string>();
  const [txId, setTxId] = useState('');
  const call = useChainCall<{ accepted: boolean; reason: string; anchor?: boolean }>();
  if (chainNotReady() || !claim || !/^[0-9a-fA-F]{64}$/.test(claim.identity)) return null;

  const make = async () => {
    const { newChallenge } = await import('../../veilcore/chain/ownership-check');
    setChallenge(newChallenge());
    setTxId('');
  };
  const check = () =>
    call.run(async (progress) => {
      progress('Reading the answer from the network…');
      const { checkOwnership, checkAnchor } = await import('../../veilcore/chain/ownership-check');
      const v = await checkOwnership({ txId, identity: claim.identity, challenge: challenge ?? '' });
      const anchor = claim.txId ? await checkAnchor(claim.txId, claim.identity) : undefined;
      return { ...v, anchor };
    });

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 }, mt: 3 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1">Ask the holder to prove they hold this record</Typography>
        <Typography variant="body2" color="text.secondary">
          The link you were sent names an on-chain identity for this record ({claim.identity.slice(0, 16)}…). Make a
          challenge, send it to them, and paste back the transaction id they give you. This page then checks the
          network: the answer must come from that identity, answer your challenge, and the identity must be anchored and
          current. Test network only: it can be reset and its dates carry no evidential weight. That this identity
          belongs to this record’s content is the holder’s statement.
        </Typography>
        {!challenge ? (
          <Button variant="outlined" onClick={() => void make()} sx={{ alignSelf: 'flex-start' }}>
            Make a challenge
          </Button>
        ) : (
          <>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Your challenge (send it to the holder; it works once, in this tab):
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {challenge}
              </Typography>
              <Button
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={() => void navigator.clipboard.writeText(challenge)}
              >
                Copy
              </Button>
            </Box>
            <TextField
              label="The holder’s transaction id"
              value={txId}
              onChange={(e) => setTxId(e.target.value)}
              size="small"
              fullWidth
            />
            <Button
              variant="contained"
              disabled={!txId.trim() || call.busy}
              onClick={() => void check()}
              sx={{ alignSelf: 'flex-start' }}
            >
              Check the answer
            </Button>
          </>
        )}
        <ChainStatusLine busy={call.busy} progress={call.progress} error={call.error} />
        {call.result && (
          <Alert severity={call.result.accepted ? 'success' : 'error'} variant="outlined">
            {call.result.accepted
              ? 'Accepted: whoever sent that transaction holds this identity’s secret, and answered your challenge.'
              : `Not accepted: ${call.result.reason}.`}
            {call.result.anchor === true && ' The anchor transaction the holder gave does create this identity.'}
            {call.result.anchor === false && ' The anchor transaction the holder gave could not be confirmed.'}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
};
