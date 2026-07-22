// Veilcore — investor-facing demo UI.
// Anchor a genetics commitment on-chain and prove ownership in zero knowledge.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Box, Container, Divider, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { AnchorPanel } from './components/veilcore/AnchorPanel';
import { VerifyPanel } from './components/veilcore/VerifyPanel';
import { StrainList } from './components/veilcore/StrainList';
import { WalletBadge } from './components/veilcore/WalletBadge';
import { TEAL } from './config/theme';

const MBox = motion(Box);

const network = (import.meta.env.VITE_NETWORK_ID as string) ?? 'preview';
const contractAddress = (import.meta.env.VITE_VEILCORE_CONTRACT_ADDRESS as string) ?? '';
const demoMode = !contractAddress;

const App: React.FC = () => {
  const [tab, setTab] = useState(0);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: `radial-gradient(1100px 620px at 78% -8%, rgba(47,240,207,0.10), transparent 60%),
                     radial-gradient(900px 500px at 8% 108%, rgba(138,125,255,0.07), transparent 55%),
                     #04070a`,
      }}
    >
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 7 } }}>
        {/* Top bar */}
        <Stack direction="row" sx={{ mb: { xs: 5, md: 8 }, alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: TEAL,
                boxShadow: `0 0 16px ${TEAL}`,
              }}
            />
            <Typography variant="h6" sx={{ letterSpacing: '0.32em', fontWeight: 600 }}>
              VEILCORE
            </Typography>
          </Stack>
          <WalletBadge network={network} demo={demoMode} />
        </Stack>

        {/* Hero */}
        <MBox
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          sx={{ maxWidth: 780, mb: { xs: 5, md: 8 } }}
        >
          <Typography variant="overline">Zero-knowledge provenance for living material</Typography>
          <Typography variant="h2" sx={{ mt: 1.5, mb: 2, fontSize: { xs: '2.2rem', md: '3.1rem' }, lineHeight: 1.05 }}>
            Anchor provenance.{' '}
            <Box component="span" sx={{ color: TEAL }}>
              Prove ownership.
            </Box>{' '}
            Reveal nothing.
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ fontSize: '1.06rem', maxWidth: 620 }}>
            Veilcore commits a strain&apos;s genetics to an immutable on-chain record — hashed on your own device.
            Later, prove you hold that strain without ever disclosing its genetics.
          </Typography>
        </MBox>

        {/* Main grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.25fr 0.9fr' },
            gap: { xs: 3, md: 4 },
            alignItems: 'start',
          }}
        >
          <Paper sx={{ p: { xs: 2.5, md: 4 } }}>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: '1rem' } }}
            >
              <Tab label="Anchor a strain" />
              <Tab label="Prove ownership" />
            </Tabs>
            {tab === 0 ? <AnchorPanel /> : <VerifyPanel />}
          </Paper>

          <Stack spacing={3}>
            <StrainList />
          </Stack>
        </Box>

        <Divider sx={{ mt: { xs: 6, md: 9 }, mb: 3 }} />
        <Typography variant="caption" color="text.secondary">
          {demoMode
            ? 'Demo mode — commitment hashing is real (runs locally in your browser); the on-chain ledger is simulated until the Veilcore contract is deployed on Preview.'
            : `Live on ${network} · contract ${contractAddress.slice(0, 18)}…`}
        </Typography>
      </Container>
    </Box>
  );
};

export default App;
