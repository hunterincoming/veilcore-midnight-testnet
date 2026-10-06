// The record's two secrets, as the holder sees them: whether this browser holds them,
// whether a backup exists, and the controls to download, restore or forget them.
// SPDX-License-Identifier: Apache-2.0

import React, { useRef, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import UploadIcon from '@mui/icons-material/FileUploadOutlined';
import { downloadBackup, forgetKeys, hexBytes, restoreBackup, useRecordKeys } from '../../veilcore/record-keys';
import { identityOf } from '../../veilcore/chain/identity';
import type { StrainRecord } from '../../veilcore/records';
import { NETWORK } from '../../config/network';
import { CHAIN_CONTRACT } from '../../veilcore/chain/config';

export const RecordKeysPanel: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const keys = useRecordKeys()[record.id];
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>();

  const extra = {
    cultivar: record.strainName,
    network: NETWORK,
    contract: CHAIN_CONTRACT,
  };

  const onRestore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const k = await restoreBackup(f);
      if (k.recordId !== record.id) setMsg(`Restored keys for ${k.recordId}.`);
      else if (k.anchor && identityOf(hexBytes(k.recordSecret)) !== k.anchor.identity) {
        setMsg('Restored, but these keys are not this record’s on-chain identity. Check you chose the right file.');
      } else setMsg('Keys restored to this browser.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const onForget = () => {
    if (!keys) return;
    const warning = keys.backedUpAt
      ? 'Remove this record’s keys from this browser? You can restore them from your backup file.'
      : 'You have NOT downloaded a backup of these keys. If you remove them, nobody, VeilCore included, can ever prove this record again. Remove them anyway?';
    if (window.confirm(warning)) forgetKeys(record.id);
  };

  return (
    <Stack spacing={1.25}>
      <Typography variant="overline">Record keys (this browser only)</Typography>
      {keys ? (
        <>
          <Typography variant="body2" color="text.secondary">
            This browser holds the two secrets that prove you hold this record on chain. They are never sent anywhere,
            VeilCore has no copy, and clearing this browser deletes them.
          </Typography>
          {!keys.backedUpAt && (
            <Alert severity="warning" variant="outlined">
              No backup yet. Download it and keep it offline: without it, clearing this browser loses the record for
              good.
            </Alert>
          )}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => downloadBackup(keys, extra)}
            >
              {keys.backedUpAt ? 'Download the backup again' : 'Download the backup (secret)'}
            </Button>
            <Button size="small" variant="text" color="inherit" onClick={onForget}>
              Remove from this browser
            </Button>
          </Stack>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            This browser does not hold this record’s keys. If you made them elsewhere, restore them from your backup
            file.
          </Typography>
          <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => fileRef.current?.click()}>
            Restore keys from a backup file
          </Button>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => void onRestore(e.target.files?.[0])}
      />
      {msg && <Typography variant="caption">{msg}</Typography>}
    </Stack>
  );
};
