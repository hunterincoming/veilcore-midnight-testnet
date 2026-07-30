// Wizard step 2 — Send to a lab. A lab-transfer agreement (custody, not commerce): terms
// bound to the genetics before the material physically leaves the breeder's hands. Fully
// skippable — a breeder who isn't sending anything anywhere moves on in one click.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import { getRecord } from '../../veilcore/records';
import { createLicense, type LicenseTerms } from '../../veilcore/licenses';
import { fingerprintText } from '../../veilcore/commitment';
import { AgreementTermsFields, emptyTermsFor, type SetTerm } from '../licensing/LicenseTermsFields';

export const Step2LabTransfer: React.FC<{
  recordId: string;
  onDone: (licenseId?: string) => void;
  onSkip: () => void;
  onBack: () => void;
}> = ({ recordId, onDone, onSkip, onBack }) => {
  const record = getRecord(recordId);
  const [t, setT] = useState<LicenseTerms>(emptyTermsFor('lab-transfer'));
  const [busy, setBusy] = useState(false);
  const set: SetTerm = (k, v) => setT((p) => ({ ...p, [k]: v }));

  if (!record) return <Typography>Record not found.</Typography>;

  const canSeal = Boolean(t.licensee.trim());

  const onSeal = async () => {
    if (!canSeal) return;
    setBusy(true);
    try {
      const agreementFingerprint = await fingerprintText(
        JSON.stringify({ type: 'lab-transfer', terms: t, record: record.recordFingerprint }),
      );
      const lic = createLicense({
        type: 'lab-transfer',
        recordId: record.id,
        recordFingerprint: record.recordFingerprint,
        dnaFingerprint: record.dnaFingerprint,
        terms: t,
        agreementFingerprint,
      });
      onDone(lic.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <ScienceIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h5">Send to a lab</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          About to send genetics to a tissue culture or DNA lab? Put terms on it before it leaves your hands.
        </Typography>
      </Box>

      <Alert icon={<ScienceIcon />} severity="info" variant="outlined">
        This puts the transfer terms on the record before the material leaves your hands. It&apos;s custody, not a
        sale: no royalty, no fee.
      </Alert>

      <AgreementTermsFields type="lab-transfer" terms={t} set={set} />

      <Divider />
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        <Button variant="contained" size="large" disabled={busy || !canSeal} onClick={onSeal}>
          {busy ? 'Sealing transfer…' : 'Seal transfer & continue'}
        </Button>
        <Button variant="text" color="inherit" onClick={onSkip}>
          Not sending it anywhere yet — skip
        </Button>
      </Stack>
    </Stack>
  );
};
