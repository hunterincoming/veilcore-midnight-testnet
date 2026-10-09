// HolderKeyPanel — the holder key is how this browser finds the breeder's records.
// It is sent to VeilCore's registry with every save and stored there to find the
// records, so the panel must not say VeilCore has no copy. What is true: anyone with
// the key can read and change the records, and VeilCore cannot recover it for the
// holder. So it has to be easy to save and easy to restore on another device.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import { holderKeyIfAny, setHolderKey, downloadHolderKey } from '../veilcore/holder';
import { TEAL } from '../config/theme';

export const HolderKeyPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [restoreValue, setRestoreValue] = useState('');
  const [copied, setCopied] = useState(false);
  // Read, never created: opening this panel is not a reason to mint a key.
  const key = holderKeyIfAny();

  const copy = async () => {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    if (key) downloadHolderKey(key);
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
              VeilCore&apos;s server receives this key with every save and stores it to find your records. Anyone with
              it can read and change them. We cannot recover it for you: save it before you clear this browser.
            </Alert>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Holder key
              </Typography>
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.5,
                  borderRadius: 1,
                  background: 'rgba(255,255,255,0.04)',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  wordBreak: 'break-all',
                  color: TEAL,
                }}
              >
                {key ?? 'No key yet. One is made the first time you save a record in this browser.'}
              </Box>
            </Box>

            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy} disabled={!key}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={download} disabled={!key}>
                Download
              </Button>
            </Stack>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Restore on this device
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Paste a key saved from another browser to load those records here. This replaces the key above — save it
                first if you still need it.
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="64 hex characters"
                  value={restoreValue}
                  onChange={(e) => setRestoreValue(e.target.value)}
                  slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
                />
                <Button variant="contained" onClick={restore} disabled={!/^[0-9a-f]{64}$/i.test(restoreValue.trim())}>
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
