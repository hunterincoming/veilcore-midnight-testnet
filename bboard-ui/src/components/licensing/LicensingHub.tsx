// LicensingHub (/licenses) — every license across all strains, as a managed portfolio.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import EastIcon from '@mui/icons-material/East';
import { motion } from 'framer-motion';
import { useLicenses, allLicenses } from '../../veilcore/licenses';
import { getRecord } from '../../veilcore/records';
import { AppHeader } from '../AppHeader';
import { LicenseStateChip } from './LicenseStateChip';

const MPaper = motion(Paper);

export const LicensingHub: React.FC = () => {
  useLicenses();
  const navigate = useNavigate();
  const licenses = allLicenses();

  return (
    <Box>
      <AppHeader />
      <Typography variant="h4" sx={{ mb: 0.5 }}>
        Licensing hub
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Every license you&apos;ve issued, across all your cultivars — your licensing portfolio.
      </Typography>

      {licenses.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', borderStyle: 'dashed' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            No licenses yet. Open a cultivar and choose “License this cultivar” to draft one.
          </Typography>
          <RouterLink to="/" style={{ color: '#2ff0cf' }}>
            Go to your cultivars
          </RouterLink>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {licenses.map((l) => {
            const record = getRecord(l.recordId);
            return (
              <MPaper
                key={l.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => navigate(`/license/${l.id}`)}
                sx={{ p: 2.5, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap>
                      {record?.strainName ?? l.recordId} → {l.terms.licensee || 'unnamed licensee'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {l.id} · {l.terms.startDate} → {l.terms.endDate}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <LicenseStateChip license={l} />
                    <EastIcon sx={{ color: 'text.secondary' }} />
                  </Stack>
                </Stack>
              </MPaper>
            );
          })}
        </Stack>
      )}
    </Box>
  );
};
