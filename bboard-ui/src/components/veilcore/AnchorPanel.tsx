// AnchorPanel — "Anchor your strain": enter genetics, hash locally, anchor the commitment.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import AnchorIcon from '@mui/icons-material/AnchorOutlined';
import { motion } from 'framer-motion';
import { commitGenetics } from '../../veilcore/commitment';
import { anchorStrain, type AnchoredStrain } from '../../veilcore/demoStore';
import { CommitmentReveal } from './CommitmentReveal';

const MBox = motion(Box);

export const AnchorPanel: React.FC = () => {
  const [genetics, setGenetics] = useState('');
  const [label, setLabel] = useState('');
  const [commitmentHex, setCommitmentHex] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; record?: AnchoredStrain }>();

  const onGeneticsChange = (v: string) => {
    setGenetics(v);
    setCommitmentHex(undefined);
    setResult(undefined);
  };

  const onAnchor = async () => {
    if (!genetics.trim()) return;
    setBusy(true);
    setResult(undefined);
    try {
      const { commitmentHex: c } = await commitGenetics(genetics);
      setCommitmentHex(c);
      // Simulated on-chain anchor (demo mode). Real mode: veilcoreApi.anchor(commitment).
      const record = anchorStrain(c, label);
      if (record) {
        setResult({ ok: true, msg: `Strain anchored as #${record.timestamp}.`, record });
      } else {
        setResult({ ok: false, msg: 'This exact genetics commitment is already anchored on-chain.' });
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
          Anchor your strain
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Record an immutable, timestamped proof that this genetic material existed — without ever publishing the
          genetics.
        </Typography>
      </Box>

      <TextField
        label="Genetic material"
        placeholder="Paste a sequence, marker set, or any representation of the strain's genetics…"
        value={genetics}
        onChange={(e) => onGeneticsChange(e.target.value)}
        multiline
        minRows={4}
        fullWidth
      />
      <TextField
        label="Strain label (public, optional)"
        placeholder="e.g. Veil-A17 · lot 2231"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        fullWidth
      />

      <Box>
        <Button
          variant="contained"
          size="large"
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <AnchorIcon />}
          disabled={busy || !genetics.trim()}
          onClick={onAnchor}
        >
          {busy ? 'Hashing & anchoring…' : 'Hash locally & anchor'}
        </Button>
      </Box>

      <CommitmentReveal commitmentHex={commitmentHex} />

      {result && (
        <MBox initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Alert severity={result.ok ? 'success' : 'warning'} variant="outlined">
            {result.msg}
            {result.record && (
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 0.5, fontFamily: '"Space Grotesk", monospace', color: 'text.secondary' }}
              >
                tx {result.record.txId} · commitment {result.record.commitment.slice(0, 24)}…
              </Typography>
            )}
          </Alert>
        </MBox>
      )}
    </Stack>
  );
};
