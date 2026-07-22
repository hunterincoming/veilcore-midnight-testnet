// Step 2 — Pair your DNA report. The breeder uploads the report their testing lab
// returned; it is fingerprinted locally and paired to the Step 1 record. We do not
// sequence DNA in-app, and we stay lab-agnostic.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import LinkIcon from '@mui/icons-material/LinkOutlined';
import { motion } from 'framer-motion';
import { fingerprintFile, shortFingerprint } from '../../veilcore/commitment';
import { getRecord, pairDna, conflictsFor, type StrainRecord } from '../../veilcore/records';
import { FingerprintReveal } from './FingerprintReveal';
import { Dropzone } from './Dropzone';

const MChip = motion(Chip);

export const Step2PairDna: React.FC<{ recordId: string; onDone: () => void; onBack: () => void }> = ({
  recordId,
  onDone,
  onBack,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState<StrainRecord>();
  const [conflicts, setConflicts] = useState<StrainRecord[]>([]);
  const [error, setError] = useState<string>();
  const record = getRecord(recordId);

  const onPair = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const dnaHex = await fingerprintFile(file);
      const found = conflictsFor(dnaHex, recordId);
      const updated = pairDna(recordId, dnaHex, file.name);
      if (!updated) throw new Error('Could not find the record to pair.');
      setConflicts(found);
      setPaired(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (paired && paired.dnaFingerprint) {
    const priority = [paired, ...conflicts].slice().sort((a, b) => a.loggedAt - b.loggedAt)[0];
    const yoursFirst = priority.id === paired.id;
    return (
      <Stack spacing={2}>
        <FingerprintReveal
          fingerprint={paired.dnaFingerprint}
          headline="Zero bytes left your device."
          sub="Your lab report was read and fingerprinted right here in your browser. The file itself was never uploaded."
        />
        {/* the 1-2 punch completing */}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
          <MChip
            initial={{ x: -30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            color="primary"
            variant="outlined"
            label={`WHEN & who · ${shortFingerprint(paired.recordFingerprint)}`}
          />
          <LinkIcon sx={{ color: 'primary.main' }} />
          <MChip
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            color="primary"
            variant="outlined"
            label={`WHAT · ${shortFingerprint(paired.dnaFingerprint)}`}
          />
        </Stack>
        {conflicts.length > 0 && (
          <Alert severity="warning" variant="outlined">
            Heads up: this genetic fingerprint also matches {conflicts.length} other record
            {conflicts.length === 1 ? '' : 's'} on this device
            {yoursFirst
              ? ' — but your record here was logged first, so it has priority.'
              : `. An earlier record — ${priority.strainName}, logged ${new Date(
                  priority.loggedAt,
                ).toLocaleDateString()} — has priority.`}
          </Alert>
        )}
        <Alert severity="success" variant="outlined">
          Paired. Your record now proves both <b>when</b> you made it and <b>what</b> it genetically is — the complete
          picture.
        </Alert>
        <Box>
          <Button variant="contained" size="large" onClick={onDone}>
            Continue — see your certificate
          </Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Pair your DNA report
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Got your DNA test back from the lab? Pair it to prove what your cultivar genetically is.
        </Typography>
        {record && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Pairing to: <b>{record.strainName}</b> · bred by {record.bredBy}
          </Typography>
        )}
      </Box>

      <Alert icon={<ScienceIcon />} severity="info" variant="outlined">
        You get a DNA report from a testing lab. Veilcore doesn&apos;t sequence anything — you just pair the report you
        already have. It&apos;s read and fingerprinted on your device; the file never leaves.
      </Alert>

      <Dropzone
        file={file}
        onFile={setFile}
        title="Drag your lab report here, or click to choose"
        hint="The report file your testing lab returned — read locally, never uploaded."
      />

      {error && <Alert severity="error" variant="outlined">{error}</Alert>}

      <Stack direction="row" spacing={1.5}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="contained"
          size="large"
          disabled={busy || !file}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
          onClick={onPair}
        >
          {busy ? 'Fingerprinting locally…' : 'Pair to my cultivar'}
        </Button>
      </Stack>
    </Stack>
  );
};
