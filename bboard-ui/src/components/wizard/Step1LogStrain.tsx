// Step 1 — Log your strain. Proof you made it first: an un-forgeable, timestamped
// record sealed the moment you log it. All fields (incl. photos) are hashed locally;
// nothing leaves the device.
// SPDX-License-Identifier: Apache-2.0

import React, { useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ShieldIcon from '@mui/icons-material/GppGoodOutlined';
import PhotoIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import { motion } from 'framer-motion';
import { fingerprintRecord, fingerprintFile } from '../../veilcore/commitment';
import { createRecord, allRecords, type StrainRecord, type ParentRef } from '../../veilcore/records';
import { FingerprintReveal } from './FingerprintReveal';
import { TEAL } from '../../config/theme';

const MBox = motion(Box);
const today = () => new Date().toISOString().slice(0, 10);
const fmtStamp = (ms: number) => new Date(ms).toLocaleString();

const BREEDING_METHODS = [
  'Seed — F1',
  'Seed — F2',
  'Seed — S1 (selfed)',
  'Seed — backcross',
  'Clone / cutting',
  'Tissue culture',
  'Pheno selection',
  'Landrace / heirloom',
  'Other',
];

export const Step1LogStrain: React.FC<{ onDone: (recordId: string) => void }> = ({ onDone }) => {
  const [strainName, setStrainName] = useState('');
  const [bredBy, setBredBy] = useState('');
  const [dateCreated, setDateCreated] = useState(today());
  const [notes, setNotes] = useState('');
  const [parents, setParents] = useState<ParentRef[]>([]);
  const [breedingMethod, setBreedingMethod] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [refId, setRefId] = useState('');
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<StrainRecord>();
  const [error, setError] = useState<string>();
  const photoRef = useRef<HTMLInputElement>(null);

  const parentOptions: ParentRef[] = allRecords().map((r) => ({ recordId: r.id, name: r.strainName }));
  const canSubmit = strainName.trim() && bredBy.trim();

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      const loggedAt = Date.now();
      const photoFingerprints = await Promise.all(photos.map((f) => fingerprintFile(f)));
      const fields = {
        strainName: strainName.trim(),
        bredBy: bredBy.trim(),
        dateCreated,
        notes: notes.trim(),
        loggedAt,
        parents,
        breedingMethod,
        photoFingerprints,
        refId: refId.trim(),
      };
      const recordFingerprint = await fingerprintRecord(fields);
      setRecord(createRecord({ ...fields, recordFingerprint }));
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
          sub="Your record — every field and photo — was sealed and timestamped right here in your browser. Only this tamper-evident fingerprint was saved."
        />
        <Alert icon={<ShieldIcon />} severity="success" variant="outlined">
          <Typography variant="subtitle2">Proof created — you were first to log it.</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            <b>{record.strainName}</b> · bred by {record.bredBy}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            Sealed {fmtStamp(record.loggedAt)}. This is a timestamped record from the moment you logged
            it — first to log it, first in line. Your stated creation date ({record.dateCreated}) is recorded as your
            own claim.
          </Typography>
        </Alert>
        <Box>
          <Button variant="contained" size="large" onClick={() => onDone(record.id)}>
            Continue — send it to a lab
          </Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Log your cultivar — a sealed record of what you hold, and when
        </Typography>
        <Typography variant="body2" color="text.secondary">
          A tamper-evident, timestamped record of this cultivar in your hands — sealed before anyone else can claim it.
        </Typography>
      </Box>

      <TextField
        label="Cultivar name"
        placeholder="e.g. Blue Lotus #4"
        helperText="The name you know it by — what most people call the strain."
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

      <Autocomplete<ParentRef, true, false, true>
        multiple
        freeSolo
        options={parentOptions}
        getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
        value={parents}
        onChange={(_, val) => setParents(val.map((v) => (typeof v === 'string' ? { name: v } : v)))}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Parent cultivars / lineage"
            helperText="What did you cross to make this? Pick from cultivars you've already logged, or type them in."
          />
        )}
      />

      <TextField
        select
        label="Breeding method"
        helperText="How this cultivar was produced."
        value={breedingMethod}
        onChange={(e) => setBreedingMethod(e.target.value)}
        fullWidth
      >
        {BREEDING_METHODS.map((m) => (
          <MenuItem key={m} value={m}>
            {m}
          </MenuItem>
        ))}
      </TextField>

      <Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<PhotoIcon />} onClick={() => photoRef.current?.click()}>
            Add photos
          </Button>
          {photos.length > 0 && (
            <Chip label={`${photos.length} photo${photos.length === 1 ? '' : 's'} · hashed locally`} color="primary" variant="outlined" />
          )}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Optional. Photos are fingerprinted on your device and never uploaded.
        </Typography>
      </Box>

      <TextField
        label="Your reference / lot ID (optional)"
        placeholder="e.g. lot 2231"
        helperText="Your own internal reference, if you use one."
        value={refId}
        onChange={(e) => setRefId(e.target.value)}
        fullWidth
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
