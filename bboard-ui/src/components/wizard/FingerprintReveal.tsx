// FingerprintReveal — the privacy hero moment. A record/report "collapses" into a
// single glowing fingerprint, with the loud reassurance that nothing was transmitted.
// Reused in steps 1, 2 and 4.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { motion } from 'framer-motion';
import { TEAL } from '../../config/theme';
import { shortFingerprint } from '../../veilcore/commitment';

const MBox = motion(Box);

export const FingerprintReveal: React.FC<{
  fingerprint: string;
  headline?: string;
  sub?: string;
}> = ({ fingerprint, headline = 'Zero bytes left your device.', sub }) => (
  <MBox
    initial={{ opacity: 0, scale: 0.96 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.5, ease: 'easeOut' }}
    sx={{ textAlign: 'center', py: 3 }}
  >
    <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1.5 }}>
      <MBox
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: 'backOut' }}
        sx={{ display: 'inline-flex' }}
      >
        <FingerprintIcon sx={{ fontSize: 92, color: TEAL, filter: `drop-shadow(0 0 22px ${TEAL})` }} />
      </MBox>
      {/* scan sweep */}
      <MBox
        initial={{ top: 0, opacity: 0 }}
        animate={{ top: ['4%', '92%', '4%'], opacity: [0, 1, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        sx={{
          position: 'absolute',
          left: '10%',
          right: '10%',
          height: 2,
          background: `linear-gradient(90deg, transparent, ${TEAL}, transparent)`,
          borderRadius: 2,
        }}
      />
    </Box>

    <Typography variant="h5" sx={{ color: TEAL, mb: 1 }}>
      {headline}
    </Typography>
    {sub && (
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mb: 2 }}>
        {sub}
      </Typography>
    )}

    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.18em' }}>
        SEALED FINGERPRINT
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: '"Space Grotesk", monospace', color: 'text.primary', wordBreak: 'break-all' }}
      >
        {shortFingerprint(fingerprint)}
      </Typography>
    </Stack>
  </MBox>
);
