// Sharing a licence with someone who needs to see it.
//
// The public face travels always — this licence exists, its state, what it was issued
// against, whether it binds descendants. That is what a buyer downstream needs, and it
// reveals nothing commercially sensitive.
//
// Everything else is opt-in. Ungranted terms are absent from the file rather than
// hidden in it, so a recipient cannot open it in a text editor and read what they were
// not given.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Stack, Typography,
} from '@mui/material';
import ShareIcon from '@mui/icons-material/IosShareOutlined';
import { exportCertificate, type LicenseGrant } from '../../veilcore/license-certificate';
import type { License } from '../../veilcore/licenses';
import { TEAL } from '../../config/theme';

/** Named after what the recipient learns, not the field revealed. */
const GRANTS: { key: LicenseGrant; label: string; why: string }[] = [
  { key: 'scope', label: 'What they may do', why: 'Rights granted, whether they can sublicense, exclusivity' },
  { key: 'territory', label: 'Where it applies', why: 'The licensed territory' },
  { key: 'term', label: 'How long it runs', why: 'Start and end dates' },
  { key: 'royalty', label: 'The commercial terms', why: 'Royalty type, amount and basis. Usually the most sensitive' },
  { key: 'offspring', label: 'The obligation on offspring', why: 'What descendants owe. A downstream buyer often needs this' },
  { key: 'parties', label: 'Who the counterparty is', why: 'The licensee name' },
];

export const ShareLicense: React.FC<{ license: License }> = ({ license }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Set<LicenseGrant>>(new Set(['offspring']));

  const toggle = (k: LicenseGrant) =>
    setChosen((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const share = async () => {
    setBusy(true);
    await exportCertificate(license, ['existence', ...chosen]);
    setBusy(false);
    setOpen(false);
  };

  return (
    <>
      <Button variant="outlined" startIcon={<ShareIcon />} onClick={() => setOpen(true)}>
        Share licence
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Share {license.id}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box>
              <Typography variant="overline" sx={{ color: TEAL, display: 'block' }}>
                Always included
              </Typography>
              <Typography variant="body2" color="text.secondary">
                That this licence exists, its current state, the record it was issued against, and
                whether it binds descendants. Anyone can verify these without your permission —
                that is what makes the licence checkable rather than a claim.
              </Typography>
            </Box>

            <Box>
              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Choose what else they see
              </Typography>
              <Stack>
                {GRANTS.map((g) => (
                  <FormControlLabel
                    key={g.key}
                    control={<Checkbox checked={chosen.has(g.key)} onChange={() => toggle(g.key)} />}
                    label={
                      <Box>
                        <Typography variant="body2">{g.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{g.why}</Typography>
                      </Box>
                    }
                    sx={{ alignItems: 'flex-start', mb: 0.5 }}
                  />
                ))}
              </Stack>
            </Box>

            <Alert severity="info" variant="outlined">
              What you leave unchecked is not in the file at all — not hidden, absent. They cannot
              read it however they open it.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={share} disabled={busy}>
            Download certificate
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
