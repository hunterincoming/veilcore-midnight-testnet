// LineageGraph — a simple family tree for a strain: its parents above, children below.
// Linked (logged) relatives are clickable. This is what makes renaming detectable.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { TEAL } from '../config/theme';
import { childrenOf, type StrainRecord, type ParentRef } from '../veilcore/records';

const Connector: React.FC = () => (
  <Box sx={{ width: 2, height: 20, mx: 'auto', background: 'rgba(47,240,207,0.35)' }} />
);

const RelChip: React.FC<{ label: string; to?: string }> = ({ label, to }) =>
  to ? (
    <Chip component={RouterLink} to={to} clickable label={label} variant="outlined" color="primary" size="small" />
  ) : (
    <Chip label={label} variant="outlined" size="small" />
  );

export const LineageGraph: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const parents: ParentRef[] = record.parents ?? [];
  const kids = childrenOf(record.id);

  if (parents.length === 0 && kids.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No lineage recorded yet. Add parent strains when logging to build the family tree.
      </Typography>
    );
  }

  return (
    <Box sx={{ textAlign: 'center' }}>
      {parents.length > 0 && (
        <>
          <Typography variant="overline">Parents</Typography>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap', mt: 0.5 }}>
            {parents.map((p, i) => (
              <RelChip key={`${p.name}-${i}`} label={p.name} to={p.recordId ? `/record/${p.recordId}` : undefined} />
            ))}
          </Stack>
          <Connector />
        </>
      )}

      <Chip
        label={record.strainName}
        sx={{ background: TEAL, color: '#02110d', fontWeight: 700, px: 1 }}
      />

      {kids.length > 0 && (
        <>
          <Connector />
          <Typography variant="overline">Offspring</Typography>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap', mt: 0.5 }}>
            {kids.map((k) => (
              <RelChip key={k.id} label={k.strainName} to={`/record/${k.id}`} />
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
};
