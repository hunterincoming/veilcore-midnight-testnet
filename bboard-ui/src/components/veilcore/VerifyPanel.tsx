// VerifyPanel — "Verify / prove ownership": re-enter genetics, prove it matches an
// anchored commitment in zero knowledge, without revealing the genetics.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import GppBadIcon from '@mui/icons-material/GppBadOutlined';
import { motion } from 'framer-motion';
import { commitGenetics } from '../../veilcore/commitment';
import { isAnchored, findByCommitment } from '../../veilcore/demoStore';
import { CommitmentReveal } from './CommitmentReveal';

const MBox = motion(Box);

export const VerifyPanel: React.FC = () => {
  const [genetics, setGenetics] = useState('');
  const [commitmentHex, setCommitmentHex] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; label?: string }>();

  const onGeneticsChange = (v: string) => {
    setGenetics(v);
    setCommitmentHex(undefined);
    setResult(undefined);
  };

  const onProve = async () => {
    if (!genetics.trim()) return;
    setBusy(true);
    setResult(undefined);
    try {
      const { commitmentHex: c } = await commitGenetics(genetics);
      setCommitmentHex(c);
      // Simulated proof (demo mode). Real mode: veilcoreApi.proveOwnership(geneticSecret).
      if (isAnchored(c)) {
        const record = findByCommitment(c);
        setResult({ ok: true, msg: 'Provenance verified in zero knowledge.', label: record?.label });
      } else {
        setResult({ ok: false, msg: 'No anchored strain matches this genetics.' });
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Prove ownership
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Demonstrate that you hold the secret behind a previously-anchored strain — revealing nothing about the
          genetics themselves.
        </Typography>
      </Box>

      <TextField
        label="Genetic material"
        placeholder="Re-enter the strain's genetics to prove you hold it…"
        value={genetics}
        onChange={(e) => onGeneticsChange(e.target.value)}
        multiline
        minRows={4}
        fullWidth
      />

      <Box>
        <Button
          variant="contained"
          size="large"
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <VerifiedIcon />}
          disabled={busy || !genetics.trim()}
          onClick={onProve}
        >
          {busy ? 'Proving…' : 'Prove ownership (zero-knowledge)'}
        </Button>
      </Box>

      <CommitmentReveal commitmentHex={commitmentHex} />

      {result && (
        <MBox initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Alert
            icon={result.ok ? <VerifiedIcon /> : <GppBadIcon />}
            severity={result.ok ? 'success' : 'error'}
            variant="outlined"
          >
            {result.msg}
            {result.ok && result.label && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                Matched anchored strain: {result.label}
              </Typography>
            )}
          </Alert>
        </MBox>
      )}
    </Stack>
  );
};
