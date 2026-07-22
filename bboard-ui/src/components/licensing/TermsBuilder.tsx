// TermsBuilder (/record/:id/license) — standalone terms builder. On save, the agreement
// is hashed locally and bound to the cultivar record + its DNA fingerprint, then created
// as a Draft the breeder can issue.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import { useNavigate, useParams, useSearchParams, Link as RouterLink } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import { getRecord } from '../../veilcore/records';
import {
  createLicense,
  renewLicense,
  getLicense,
  FEE_NOTE,
  hasVeilcoreFee,
  AGREEMENT_LABEL,
  AGREEMENT_TAGLINE,
  type AgreementType,
  type LicenseTerms,
} from '../../veilcore/licenses';
import { fingerprintText } from '../../veilcore/commitment';
import { AppHeader } from '../AppHeader';
import { AgreementTermsFields, emptyTermsFor, type SetTerm } from './LicenseTermsFields';
import { AgreementTypeChip } from './AgreementTypeChip';

const isType = (v: string | null): v is AgreementType =>
  v === 'license' || v === 'lab-transfer' || v === 'breeder-share';

export const TermsBuilder: React.FC = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const supersedeId = params.get('supersede') ?? undefined;
  const navigate = useNavigate();
  const record = getRecord(id);
  const prior = supersedeId ? getLicense(supersedeId) : undefined;

  // When renewing, keep the prior agreement's type; otherwise take it from ?type= (the
  // action the user clicked), defaulting to a commercial license.
  const typeParam = params.get('type');
  const type: AgreementType = prior?.type ?? (isType(typeParam) ? typeParam : 'license');

  const [t, setT] = useState<LicenseTerms>(prior?.terms ?? emptyTermsFor(type));
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

  // A commercial license needs a royalty amount; the others just need a counterparty.
  const canSave = type === 'license' ? Boolean(t.licensee.trim() && t.royaltyAmount.trim()) : Boolean(t.licensee.trim());

  const onSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const agreementFingerprint = await fingerprintText(
        JSON.stringify({ type, terms: t, record: record.recordFingerprint }),
      );
      const lic = supersedeId
        ? renewLicense(supersedeId, t, agreementFingerprint)
        : createLicense({
            type,
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

  const heading = supersedeId ? `Renew / amend — ${AGREEMENT_LABEL[type]}` : AGREEMENT_LABEL[type];
  const saveLabel = busy
    ? 'Sealing agreement…'
    : supersedeId
      ? 'Save amended agreement'
      : `Create agreement (Draft)`;

  return (
    <Box>
      <AppHeader />
      <Button component={RouterLink} to={`/record/${record.id}`} size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to {record.strainName}
      </Button>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
        <Typography variant="h4">{heading}</Typography>
        <AgreementTypeChip type={type} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {AGREEMENT_TAGLINE[type]}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Set the terms in plain language. When you save, the agreement is sealed and bound to {record.strainName} and its
        genetics — so the terms travel with the plant.
      </Typography>

      <AgreementTermsFields type={type} terms={t} set={set} />

      {hasVeilcoreFee(type, t) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          {FEE_NOTE}
        </Typography>
      )}

      <Divider sx={{ my: 3 }} />
      <Box>
        <Button variant="contained" size="large" disabled={busy || !canSave} onClick={onSave}>
          {saveLabel}
        </Button>
      </Box>
    </Box>
  );
};
