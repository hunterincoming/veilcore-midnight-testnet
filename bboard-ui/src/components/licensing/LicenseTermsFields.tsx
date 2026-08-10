// LicenseTermsFields — the plain-language terms form, shared by the standalone terms
// builder route and the in-wizard licensing step.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import type { AgreementType, LicenseTerms } from '../../veilcore/licenses';

export type SetTerm = <K extends keyof LicenseTerms>(k: K, v: LicenseTerms[K]) => void;

/** Renders the right term fields for the chosen agreement type. */
export const AgreementTermsFields: React.FC<{ type: AgreementType; terms: LicenseTerms; set: SetTerm }> = ({
  type,
  terms,
  set,
}) => {
  if (type === 'lab-transfer') return <LabTransferFields terms={terms} set={set} />;
  if (type === 'breeder-share') return <BreederShareFields terms={terms} set={set} />;
  return <LicenseTermsFields terms={terms} set={set} />;
};

export const LicenseTermsFields: React.FC<{ terms: LicenseTerms; set: SetTerm }> = ({ terms: t, set }) => (
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
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
      <TextField
        label="Royalty on offspring (%)"
        helperText="Follows the genetics, not the sale. Binds anything bred from this cultivar — including cuttings the licensee passes on. Leave blank if none."
        value={t.offspringRoyaltyPct ?? ''}
        onChange={(e) => set('offspringRoyaltyPct', e.target.value)}
        sx={{ minWidth: 260 }}
      />
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
  </Stack>
);

export const emptyTerms = (): LicenseTerms => {
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return {
    licensee: '',
    rights: 'cultivate',
    territory: '',
    startDate: today,
    endDate: d.toISOString().slice(0, 10),
    royaltyType: 'percent',
    royaltyAmount: '',
    unitBasis: 'per-unit-sold',
    offspringRoyaltyPct: '',
    sublicensable: false,
    exclusive: false,
    extraTerms: '',
  };
};

/** Blank terms seeded with sensible defaults for the chosen agreement type. */
export const emptyTermsFor = (type: AgreementType): LicenseTerms => {
  const base = emptyTerms();
  if (type === 'lab-transfer') {
    return {
      ...base,
      labPurpose: 'tissue-culture',
      noPropagationBeyondPurpose: true,
      onCompletion: 'return',
      confidentiality: true,
    };
  }
  if (type === 'breeder-share') {
    return { ...base, mayBreed: true, mayDistribute: false, attributionRequired: true, offspringRoyaltyPct: '' };
  }
  return base;
};

// ---- Lab transfer: custody, not commerce. No royalty, no Veilcore fee. ----
export const LabTransferFields: React.FC<{ terms: LicenseTerms; set: SetTerm }> = ({ terms: t, set }) => (
  <Stack spacing={2.5}>
    <TextField
      label="Receiving lab"
      helperText="The tissue-culture or DNA-testing lab the genetics are going to."
      value={t.licensee}
      onChange={(e) => set('licensee', e.target.value)}
      fullWidth
    />
    <TextField
      select
      label="Purpose"
      helperText="Why the lab is receiving the material."
      value={t.labPurpose ?? 'tissue-culture'}
      onChange={(e) => set('labPurpose', e.target.value as LicenseTerms['labPurpose'])}
      fullWidth
    >
      <MenuItem value="tissue-culture">Tissue culture</MenuItem>
      <MenuItem value="propagation">Propagation</MenuItem>
      <MenuItem value="dna-testing">DNA testing</MenuItem>
      <MenuItem value="storage">Storage</MenuItem>
    </TextField>
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
        helperText="When custody ends."
        value={t.endDate}
        onChange={(e) => set('endDate', e.target.value)}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Stack>
    <TextField
      select
      label="On completion"
      helperText="What the lab must do with the material when done."
      value={t.onCompletion ?? 'return'}
      onChange={(e) => set('onCompletion', e.target.value as LicenseTerms['onCompletion'])}
      fullWidth
    >
      <MenuItem value="return">Return the material</MenuItem>
      <MenuItem value="destroy">Destroy the material</MenuItem>
    </TextField>
    <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
      <FormControlLabel
        control={
          <Switch
            checked={t.noPropagationBeyondPurpose ?? true}
            onChange={(e) => set('noPropagationBeyondPurpose', e.target.checked)}
          />
        }
        label="No propagation beyond the stated purpose"
      />
      <FormControlLabel
        control={
          <Switch checked={t.confidentiality ?? true} onChange={(e) => set('confidentiality', e.target.checked)} />
        }
        label="Confidentiality required"
      />
    </Stack>
    <TextField
      label="Additional terms (optional)"
      helperText="Anything else that's part of the transfer, in your own words."
      value={t.extraTerms}
      onChange={(e) => set('extraTerms', e.target.value)}
      multiline
      minRows={2}
      fullWidth
    />
  </Stack>
);

// ---- Breeder share: sharing a cut with another breeder. ----
export const BreederShareFields: React.FC<{ terms: LicenseTerms; set: SetTerm }> = ({ terms: t, set }) => (
  <Stack spacing={2.5}>
    <TextField
      label="Receiving breeder"
      helperText="Who you're sharing the cut with."
      value={t.licensee}
      onChange={(e) => set('licensee', e.target.value)}
      fullWidth
    />
    <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
      <FormControlLabel
        control={<Switch checked={t.mayBreed ?? false} onChange={(e) => set('mayBreed', e.target.checked)} />}
        label="May breed with it"
      />
      <FormControlLabel
        control={<Switch checked={t.mayDistribute ?? false} onChange={(e) => set('mayDistribute', e.target.checked)} />}
        label="May distribute or sell it"
      />
      <FormControlLabel
        control={
          <Switch
            checked={t.attributionRequired ?? true}
            onChange={(e) => set('attributionRequired', e.target.checked)}
          />
        }
        label="Attribution / credit required"
      />
    </Stack>
    <TextField
      label="Royalty on offspring (%)"
      helperText="Your cut of anything they breed from it. Leave blank for none."
      value={t.offspringRoyaltyPct ?? ''}
      onChange={(e) => set('offspringRoyaltyPct', e.target.value)}
      sx={{ maxWidth: 260 }}
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
        value={t.endDate}
        onChange={(e) => set('endDate', e.target.value)}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Stack>
    <TextField
      label="Additional terms (optional)"
      helperText="Anything else that's part of the arrangement, in your own words."
      value={t.extraTerms}
      onChange={(e) => set('extraTerms', e.target.value)}
      multiline
      minRows={2}
      fullWidth
    />
  </Stack>
);
