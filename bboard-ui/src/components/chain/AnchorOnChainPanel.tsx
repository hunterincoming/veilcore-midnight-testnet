// After sealing: anchor the record's identity on Midnight's test network, from this
// browser, with VeilCore paying the fee. Real-chain builds only (VITE_REAL_CHAIN=1).
//
// In order: make the record's keys here, download the backup, then anchor. The anchor
// publishes the identity, commit(record secret), and a commitment to the recovery
// secret. Neither secret leaves this browser.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Button, Checkbox, FormControlLabel, Paper, Stack, Typography } from '@mui/material';
import LinkIcon from '@mui/icons-material/LinkOutlined';
import { ensureKeys, hexBytes, setAnchor, storageKeeps, useRecordKeys } from '../../veilcore/record-keys';
import { getRecord, useRecords } from '../../veilcore/records';
import { CHAIN_CONTRACT, chainNotReady } from '../../veilcore/chain/config';
import { NETWORK, networkLabel } from '../../config/network';
import { identityOf } from '../../veilcore/chain/identity';
import { useChainCall } from './useChainCall';
import { ChainStatusLine, TxLine } from './ChainStatusLine';
import { RecordKeysPanel } from './RecordKeysPanel';

export const AnchorOnChainPanel: React.FC<{ recordId: string }> = ({ recordId }) => {
  useRecords();
  const record = getRecord(recordId);
  const keys = useRecordKeys()[recordId];
  const anchored = keys?.anchor;
  const [privateOk, setPrivateOk] = useState(false);
  const call = useChainCall<void>();
  if (!record) return null;

  const notReady = chainNotReady();
  const keeps = storageKeeps();

  const anchor = () =>
    call.run(async (progress) => {
      const k = ensureKeys(recordId);
      const { anchorOnChain } = await import('../../veilcore/chain/actions');
      const secret = hexBytes(k.recordSecret);
      const receipt = await anchorOnChain(secret, hexBytes(k.recoverySecret), { progress });
      setAnchor(recordId, {
        identity: identityOf(secret),
        network: NETWORK,
        contractAddress: CHAIN_CONTRACT ?? '',
        txId: receipt.txId,
        txHash: receipt.txHash,
        blockHeight: receipt.blockHeight,
        anchoredAt: receipt.blockTime,
      });
    });

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <LinkIcon color="primary" />
          <Typography variant="subtitle1">Anchor this record on {networkLabel()}</Typography>
        </Stack>

        {anchored ? (
          <>
            <Alert severity="success" variant="outlined">
              Anchored. Its on-chain identity is {anchored.identity.slice(0, 16)}…, recorded at block{' '}
              {anchored.blockHeight}
              {anchored.anchoredAt ? ` (${new Date(anchored.anchoredAt).toLocaleString()}, the chain’s clock)` : ''}.
              The identity is kept in this browser and in your backup, not on VeilCore’s server: you share it by sending
              someone a checker’s link. This is a test network: it can be reset, and its dates carry no evidential
              weight.
            </Alert>
            <TxLine label="Anchor" txHash={anchored.txHash} blockHeight={anchored.blockHeight} />
            <RecordKeysPanel record={record} />
          </>
        ) : notReady ? (
          <Typography variant="body2" color="text.secondary">
            Not available in this build: {notReady}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              This gives the record an identity on the network that only this browser can act as. Your browser builds
              and proves the transaction itself; VeilCore pays the network fee and sees only what the network publishes.
              You need no wallet and no crypto. Later you can prove you held it since this block, to someone who asks.
            </Typography>
            {!keeps && (
              <>
                <Alert severity="warning" variant="outlined">
                  This browser is not keeping what it stores (a private window, or site data blocked). The record’s keys
                  would be lost when this tab closes, unless you download the backup.
                </Alert>
                <FormControlLabel
                  control={<Checkbox checked={privateOk} onChange={(e) => setPrivateOk(e.target.checked)} />}
                  label={<Typography variant="body2">I understand, and I will download the backup</Typography>}
                />
              </>
            )}
            {!keys ? (
              <Button variant="outlined" disabled={!keeps && !privateOk} onClick={() => ensureKeys(recordId)}>
                1. Make this record’s keys (in this browser)
              </Button>
            ) : (
              <>
                <RecordKeysPanel record={record} />
                <Button
                  variant="contained"
                  disabled={call.busy || !keys.backedUpAt}
                  onClick={() => void anchor()}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {keys.backedUpAt ? '2. Anchor on the test network' : 'Download the backup first'}
                </Button>
              </>
            )}
            <ChainStatusLine busy={call.busy} progress={call.progress} error={call.error} />
          </>
        )}
      </Stack>
    </Paper>
  );
};
