// TrustPanel — answers the killer objection in plain breeder language:
// "What stops me from logging YOUR cultivar?"
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import GroupIcon from '@mui/icons-material/GroupOutlined';
import { TEAL } from '../config/theme';
import { THIS_SITE } from '../config/copy';

const POINTS = [
  {
    icon: <ScheduleIcon />,
    title: 'An earlier record shows as earlier',
    body: 'Once records are anchored, anyone can check which was anchored first. Before that, a record’s time is its device’s clock. A record is evidence, not a registration: it shows what you had and when, but doesn’t settle a dispute on its own.',
  },
  {
    icon: <ScienceIcon />,
    title: 'A paired report can be compared later',
    body: `Pairing saves your lab report’s fingerprint with the record, as your statement, so a fresh test of the material can later be compared with it. When you pair through VeilCore’s contract on Midnight, the pairing is dated too: it shows the record was paired with that report by then, not who had the report first. In ${THIS_SITE}, pairings aren’t dated yet.`,
  },
  {
    icon: <GroupIcon />,
    title: 'A second party takes delivery',
    body: 'When material is transferred, whoever takes it confirms receipt with their own key. That puts a second party on the record, not just you. It shows someone took delivery, not who they are.',
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
      Three things make a VeilCore record hard to fake:
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
