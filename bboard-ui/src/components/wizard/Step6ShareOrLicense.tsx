// Wizard step 6 — Share or license. The breeder picks who's receiving the genetics: a
// company (a commercial license, 3% Veilcore fee) or another breeder (a breeder share, no
// fee but offspring-royalty + attribution + the lineage-traceability guarantee). Then the
// matching terms builder, issue, counter-sign, and the active agreement — reusing the same
// instrument as everywhere else.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import ShareIcon from '@mui/icons-material/ShareOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { motion } from 'framer-motion';
import { getRecord, childrenOf } from '../../veilcore/records';
import {
  useLicenses,
  createLicense,
  issueLicense,
  countersignLicense,
  getLicense,
  agreementRows,
  hasVeilcoreFee,
  SHOW_VEILCORE_FEE,
  AGREEMENT_LABEL,
  FEE_NOTE,
  type AgreementType,
  type LicenseTerms,
} from '../../veilcore/licenses';
import { fingerprintText } from '../../veilcore/commitment';
import { AgreementTermsFields, emptyTermsFor, type SetTerm } from '../licensing/LicenseTermsFields';
import { LicenseStateChip } from '../licensing/LicenseStateChip';
import { TEAL } from '../../config/theme';

const MBox = motion(Box);

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

export const Step6ShareOrLicense: React.FC<{
  recordId: string;
  onDone: (licenseId?: string) => void;
  onBack: () => void;
}> = ({ recordId, onDone, onBack }) => {
  useLicenses();
  const navigate = useNavigate();
  const record = getRecord(recordId);
  const [type, setType] = useState<AgreementType>();
  const [t, setT] = useState<LicenseTerms>(emptyTermsFor('license'));
  const [phase, setPhase] = useState<'choose' | 'terms' | 'issued' | 'active'>('choose');
  const [licenseId, setLicenseId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set: SetTerm = (k, v) => setT((p) => ({ ...p, [k]: v }));

  if (!record) return <Typography>Record not found.</Typography>;

  const license = licenseId ? getLicense(licenseId) : undefined;
  const signLink = licenseId ? `${window.location.origin}/license/${licenseId}/sign` : '';
  const canIssue =
    type === 'license' ? Boolean(t.licensee.trim() && t.royaltyAmount.trim()) : Boolean(t.licensee.trim());

  const pick = (chosen: AgreementType) => {
    setType(chosen);
    setT(emptyTermsFor(chosen));
    setPhase('terms');
  };

  const onCreateIssue = async () => {
    if (!canIssue || !type) return;
    setBusy(true);
    try {
      const agreementFingerprint = await fingerprintText(
        JSON.stringify({ type, terms: t, record: record.recordFingerprint }),
      );
      const lic = createLicense({
        type,
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

  // ---- phase: active ----
  if (phase === 'active' && license && type) {
    const showLineageNote = type === 'breeder-share' && license.terms.mayBreed;
    const derivatives = showLineageNote ? childrenOf(record.id).length : 0;
    return (
      <Stack spacing={2.5}>
        <MBox
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          sx={{ textAlign: 'center', py: 1 }}
        >
          <PaidIcon sx={{ fontSize: 52, color: TEAL, filter: `drop-shadow(0 0 18px ${TEAL})`, mb: 1 }} />
          <Typography variant="h4" sx={{ color: TEAL }}>
            {type === 'license' ? 'This is how breeders get paid.' : 'Shared — on your terms.'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto', mt: 1 }}>
            Both parties signed. The agreement is active — and its terms are bound to {record.strainName}&apos;s
            sealed record and its DNA fingerprint.
          </Typography>
        </MBox>

        <Paper sx={{ p: { xs: 2.5, md: 3 }, border: `1px solid ${TEAL}55` }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="overline">Active · {AGREEMENT_LABEL[type]}</Typography>
            <LicenseStateChip license={license} />
          </Stack>
          <Stack spacing={1}>
            {agreementRows(license).map((r) => (
              <Row key={r.k} k={r.k} v={r.v} />
            ))}
          </Stack>
        </Paper>

        {showLineageNote && (
          <Alert severity="info" variant="outlined">
            They may breed with it — but any cultivar later logged with {record.strainName} as a parent is traceable
            through the lineage graph, keeping offspring linked to this agreement.
            {derivatives > 0 ? ` ${derivatives} already descend${derivatives === 1 ? 's' : ''} from it.` : ''}
          </Alert>
        )}

        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => navigate(`/license/${license.id}`)}>
            Manage this agreement
          </Button>
          <Button variant="contained" onClick={() => onDone(license.id)}>
            Finish
          </Button>
        </Stack>
      </Stack>
    );
  }

  // ---- phase: issued (awaiting counter-signature) ----
  if (phase === 'issued' && license && type) {
    return (
      <Stack spacing={2.5}>
        <Typography variant="h5">Send it to your counterparty</Typography>
        <Alert severity="warning" variant="outlined">
          You&apos;ve signed. The {AGREEMENT_LABEL[type].toLowerCase()} is <b>not active</b> until they counter-sign.
        </Alert>
        <TextField
          label="Counter-sign link (send to the recipient)"
          value={signLink}
          fullWidth
          size="small"
          slotProps={{ input: { readOnly: true } }}
        />
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={() => navigator.clipboard.writeText(signLink)}
          >
            Copy link
          </Button>
          <Button variant="contained" onClick={onCountersign}>
            Simulate counter-signature
          </Button>
          <Chip size="small" variant="outlined" label="Demo — settlement simulated" />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          In the live product, the recipient opens the link, reviews the terms, and signs — only then does it activate.
        </Typography>
      </Stack>
    );
  }

  // ---- phase: terms ----
  if (phase === 'terms' && type) {
    return (
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h5">{AGREEMENT_LABEL[type]}</Typography>
          <Typography variant="body2" color="text.secondary">
            Terms bound to {record.strainName}&apos;s genetics — not just a signature page.
          </Typography>
        </Box>

        <AgreementTermsFields type={type} terms={t} set={set} />

        {SHOW_VEILCORE_FEE && hasVeilcoreFee(type, t) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {FEE_NOTE}
          </Typography>
        )}

        <Divider />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="text" onClick={() => setPhase('choose')}>
            Back
          </Button>
          <Button variant="contained" size="large" disabled={busy || !canIssue} onClick={onCreateIssue}>
            {busy ? 'Sealing agreement…' : 'Create & sign'}
          </Button>
          <Button variant="text" color="inherit" onClick={() => onDone(undefined)}>
            Skip for now
          </Button>
        </Stack>
      </Stack>
    );
  }

  // ---- phase: choose ----
  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Share or license
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Who&apos;s receiving {record.strainName}? Pick the relationship and we&apos;ll build the right terms — bound
          to the genetics either way.
        </Typography>
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Paper
          onClick={() => pick('license')}
          sx={{ flex: 1, p: 2.5, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
        >
          <Stack spacing={1}>
            <GavelIcon sx={{ color: TEAL }} />
            <Typography variant="h6">A company</Typography>
            <Typography variant="body2" color="text.secondary">
              License agreement — rights, territory, royalty, exclusivity.{SHOW_VEILCORE_FEE ? ' Carries the Veilcore 3% fee.' : ''}
            </Typography>
          </Stack>
        </Paper>
        <Paper
          onClick={() => pick('breeder-share')}
          sx={{ flex: 1, p: 2.5, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
        >
          <Stack spacing={1}>
            <ShareIcon sx={{ color: TEAL }} />
            <Typography variant="h6">Another breeder</Typography>
            <Typography variant="body2" color="text.secondary">
              Breeder share — breeding/distribution rights, attribution, offspring royalty. No fee; lineage
              keeps derivatives traceable.
            </Typography>
          </Stack>
        </Paper>
      </Stack>

      <Divider />
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        <Button variant="text" color="inherit" onClick={() => onDone(undefined)}>
          Not sharing it yet — finish
        </Button>
      </Stack>
    </Stack>
  );
};
