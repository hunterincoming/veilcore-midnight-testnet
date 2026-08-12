// A lab returning its report.
//
// The lab produces the report, so this is the only place a report legitimately enters
// the system. It is hashed here, never uploaded, and the hash is signed with the lab's
// own key and attached to the SENDER's record — because that is whose evidence it is.
//
// The lab's own record gets nothing from this. They did not seal the sender's material
// and cannot claim the sender's evidence; what they contribute is a statement about it.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import { fingerprintFile, shortFingerprint } from '../veilcore/commitment';
import { loadAttester, attestRecord } from '../veilcore/attester-keys';
import type { StrainRecord } from '../veilcore/records';
import { Dropzone } from './wizard/Dropzone';
import { TEAL } from '../config/theme';

export const AttachReport: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<'laboratory-report' | 'genetic-fingerprint' | 'inspection'>('laboratory-report');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ hash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attester = loadAttester();

  const attach = async () => {
    if (!file) return;
    const source = record.receivedFromCommitment;
    if (!source) { setError('This record did not arrive through a transfer, so there is no sender to attest to.'); return; }
    if (!attester) { setError('Set up an attester identity first — a report signed by nobody is not evidence.'); return; }

    setBusy(true);
    setError(null);
    try {
      // Hashed here. The report itself never leaves this device — a hash is enough to
      // prove later that a produced document is the one that was signed.
      const hash = await fingerprintFile(file);
      const out = await attestRecord(attester, source, hash, type);
      if (out.error) { setError(out.error); setBusy(false); return; }
      setDone({ hash });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <>
      <Button variant="contained" startIcon={<ScienceIcon />} onClick={() => setOpen(true)}>
        Attach a report
      </Button>

      <Dialog open={open} onClose={() => { setOpen(false); setDone(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>{done ? 'Report signed' : 'Attach your report'}</DialogTitle>
        <DialogContent>
          {done ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="success" variant="outlined">
                Signed and sent to the sender's record. They will see it attributed to
                {' '}{attester?.displayName ?? 'you'}, with your signature.
              </Alert>
              <Box>
                <Typography variant="overline" sx={{ display: 'block', color: TEAL }}>Document fingerprint</Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 13 }}>{shortFingerprint(done.hash)}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Keep the report file. The hash proves a document is the one you signed — without it
                there is nothing to compare against.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Your report is hashed on this device and never uploaded. The hash is signed with your
                key and attached to the sender's record — it is their evidence, and your statement
                about it.
              </Typography>

              {!attester && (
                <Alert severity="warning" variant="outlined">
                  You need an attester identity first. A report the registry records on your behalf
                  is not the same as one you signed.
                </Alert>
              )}

              <TextField select label="Report type" value={type} onChange={(e) => setType(e.target.value as typeof type)} fullWidth>
                <MenuItem value="laboratory-report">Laboratory report (COA)</MenuItem>
                <MenuItem value="genetic-fingerprint">Genetic fingerprint</MenuItem>
                <MenuItem value="inspection">Inspection</MenuItem>
              </TextField>

              <Dropzone
                file={file}
                onFile={setFile}
                title="Drop your report"
                hint="Hashed on this device. The file itself is never uploaded."
              />
              {error && <Alert severity="warning" variant="outlined">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setOpen(false); setDone(null); }}>{done ? 'Done' : 'Cancel'}</Button>
          {!done && (
            <Button variant="contained" onClick={attach} disabled={busy || !file || !attester}>
              Sign and send
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};
