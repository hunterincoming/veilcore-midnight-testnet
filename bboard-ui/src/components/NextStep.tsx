// The single most useful thing to do with this record right now.
//
// A record page that presents every panel equally makes the reader do the work of
// deciding what matters. Computing one primary action from the record's state is what
// turns a screen that reports into a screen that helps.
//
// Research on progressive disclosure is consistent here: deferring secondary options
// measurably speeds up the primary task, provided the deferred things stay findable.
// So this never hides anything — it puts one action first.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';
import type { StrainRecord } from '../veilcore/records';
import { TEAL } from '../config/theme';

type Step = {
  title: string;
  /** What this gets them. Never a description of the state they can already see. */
  why: string;
  action: string;
  icon: React.ReactNode;
  onClick: () => void;
};

export const NextStep: React.FC<{
  record: StrainRecord;
  onPairDna: () => void;
  onAttest: () => void;
  onAgreement: () => void;
}> = ({ record, onPairDna, onAttest, onAgreement }) => {
  let step: Step;

  if (!record.dnaFingerprint) {
    step = {
      title: 'Pair a DNA report',
      why: 'Right now this record is a name you typed. Pairing a lab report ties it to the actual genetics, so a claim becomes something anyone can test.',
      action: 'Pair DNA report',
      icon: <ScienceIcon />,
      onClick: onPairDna,
    };
  } else if (!record.attestation) {
    step = {
      title: 'Get a second party to confirm it',
      why: 'A record you signed alone is weaker evidence than one a lab confirms they received. Send them the evidence package and ask them to confirm receipt.',
      action: 'Evidence package',
      icon: <VerifiedIcon />,
      onClick: onAttest,
    };
  } else {
    step = {
      title: 'This record is ready to use',
      why: 'DNA paired and confirmed by a second party. You can send it to a lab or license it with terms that follow the genetics into every descendant.',
      action: 'Start an agreement',
      icon: <SendIcon />,
      onClick: onAgreement,
    };
  }

  return (
    <Paper sx={{ p: { xs: 2.5, md: 3 }, borderColor: TEAL, borderWidth: 1, borderStyle: 'solid' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" sx={{ color: TEAL, display: 'block' }}>
            Next step
          </Typography>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            {step.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {step.why}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={step.icon} onClick={step.onClick} sx={{ flexShrink: 0 }}>
          {step.action}
        </Button>
      </Stack>
    </Paper>
  );
};
