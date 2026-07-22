// Veilcore — the enforcement layer for cannabis genetics. Routed app: records
// dashboard, the guided wizard, per-strain detail, and a public verification view.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Container } from '@mui/material';
import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { WizardShell } from './components/wizard/WizardShell';
import { RecordDetail } from './components/RecordDetail';
import { VerifyPage } from './pages/VerifyPage';

const AppLayout: React.FC<React.PropsWithChildren> = ({ children }) => (
  <Box
    sx={{
      minHeight: '100vh',
      background: `radial-gradient(1100px 620px at 78% -8%, rgba(47,240,207,0.10), transparent 60%),
                   radial-gradient(900px 500px at 8% 108%, rgba(138,125,255,0.06), transparent 55%),
                   #04070a`,
    }}
  >
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
      {children}
    </Container>
  </Box>
);

const App: React.FC = () => (
  <Routes>
    <Route
      path="/"
      element={
        <AppLayout>
          <Dashboard />
        </AppLayout>
      }
    />
    <Route
      path="/new"
      element={
        <AppLayout>
          <WizardShell />
        </AppLayout>
      }
    />
    <Route
      path="/record/:id"
      element={
        <AppLayout>
          <RecordDetail />
        </AppLayout>
      }
    />
    <Route path="/verify/:id" element={<VerifyPage />} />
  </Routes>
);

export default App;
