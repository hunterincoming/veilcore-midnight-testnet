// Wizard step 5 — Choose what a stranger sees. The holder picks which facts about this
// record anyone holding its id is shown; the genetics are never disclosable. A live
// preview shows what the verify page will show.
//
// The choice is saved to the registry as the record's disclosure grant BEFORE any link
// is shown or copied (attack round D). It used to live only in the link's ?show=, which
// the recipient could edit to read parent names and breeding method, and the "Proof
// sealed locally" token on screen was a hash that went nowhere. The grant applies to the
// record, so to everyone with its id — this link, the certificate QR code, anything
// forwarded — and the copy says that rather than "a recipient-specific proof".
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import {
  DISCLOSURE_FIELDS,
  GENETICS_LABEL,
  defaultDisclosure,
  disclosureFrom,
  keysOn,
  loadGrant,
  saveGrant,
  labelOf,
  type Disclosure,
  type DisclosureKey,
} from '../../veilcore/disclosure';
import { canonicalUrl } from '../../config/network';
import { DisclosedFacts } from '../verify/DisclosedFacts';

export const Step5ProveDisclosure: React.FC<{ recordId: string; onDone: () => void; onBack: () => void }> = ({
  recordId,
  onDone,
  onBack,
}) => {
  const record = getRecord(recordId);
  const [disclosure, setDisclosure] = useState<Disclosure>(defaultDisclosure());
  // What the registry holds now, so the switches start from the truth rather than from
  // defaults that may not be what strangers currently see.
  const [stored, setStored] = useState<{ show: string[]; updatedAt: string | null } | 'loading' | 'unknown'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ absolute: string; relative: string }>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void loadGrant(recordId).then((g) => {
      if (!live) return;
      if (g && !('error' in g)) {
        setStored(g);
        // A record with no grant yet starts from the defaults, which are not saved
        // until the holder presses the button.
        if (g.updatedAt !== null) setDisclosure(disclosureFrom(g.show));
      } else {
        setStored('unknown');
      }
    });
    return () => {
      live = false;
    };
  }, [recordId]);

  if (!record) return <Typography>Record not found.</Typography>;

  const toggle = (key: keyof Disclosure) => {
    setDisclosure((p) => ({ ...p, [key]: !p[key] }));
    setResult(undefined); // selection changed — not saved until the button is pressed
    setError(null);
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setResult(undefined);
    try {
      const out = await saveGrant(record.id, disclosure);
      if ('error' in out) {
        // No link without a stored grant: a link shown now would show strangers
        // whatever the registry held before, not what is on screen.
        setError(`Your choice was not saved, so no link was made: ${out.error}.`);
        return;
      }
      setStored(out);
      const relative = `/verify/${encodeURIComponent(record.id)}`;
      setResult({ absolute: canonicalUrl(relative), relative });
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

  const unsaved =
    stored === 'loading' || stored === 'unknown' || stored.updatedAt === null
      ? true
      : stored.show.join(',') !== keysOn(disclosure).join(',');

  return (
    <Stack spacing={2.5}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <VerifiedIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h5">Choose what a stranger sees</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Anyone who has this record&apos;s id — from a link you send, the QR code on its certificate, or a message
          someone forwards — can open its verify page. Pick which facts that page shows. The choice is saved with the
          record on VeilCore&apos;s registry and applies to everyone with the id; you can change it here at any time,
          and links already sent then show the new choice.
        </Typography>
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} sx={{ alignItems: 'stretch' }}>
        {/* the choices */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">
            Shown on the verify page
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {stored === 'loading'
              ? 'Checking what is shared now…'
              : stored === 'unknown'
                ? 'Could not read what is shared now from the registry.'
                : stored.updatedAt === null
                  ? 'Nothing beyond the basics is shared yet.'
                  : `Saved choice: ${stored.show.length ? stored.show.map((k) => labelOf(k as DisclosureKey)).join('; ') : 'nothing beyond the basics'}.`}
            {unsaved && stored !== 'loading' ? ' The switches above are not saved yet.' : ''}
          </Typography>
        </Box>

        {/* live preview */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">
            What a stranger with the id will see
          </Typography>
          <Paper variant="outlined" sx={{ p: 2, mt: 0.5, background: 'rgba(255,255,255,0.02)' }}>
            <DisclosedFacts record={record} disclosure={disclosure} />
          </Paper>
        </Box>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      )}

      {result && !unsaved ? (
        <Alert severity="success" variant="outlined" icon={<VerifiedIcon />}>
          <Typography variant="subtitle2">Saved on the registry</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
            Anyone who opens this link, or has this record&apos;s id any other way, sees the facts on the right and
            nothing else; the registry does not send the rest, and editing the link cannot add to it. The genetics are
            never disclosed. Proving a withheld fact without revealing it needs the per-field scheme, which the
            specification does not yet define.
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
            onClick={() => void onSave()}
          >
            {busy ? 'Saving…' : 'Save this choice & get the link'}
          </Button>
        </Box>
      )}

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
