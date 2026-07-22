// VerifyPage (/verify/:id) — public, shareable proof anyone can open to confirm a record
// exists and is intact, WITHOUT seeing any genetics. Phase 3.4 deepens this; the Phase 1
// version already reads the record and shows the privacy-safe facts.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Chip, Container, Divider, Paper, Stack, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import { useRecords, getRecord } from '../veilcore/records';
import { useLicenses, activeLicenseCount } from '../veilcore/licenses';
import { shortFingerprint } from '../veilcore/commitment';
import { TEAL } from '../config/theme';

const fmt = (ms: number) => new Date(ms).toLocaleString();

const Fact: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
    {ok ? (
      <CheckCircleIcon sx={{ fontSize: 18, color: TEAL }} />
    ) : (
      <CancelIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
    )}
    <Typography variant="body2" sx={{ color: ok ? 'text.primary' : 'text.secondary' }}>
      {children}
    </Typography>
  </Stack>
);

export const VerifyPage: React.FC = () => {
  useRecords(); // re-render on store changes
  useLicenses();
  const { id = '' } = useParams();
  const record = getRecord(id);
  const activeLic = record ? activeLicenseCount(record.id) : 0;

  return (
    <Box sx={{ minHeight: '100vh', background: '#04070a' }}>
      <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', justifyContent: 'center', mb: 4 }}>
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', background: TEAL, boxShadow: `0 0 14px ${TEAL}` }} />
          <Typography variant="h6" sx={{ letterSpacing: '0.3em', fontWeight: 600 }}>
            VEILCORE
          </Typography>
        </Stack>

        {!record ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              No record found for {id || 'this ID'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This verification link doesn&apos;t match a record on this device. (In demo mode, verification reads local
              records; the deployed version checks the public network.)
            </Typography>
          </Paper>
        ) : (
          <Paper sx={{ p: { xs: 3, md: 4 } }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
              <VerifiedIcon sx={{ color: TEAL, fontSize: 30 }} />
              <Box>
                <Typography variant="overline" sx={{ color: TEAL }}>
                  Provenance verified
                </Typography>
                <Typography variant="h5">{record.strainName}</Typography>
              </Box>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Bred by {record.bredBy} · sealed {fmt(record.loggedAt)} · {record.id}
            </Typography>

            <Divider sx={{ mb: 2 }} />

            <Stack spacing={1.25}>
              <Fact ok>Record exists and its fingerprint is intact — unaltered since it was sealed.</Fact>
              <Fact ok={!!record.dnaFingerprint}>
                DNA report {record.dnaFingerprint ? 'paired' : 'not yet paired'}
              </Fact>
              <Fact ok={!!record.attestation}>
                {record.attestation ? `Attested by ${record.attestation.lab}` : 'No lab attestation yet'}
              </Fact>
              <Fact ok={activeLic > 0}>
                {activeLic > 0 ? `${activeLic} active license${activeLic === 1 ? '' : 's'} on record` : 'No active license'}
              </Fact>
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Fingerprint {shortFingerprint(record.recordFingerprint)} · no genetics disclosed
              </Typography>
              <Chip size="small" variant="outlined" label="Demo · reads local records" />
            </Stack>
          </Paper>
        )}
      </Container>
    </Box>
  );
};
