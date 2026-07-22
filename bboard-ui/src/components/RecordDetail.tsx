// RecordDetail (/record/:id) — a single strain's full picture and its available next
// actions. Reuses the wizard step components so a returning breeder can pair DNA, pull
// the evidence package, or prove ownership on an existing record.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Box, Button, Divider, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import { useRecords, getRecord } from '../veilcore/records';
import { shortFingerprint } from '../veilcore/commitment';
import { StatusChain } from './StatusChain';
import { AppHeader } from './AppHeader';
import { Step2PairDna } from './wizard/Step2PairDna';
import { Step3Certificate } from './wizard/Step3Certificate';
import { Step4ProveOwnership } from './wizard/Step4ProveOwnership';

type Mode = 'overview' | 'pair' | 'cert' | 'prove';
const fmt = (ms: number) => new Date(ms).toLocaleString();

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box>
    <Typography variant="overline" sx={{ display: 'block' }}>
      {label}
    </Typography>
    <Typography variant="body2">{children}</Typography>
  </Box>
);

export const RecordDetail: React.FC = () => {
  useRecords();
  const { id = '' } = useParams();
  const [mode, setMode] = useState<Mode>('overview');
  const record = getRecord(id);

  if (!record) {
    return (
      <Box>
        <AppHeader />
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Record not found
          </Typography>
          <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />}>
            Back to your strains
          </Button>
        </Paper>
      </Box>
    );
  }

  const back = () => setMode('overview');

  return (
    <Box>
      <AppHeader />

      <Button component={RouterLink} to="/" size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        All strains
      </Button>

      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="h4">{record.strainName}</Typography>
        <Typography variant="caption" color="text.secondary">
          {record.id}
        </Typography>
      </Stack>
      <Box sx={{ mb: 2.5 }}>
        <StatusChain record={record} />
      </Box>

      {mode === 'overview' && (
        <Stack spacing={2.5}>
          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={2}>
              <Field label="Bred by">{record.bredBy}</Field>
              <Field label="Stated creation date (breeder's claim)">{record.dateCreated}</Field>
              <Field label="Sealed with Veilcore">{fmt(record.loggedAt)}</Field>
              {record.notes && <Field label="Notes">{record.notes}</Field>}
              <Field label="DNA report">
                {record.dnaFingerprint
                  ? `paired (${record.dnaFileName ?? 'file'}) · ${shortFingerprint(record.dnaFingerprint)}`
                  : 'not paired yet'}
              </Field>
              <Field label="Lab attestation">
                {record.attestation ? `attested by ${record.attestation.lab}` : 'awaiting lab attestation'}
              </Field>
              <Divider />
              <Field label="Record fingerprint">
                <Box component="span" sx={{ fontFamily: '"Space Grotesk", monospace' }}>
                  {shortFingerprint(record.recordFingerprint)}
                </Box>
              </Field>
            </Stack>
          </Paper>

          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
            {!record.dnaFingerprint && (
              <Button variant="contained" startIcon={<ScienceIcon />} onClick={() => setMode('pair')}>
                Pair DNA report
              </Button>
            )}
            <Button variant="outlined" startIcon={<DescriptionIcon />} onClick={() => setMode('cert')}>
              Evidence package
            </Button>
            <Button variant="outlined" startIcon={<VerifiedIcon />} onClick={() => setMode('prove')}>
              Prove ownership
            </Button>
          </Stack>
        </Stack>
      )}

      {mode !== 'overview' && (
        <Paper sx={{ p: { xs: 2.5, md: 4 } }}>
          {mode === 'pair' && <Step2PairDna recordId={record.id} onBack={back} onDone={back} />}
          {mode === 'cert' && <Step3Certificate recordId={record.id} onBack={back} onDone={back} />}
          {mode === 'prove' && <Step4ProveOwnership onBack={back} onRestart={back} />}
        </Paper>
      )}
    </Box>
  );
};
