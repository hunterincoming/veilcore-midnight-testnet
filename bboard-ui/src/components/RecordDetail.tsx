// RecordDetail (/record/:id) — a single strain's full picture and its available next
// actions. Reuses the wizard step components so a returning breeder can pair DNA, pull
// the evidence package, or prove ownership on an existing record.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import { useRecords, getRecord, attestRecord } from '../veilcore/records';
import { useLicenses, licensesForRecord, activeLicenseCount } from '../veilcore/licenses';
import { shortFingerprint } from '../veilcore/commitment';
import { StatusChain } from './StatusChain';
import { LineageGraph } from './LineageGraph';
import { LicenseStateChip } from './licensing/LicenseStateChip';
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
  useLicenses();
  const { id = '' } = useParams();
  const navigate = useNavigate();
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
            Back to your cultivars
          </Button>
        </Paper>
      </Box>
    );
  }

  const back = () => setMode('overview');
  const licenses = licensesForRecord(record.id);

  return (
    <Box>
      <AppHeader />

      <Button component={RouterLink} to="/" size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        All cultivars
      </Button>

      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="h4">{record.strainName}</Typography>
        <Typography variant="caption" color="text.secondary">
          {record.id}
        </Typography>
      </Stack>
      <Box sx={{ mb: 2.5 }}>
        <StatusChain record={record} licenseCount={activeLicenseCount(record.id)} />
      </Box>

      {mode === 'overview' && (
        <Stack spacing={2.5}>
          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={2}>
              <Field label="Bred by">{record.bredBy}</Field>
              {record.breedingMethod && <Field label="Breeding method">{record.breedingMethod}</Field>}
              {record.parents && record.parents.length > 0 && (
                <Field label="Parents">{record.parents.map((p) => p.name).join('  ×  ')}</Field>
              )}
              <Field label="Stated creation date (breeder's claim)">{record.dateCreated}</Field>
              <Field label="Sealed with Veilcore">{fmt(record.loggedAt)}</Field>
              {record.refId && <Field label="Reference / lot ID">{record.refId}</Field>}
              {record.photoFingerprints && record.photoFingerprints.length > 0 && (
                <Field label="Photos">
                  {record.photoFingerprints.length} sealed (fingerprints only — images never stored)
                </Field>
              )}
              {record.notes && <Field label="Notes">{record.notes}</Field>}
              <Field label="DNA report">
                {record.dnaFingerprint
                  ? `paired (${record.dnaFileName ?? 'file'}) · ${shortFingerprint(record.dnaFingerprint)}`
                  : 'not paired yet'}
              </Field>
              <Divider />
              <Field label="Record fingerprint">
                <Box component="span" sx={{ fontFamily: '"Space Grotesk", monospace' }}>
                  {shortFingerprint(record.recordFingerprint)}
                </Box>
              </Field>
            </Stack>
          </Paper>

          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <Typography variant="overline" sx={{ display: 'block', mb: 1.25 }}>
              Lab attestation
            </Typography>
            {record.attestation ? (
              <Alert severity="success" variant="outlined">
                Attested by {record.attestation.lab} · {new Date(record.attestation.attestedAt).toLocaleDateString()} —
                a second party has confirmed this sample.
              </Alert>
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  A second party confirming they received this sample makes your record far stronger evidence than one
                  you signed alone.
                </Typography>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    variant="outlined"
                    startIcon={<ScienceIcon />}
                    onClick={() => attestRecord(record.id, 'Demo Genetics Lab')}
                  >
                    Simulate lab attestation
                  </Button>
                  <Chip size="small" variant="outlined" label="Demo action" />
                </Stack>
              </Stack>
            )}
          </Paper>

          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
              Lineage
            </Typography>
            <LineageGraph record={record} />
          </Paper>

          {licenses.length > 0 && (
            <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
              <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
                Licenses
              </Typography>
              <Stack spacing={1}>
                {licenses.map((l) => (
                  <Stack
                    key={l.id}
                    direction="row"
                    onClick={() => navigate(`/license/${l.id}`)}
                    sx={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      p: 1,
                      borderRadius: 1,
                      '&:hover': { background: 'rgba(255,255,255,0.03)' },
                    }}
                  >
                    <Typography variant="body2">
                      {l.terms.licensee || 'unnamed licensee'} · {l.id}
                    </Typography>
                    <LicenseStateChip license={l} />
                  </Stack>
                ))}
              </Stack>
            </Paper>
          )}

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
            <Button variant="contained" startIcon={<GavelIcon />} onClick={() => navigate(`/record/${record.id}/license`)}>
              License this cultivar
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
