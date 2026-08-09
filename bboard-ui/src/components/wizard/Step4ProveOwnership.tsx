// Step 4 — Prove ownership. To prove they hold a strain, the breeder RE-DROPS the DNA
// report; it is fingerprinted locally and matched against an existing record. Nothing
// about the genetics is revealed — the honest demonstration of zero-knowledge ownership.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import HandshakeIcon from '@mui/icons-material/HandshakeOutlined';
import GppBadIcon from '@mui/icons-material/GppBadOutlined';
import { fingerprintFile } from '../../veilcore/commitment';
import { findByDnaFingerprint } from '../../veilcore/records';
import { Dropzone } from './Dropzone';
import { FingerprintReveal } from './FingerprintReveal';

export const Step4ProveOwnership: React.FC<{ onBack: () => void; onRestart: () => void; onDone?: () => void }> = ({
  onBack,
  onRestart,
  onDone,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<{ ok: boolean; strain?: string; fingerprint?: string }>();
  const [error, setError] = useState<string>();

  const onProve = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setProof(undefined);
    try {
      const dnaHex = await fingerprintFile(file);
      const match = findByDnaFingerprint(dnaHex);
      setProof({ ok: !!match, strain: match?.strainName, fingerprint: dnaHex });
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
          Prove prior possession
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Licensing your genetics? Prove you had it first — and reveal nothing.
        </Typography>
      </Box>

      <Alert icon={<HandshakeIcon />} severity="info" variant="outlined">
        A contract binds whoever signed it. This is the evidence you bring to it — what you held, and when,
        established before any dispute.
      </Alert>

      {!proof?.ok && (
        <>
          <Typography variant="body2" color="text.secondary">
            Re-drop the same DNA report to prove you hold this cultivar. It&apos;s fingerprinted locally and matched —
            nothing about the genetics is revealed or uploaded.
          </Typography>
          <Dropzone
            file={file}
            onFile={setFile}
            title="Drag the DNA report here to prove ownership"
            hint="The same report file — read locally, never uploaded."
          />
        </>
      )}

      {error && <Alert severity="error" variant="outlined">{error}</Alert>}

      {proof && !proof.ok && (
        <Alert icon={<GppBadIcon />} severity="error" variant="outlined">
          No record matches this report. Log and pair the cultivar first, then come back to prove it.
        </Alert>
      )}

      {proof?.ok && (
        <Stack spacing={2}>
          <FingerprintReveal
            fingerprint={proof.fingerprint ?? ''}
            headline="Prior possession proven — and nothing was revealed."
            sub="You demonstrated you hold this cultivar by matching its fingerprint locally. No genetics, no details — zero bytes left your device."
          />
          <Alert severity="success" variant="outlined">
            <Typography variant="subtitle2">
              Prior possession proven. Now you can license it.
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
              You hold <b>{proof.strain}</b>. A licensee can verify this proof before they sign.
            </Typography>
          </Alert>
          <Box>
            <Chip color="primary" variant="outlined" label="This is what makes a licensing deal enforceable." />
          </Box>
        </Stack>
      )}

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        {!proof?.ok ? (
          <Button
            variant="contained"
            size="large"
            disabled={busy || !file}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
            onClick={onProve}
          >
            {busy ? 'Proving locally…' : 'Prove I own it'}
          </Button>
        ) : onDone ? (
          <Button variant="contained" onClick={onDone}>
            Continue — license your genetics
          </Button>
        ) : (
          <Button variant="contained" onClick={onRestart}>
            Log another cultivar
          </Button>
        )}
      </Stack>
    </Stack>
  );
};
