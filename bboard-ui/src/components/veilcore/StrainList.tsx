// StrainList — the public ledger view: commitments anchored on-chain (no genetics).
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnchoredStrains } from '../../veilcore/demoStore';

const MPaper = motion(Paper);

export const StrainList: React.FC = () => {
  const strains = useAnchoredStrains();

  return (
    <Box>
      <Stack direction="row" sx={{ mb: 1.5, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Typography variant="overline">Anchored strains · public ledger</Typography>
        <Typography variant="caption" color="text.secondary">
          {strains.length} anchored
        </Typography>
      </Stack>

      {strains.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center', borderStyle: 'dashed' }}>
          <Typography variant="body2" color="text.secondary">
            No strains anchored yet. Anchor one to see its commitment appear here — genetics never included.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.25}>
          <AnimatePresence initial={false}>
            {strains.map((s) => (
              <MPaper
                key={s.commitment}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                sx={{ p: 2 }}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <FingerprintIcon sx={{ color: 'primary.main' }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" noWrap>
                      {s.label}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', fontFamily: '"Space Grotesk", monospace', wordBreak: 'break-all' }}
                    >
                      {s.commitment.slice(0, 32)}…
                    </Typography>
                  </Box>
                  <Chip size="small" label={`#${s.timestamp}`} variant="outlined" color="primary" />
                </Stack>
              </MPaper>
            ))}
          </AnimatePresence>
        </Stack>
      )}
    </Box>
  );
};
