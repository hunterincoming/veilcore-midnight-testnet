// HolderKeyPanel — the holder key is the only thing that can retrieve this
// breeder's records. Nobody else holds a copy, including us. That is the point,
// and it means losing it is unrecoverable — so it has to be easy to save and
// easy to restore on another device.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography,
} from '@mui/material';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import { holderKey, setHolderKey } from '../veilcore/holder';
import { TEAL } from '../config/theme';

export const HolderKeyPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [restoreValue, setRestoreValue] = useState('');
  const [copied, setCopied] = useState(false);
  const key = holderKey();

  const copy = async () => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob(
      [
        'VeilCore holder key\n\n',
        `${key}\n\n`,
        'This key is the only way to retrieve your records. Nobody else has a copy,\n',
        'including VeilCore. Store it somewhere safe. Anyone with this key can read\n',
        'your records; without it, they cannot be recovered.\n',
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

  const restore = () => {
    const v = restoreValue.trim();
    if (!/^[0-9a-f]{64}$/i.test(v)) return;
    setHolderKey(v);
    window.location.reload();
  };

  return (
    <>
      <Button size="small" startIcon={<KeyIcon />} onClick={() => setOpen(true)} sx={{ color: 'text.secondary' }}>
        Holder key
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Your holder key</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Alert severity="warning" variant="outlined">
              This key is the only way to retrieve your records. We do not have a copy and cannot
              reset it. Save it before you clear this browser.
            </Alert>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Holder key
              </Typography>
              <Box
                sx={{
                  mt: 0.5, p: 1.5, borderRadius: 1, background: 'rgba(255,255,255,0.04)',
                  fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', color: TEAL,
                }}
              >
                {key}
              </Box>
            </Box>

            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={download}>
                Download
              </Button>
            </Stack>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Restore on this device
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Paste a key saved from another browser to load those records here. This replaces the
                key above — save it first if you still need it.
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small" fullWidth placeholder="64 hex characters"
                  value={restoreValue} onChange={(e) => setRestoreValue(e.target.value)}
                  slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
                />
                <Button
                  variant="contained" onClick={restore}
                  disabled={!/^[0-9a-f]{64}$/i.test(restoreValue.trim())}
                >
                  Restore
                </Button>
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
