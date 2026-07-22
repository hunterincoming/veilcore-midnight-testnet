// Wizard step 5 — Prove what you choose. Midnight's core capability, made concrete: the
// breeder generates a proof for a specific recipient and picks exactly which facts that
// recipient sees. A live preview shows precisely what they'll get; the genetics are never
// disclosable. The proof runs the real `commit` circuit locally — only settlement is simulated.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import LockIcon from '@mui/icons-material/LockOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import { getRecord } from '../../veilcore/records';
import { fingerprintText, shortFingerprint } from '../../veilcore/commitment';
import {
  DISCLOSURE_FIELDS,
  GENETICS_LABEL,
  defaultDisclosure,
  encodeDisclosure,
  type Disclosure,
} from '../../veilcore/disclosure';
import { DisclosedFacts } from '../verify/DisclosedFacts';

export const Step5ProveDisclosure: React.FC<{ recordId: string; onDone: () => void; onBack: () => void }> = ({
  recordId,
  onDone,
  onBack,
}) => {
  const record = getRecord(recordId);
  const [recipient, setRecipient] = useState('');
  const [disclosure, setDisclosure] = useState<Disclosure>(defaultDisclosure());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ absolute: string; relative: string; token: string }>();
  const [copied, setCopied] = useState(false);

  if (!record) return <Typography>Record not found.</Typography>;

  const toggle = (key: keyof Disclosure) => {
    setDisclosure((p) => ({ ...p, [key]: !p[key] }));
    setResult(undefined); // selection changed — the old link no longer matches
  };

  const onGenerate = async () => {
    setBusy(true);
    try {
      const show = encodeDisclosure(disclosure);
      // Runs the real commit circuit locally — a genuine local commitment over exactly what
      // this recipient will see. Nothing is submitted on-chain here.
      const token = await fingerprintText(JSON.stringify({ r: record.recordFingerprint, show, to: recipient.trim() }));
      const query = `show=${show}${recipient.trim() ? `&to=${encodeURIComponent(recipient.trim())}` : ''}`;
      setResult({
        absolute: `${window.location.origin}/verify/${record.id}?${query}`,
        relative: `/verify/${record.id}?${query}`,
        token,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.absolute);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <VerifiedIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h5">Prove what you choose</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Prove what matters. Reveal nothing else. They get certainty about exactly what they need — and no access to
          anything they don&apos;t.
        </Typography>
      </Box>

      <TextField
        label="Who is this proof for? (optional)"
        placeholder="e.g. a potential licensee, a lab, a buyer"
        helperText="The proof link is prepared for this recipient."
        value={recipient}
        onChange={(e) => {
          setRecipient(e.target.value);
          setResult(undefined);
        }}
        fullWidth
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} sx={{ alignItems: 'stretch' }}>
        {/* the choices */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">
            Choose what they see
          </Typography>
          <Stack sx={{ mt: 0.5 }}>
            {DISCLOSURE_FIELDS.map((f) => (
              <FormControlLabel
                key={f.key}
                control={<Switch checked={disclosure[f.key]} onChange={() => toggle(f.key)} size="small" />}
                label={<Typography variant="body2">{f.label}</Typography>}
              />
            ))}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1, opacity: 0.7 }}>
              <LockIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              <Typography variant="body2" color="text.disabled">
                {GENETICS_LABEL}
              </Typography>
            </Stack>
          </Stack>
        </Box>

        {/* live preview */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">
            Here&apos;s exactly what they&apos;ll see
          </Typography>
          <Paper variant="outlined" sx={{ p: 2, mt: 0.5, background: 'rgba(255,255,255,0.02)' }}>
            {recipient.trim() && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Prepared for {recipient.trim()}
              </Typography>
            )}
            <DisclosedFacts record={record} disclosure={disclosure} />
          </Paper>
        </Box>
      </Stack>

      {result ? (
        <Alert severity="success" variant="outlined" icon={<VerifiedIcon />}>
          <Typography variant="subtitle2">Proof sealed locally · {shortFingerprint(result.token)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
            Share this recipient-specific link. It shows only what you selected — the withheld facts stay sealed and
            provable, and the genetics are never disclosed.
          </Typography>
          <TextField
            value={result.absolute}
            fullWidth
            size="small"
            slotProps={{ input: { readOnly: true } }}
            sx={{ mb: 1 }}
          />
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<VisibilityIcon />}
              component={RouterLink}
              to={result.relative}
              target="_blank"
            >
              Open what they&apos;ll see
            </Button>
          </Stack>
        </Alert>
      ) : (
        <Box>
          <Button
            variant="contained"
            size="large"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
            onClick={onGenerate}
          >
            {busy ? 'Proving locally…' : 'Generate proof & share link'}
          </Button>
        </Box>
      )}

      <Chip
        size="small"
        variant="outlined"
        label="Real commit circuit runs locally · settlement simulated — no on-chain proof submitted right now"
        sx={{ alignSelf: 'flex-start', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
      />

      <Divider />
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        <Button variant="contained" onClick={onDone}>
          Continue — share or license
        </Button>
      </Stack>
    </Stack>
  );
};
