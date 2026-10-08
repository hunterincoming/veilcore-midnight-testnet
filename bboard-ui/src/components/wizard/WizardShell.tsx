// WizardShell — the persistent frame: brand hook, the always-visible 6-step progress path,
// and one animated step on screen at a time. The order follows how a breeder actually
// operates: seal it → (send it to a lab) → (the report comes back) → certificate → choose
// what others see → share or license. The lab and DNA steps are skippable; a completion recap
// closes it out. This is the primary guided path — the dashboard/record page stay the fast
// path for returning users.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import DoneIcon from '@mui/icons-material/TaskAltOutlined';
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
import { AGREEMENT_RECORDED, THIS_SITE } from '../../config/copy';

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
            <DoneIcon sx={{ fontSize: 52, color: TEAL, filter: `drop-shadow(0 0 16px ${TEAL})` }} />
            <Typography variant="h4" sx={{ mt: 1 }}>
              {license
                ? type === 'license'
                  ? 'Agreement recorded.'
                  : 'Shared on your terms.'
                : 'Your record is sealed.'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, mx: 'auto', mt: 1 }}>
              {record ? <b>{record.strainName}</b> : 'Your record'} is sealed, and its lab and DNA files stayed on your
              device
              {license
                ? `. The agreement is attached to the record; in ${THIS_SITE}, signing is simulated. VeilCore records what is owed; payment happens between you.`
                : '. It is dated when its batch is anchored; its verify page shows when that has happened.'}
            </Typography>
          </Box>

          {license && type ? (
            <Paper sx={{ p: { xs: 2.5, md: 3 }, textAlign: 'left', border: `1px solid ${TEAL}55` }}>
              <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
                {AGREEMENT_RECORDED} · {AGREEMENT_LABEL[type]}
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
                You haven’t shared or licensed it yet. When you’re ready, open the record and choose License, Send to a
                lab, or Share with a breeder. The terms are attached to the record.
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
                  Open the record
                </Button>
              )
            )}
            <Button variant={license ? 'contained' : 'outlined'} onClick={() => navigate('/records')}>
              All records
            </Button>
            <Button variant="text" onClick={restart}>
              Seal another record
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
          Prove you had it{' '}
          <Box component="span" sx={{ color: TEAL }}>
            first.
          </Box>
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640, mx: 'auto' }}>
          Seal it, pair your lab report, choose what others see, then share or license it.
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
        <Button component={RouterLink} to="/records" size="small" variant="text" color="inherit">
          Go to your records (everything is saved)
        </Button>
      </Box>
    </Box>
  );
};
