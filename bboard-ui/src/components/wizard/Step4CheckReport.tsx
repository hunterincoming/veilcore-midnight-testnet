// Step 4 — Check a report matches a record. The holder picks a lab report file; it is
// fingerprinted in this browser and compared with the report fingerprints paired to the
// records this browser holds. Nothing is sent anywhere, so the result is for the holder:
// nobody else sees it or can verify it from here. It shows possession of a matching
// file, nothing about ownership, and it is not a proof a third party can check. A third
// party checks a record on the verify page, and its date once the record is anchored.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import GppBadIcon from '@mui/icons-material/GppBadOutlined';
import { fingerprintFile } from '../../veilcore/commitment';
import { findByDnaFingerprint } from '../../veilcore/records';
import { Dropzone } from './Dropzone';
import { FingerprintReveal } from './FingerprintReveal';

export const Step4CheckReport: React.FC<{ onBack: () => void; onRestart: () => void; onDone?: () => void }> = ({
  onBack,
  onRestart,
  onDone,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; name?: string; id?: string; fingerprint?: string }>();
  const [error, setError] = useState<string>();

  const onCheck = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const reportHex = await fingerprintFile(file);
      const match = findByDnaFingerprint(reportHex);
      setResult({ ok: !!match, name: match?.strainName, id: match?.id, fingerprint: reportHex });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Check a report matches this record
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pick a lab report file to see whether it is the one paired with a record you hold.
        </Typography>
      </Box>

      <Alert icon={<FactCheckIcon />} severity="info" variant="outlined">
        This check runs only in your browser and sends nothing, so it is for you. It shows you have a file matching the
        report paired with a record. It does not show ownership, and nobody else can verify it from here. Others check a
        record on its verify page, and its date once the record is anchored.
      </Alert>

      {!result?.ok && (
        <Dropzone
          file={file}
          onFile={setFile}
          title="Drag the lab report here, or click to choose"
          hint="Read and fingerprinted locally, never uploaded."
        />
      )}

      {error && (
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      )}

      {result && !result.ok && (
        <Alert icon={<GppBadIcon />} severity="error" variant="outlined">
          None of your records has this report paired. Pair it with the right record first, then check again.
        </Alert>
      )}

      {result?.ok && (
        <Stack spacing={2}>
          <FingerprintReveal
            fingerprint={result.fingerprint ?? ''}
            headline="Match found."
            sub="This file was fingerprinted in your browser and was not uploaded."
          />
          <Alert severity="success" variant="outlined">
            <Typography variant="subtitle2">This file matches the report paired with {result.name}.</Typography>
            <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
              Record {result.id}. A match means the file is byte-for-byte the one you paired; it says nothing about the
              genetics and nothing about ownership.
            </Typography>
          </Alert>
        </Stack>
      )}

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        {!result?.ok ? (
          <Button
            variant="contained"
            size="large"
            disabled={busy || !file}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
            onClick={onCheck}
          >
            {busy ? 'Checking on your device…' : 'Check it'}
          </Button>
        ) : onDone ? (
          <Button variant="contained" onClick={onDone}>
            Continue
          </Button>
        ) : (
          <Button variant="contained" onClick={onRestart}>
            Done
          </Button>
        )}
      </Stack>
    </Stack>
  );
};
