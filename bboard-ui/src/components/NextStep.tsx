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
import { SendToLab } from './SendToLab';
import { AttachReport } from './AttachReport';
import { TEAL } from '../config/theme';

type Step = {
  /** Some steps render their own control rather than a plain button. */
  custom?: React.ReactNode;
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
  onAgreement: () => void;
}> = ({ record, onPairDna, onAgreement }) => {
  let step: Step;

  // A record that arrived through a transfer belongs to the recipient. Telling them to
  // "send it to a lab for confirmation" is telling the lab to send it to a lab — the
  // page has to know which side of the transfer the reader is on.
  const isReceived = Boolean(record.receivedFrom);

  if (isReceived && !record.attestation) {
    step = {
      title: 'Confirm what you received',
      why: 'You hold this material now. Attaching your report is what turns the sender\u2019s record into evidence — signed by you, not recorded on your behalf.',
      action: 'Attach a report',
      icon: <ScienceIcon />,
      onClick: () => {},
      // The lab's report belongs on the sender's record, not their own.
      custom: <AttachReport record={record} />,
    };
  } else if (isReceived) {
    step = {
      title: 'Received and confirmed',
      why: 'Your confirmation is on the sender\u2019s record. You can send this material onward, or license what you produce from it.',
      action: 'Start an agreement',
      icon: <SendIcon />,
      onClick: onAgreement,
    };
  } else if (!record.dnaFingerprint && !record.attestation) {
    step = {
      title: 'Send a sample to a lab',
      why: 'Right now this record is your own account of the cultivar. A lab confirming receipt and returning a report is what makes it evidence someone else can rely on — and they produce the report, so this is the step that starts it.',
      action: 'Send to a lab',
      icon: <VerifiedIcon />,
      onClick: () => {},
      custom: <SendToLab record={record} />,
    };
  } else {
    step = {
      title: 'This record is ready to use',
      why: 'Confirmed by a second party. You can send material onward or license it with terms that follow the genetics into every descendant.',
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
        <Box sx={{ flexShrink: 0 }}>
          {step.custom ?? (
            <Button variant="contained" startIcon={step.icon} onClick={step.onClick}>
              {step.action}
            </Button>
          )}
        </Box>
      </Stack>
    </Paper>
  );
};
