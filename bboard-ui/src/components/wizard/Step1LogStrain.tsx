// Step 1 — Seal a record. The record is sealed in the browser: its fingerprint is
// computed here, photos and DNA files are hashed here and never uploaded. The details
// typed in (name, breeder, dates, notes, parents) are saved to VeilCore's server so
// the holder can come back to them. The time comes from this device's clock until the
// record's batch is anchored. Nothing here checks whether anyone logged it before.
// New records are sealed under the plant-variety profile; the taxon is what the holder
// enters, or nothing.
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
import { fingerprintRecord, fingerprintFile, newNonce } from '../../veilcore/commitment';
import { createRecord, allRecords, type StrainRecord, type ParentRef } from '../../veilcore/records';
import { PLANT_VARIETY_PROFILE } from '../../veilcore/envelope';
import { FingerprintReveal } from './FingerprintReveal';
import { TEAL } from '../../config/theme';
import { OUR_SERVER } from '../../config/copy';

const MBox = motion(Box);
const today = () => new Date().toISOString().slice(0, 10);
const fmtStamp = (ms: number) => new Date(ms).toLocaleString();

const BREEDING_METHODS = [
  'Seed — F1',
  'Seed — F2',
  'Seed — selfed (S1)',
  'Seed — backcross',
  'Clone / cutting',
  'Tissue culture',
  'Selection',
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
  const [taxon, setTaxon] = useState('');
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
      // The nonce is committed with the record and stored on it. Without storing it
      // nobody could ever recompute the commitment, so the record would be
      // unverifiable by anyone including us.
      const nonce = newNonce();
      const fields = {
        nonce,
        strainName: strainName.trim(),
        bredBy: bredBy.trim(),
        dateCreated,
        notes: notes.trim(),
        loggedAt,
        parents,
        breedingMethod,
        photoFingerprints,
        refId: refId.trim(),
        profile: PLANT_VARIETY_PROFILE,
        taxon: taxon.trim() || undefined,
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
          headline="Sealed in your browser."
          sub={`Photos and lab or DNA files stay on this device; only their fingerprints are kept. The details you typed are saved on ${OUR_SERVER} so you can come back to them.`}
        />
        <Alert icon={<ShieldIcon />} severity="success" variant="outlined">
          <Typography variant="subtitle2">Record sealed.</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            <b>{record.strainName}</b> · bred by {record.bredBy}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            Sealed {fmtStamp(record.loggedAt)}, by this device&apos;s clock. Its public date comes when the next batch
            is anchored; the record&apos;s verify page will show it. The creation date ({record.dateCreated}) is
            recorded as your own statement. Nothing here checks whether anyone else logged it first.
          </Typography>
        </Alert>
        <Box>
          <Button variant="contained" size="large" onClick={() => onDone(record.id)}>
            Continue: send it to a lab
          </Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Seal a record of what you hold
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Any later change to it would show. Once its batch is anchored, anyone can check its date.
        </Typography>
      </Box>

      <TextField
        label="Cultivar name"
        required
        placeholder="e.g. Harbour Mist"
        helperText="The name you know it by: the variety or cultivar name."
        value={strainName}
        onChange={(e) => setStrainName(e.target.value)}
        fullWidth
      />
      <TextField
        label="Bred by"
        required
        placeholder="Your name or operation"
        helperText="Who the record credits: you or your operation."
        value={bredBy}
        onChange={(e) => setBredBy(e.target.value)}
        fullWidth
      />

      <TextField
        label="Species (optional)"
        placeholder="e.g. Solanum lycopersicum"
        helperText="The species or other taxon, if you want it on the record. Leave blank to omit it."
        value={taxon}
        onChange={(e) => setTaxon(e.target.value)}
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
            label="Parents"
            helperText="What did you cross to make this? Pick from records you've already sealed, or type a name and press Enter."
          />
        )}
      />

      <TextField
        select
        label="Breeding method"
        helperText="How this cultivar was produced (optional)."
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
            <Chip
              label={`${photos.length} photo${photos.length === 1 ? '' : 's'} · hashed locally`}
              color="primary"
              variant="outlined"
            />
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
        placeholder="The cross, the selection, the story…"
        helperText={`Saved on ${OUR_SERVER} with the rest of the record. Shown only to whoever holds your holder key.`}
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
          Photos and DNA files stay on your device. The details you type here are saved on {OUR_SERVER}.
        </Typography>
      </MBox>

      {error && (
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      )}

      <Box>
        {!canSubmit && !busy && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Fill in the two required fields (*) to seal it.
          </Typography>
        )}
        <Button
          variant="contained"
          size="large"
          disabled={busy || !canSubmit}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
          onClick={onSubmit}
        >
          {busy ? 'Sealing locally…' : 'Seal this record'}
        </Button>
      </Box>
    </Stack>
  );
};
