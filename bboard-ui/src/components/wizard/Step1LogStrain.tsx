// Step 1 — Log your strain. Proof you made it first: an un-forgeable, timestamped
// record sealed the moment you log it. The genetics never leave the device.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Divider, Stack, TextField, Typography } from '@mui/material';
import ShieldIcon from '@mui/icons-material/GppGoodOutlined';
import { motion } from 'framer-motion';
import { fingerprintRecord } from '../../veilcore/commitment';
import { createRecord, type StrainRecord } from '../../veilcore/records';
import { FingerprintReveal } from './FingerprintReveal';
import { TEAL } from '../../config/theme';

const MBox = motion(Box);
const today = () => new Date().toISOString().slice(0, 10);
const fmtStamp = (ms: number) => new Date(ms).toLocaleString();

export const Step1LogStrain: React.FC<{ onDone: (recordId: string) => void }> = ({ onDone }) => {
  const [strainName, setStrainName] = useState('');
  const [bredBy, setBredBy] = useState('');
  const [dateCreated, setDateCreated] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<StrainRecord>();
  const [error, setError] = useState<string>();

  const canSubmit = strainName.trim() && bredBy.trim();

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      const loggedAt = Date.now();
      const fields = { strainName: strainName.trim(), bredBy: bredBy.trim(), dateCreated, notes: notes.trim(), loggedAt };
      const recordFingerprint = await fingerprintRecord(fields);
      const rec = createRecord({ ...fields, recordFingerprint });
      setRecord(rec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (record) {
    return (
      <Stack spacing={2}>
        <FingerprintReveal
          fingerprint={record.recordFingerprint}
          headline="Zero bytes left your device."
          sub="Your record was sealed and timestamped right here in your browser — only this tamper-proof fingerprint was saved, never your details."
        />
        <Alert icon={<ShieldIcon />} severity="success" variant="outlined">
          <Typography variant="subtitle2">Proof created — you were first to log it.</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            <b>{record.strainName}</b> · bred by {record.bredBy}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            Sealed {fmtStamp(record.loggedAt)}. This is an un-forgeable, timestamped record from the moment you logged
            it — first to log it, first in line. Your stated creation date ({record.dateCreated}) is recorded as your
            own claim.
          </Typography>
        </Alert>
        <Box>
          <Button variant="contained" size="large" onClick={() => onDone(record.id)}>
            Continue — pair your DNA report
          </Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Log your strain — proof you made it first
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Lock in dated, tamper-proof proof you created this strain — before anyone can claim it.
        </Typography>
      </Box>

      <TextField
        label="Strain name"
        placeholder="e.g. Blue Lotus #4"
        helperText="What you call this strain or cut — your working name is fine."
        value={strainName}
        onChange={(e) => setStrainName(e.target.value)}
        fullWidth
      />
      <TextField
        label="Bred by"
        placeholder="Your name or operation"
        helperText="Who the proof credits — you or your operation."
        value={bredBy}
        onChange={(e) => setBredBy(e.target.value)}
        fullWidth
      />
      <TextField
        label="Date created"
        type="date"
        helperText="Your own note of when you made it. Veilcore's tamper-proof timestamp is the moment you log it."
        value={dateCreated}
        onChange={(e) => setDateCreated(e.target.value)}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="Notes (optional)"
        placeholder="The cross, the pheno, the story…"
        helperText="Anything you want on the record. Stays private to you."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        multiline
        minRows={2}
        fullWidth
      />

      <Divider />
      <MBox
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, color: TEAL }}
      >
        <ShieldIcon fontSize="small" />
        <Typography variant="body2" sx={{ color: TEAL }}>
          Nothing proprietary required — your genetics never leave your device.
        </Typography>
      </MBox>

      {error && <Alert severity="error" variant="outlined">{error}</Alert>}

      <Box>
        <Button
          variant="contained"
          size="large"
          disabled={busy || !canSubmit}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
          onClick={onSubmit}
        >
          {busy ? 'Sealing locally…' : 'Create my proof'}
        </Button>
      </Box>
    </Stack>
  );
};
