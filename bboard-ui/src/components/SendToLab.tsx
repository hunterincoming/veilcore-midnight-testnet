// Sending a cultivar to a lab or another breeder.
//
// This is where a record stops being the holder's own claim. When the recipient
// confirms receipt, the attestation is recorded against their key — which is the single
// biggest increase in what the record is worth as evidence, and the only way to get one.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/SendOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { offerTransfer } from '../veilcore/transfers';
import type { StrainRecord } from '../veilcore/records';

export const SendToLab: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    if (!handle.trim()) return;
    setBusy(true);
    setError(null);
    const res = await offerTransfer(record.id, handle.trim(), {
      quantity: quantity.trim() || undefined,
      note: note.trim() || undefined,
    });
    if ('error' in res) setError(res.error);
    else setTransferId(res.transferId);
    setBusy(false);
  };

  const reset = () => {
    setOpen(false);
    setTransferId(null);
    setHandle('');
    setQuantity('');
    setNote('');
    setError(null);
  };

  const copyCode = async () => {
    if (!transferId) return;
    await navigator.clipboard.writeText(transferId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Button variant="outlined" startIcon={<SendIcon />} onClick={() => setOpen(true)}>
        Send to a lab
      </Button>

      <Dialog open={open} onClose={reset} maxWidth="sm" fullWidth>
        <DialogTitle>{transferId ? 'Ready to send' : `Send ${record.strainName}`}</DialogTitle>
        <DialogContent>
          {transferId ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="success" variant="outlined">
                Give this code to {handle}. When they claim it, they confirm receipt — and that
                confirmation becomes the attestation on your record.
              </Alert>
              <Box
                sx={{
                  p: 2, borderRadius: 1, background: 'rgba(255,255,255,0.04)',
                  fontFamily: 'monospace', fontSize: 20, textAlign: 'center', letterSpacing: 1,
                }}
              >
                {transferId}
              </Box>
              <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyCode}>
                {copied ? 'Copied' : 'Copy code'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                Nothing has moved yet. The transfer completes when they claim it, and until then
                your record is unchanged.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                They receive a record descended from yours — not a copy. When they confirm receipt,
                the attestation is recorded against their key, which is the only way to get one.
              </Typography>
              <TextField
                label="Who are you sending it to"
                helperText="Their handle. They'll need this to find the transfer."
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                fullWidth
              />
              <TextField
                label="Quantity (optional)"
                placeholder="e.g. 10 cuttings"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                fullWidth
              />
              <TextField
                label="Note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                fullWidth
              />
              {error && <Alert severity="warning" variant="outlined">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={reset}>{transferId ? 'Done' : 'Cancel'}</Button>
          {!transferId && (
            <Button variant="contained" onClick={send} disabled={busy || !handle.trim()}>
              Create transfer
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};
