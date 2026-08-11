// Receiving a cultivar.
//
// Claiming is not just an inbox action — it is the attestation. A second party, holding
// their own key, confirming they received specific material on a specific date. That is
// what the sender's record needs and the only way to produce it honestly.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/MoveToInboxOutlined';
import { useNavigate } from 'react-router-dom';
import { claimTransfer } from '../veilcore/transfers';
import { hydrate, getRecord, sealReceived } from '../veilcore/records';

export const ClaimTransfer: React.FC<{ variant?: 'button' | 'text' }> = ({ variant = 'text' }) => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const claim = async () => {
    const id = code.trim().toUpperCase();
    if (!id) return;
    setBusy(true);
    setError(null);
    const res = await claimTransfer(id);
    if ('error' in res) {
      setError(res.error);
      setBusy(false);
      return;
    }
    await hydrate();
    // Seal the received record with the recipient's own commitment. They are not
    // copying the sender's evidence — they are committing to what they received:
    // this material, this quantity, this date, from this source.
    await sealReceived(res.recordId);
    setBusy(false);
    setOpen(false);
    setCode('');
    navigate(`/record/${res.recordId}`);
  };

  return (
    <>
      <Button
        variant={variant === 'button' ? 'outlined' : 'text'}
        startIcon={<InboxIcon />}
        onClick={() => setOpen(true)}
      >
        Receive a cultivar
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Receive a cultivar</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Enter the transfer code the sender gave you. You'll get a record descended from
              theirs, and your confirmation of receipt is recorded against their record — which is
              what makes it evidence rather than something they wrote alone.
            </Typography>
            <TextField
              label="Transfer code"
              placeholder="TR-XXXXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void claim(); }}
              fullWidth
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace', letterSpacing: 1 } } }}
            />
            {error && <Alert severity="warning" variant="outlined">{error}</Alert>}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Only confirm what you actually received. This is a statement other people will rely
                on.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={claim} disabled={busy || !code.trim()}>
            Confirm receipt
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
