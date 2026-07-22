// WalletBadge — connection/mode indicator. Shows demo vs on-chain and the network.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Chip, Stack } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';

export const WalletBadge: React.FC<{ network: string; demo: boolean }> = ({ network, demo }) => (
  <Stack direction="row" spacing={1}>
    <Chip
      size="small"
      icon={<ScienceIcon />}
      color={demo ? 'default' : 'primary'}
      variant={demo ? 'outlined' : 'filled'}
      label={demo ? 'Demo mode' : 'On-chain'}
    />
    <Chip size="small" icon={<BoltIcon />} variant="outlined" label={network} sx={{ textTransform: 'capitalize' }} />
  </Stack>
);
