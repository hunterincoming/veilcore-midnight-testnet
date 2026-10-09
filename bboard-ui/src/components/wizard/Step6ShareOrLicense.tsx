// Wizard step 6 — Share or license. The breeder picks who's receiving the genetics: a
// company (a commercial license) or another breeder (a breeder share: breeding and selling
// rights, credit, a royalty on declared offspring). Simulated in the web demo, and says so. Then the
// matching terms builder, issue, counter-sign, and the active agreement — reusing the same
// instrument as everywhere else.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import ShareIcon from '@mui/icons-material/ShareOutlined';
import AgreedIcon from '@mui/icons-material/HandshakeOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { motion } from 'framer-motion';
import { getRecord, childrenOf } from '../../veilcore/records';
import {
  useLicenses,
  createLicense,
  sealAgreement,
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
import { canonicalUrl } from '../../config/network';
import { AgreementTermsFields, emptyTermsFor, type SetTerm } from '../licensing/LicenseTermsFields';
import { LicenseStateChip } from '../licensing/LicenseStateChip';
import { TEAL } from '../../config/theme';
import { AGREEMENTS_SIMULATED, AGREEMENT_RECORDED, SIMULATED_TAG, THIS_SITE } from '../../config/copy';

/** The two choice cards: real buttons, so a keyboard reaches them. */
const CHOICE = {
  flex: 1,
  p: 2.5,
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  border: '1px solid',
  borderColor: 'divider',
  '&:hover, &:focus-visible': { borderColor: 'primary.main', outline: 'none' },
} as const;

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
  const signLink = licenseId ? canonicalUrl(`/license/${encodeURIComponent(licenseId)}/sign`) : '';
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
      const { agreementFingerprint, agreementSalt } = await sealAgreement(type, t, record.recordFingerprint);
      const lic = createLicense({
        type,
        recordId: record.id,
        recordFingerprint: record.recordFingerprint,
        dnaFingerprint: record.dnaFingerprint,
        terms: t,
        agreementFingerprint,
        agreementSalt,
      });
      await issueLicense(lic.id);
      setLicenseId(lic.id);
      setPhase('issued');
    } finally {
      setBusy(false);
    }
  };

  const onCountersign = async () => {
    if (licenseId) {
      await countersignLicense(licenseId);
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
          <AgreedIcon sx={{ fontSize: 52, color: TEAL, filter: `drop-shadow(0 0 18px ${TEAL})`, mb: 1 }} />
          <Typography variant="h4" sx={{ color: TEAL }}>
            {type === 'license' ? 'Agreement recorded.' : 'Shared, on your terms.'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto', mt: 1 }}>
            Marked active from your browser. Your counterparty has not signed anything in VeilCore: counter-signing by
            the other party, with their own key, is not built yet. Its terms are attached to {record.strainName}
            &apos;s record. VeilCore records what is owed; payment happens between you.
          </Typography>
        </MBox>

        <Paper sx={{ p: { xs: 2.5, md: 3 }, border: `1px solid ${TEAL}55` }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="overline">
              {AGREEMENT_RECORDED} · {AGREEMENT_LABEL[type]}
            </Typography>
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
            They may breed with it. A cultivar later logged with {record.strainName} as a parent, with both holders
            confirming, links back to this agreement. Offspring nobody logs are not detected.
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
          <Button variant="contained" onClick={() => void onCountersign()}>
            Mark active myself {SIMULATED_TAG}
          </Button>
          <Chip size="small" variant="outlined" label={`Simulated in ${THIS_SITE}`} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          The link opens only in your own browser for now: the other party cannot load or sign it from theirs yet.
          Marking it active yourself records that you did so, not that they agreed.
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
            Terms attached to {record.strainName}&apos;s sealed record, not just a signature page.{' '}
            {AGREEMENTS_SIMULATED}
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
          Who&apos;s receiving {record.strainName}? Pick the relationship and we&apos;ll set out the right terms,
          attached to the record either way. {AGREEMENTS_SIMULATED}
        </Typography>
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Paper component="button" type="button" onClick={() => pick('license')} sx={CHOICE}>
          <Stack spacing={1}>
            <GavelIcon sx={{ color: TEAL }} />
            <Typography variant="h6">A company</Typography>
            <Typography variant="body2" color="text.secondary">
              License agreement: rights, territory, royalty, exclusivity.
              {SHOW_VEILCORE_FEE ? ' Carries the VeilCore 3% fee.' : ''}
            </Typography>
          </Stack>
        </Paper>
        <Paper component="button" type="button" onClick={() => pick('breeder-share')} sx={CHOICE}>
          <Stack spacing={1}>
            <ShareIcon sx={{ color: TEAL }} />
            <Typography variant="h6">Another breeder</Typography>
            <Typography variant="body2" color="text.secondary">
              Breeder share: whether they may breed with it or sell it, credit, and a royalty on offspring. Offspring
              they declare from it stay linked to this record.
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
          Not sharing it yet: finish
        </Button>
      </Stack>
    </Stack>
  );
};
