// ProgressPath — the always-visible step indicator. Shows the full 6-step workflow even
// when steps are skipped, so a breeder always sees where a skipped step sits in the flow.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import RemoveIcon from '@mui/icons-material/Remove';
import { TEAL } from '../../config/theme';

export const STEP_LABELS = ['Log cultivar', 'Send to a lab', 'Pair DNA', 'Evidence', 'Prove', 'Share / license'];

export const ProgressPath: React.FC<{ current: number; skipped?: number[] }> = ({ current, skipped = [] }) => (
  <Stack direction="row" sx={{ alignItems: 'flex-start', width: '100%', maxWidth: 720, mx: 'auto' }}>
    {STEP_LABELS.map((label, i) => {
      const n = i + 1;
      const isSkipped = skipped.includes(n);
      const active = n === current;
      const done = n < current && !isSkipped;
      const passed = n < current; // step is behind the cursor (done or skipped) — used for the connector

      return (
        <React.Fragment key={label}>
          <Stack sx={{ alignItems: 'center', flex: '0 0 auto', width: 72 }}>
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
                borderColor: isSkipped ? 'divider' : active || done ? TEAL : 'divider',
                borderStyle: isSkipped ? 'dashed' : 'solid',
                boxShadow: active ? `0 0 18px ${TEAL}` : 'none',
                opacity: isSkipped ? 0.7 : 1,
                transition: 'all 0.3s',
              }}
            >
              {isSkipped ? <RemoveIcon fontSize="small" /> : done ? <CheckIcon fontSize="small" /> : n}
            </Box>
            <Typography
              variant="caption"
              sx={{
                mt: 1,
                textAlign: 'center',
                lineHeight: 1.2,
                color: active ? 'text.primary' : 'text.secondary',
                textDecoration: isSkipped ? 'line-through' : 'none',
              }}
            >
              {label}
            </Typography>
            {isSkipped && (
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', lineHeight: 1 }}>
                skipped
              </Typography>
            )}
          </Stack>
          {n < STEP_LABELS.length && (
            <Box
              sx={{
                flex: 1,
                minWidth: 8,
                height: 2,
                mt: '16px',
                background: passed ? TEAL : 'rgba(255,255,255,0.12)',
                transition: 'background 0.3s',
              }}
            />
          )}
        </React.Fragment>
      );
    })}
  </Stack>
);
