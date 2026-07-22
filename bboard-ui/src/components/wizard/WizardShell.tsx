// WizardShell — the persistent frame: brand hook, the always-visible progress path, and
// one animated step on screen at a time. Five steps ending on the licensing money moment,
// then a completion recap.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import { ProgressPath } from './ProgressPath';
import { Step1LogStrain } from './Step1LogStrain';
import { Step2PairDna } from './Step2PairDna';
import { Step3Certificate } from './Step3Certificate';
import { Step4License } from './Step4License';
import { Step4ProveOwnership } from './Step4ProveOwnership';
import { AppHeader } from '../AppHeader';
import { getLicense, RIGHTS_LABEL } from '../../veilcore/licenses';
import { getRecord } from '../../veilcore/records';
import { TEAL } from '../../config/theme';

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
    <Typography variant="body2" color="text.secondary">
      {k}
    </Typography>
    <Typography variant="body2" sx={{ textAlign: 'right' }}>
      {v}
    </Typography>
  </Stack>
);

export const WizardShell: React.FC = () => {
  const [step, setStep] = useState(1);
  const [recordId, setRecordId] = useState<string>();
  const [licenseId, setLicenseId] = useState<string>();
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const restart = () => {
    setRecordId(undefined);
    setLicenseId(undefined);
    setDone(false);
    setStep(1);
  };

  const active = (() => {
    if (done) {
      const record = recordId ? getRecord(recordId) : undefined;
      const license = licenseId ? getLicense(licenseId) : undefined;
      return (
        <Stack spacing={2.5} sx={{ textAlign: 'center' }}>
          <Box>
            <PaidIcon sx={{ fontSize: 52, color: TEAL, filter: `drop-shadow(0 0 16px ${TEAL})` }} />
            <Typography variant="h4" sx={{ mt: 1 }}>
              {license ? 'You’re set — and this is how you get paid.' : 'Your cultivar is protected.'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, mx: 'auto', mt: 1 }}>
              {record ? <b>{record.strainName}</b> : 'Your cultivar'} is logged, DNA-paired, and ownership-proven
              {license ? ', with an active license whose terms are bound to the genetics.' : '.'}
            </Typography>
          </Box>

          {license ? (
            <Paper sx={{ p: { xs: 2.5, md: 3 }, textAlign: 'left', border: `1px solid ${TEAL}55` }}>
              <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
                Active license · royalty terms
              </Typography>
              <Stack spacing={1}>
                <Row k="Licensee" v={license.terms.licensee} />
                <Row k="Rights" v={RIGHTS_LABEL[license.terms.rights]} />
                <Row
                  k="Royalty"
                  v={
                    license.terms.royaltyType === 'percent'
                      ? `${license.terms.royaltyAmount}% · ${license.terms.unitBasis}`
                      : `$${license.terms.royaltyAmount} · ${license.terms.unitBasis}`
                  }
                />
                <Row k="Term" v={`${license.terms.startDate} → ${license.terms.endDate}`} />
              </Stack>
            </Paper>
          ) : (
            recordId && (
              <Alert severity="info" variant="outlined" sx={{ textAlign: 'left' }}>
                You skipped licensing. When you’re ready to get paid, license this cultivar — the terms travel with the
                genetics.
              </Alert>
            )
          )}

          <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            {license ? (
              <Button variant="outlined" onClick={() => navigate(`/license/${license.id}`)}>
                Manage license
              </Button>
            ) : (
              recordId && (
                <Button variant="contained" onClick={() => navigate(`/record/${recordId}/license`)}>
                  License this cultivar
                </Button>
              )
            )}
            <Button variant={license ? 'contained' : 'outlined'} onClick={() => navigate('/')}>
              All cultivars
            </Button>
            <Button variant="text" onClick={restart}>
              Log another cultivar
            </Button>
          </Stack>
        </Stack>
      );
    }
    switch (step) {
      case 1:
        return (
          <Step1LogStrain
            onDone={(id) => {
              setRecordId(id);
              setStep(2);
            }}
          />
        );
      case 2:
        return recordId ? (
          <Step2PairDna recordId={recordId} onBack={() => setStep(1)} onDone={() => setStep(3)} />
        ) : null;
      case 3:
        return recordId ? (
          <Step3Certificate recordId={recordId} onBack={() => setStep(2)} onDone={() => setStep(4)} />
        ) : null;
      case 4:
        return recordId ? (
          <Step4License
            recordId={recordId}
            onBack={() => setStep(3)}
            onDone={(licId) => {
              setLicenseId(licId);
              setStep(5);
            }}
          />
        ) : null;
      case 5:
        return <Step4ProveOwnership onBack={() => setStep(4)} onRestart={restart} onDone={() => setDone(true)} />;
      default:
        return null;
    }
  })();

  return (
    <Box>
      <AppHeader />

      <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
        <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.9rem' }, mb: 1.5 }}>
          Prove you made it{' '}
          <Box component="span" sx={{ color: TEAL }}>
            first.
          </Box>
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640, mx: 'auto' }}>
          Log your cultivar, pair its DNA, and license it with terms bound to the genetics — proof and payment that
          travel with the plant, even to someone who never signed a contract.
        </Typography>
      </Box>

      <Box sx={{ mb: { xs: 4, md: 5 } }}>
        <ProgressPath current={done ? 6 : step} />
      </Box>

      <Paper sx={{ p: { xs: 2.5, md: 4 }, maxWidth: 720, mx: 'auto', minHeight: 380, overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={done ? 'done' : step}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {active}
          </motion.div>
        </AnimatePresence>
      </Paper>

      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <Button component={RouterLink} to="/" size="small" variant="text" color="inherit">
          Save &amp; exit to dashboard
        </Button>
      </Box>
    </Box>
  );
};
