// WalletBadge — mode indicator. Says whether this build writes to a chain at all, and
// which network. In demo mode (no contract address configured) nothing in the app
// anchors anything; records are anchored, if at all, in batches by an operator. So the
// badge must not say "anchored": whether a record is anchored is shown per record.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Chip, Stack } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import { isTestNetwork } from '../../config/network';

export const WalletBadge: React.FC<{ network: string; demo: boolean }> = ({ network, demo }) => (
  <Stack direction="row" spacing={1}>
    <Chip
      size="small"
      icon={<ScienceIcon />}
      color={demo ? 'default' : 'primary'}
      variant={demo ? 'outlined' : 'filled'}
      label={demo ? 'Demo' : isTestNetwork(network) ? 'Test network' : 'Live network'}
    />
    <Chip size="small" icon={<BoltIcon />} variant="outlined" label={network} sx={{ textTransform: 'capitalize' }} />
  </Stack>
);
