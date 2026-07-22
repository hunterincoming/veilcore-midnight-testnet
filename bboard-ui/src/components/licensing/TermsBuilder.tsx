// TermsBuilder (/record/:id/license) — plain-language license terms. On save, the
// agreement is hashed locally and bound to the strain record + its DNA fingerprint,
// then created as a Draft the breeder can issue.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate, useParams, useSearchParams, Link as RouterLink } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import { getRecord } from '../../veilcore/records';
import { createLicense, renewLicense, getLicense, type LicenseTerms } from '../../veilcore/licenses';
import { fingerprintText } from '../../veilcore/commitment';
import { AppHeader } from '../AppHeader';

const today = () => new Date().toISOString().slice(0, 10);
const inOneYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

export const TermsBuilder: React.FC = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const supersedeId = params.get('supersede') ?? undefined;
  const navigate = useNavigate();
  const record = getRecord(id);
  const prior = supersedeId ? getLicense(supersedeId) : undefined;

  const [t, setT] = useState<LicenseTerms>(
    prior?.terms ?? {
      licensee: '',
      rights: 'cultivate',
      territory: '',
      startDate: today(),
      endDate: inOneYear(),
      royaltyType: 'percent',
      royaltyAmount: '',
      unitBasis: 'per-unit-sold',
      sublicensable: false,
      exclusive: false,
      extraTerms: '',
    },
  );
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof LicenseTerms>(k: K, v: LicenseTerms[K]) => setT((p) => ({ ...p, [k]: v }));

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
        {supersedeId ? 'Renew / amend license' : 'License this strain'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Set the terms in plain language. When you save, the agreement is sealed and bound to {record.strainName} and its
        genetics — so the terms travel with the plant.
      </Typography>

      <Stack spacing={2.5}>
        <TextField
          label="Licensee (name or company)"
          helperText="Who you're granting rights to."
          value={t.licensee}
          onChange={(e) => set('licensee', e.target.value)}
          fullWidth
        />
        <TextField
          select
          label="Rights granted"
          helperText="What the licensee is allowed to do with the genetics."
          value={t.rights}
          onChange={(e) => set('rights', e.target.value as LicenseTerms['rights'])}
          fullWidth
        >
          <MenuItem value="cultivate">Cultivate only</MenuItem>
          <MenuItem value="cultivate+propagate">Cultivate + propagate (make cuts/seeds)</MenuItem>
          <MenuItem value="full-transfer">Full transfer of rights</MenuItem>
        </TextField>
        <TextField
          label="Territory"
          placeholder="e.g. California, or Worldwide"
          helperText="Where these rights apply."
          value={t.territory}
          onChange={(e) => set('territory', e.target.value)}
          fullWidth
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Start date"
            type="date"
            value={t.startDate}
            onChange={(e) => set('startDate', e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="End date"
            type="date"
            helperText="The license expires automatically after this."
            value={t.endDate}
            onChange={(e) => set('endDate', e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Royalty type"
            value={t.royaltyType}
            onChange={(e) => set('royaltyType', e.target.value as LicenseTerms['royaltyType'])}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="percent">Percentage</MenuItem>
            <MenuItem value="flat">Flat fee</MenuItem>
          </TextField>
          <TextField
            label={t.royaltyType === 'percent' ? 'Royalty %' : 'Flat fee ($)'}
            helperText={t.royaltyType === 'percent' ? 'e.g. 8 (percent)' : 'e.g. 25 (per unit)'}
            value={t.royaltyAmount}
            onChange={(e) => set('royaltyAmount', e.target.value)}
            fullWidth
          />
          <TextField
            select
            label="Basis"
            helperText="What the royalty is charged per."
            value={t.unitBasis}
            onChange={(e) => set('unitBasis', e.target.value as LicenseTerms['unitBasis'])}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="per-plant">Per plant</MenuItem>
            <MenuItem value="per-harvest">Per harvest</MenuItem>
            <MenuItem value="per-unit-sold">Per unit sold</MenuItem>
          </TextField>
        </Stack>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <FormControlLabel
            control={<Switch checked={t.sublicensable} onChange={(e) => set('sublicensable', e.target.checked)} />}
            label="Can sublicense"
          />
          <FormControlLabel
            control={<Switch checked={t.exclusive} onChange={(e) => set('exclusive', e.target.checked)} />}
            label="Exclusive"
          />
        </Stack>
        <TextField
          label="Additional terms (optional)"
          helperText="Anything else that's part of the deal, in your own words."
          value={t.extraTerms}
          onChange={(e) => set('extraTerms', e.target.value)}
          multiline
          minRows={2}
          fullWidth
        />

        <Divider />
        <Box>
          <Button variant="contained" size="large" disabled={busy || !canSave} onClick={onSave}>
            {busy ? 'Sealing agreement…' : supersedeId ? 'Save amended license' : 'Create license (Draft)'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};
