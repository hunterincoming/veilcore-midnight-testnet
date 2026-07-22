// Step 4 — License your genetics. The centerpiece / revenue moment. Build terms, issue
// (breeder signs), counter-sign (licensee), and land on the active license + royalty
// terms: "this is how breeders get paid." All bound to the cultivar's genetics.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Divider, Paper, Stack, TextField, Typography, Chip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { motion } from 'framer-motion';
import { getRecord } from '../../veilcore/records';
import {
  useLicenses,
  createLicense,
  issueLicense,
  countersignLicense,
  getLicense,
  RIGHTS_LABEL,
  VEILCORE_FEE_PCT,
  FEE_NOTE,
  type LicenseTerms,
} from '../../veilcore/licenses';
import { fingerprintText } from '../../veilcore/commitment';
import { LicenseTermsFields, emptyTerms, type SetTerm } from '../licensing/LicenseTermsFields';
import { LicenseStateChip } from '../licensing/LicenseStateChip';
import { TEAL } from '../../config/theme';

const MBox = motion(Box);
const royaltyText = (t: LicenseTerms) =>
  t.royaltyType === 'percent' ? `${t.royaltyAmount || '—'}% · ${t.unitBasis}` : `$${t.royaltyAmount || '—'} · ${t.unitBasis}`;

export const Step4License: React.FC<{
  recordId: string;
  onDone: (licenseId?: string) => void;
  onBack: () => void;
}> = ({ recordId, onDone, onBack }) => {
  useLicenses();
  const navigate = useNavigate();
  const record = getRecord(recordId);
  const [t, setT] = useState<LicenseTerms>(emptyTerms());
  const [phase, setPhase] = useState<'terms' | 'issued' | 'active'>('terms');
  const [licenseId, setLicenseId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set: SetTerm = (k, v) => setT((p) => ({ ...p, [k]: v }));

  const canIssue = t.licensee.trim() && t.royaltyAmount.trim();
  const license = licenseId ? getLicense(licenseId) : undefined;
  const signLink = licenseId ? `${window.location.origin}/license/${licenseId}/sign` : '';

  const onCreateIssue = async () => {
    if (!canIssue || !record) return;
    setBusy(true);
    try {
      const agreementFingerprint = await fingerprintText(JSON.stringify({ terms: t, record: record.recordFingerprint }));
      const lic = createLicense({
        type: 'license',
        recordId: record.id,
        recordFingerprint: record.recordFingerprint,
        dnaFingerprint: record.dnaFingerprint,
        terms: t,
        agreementFingerprint,
      });
      issueLicense(lic.id);
      setLicenseId(lic.id);
      setPhase('issued');
    } finally {
      setBusy(false);
    }
  };

  const onCountersign = () => {
    if (licenseId) {
      countersignLicense(licenseId);
      setPhase('active');
    }
  };

  if (!record) return <Typography>Record not found.</Typography>;

  // ---- phase: active (the money moment) ----
  if (phase === 'active' && license) {
    return (
      <Stack spacing={2.5}>
        <MBox initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} sx={{ textAlign: 'center', py: 1 }}>
          <PaidIcon sx={{ fontSize: 56, color: TEAL, filter: `drop-shadow(0 0 18px ${TEAL})`, mb: 1 }} />
          <Typography variant="h4" sx={{ color: TEAL }}>
            This is how breeders get paid.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto', mt: 1 }}>
            Both parties signed. The license is active — and its terms are bound to {record.strainName}&apos;s genetics,
            so they travel with the plant even to someone who never signed.
          </Typography>
        </MBox>

        <Paper sx={{ p: { xs: 2.5, md: 3 }, border: `1px solid ${TEAL}55` }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="overline">Active license</Typography>
            <LicenseStateChip license={license} />
          </Stack>
          <Stack spacing={1}>
            <Row k="Licensee" v={license.terms.licensee} />
            <Row k="Rights" v={RIGHTS_LABEL[license.terms.rights]} />
            <Row k="Royalty (your cut)" v={royaltyText(license.terms)} />
            <Row k={`Veilcore fee (${VEILCORE_FEE_PCT}% of deal value)`} v="calculated, not collected" />
            <Row k="Term" v={`${license.terms.startDate} → ${license.terms.endDate}`} />
            <Row k="Exclusivity" v={license.terms.exclusive ? 'Exclusive' : 'Non-exclusive'} />
          </Stack>
        </Paper>

        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => navigate(`/license/${license.id}`)}>
            Manage this license
          </Button>
          <Button variant="contained" onClick={() => onDone(license.id)}>
            Finish
          </Button>
        </Stack>
      </Stack>
    );
  }

  // ---- phase: issued (awaiting counter-signature) ----
  if (phase === 'issued' && license) {
    return (
      <Stack spacing={2.5}>
        <Typography variant="h5">Send it to your licensee</Typography>
        <Alert severity="warning" variant="outlined">
          You&apos;ve signed. The license is <b>not active</b> until the licensee counter-signs.
        </Alert>
        <TextField
          label="Counter-sign link (send to your licensee)"
          value={signLink}
          fullWidth
          size="small"
          slotProps={{ input: { readOnly: true } }}
        />
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => navigator.clipboard.writeText(signLink)}>
            Copy link
          </Button>
          <Button variant="contained" onClick={onCountersign}>
            Simulate counter-signature
          </Button>
          <Chip size="small" variant="outlined" label="Demo — settlement simulated" />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          In the live product, the licensee opens the link, reviews the terms, and signs — only then does it activate.
        </Typography>
      </Stack>
    );
  }

  // ---- phase: terms ----
  return (
    <Stack spacing={2.5}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <GavelIcon sx={{ color: TEAL }} />
          <Typography variant="h5">License your genetics</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          License this cultivar to a grower or company — with terms bound to the genetics themselves, not just a
          signature page. This is where breeders get paid.
        </Typography>
      </Box>

      <LicenseTermsFields terms={t} set={set} />

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {FEE_NOTE}
      </Typography>

      <Divider />
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        <Button variant="contained" size="large" disabled={busy || !canIssue} onClick={onCreateIssue}>
          {busy ? 'Sealing agreement…' : 'Create & sign license'}
        </Button>
        <Button variant="text" color="inherit" onClick={() => onDone(undefined)}>
          Skip licensing for now
        </Button>
      </Stack>
    </Stack>
  );
};

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
    <Typography variant="body2" color="text.secondary">
      {k}
    </Typography>
    <Typography variant="body2" sx={{ textAlign: 'right' }}>
      {v}
    </Typography>
  </Stack>
);
