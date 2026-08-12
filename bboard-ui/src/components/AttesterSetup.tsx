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

import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import BadgeIcon from '@mui/icons-material/VerifiedUserOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import { createAttester, publishAttester, loadAttester, type AttesterProfile } from '../veilcore/attester-keys';
import { TEAL } from '../config/theme';

export const AttesterSetup: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<AttesterProfile | null>(loadAttester());
  const [name, setName] = useState('');
  const [role, setRole] = useState<AttesterProfile['role']>('laboratory');
  const [scheme, setScheme] = useState('ISO/IEC 17025');
  const [accId, setAccId] = useState('');
  const [accreditor, setAccreditor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setup = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const accreditation = accId.trim() && accreditor.trim()
      ? { scheme, identifier: accId.trim(), accreditor: accreditor.trim() }
      : undefined;
    const p = await createAttester(name.trim(), role, accreditation);
    const out = await publishAttester(p);
    setBusy(false);
    if (out.error) { setError(out.error); return; }
    setProfile({ ...p, registeredAt: Date.now() });
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
      <Button variant="text" startIcon={<BadgeIcon />} onClick={() => setOpen(true)}>
        {profile ? 'Attester identity' : 'Set up as an attester'}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{profile ? 'Your attester identity' : 'Set up as an attester'}</DialogTitle>
        <DialogContent>
          {profile ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="success" variant="outlined">
                {profile.displayName} — {profile.role}
                {profile.accreditation && ` · ${profile.accreditation.scheme} ${profile.accreditation.identifier}`}
              </Alert>
              <Box>
                <Typography variant="overline" sx={{ display: 'block', color: TEAL }}>Public key</Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {profile.keypair.publicKey}
                </Typography>
              </Box>
              <Alert severity="warning" variant="outlined">
                Your private key is stored in this browser and nowhere else. If you lose it you cannot
                sign new attestations — past ones stay valid and can still be retracted through the
                registry. Back it up somewhere safe.
              </Alert>
              <Button variant="outlined" startIcon={<DownloadIcon />} onClick={backup}>
                Download key backup
              </Button>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                When you confirm you received material, that confirmation is signed with a key only
                you hold. It becomes your statement rather than something we recorded on your
                behalf — which is what makes it evidence.
              </Typography>
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth
                helperText="How you'll appear to anyone verifying a record you attested to." />
              <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as AttesterProfile['role'])} fullWidth>
                <MenuItem value="laboratory">Laboratory</MenuItem>
                <MenuItem value="inspector">Inspector</MenuItem>
                <MenuItem value="registry">Registry</MenuItem>
                <MenuItem value="breeder">Breeder</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </TextField>

              <Typography variant="overline" sx={{ display: 'block' }}>Accreditation (optional)</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                We record this and never verify it. Whoever checks your attestation can confirm it
                with the accreditor directly — that's the point of naming them.
              </Typography>
              <TextField select label="Scheme" value={scheme} onChange={(e) => setScheme(e.target.value)} fullWidth>
                <MenuItem value="ISO/IEC 17025">ISO/IEC 17025</MenuItem>
                <MenuItem value="ISO 9001">ISO 9001</MenuItem>
                <MenuItem value="State licence">State licence</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </TextField>
              <TextField label="Accreditation number" value={accId} onChange={(e) => setAccId(e.target.value)} fullWidth />
              <TextField label="Accreditor" placeholder="e.g. A2LA, PJLA, state agency"
                value={accreditor} onChange={(e) => setAccreditor(e.target.value)} fullWidth />

              {error && <Alert severity="warning" variant="outlined">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{profile ? 'Done' : 'Cancel'}</Button>
          {!profile && (
            <Button variant="contained" onClick={setup} disabled={busy || !name.trim()}>
              Create identity
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};
