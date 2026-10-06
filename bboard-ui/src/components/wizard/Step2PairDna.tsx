// Step 2 — Pair a lab report. The breeder picks the report their testing lab returned;
// the file is fingerprinted locally and never uploaded. Its fingerprint and file name are
// saved with the record on VeilCore's server. Pairing is the holder's own statement
// that this report belongs to this record; it is not a check of the genetics.
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

export const Step2PairDna: React.FC<{
  recordId: string;
  onDone: () => void;
  onBack: () => void;
  onSkip?: () => void;
}> = ({ recordId, onDone, onBack, onSkip }) => {
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
          headline="The report file stayed on your device."
          sub="It was read and fingerprinted here in your browser. Its fingerprint and file name were saved with your record."
        />
        {/* the 1-2 punch completing */}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
          <MChip
            initial={{ x: -30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            color="primary"
            variant="outlined"
            label={`Record · ${shortFingerprint(paired.recordFingerprint)}`}
          />
          <LinkIcon sx={{ color: 'primary.main' }} />
          <MChip
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            color="primary"
            variant="outlined"
            label={`Report · ${shortFingerprint(paired.dnaFingerprint)}`}
          />
        </Stack>
        {conflicts.length > 0 && (
          <Alert severity="warning" variant="outlined">
            Heads up: this report fingerprint is also paired with {conflicts.length} other record
            {conflicts.length === 1 ? '' : 's'} you hold
            {yoursFirst
              ? '. This record was sealed earliest, by the clocks of the devices that sealed them.'
              : `. ${priority.strainName} was sealed earlier (${new Date(
                  priority.loggedAt,
                ).toLocaleDateString()}, by its device's clock).`}
          </Alert>
        )}
        <Alert severity="success" variant="outlined">
          Paired. Your lab report&apos;s fingerprint is saved with the record, as your statement that this report
          belongs to it. It is not a check of the genetics, and in this web demo the pairing isn&apos;t dated yet.
        </Alert>
        <Box>
          <Button variant="contained" size="large" onClick={onDone}>
            Continue: see the certificate
          </Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Pair your lab report
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Got your DNA test back from the lab? Pair the report with this record, so it can later be compared against a
          fresh test.
        </Typography>
        {record && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Pairing to: <b>{record.strainName}</b> · bred by {record.bredBy}
          </Typography>
        )}
      </Box>

      <Alert icon={<ScienceIcon />} severity="info" variant="outlined">
        VeilCore doesn&apos;t test DNA: you pair the report your testing lab gave you. It&apos;s read and fingerprinted
        on your device; the file is never uploaded. Its fingerprint and file name are saved with your record. In this
        web demo the pairing isn&apos;t dated yet; on VeilCore&apos;s contract it is.
      </Alert>

      <Dropzone
        file={file}
        onFile={setFile}
        title="Drag your lab report here, or click to choose"
        hint="The report file your testing lab returned — read locally, never uploaded."
      />

      {error && (
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        A lab can also sign a report with its own key; a signed report carries more weight than one you pair yourself.
        Here, pair the report file you have.
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
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
          {busy ? 'Fingerprinting on your device…' : 'Pair this report'}
        </Button>
        {onSkip && (
          <Button variant="text" color="inherit" onClick={onSkip}>
            No report yet: skip
          </Button>
        )}
      </Stack>
    </Stack>
  );
};
