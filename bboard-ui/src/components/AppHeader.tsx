// AppHeader — shared top bar: wordmark (home), quick "New strain", and the demo/network badge.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { HolderKeyPanel } from './HolderKeyPanel';
import { ClaimTransfer } from './ClaimTransfer';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';
import { WalletBadge } from './veilcore/WalletBadge';
import { TEAL } from '../config/theme';

const network = (import.meta.env.VITE_NETWORK_ID as string) ?? 'preview';
const demoMode = !(import.meta.env.VITE_VEILCORE_CONTRACT_ADDRESS as string);

export const AppHeader: React.FC = () => {
  const loc = useLocation();
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: { xs: 4, md: 5 } }}>
      <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
        <Stack
          component={RouterLink}
          to="/"
          direction="row"
          spacing={1.25}
          sx={{ alignItems: 'center', textDecoration: 'none' }}
        >
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', background: TEAL, boxShadow: `0 0 14px ${TEAL}` }} />
          <Typography variant="h6" sx={{ letterSpacing: '0.3em', fontWeight: 600, color: 'text.primary' }}>
            VEILCORE
          </Typography>
        </Stack>
        {loc.pathname !== '/new' && (
          <Button component={RouterLink} to="/new" size="small" variant="outlined" startIcon={<AddIcon />}>
            New cultivar
          </Button>
        )}
        {loc.pathname !== '/licenses' && (
          <Button component={RouterLink} to="/licenses" size="small" variant="text">
            Licenses
          </Button>
        )}
        {/* A recipient may have no records at all — receiving has to be reachable
            from anywhere, not buried inside a cultivar they do not own yet. */}
        <ClaimTransfer />
        <HolderKeyPanel />
      </Stack>
      <WalletBadge network={network} demo={demoMode} />
    </Stack>
  );
};
