// CommitmentReveal — visualizes the local hashing pipeline:
//   genetics (private, on-device)  ->  SHA-256  ->  commitment (public, anchored)
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/LockOutlined';
import PublicIcon from '@mui/icons-material/PublicOutlined';
import EastIcon from '@mui/icons-material/East';
import { motion, AnimatePresence } from 'framer-motion';
import { TEAL } from '../../config/theme';

const MBox = motion(Box);

const Node: React.FC<{ label: string; sub: string; icon: React.ReactNode; tone: 'private' | 'public' }> = ({
  label,
  sub,
  icon,
  tone,
}) => (
  <Box
    sx={{
      flex: 1,
      minWidth: 0,
      p: 2,
      borderRadius: 3,
      border: '1px solid',
      borderColor: tone === 'public' ? 'primary.main' : 'divider',
      background: tone === 'public' ? 'rgba(47,240,207,0.06)' : 'rgba(255,255,255,0.02)',
    }}
  >
    <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'center' }}>
      <Box sx={{ color: tone === 'public' ? 'primary.main' : 'text.secondary', display: 'flex' }}>{icon}</Box>
      <Typography variant="overline" sx={{ color: tone === 'public' ? 'primary.main' : 'text.secondary' }}>
        {label}
      </Typography>
    </Stack>
    <Typography
      variant="body2"
      sx={{ fontFamily: '"Space Grotesk", monospace', wordBreak: 'break-all', color: 'text.primary', opacity: 0.9 }}
    >
      {sub}
    </Typography>
  </Box>
);

const Arrow: React.FC<{ caption: string }> = ({ caption }) => (
  <Stack sx={{ px: 1, minWidth: 72, alignItems: 'center' }}>
    <EastIcon sx={{ color: 'text.secondary' }} />
    <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5 }}>
      {caption}
    </Typography>
  </Stack>
);

export const CommitmentReveal: React.FC<{ commitmentHex?: string }> = ({ commitmentHex }) => {
  const shortCommit = commitmentHex ? `${commitmentHex.slice(0, 16)}…${commitmentHex.slice(-8)}` : '';
  return (
    <AnimatePresence>
      {commitmentHex && (
        <MBox
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          sx={{ mt: 3 }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ alignItems: 'stretch', justifyContent: 'center' }}
          >
            <Node
              tone="private"
              icon={<LockIcon fontSize="small" />}
              label="Genetics · on-device"
              sub="•••••••••••••••  (never transmitted)"
            />
            <Arrow caption="SHA-256" />
            <Node tone="public" icon={<PublicIcon fontSize="small" />} label="Commitment · anchored" sub={shortCommit} />
          </Stack>
          <Typography
            variant="caption"
            sx={{ display: 'block', textAlign: 'center', mt: 2, color: 'text.secondary' }}
          >
            Only the commitment hash leaves your browser.{' '}
            <Box component="span" sx={{ color: TEAL }}>
              The genetics themselves never do.
            </Box>
          </Typography>
        </MBox>
      )}
    </AnimatePresence>
  );
};
