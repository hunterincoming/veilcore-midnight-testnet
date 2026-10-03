// AppHeader — shared top bar: wordmark (home), quick "New cultivar", and the demo/network badge.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { HolderKeyPanel } from './HolderKeyPanel';
import { ClaimTransfer } from './ClaimTransfer';
import { AttesterSetup } from './AttesterSetup';
import { getRole, isLab } from '../veilcore/role';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';
import { WalletBadge } from './veilcore/WalletBadge';
import { TEAL } from '../config/theme';
import { NETWORK, DEMO_MODE } from '../config/network';
import { CHAIN_READY } from '../veilcore/chain/config';
import { useI18n } from '../i18n';
import { LanguagePicker } from '../i18n/LanguagePicker';

export const AppHeader: React.FC = () => {
  const loc = useLocation();
  const { t } = useI18n();
  return (
    <Stack
      direction="row"
      sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: { xs: 4, md: 5 } }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 3, rowGap: 1 }}>
        <Stack
          component={RouterLink}
          to="/records"
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
            {t('nav.newCultivar')}
          </Button>
        )}
        {loc.pathname !== '/licenses' && (
          <Button component={RouterLink} to="/licenses" size="small" variant="text">
            {t('nav.licenses')}
          </Button>
        )}
        {/* A recipient may have no records at all — receiving has to be reachable
            from anywhere, not buried inside a cultivar they do not own yet. */}
        {/* Receiving and attesting are a lab's job. Showing them to a breeder is
            offering controls for work they will never do. */}
        {isLab(getRole()) && (
          <>
            <ClaimTransfer />
            <AttesterSetup />
          </>
        )}
        <HolderKeyPanel />
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <LanguagePicker />
        <WalletBadge network={NETWORK} demo={DEMO_MODE && !CHAIN_READY} />
      </Stack>
    </Stack>
  );
};
