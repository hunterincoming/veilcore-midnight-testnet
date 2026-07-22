// TermsBuilder (/record/:id/license) — standalone terms builder. On save, the agreement
// is hashed locally and bound to the cultivar record + its DNA fingerprint, then created
// as a Draft the breeder can issue.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import { useNavigate, useParams, useSearchParams, Link as RouterLink } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import { getRecord } from '../../veilcore/records';
import { createLicense, renewLicense, getLicense, FEE_NOTE, type LicenseTerms } from '../../veilcore/licenses';
import { fingerprintText } from '../../veilcore/commitment';
import { AppHeader } from '../AppHeader';
import { LicenseTermsFields, emptyTerms, type SetTerm } from './LicenseTermsFields';

export const TermsBuilder: React.FC = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const supersedeId = params.get('supersede') ?? undefined;
  const navigate = useNavigate();
  const record = getRecord(id);
  const prior = supersedeId ? getLicense(supersedeId) : undefined;

  const [t, setT] = useState<LicenseTerms>(prior?.terms ?? emptyTerms());
  const [busy, setBusy] = useState(false);
  const set: SetTerm = (k, v) => setT((p) => ({ ...p, [k]: v }));

  if (!record) {
    return (
      <Box>
        <AppHeader />
        <Typography>Record not found.</Typography>
      </Box>
    );
  }

  const canSave = t.licensee.trim() && t.royaltyAmount.trim();

  const onSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const agreementFingerprint = await fingerprintText(JSON.stringify({ terms: t, record: record.recordFingerprint }));
      const lic = supersedeId
        ? renewLicense(supersedeId, t, agreementFingerprint)
        : createLicense({
            recordId: record.id,
            recordFingerprint: record.recordFingerprint,
            dnaFingerprint: record.dnaFingerprint,
            terms: t,
            agreementFingerprint,
          });
      if (lic) navigate(`/license/${lic.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <AppHeader />
      <Button component={RouterLink} to={`/record/${record.id}`} size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to {record.strainName}
      </Button>
      <Typography variant="h4" sx={{ mb: 0.5 }}>
        {supersedeId ? 'Renew / amend license' : 'License this cultivar'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Set the terms in plain language. When you save, the agreement is sealed and bound to {record.strainName} and its
        genetics — so the terms travel with the plant.
      </Typography>

      <LicenseTermsFields terms={t} set={set} />

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        {FEE_NOTE}
      </Typography>

      <Divider sx={{ my: 3 }} />
      <Box>
        <Button variant="contained" size="large" disabled={busy || !canSave} onClick={onSave}>
          {busy ? 'Sealing agreement…' : supersedeId ? 'Save amended license' : 'Create license (Draft)'}
        </Button>
      </Box>
    </Box>
  );
};
