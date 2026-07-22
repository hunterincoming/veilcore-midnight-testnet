// WizardShell — the persistent frame: brand hook, wallet/mode badge, the always-visible
// progress path, and one animated step on screen at a time.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { ProgressPath } from './ProgressPath';
import { Step1LogStrain } from './Step1LogStrain';
import { Step2PairDna } from './Step2PairDna';
import { Step3Certificate } from './Step3Certificate';
import { Step4ProveOwnership } from './Step4ProveOwnership';
import { AppHeader } from '../AppHeader';
import { TEAL } from '../../config/theme';

export const WizardShell: React.FC = () => {
  const [step, setStep] = useState(1);
  const [recordId, setRecordId] = useState<string>();

  const goStep1 = () => {
    setRecordId(undefined);
    setStep(1);
  };

  const active = (() => {
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
        return <Step4ProveOwnership onBack={() => setStep(3)} onRestart={goStep1} />;
      default:
        return null;
    }
  })();

  return (
    <Box>
      <AppHeader />

      {/* hook */}
      <Box sx={{ textAlign: 'center', mb: { xs: 4, md: 6 } }}>
        <Typography variant="h2" sx={{ fontSize: { xs: '2rem', md: '2.9rem' }, mb: 1.5 }}>
          Prove you made it{' '}
          <Box component="span" sx={{ color: TEAL }}>
            first.
          </Box>
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640, mx: 'auto' }}>
          Breeders keep dated records to prove they bred it first. Veilcore is the tamper-proof version — and the proof
          travels with the genetics, even to someone who never signed a contract.
        </Typography>
      </Box>

      {/* progress */}
      <Box sx={{ mb: { xs: 4, md: 5 } }}>
        <ProgressPath current={step} />
      </Box>

      {/* one step at a time */}
      <Paper sx={{ p: { xs: 2.5, md: 4 }, maxWidth: 720, mx: 'auto', minHeight: 380, overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {active}
          </motion.div>
        </AnimatePresence>
      </Paper>
    </Box>
  );
};
