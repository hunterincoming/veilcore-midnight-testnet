// VeilCore — records, licenses and verification for plant and animal genetics. Routed app: public
// pages, records dashboard, guided wizard, per-cultivar detail, licensing, and public
// verification.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect } from 'react';
import { Home } from './components/site/Home';
import { Founders, VerifyLookup } from './components/site/Founders';
import { Privacy } from './components/site/Privacy';
import { DocPage } from './components/DocPage';
import { Implementations } from './components/Implementations';
import { AppFooter } from './components/AppFooter';
import { RolePicker } from './components/RolePicker';
import { Box, Container } from '@mui/material';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { WizardShell } from './components/wizard/WizardShell';
import { RecordDetail } from './components/RecordDetail';
import { VerifyPage } from './pages/VerifyPage';
import { VerifyExample } from './components/verify/VerifyExample';
import { TermsBuilder } from './components/licensing/TermsBuilder';
import { LicenseDetail } from './components/licensing/LicenseDetail';
import { CounterSignPage } from './components/licensing/CounterSignPage';
import { LicensingHub } from './components/licensing/LicensingHub';
import { SaveProblemBar } from './components/SaveProblemBar';
import { startRecordSync } from './veilcore/records';
import { startLicenseSync } from './veilcore/licenses';

/** Pages where someone is using the app, as opposed to reading about it. */
const APP_PAGE = /^\/(new|records|record\/|licenses|license\/)/;

const AppLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  // The role question belongs to the app: making records, holding them, licensing them.
  // The documents and the implementations list are read by people deciding whether to
  // look further (investors, labs, counsel); a dialog over them, in one language, before
  // they have read a line, is the wrong first thing. The public pages outside this
  // layout (/, /founders, /verify, /privacy) never ask either.
  const { pathname } = useLocation();
  const askRole = APP_PAGE.test(pathname);
  // The app pages load and follow the holder's records; the landing page, the public
  // verify page and the documents do not (attack round D). Without a holder key in this
  // browser nothing is requested at all.
  useEffect(() => {
    startRecordSync();
    startLicenseSync();
  }, []);
  return (
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
      <RolePicker ask={askRole} />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <SaveProblemBar />
        {children}
      </Container>
      {/* Documents reachable from wherever someone happens to be, rather than only from
        the page they landed on. */}
      <AppFooter />
    </Box>
  );
};

const withLayout = (el: React.ReactNode) => <AppLayout>{el}</AppLayout>;

const App: React.FC = () => (
  <Routes>
    {/* A stranger arriving from a specification or a government submission needs
        somewhere to understand what this is. The dashboard assumes you already do. */}
    <Route path="/" element={<Home />} />
    <Route path="/founders" element={<Founders />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/verify" element={<VerifyLookup />} />
    <Route path="/records" element={withLayout(<Dashboard />)} />
    {/* Documents read here rather than in a code repository. */}
    <Route path="/docs/:doc" element={withLayout(<DocPage />)} />
    <Route path="/implementations" element={withLayout(<Implementations />)} />
    <Route path="/new" element={withLayout(<WizardShell />)} />
    <Route path="/record/:id" element={withLayout(<RecordDetail />)} />
    <Route path="/record/:id/license" element={withLayout(<TermsBuilder />)} />
    <Route path="/licenses" element={withLayout(<LicensingHub />)} />
    <Route path="/license/:id" element={withLayout(<LicenseDetail />)} />
    <Route path="/license/:id/sign" element={<CounterSignPage />} />
    {/* A made-up record, labelled as one, for a visitor with no record id yet. */}
    <Route path="/verify/example" element={<VerifyExample />} />
    <Route path="/verify/:id" element={<VerifyPage />} />
  </Routes>
);

export default App;
