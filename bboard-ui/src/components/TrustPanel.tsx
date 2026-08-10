// TrustPanel — answers the killer objection in plain breeder language:
// "What stops me from logging YOUR strain?"
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import GroupIcon from '@mui/icons-material/GroupOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTreeOutlined';
import { TEAL } from '../config/theme';

const POINTS = [
  {
    icon: <ScheduleIcon />,
    title: 'First to log it wins',
    body: 'Priority goes to whoever sealed the record first. Logging someone else’s cultivar later puts you behind their record, not ahead of it.',
  },
  {
    icon: <ScienceIcon />,
    title: 'DNA makes claims checkable',
    body: 'Pairing a lab report ties the record to the actual genetics — so a claim isn’t just something you typed, it’s something anyone can test against.',
  },
  {
    icon: <GroupIcon />,
    title: 'A second party vouches',
    body: 'Lab attestation adds an independent party who confirms they handled the sample — far stronger than a record you signed alone.',
  },
  {
    icon: <AccountTreeIcon />,
    title: 'Lineage exposes renaming',
    body: 'Because parents and offspring are linked, a “new” cultivar whose fingerprint traces to someone else’s lineage stands out.',
  },
];

export const TrustPanel: React.FC = () => (
  <Paper sx={{ p: { xs: 2.5, md: 3.5 } }}>
    <Typography variant="h6" sx={{ mb: 0.5 }}>
      “What stops me from logging <Box component="span" sx={{ color: TEAL }}>your</Box> cultivar?”
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
      Fair question — it’s the whole point. Four things make a VeilCore record hard to fake, rather than just easy to write:
    </Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
      {POINTS.map((p) => (
        <Stack key={p.title} direction="row" spacing={1.5}>
          <Box sx={{ color: TEAL, mt: 0.25 }}>{p.icon}</Box>
          <Box>
            <Typography variant="subtitle2">{p.title}</Typography>
            <Typography variant="body2" color="text.secondary">
              {p.body}
            </Typography>
          </Box>
        </Stack>
      ))}
    </Box>
  </Paper>
);
