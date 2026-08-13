// Correcting a sealed record.
//
// The original is never edited and never deleted. A correction issues a new record that
// supersedes it, and both remain on file - because a record that can be quietly changed
// is not evidence.
//
// The severity is computed from which field changed, not chosen. The holder is shown the
// consequence before committing, because "material for terms" means nothing to a breeder
// and "anyone holding an agreement against this needs to know" does.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import { useNavigate } from 'react-router-dom';
import { previewCorrection, type CorrectionPreview } from '../veilcore/corrections';
import { issueCorrection, type StrainRecord } from '../veilcore/records';
import { TEAL } from '../config/theme';

const FIELD_LABEL: Record<string, string> = {
  'profileData.cultivarName': 'cultivar name',
  'profileData.breederName': 'bred by',
  'profileData.breedingMethod': 'breeding method',
  'profileData.claimedCreationDate': 'stated creation date',
  'profileData.notes': 'notes',
  'profileData.internalReference': 'internal reference',
  parents: 'parents',
  attestations: 'attestations',
  sealedAt: 'sealed date',
  holder: 'holder',
};

export const CorrectRecord: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [name, setName] = useState(record.strainName);
  const [bredBy, setBredBy] = useState(record.bredBy);
  const [method, setMethod] = useState(record.breedingMethod ?? '');
  const [notes, setNotes] = useState(record.notes ?? '');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);

  const edited: StrainRecord = {
    ...record,
    strainName: name,
    bredBy,
    breedingMethod: method,
    notes,
  };

  const dirty =
    name !== record.strainName ||
    bredBy !== record.bredBy ||
    method !== (record.breedingMethod ?? '') ||
    notes !== (record.notes ?? '');

  const check = () => setPreview(previewCorrection(record, edited));

  const reset = () => {
    setOpen(false);
    setPreview(null);
    setReason('');
    setName(record.strainName);
    setBredBy(record.bredBy);
    setMethod(record.breedingMethod ?? '');
    setNotes(record.notes ?? '');
  };

  return (
    <>
      <Button variant="text" startIcon={<EditIcon />} onClick={() => setOpen(true)}>
        Correct this record
      </Button>

      <Dialog open={open} onClose={reset} maxWidth="sm" fullWidth>
        <DialogTitle>Correct {record.id}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              This record stays exactly as it is. A correction creates a new record that supersedes
              it, and both remain on file. Nothing is overwritten and nothing is deleted — that is
              what keeps the original usable as evidence.
            </Typography>

            <TextField label="Cultivar name" value={name} onChange={(e) => { setName(e.target.value); setPreview(null); }} fullWidth />
            <TextField label="Bred by" value={bredBy} onChange={(e) => { setBredBy(e.target.value); setPreview(null); }} fullWidth />
            <TextField label="Breeding method" value={method} onChange={(e) => { setMethod(e.target.value); setPreview(null); }} fullWidth />
            <TextField label="Notes" value={notes} onChange={(e) => { setNotes(e.target.value); setPreview(null); }} fullWidth multiline minRows={2} />

            {preview && (
              <Box sx={{ p: 2, borderRadius: 1, border: `1px solid ${TEAL}` }}>
                <Typography variant="overline" sx={{ color: TEAL, display: 'block' }}>
                  What this correction does
                </Typography>
                <Stack direction="row" spacing={1} sx={{ my: 1, flexWrap: 'wrap', gap: 0.5 }}>
                  {preview.changedFields.map((f) => (
                    <Chip key={f} size="small" variant="outlined" label={FIELD_LABEL[f] ?? f} />
                  ))}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {preview.consequence}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  This is worked out from which fields you changed. It is not something you or we
                  can set — otherwise every correction would look harmless.
                </Typography>
              </Box>
            )}

            {preview && (
              <TextField
                label="Why are you correcting this?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                fullWidth
                helperText="Recorded with the correction. Anyone checking the record sees it."
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={reset}>Cancel</Button>
          {!preview ? (
            <Button variant="contained" onClick={check} disabled={!dirty}>
              Check what this affects
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={busy || !reason.trim()}
              onClick={async () => {
                setBusy(true);
                const corrected = await issueCorrection(
                  record.id,
                  { strainName: name, bredBy, breedingMethod: method, notes },
                  reason.trim(),
                );
                setBusy(false);
                reset();
                if (corrected) navigate(`/record/${corrected.id}`);
              }}
            >
              Issue correction
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};
