// ProgressPath — the always-visible 1→2→3→4 breeder-friendly step indicator.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { TEAL } from '../../config/theme';

export const STEP_LABELS = ['Log cultivar', 'Pair DNA', 'Evidence', 'Prove', 'License'];

export const ProgressPath: React.FC<{ current: number }> = ({ current }) => (
  <Stack direction="row" sx={{ alignItems: 'flex-start', width: '100%', maxWidth: 720, mx: 'auto' }}>
    {STEP_LABELS.map((label, i) => {
      const n = i + 1;
      const done = n < current;
      const active = n === current;
      return (
        <React.Fragment key={label}>
          <Stack sx={{ alignItems: 'center', flex: '0 0 auto', width: 84 }}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontFamily: '"Space Grotesk", sans-serif',
                color: active ? '#02110d' : done ? TEAL : 'text.secondary',
                background: active ? TEAL : 'transparent',
                border: '2px solid',
                borderColor: active || done ? TEAL : 'divider',
                boxShadow: active ? `0 0 18px ${TEAL}` : 'none',
                transition: 'all 0.3s',
              }}
            >
              {done ? <CheckIcon fontSize="small" /> : n}
            </Box>
            <Typography
              variant="caption"
              sx={{ mt: 1, textAlign: 'center', lineHeight: 1.2, color: active ? 'text.primary' : 'text.secondary' }}
            >
              {label}
            </Typography>
          </Stack>
          {n < STEP_LABELS.length && (
            <Box
              sx={{
                flex: 1,
                minWidth: 12,
                height: 2,
                mt: '16px',
                background: done ? TEAL : 'rgba(255,255,255,0.12)',
                transition: 'background 0.3s',
              }}
            />
          )}
        </React.Fragment>
      );
    })}
  </Stack>
);
