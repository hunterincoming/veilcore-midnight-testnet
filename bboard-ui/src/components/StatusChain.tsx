// StatusChain — a strain's progress at a glance: Logged → DNA paired → Lab attested → Licensed.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/PendingOutlined';
import { TEAL } from '../config/theme';
import type { StrainRecord } from '../veilcore/records';

type Seg = { label: string; done: boolean };

export const chainOf = (r: StrainRecord, licenseCount = 0): Seg[] => [
  { label: 'Logged', done: true },
  { label: 'DNA paired', done: !!r.dnaFingerprint },
  { label: 'Lab attested', done: !!r.attestation },
  { label: `Licensed${licenseCount ? ` (${licenseCount})` : ''}`, done: licenseCount > 0 },
];

export const StatusChain: React.FC<{ record: StrainRecord; licenseCount?: number; dense?: boolean }> = ({
  record,
  licenseCount = 0,
  dense,
}) => (
  <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: dense ? 0.5 : 1 }}>
    {chainOf(record, licenseCount).map((s, i) => (
      <React.Fragment key={s.label}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {s.done ? (
            <CheckCircleIcon sx={{ fontSize: dense ? 15 : 17, color: TEAL }} />
          ) : (
            <PendingIcon sx={{ fontSize: dense ? 15 : 17, color: 'text.secondary' }} />
          )}
          <Typography
            variant="caption"
            sx={{ color: s.done ? 'text.primary' : 'text.secondary', whiteSpace: 'nowrap' }}
          >
            {s.label}
          </Typography>
        </Stack>
        {i < 3 && <Box sx={{ width: dense ? 10 : 16, height: 1, background: 'rgba(255,255,255,0.15)' }} />}
      </React.Fragment>
    ))}
  </Stack>
);
