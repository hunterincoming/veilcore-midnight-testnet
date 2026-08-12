// Veilcore — the enforcement layer for cannabis genetics. Routed app: records
// dashboard, guided wizard, per-strain detail, licensing, and public verification.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { RolePicker } from './components/RolePicker';
import { Box, Container } from '@mui/material';
import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { WizardShell } from './components/wizard/WizardShell';
import { RecordDetail } from './components/RecordDetail';
import { VerifyPage } from './pages/VerifyPage';
import { TermsBuilder } from './components/licensing/TermsBuilder';
import { LicenseDetail } from './components/licensing/LicenseDetail';
import { CounterSignPage } from './components/licensing/CounterSignPage';
import { LicensingHub } from './components/licensing/LicensingHub';

const AppLayout: React.FC<React.PropsWithChildren> = ({ children }) => (
  <Box
    sx={{
      minHeight: '100vh',
      background: `radial-gradient(1100px 620px at 78% -8%, rgba(47,240,207,0.10), transparent 60%),
                   radial-gradient(900px 500px at 8% 108%, rgba(138,125,255,0.06), transparent 55%),
                   #04070a`,
    }}
  >
    {/* Asked once, on first use. Without it the app has to guess who is reading,
        which is how a lab was told to send its own sample to a lab. */}
    <RolePicker />
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
      {children}
    </Container>
  </Box>
);

const withLayout = (el: React.ReactNode) => <AppLayout>{el}</AppLayout>;

const App: React.FC = () => (
  <Routes>
    <Route path="/" element={withLayout(<Dashboard />)} />
    <Route path="/new" element={withLayout(<WizardShell />)} />
    <Route path="/record/:id" element={withLayout(<RecordDetail />)} />
    <Route path="/record/:id/license" element={withLayout(<TermsBuilder />)} />
    <Route path="/licenses" element={withLayout(<LicensingHub />)} />
    <Route path="/license/:id" element={withLayout(<LicenseDetail />)} />
    <Route path="/license/:id/sign" element={<CounterSignPage />} />
    <Route path="/verify/:id" element={<VerifyPage />} />
  </Routes>
);

export default App;
