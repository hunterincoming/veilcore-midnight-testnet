// Setting up as an attester.
//
// A lab confirming they received material is the single biggest step up in what a
// record is worth. This is how they get the key that makes their confirmation theirs
// rather than something we recorded on their behalf.
//
// The key is generated in this browser and never sent anywhere. Only the public half,
// the name, and any accreditation are published.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Link,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import BadgeIcon from '@mui/icons-material/VerifiedUserOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import { createAttester, publishAttester, loadAttester, type AttesterProfile } from '../veilcore/attester-keys';
import { Link as RouterLink } from 'react-router-dom';
import { TEAL } from '../config/theme';

const ROLE_LABEL: Record<string, string> = {
  laboratory: 'Laboratory',
  inspector: 'Inspector',
  registry: 'Registry',
  breeder: 'Breeder',
  other: 'Other',
};

/** Opens the header's signing-key dialog from elsewhere on the page (a lab's first screen). */
export const OPEN_SIGNING_KEY_EVENT = 'veilcore:open-signing-key';

export const AttesterSetup: React.FC<{ variant?: 'button' | 'text' }> = ({ variant = 'text' }) => {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<AttesterProfile | null>(loadAttester());
  const [name, setName] = useState('');
  const [role, setRole] = useState<AttesterProfile['role']>('laboratory');
  const [scheme, setScheme] = useState('ISO/IEC 17025');
  const [accId, setAccId] = useState('');
  const [accreditor, setAccreditor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_SIGNING_KEY_EVENT, show);
    return () => window.removeEventListener(OPEN_SIGNING_KEY_EVENT, show);
  }, []);

  const setup = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const accreditation =
      accId.trim() && accreditor.trim()
        ? { scheme, identifier: accId.trim(), accreditor: accreditor.trim() }
        : undefined;
    let p: AttesterProfile;
    try {
      p = await createAttester(name.trim(), role, accreditation);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not create a key.');
      setProfile(loadAttester());
      return;
    }
    // Shown from here on whether or not publishing works, so a failure leaves the key
    // on screen with a way to publish it again, never a form that makes another.
    setProfile(p);
    await publish(p);
  };

  const publish = async (p: AttesterProfile) => {
    setBusy(true);
    setError(null);
    const out = await publishAttester(p);
    setBusy(false);
    if (out.error) {
      setError(`Your key is saved in this browser but was not published: ${out.error}. Try again.`);
      return;
    }
    setProfile(loadAttester() ?? { ...p, registeredAt: Date.now() });
  };

  const backup = () => {
    if (!profile) return;
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'veilcore-attester-key.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Button
        variant={variant === 'button' ? 'outlined' : 'text'}
        startIcon={<BadgeIcon />}
        onClick={() => setOpen(true)}
      >
        {profile ? 'Your signing key' : 'Set up your signing key'}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{profile ? 'Your signing key' : 'Set up your signing key'}</DialogTitle>
        <DialogContent>
          {profile ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity={profile.registeredAt ? 'success' : 'warning'} variant="outlined">
                {profile.displayName} · {(profile.role && ROLE_LABEL[profile.role]) ?? profile.role ?? 'Other'}
                {profile.accreditation && ` · ${profile.accreditation.scheme} ${profile.accreditation.identifier}`}
                {profile.registeredAt
                  ? ''
                  : ' · not published yet: until it is, nobody can match your signatures to this name.'}
              </Alert>
              {!profile.registeredAt && (
                <Button variant="contained" onClick={() => void publish(profile)} disabled={busy}>
                  Publish again
                </Button>
              )}
              {error && (
                <Alert severity="warning" variant="outlined">
                  {error}
                </Alert>
              )}
              <Box>
                <Typography variant="overline" sx={{ display: 'block', color: TEAL }}>
                  Public key
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {profile.keypair.publicKey}
                </Typography>
              </Box>
              <Alert severity="warning" variant="outlined">
                Your private key is stored in this browser&apos;s storage, unencrypted, and nowhere else. Anything that
                can run in this site, or a browser extension with access to it, could read it. If you lose it you
                can&apos;t sign anything new; what you signed before stays valid. Back it up somewhere safe. That&apos;s
                fine for trying it out. A lab using it for real would sign inside its own systems: see the{' '}
                <Link component={RouterLink} to="/docs/integrate">
                  integration guide
                </Link>
                .
              </Alert>
              <Button variant="outlined" startIcon={<DownloadIcon />} onClick={backup}>
                Download key backup
              </Button>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                When you confirm you received material, or sign a report, it is signed with a key only you hold. It
                becomes your statement, not something we recorded on your behalf. The key is made in this browser; only
                its public half, your name and any accreditation you enter are published.
              </Typography>
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                helperText="How you appear to anyone checking a record you signed."
              />
              <TextField
                select
                label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value as AttesterProfile['role'])}
                fullWidth
              >
                <MenuItem value="laboratory">Laboratory</MenuItem>
                <MenuItem value="inspector">Inspector</MenuItem>
                <MenuItem value="registry">Registry</MenuItem>
                <MenuItem value="breeder">Breeder</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </TextField>

              <Typography variant="overline" sx={{ display: 'block' }}>
                Accreditation (optional)
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                We record this and never verify it. Whoever checks your signature can confirm it with the accreditor
                directly; that&apos;s why you name them.
              </Typography>
              <TextField select label="Scheme" value={scheme} onChange={(e) => setScheme(e.target.value)} fullWidth>
                <MenuItem value="ISO/IEC 17025">ISO/IEC 17025</MenuItem>
                <MenuItem value="ISO 9001">ISO 9001</MenuItem>
                {/* The stored value stays "State licence", as profiles saved before the label changed hold it. */}
                <MenuItem value="State licence">State license</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </TextField>
              <TextField
                label="Accreditation number"
                value={accId}
                onChange={(e) => setAccId(e.target.value)}
                fullWidth
              />
              <TextField
                label="Accreditor"
                placeholder="e.g. A2LA, PJLA, state agency"
                value={accreditor}
                onChange={(e) => setAccreditor(e.target.value)}
                fullWidth
              />

              {error && (
                <Alert severity="warning" variant="outlined">
                  {error}
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{profile ? 'Done' : 'Cancel'}</Button>
          {!profile && (
            <Button variant="contained" onClick={setup} disabled={busy || !name.trim()}>
              Create my key
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};
