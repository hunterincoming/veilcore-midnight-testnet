// TrustPanel — answers the killer objection in plain breeder language:
// "What stops me from logging YOUR cultivar?"
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import GroupIcon from '@mui/icons-material/GroupOutlined';
import { TEAL } from '../config/theme';

const POINTS = [
  {
    icon: <ScheduleIcon />,
    title: 'An earlier record beats a later one',
    body: 'Once records are anchored, anyone can check which was anchored first. Before that, a record’s time is its device’s clock. It does not settle a claim against someone who never logged anything — a record is evidence, not a registration.',
  },
  {
    icon: <ScienceIcon />,
    title: 'A paired report can be compared later',
    body: 'Pairing seals your lab report’s fingerprint into the record, as your statement. A paired report can later be compared against a fresh test of the material.',
  },
  {
    icon: <GroupIcon />,
    title: 'A second party takes delivery',
    body: 'When material is transferred, the party who takes it confirms receipt with their own key. That is a second party in the record rather than you alone — what it establishes is that someone took delivery, not who they are.',
  },
];

export const TrustPanel: React.FC = () => (
  <Paper sx={{ p: { xs: 2.5, md: 3.5 } }}>
    <Typography variant="h6" sx={{ mb: 0.5 }}>
      “What stops me from logging{' '}
      <Box component="span" sx={{ color: TEAL }}>
        your
      </Box>{' '}
      cultivar?”
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
      Fair question — it’s the whole point. Three things make a VeilCore record hard to fake, rather than just easy to
      write:
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
