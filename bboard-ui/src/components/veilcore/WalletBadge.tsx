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
      // Three states, not two. Records are batched and anchored on a public ledger,
      // so "simulated settlement" understates it — but this is a test network, so
      // "Live" would overstate it. Either error is the kind this product exists to
      // avoid.
      label={network === 'mainnet' ? 'Records anchored' : 'Records anchored · test network'}
    />
    <Chip size="small" icon={<BoltIcon />} variant="outlined" label={network} sx={{ textTransform: 'capitalize' }} />
  </Stack>
);
