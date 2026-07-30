// WizardShell — the persistent frame: brand hook, the always-visible 6-step progress path,
// and one animated step on screen at a time. The order follows how a breeder actually
// operates: log it → (send it to a lab) → (the report comes back) → evidence → prove exactly
// what you choose → share or license. The lab and DNA steps are skippable; a completion recap
// closes it out. This is the primary guided path — the dashboard/record page stay the fast
// path for returning users.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import { ProgressPath } from './ProgressPath';
import { Step1LogStrain } from './Step1LogStrain';
import { Step2LabTransfer } from './Step2LabTransfer';
import { Step2PairDna } from './Step2PairDna';
import { Step3Certificate } from './Step3Certificate';
import { Step5ProveDisclosure } from './Step5ProveDisclosure';
import { Step6ShareOrLicense } from './Step6ShareOrLicense';
import { AppHeader } from '../AppHeader';
import { getLicense, agreementRows, agreementType, AGREEMENT_LABEL } from '../../veilcore/licenses';
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

const LAST_STEP = 6;

export const WizardShell: React.FC = () => {
  const [step, setStep] = useState(1);
  const [recordId, setRecordId] = useState<string>();
  const [shareLicenseId, setShareLicenseId] = useState<string>();
  const [skipped, setSkipped] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const markSkipped = (n: number) => setSkipped((s) => (s.includes(n) ? s : [...s, n]));

  // Back over any skipped steps to the previous one the breeder actually saw.
  const goBack = (from: number) => {
    for (let m = from - 1; m >= 1; m--) if (!skipped.includes(m)) return setStep(m);
    setStep(1);
  };

  const restart = () => {
    setRecordId(undefined);
    setShareLicenseId(undefined);
    setSkipped([]);
    setDone(false);
    setStep(1);
  };

  const active = (() => {
    if (done) {
      const record = recordId ? getRecord(recordId) : undefined;
      const license = shareLicenseId ? getLicense(shareLicenseId) : undefined;
      const type = license ? agreementType(license) : undefined;
      return (
        <Stack spacing={2.5} sx={{ textAlign: 'center' }}>
          <Box>
            <PaidIcon sx={{ fontSize: 52, color: TEAL, filter: `drop-shadow(0 0 16px ${TEAL})` }} />
            <Typography variant="h4" sx={{ mt: 1 }}>
              {license
                ? type === 'license'
                  ? 'You’re set — and this is how you get paid.'
                  : 'You’re set — shared on your terms.'
                : 'Your cultivar is protected.'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, mx: 'auto', mt: 1 }}>
              {record ? <b>{record.strainName}</b> : 'Your cultivar'} is logged and sealed. Everything you proved stays
              provable — and the genetics never left your device
              {license ? ', with an active agreement whose terms are bound to them.' : '.'}
            </Typography>
          </Box>

          {license && type ? (
            <Paper sx={{ p: { xs: 2.5, md: 3 }, textAlign: 'left', border: `1px solid ${TEAL}55` }}>
              <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
                Active · {AGREEMENT_LABEL[type]}
              </Typography>
              <Stack spacing={1}>
                {agreementRows(license).map((r) => (
                  <Row key={r.k} k={r.k} v={r.v} />
                ))}
              </Stack>
            </Paper>
          ) : (
            recordId && (
              <Alert severity="info" variant="outlined" sx={{ textAlign: 'left' }}>
                You didn’t share or license it yet. When you’re ready, open the cultivar and choose License, Send to a
                lab, or Share with a breeder — the terms are bound to the record and its DNA fingerprint.
              </Alert>
            )
          )}

          <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            {license ? (
              <Button variant="outlined" onClick={() => navigate(`/license/${license.id}`)}>
                Manage agreement
              </Button>
            ) : (
              recordId && (
                <Button variant="contained" onClick={() => navigate(`/record/${recordId}`)}>
                  Open cultivar
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
          <Step2LabTransfer
            recordId={recordId}
            onBack={() => goBack(2)}
            onDone={() => setStep(3)}
            onSkip={() => {
              markSkipped(2);
              setStep(3);
            }}
          />
        ) : null;
      case 3:
        return recordId ? (
          <Step2PairDna
            recordId={recordId}
            onBack={() => goBack(3)}
            onDone={() => setStep(4)}
            onSkip={() => {
              markSkipped(3);
              setStep(4);
            }}
          />
        ) : null;
      case 4:
        return recordId ? (
          <Step3Certificate recordId={recordId} onBack={() => goBack(4)} onDone={() => setStep(5)} />
        ) : null;
      case 5:
        return recordId ? (
          <Step5ProveDisclosure recordId={recordId} onBack={() => goBack(5)} onDone={() => setStep(6)} />
        ) : null;
      case 6:
        return recordId ? (
          <Step6ShareOrLicense
            recordId={recordId}
            onBack={() => goBack(6)}
            onDone={(licId) => {
              setShareLicenseId(licId);
              setDone(true);
            }}
          />
        ) : null;
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
          Log it, send it to a lab, pair the report, prove exactly what you choose, then share or license it — terms
          bound to the sealed record and its DNA fingerprint.
        </Typography>
      </Box>

      <Box sx={{ mb: { xs: 4, md: 5 } }}>
        <ProgressPath current={done ? LAST_STEP + 1 : step} skipped={skipped} />
      </Box>

      <Paper sx={{ p: { xs: 2.5, md: 4 }, maxWidth: 760, mx: 'auto', minHeight: 380, overflow: 'hidden' }}>
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
