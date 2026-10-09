// WalletBadge — the header's network indicator. It says which network this build
// describes, nothing about any one record: where a record was actually anchored is shown
// per record, from what the registry reports (an old record can sit on a test network
// even on the mainnet site).
//
// Test builds: "Demo" and "Test network". A mainnet build: "Web demo" and "Main network":
// the contract is live, but this app is still the web demo (it sends no transactions, and
// licenses and lab agreements are simulated), and the header should not be the one place
// that suggests otherwise. The screens that simulate something say so where it happens.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Chip, Stack } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';

export const WalletBadge: React.FC<{ network: string }> = ({ network }) => (
  <Stack direction="row" spacing={1}>
    <Chip size="small" icon={<ScienceIcon />} variant="outlined" label={network === 'mainnet' ? 'Web app' : 'Demo'} />
    <Chip
      size="small"
      icon={<BoltIcon />}
      variant="outlined"
      color={network === 'mainnet' ? 'primary' : 'default'}
      label={network === 'mainnet' ? 'Main network' : network === 'undeployed' ? 'Local' : 'Test network'}
    />
  </Stack>
);
