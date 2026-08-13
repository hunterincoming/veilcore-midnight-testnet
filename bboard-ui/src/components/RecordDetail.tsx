// RecordDetail (/record/:id) — a single strain's full picture and its available next
// actions. Reuses the wizard step components so a returning breeder can pair DNA, pull
// the evidence package, or prove ownership on an existing record.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Link, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import CodeIcon from '@mui/icons-material/DataObjectOutlined';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import ShareIcon from '@mui/icons-material/ShareOutlined';
import { useRecords, getRecord, exportEnvelope } from '../veilcore/records';
import { useLicenses, licensesForRecord, activeLicenseCount, agreementType } from '../veilcore/licenses';
import { shortFingerprint } from '../veilcore/commitment';
import { StatusChain } from './StatusChain';
import { LineageGraph } from './LineageGraph';
import { HeritableRights } from './HeritableRights';
import { NextStep } from './NextStep';
import { SettlementStatus } from './SettlementStatus';
import { AttestationPanel } from './AttestationPanel';
import { RecordHistory } from './RecordHistory';
import { SendToLab } from './SendToLab';
import { CorrectRecord } from './CorrectRecord';
import { LicenseStateChip } from './licensing/LicenseStateChip';
import { AgreementTypeChip } from './licensing/AgreementTypeChip';
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
          <Button component={RouterLink} to="/records" startIcon={<ArrowBackIcon />}>
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

      <Button component={RouterLink} to="/records" size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
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
          {/* A superseded record must say so. Someone opening it years later needs to
              know a correction exists, and a correcting record needs to point back. */}
          {record.supersededBy && (
            <Alert severity="info" variant="outlined">
              This record was corrected. It remains on file unchanged — nothing is ever deleted —
              but a later record supersedes it.{' '}
              <Link component={RouterLink} to={`/record/${record.supersededBy}`}>
                See the correction
              </Link>
            </Alert>
          )}

          {record.supersedes && (
            <Alert severity="info" variant="outlined">
              This corrects an earlier record. Changed:{' '}
              {record.supersedes.changedFields.join(', ')}. Reason given: {record.supersedes.reason}.{' '}
              <Link component={RouterLink} to={`/record/${record.supersedes.recordId}`}>
                See what it replaced
              </Link>
            </Alert>
          )}

          <NextStep
            record={record}
            onPairDna={() => setMode('pair')}
            onAgreement={() => navigate(`/record/${record.id}/license?type=license`)}
          />

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
            <AttestationPanel record={record} />
          </Paper>

          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <SettlementStatus record={record} />
          </Paper>

          {/* Every other panel answers "what is true now". A dispute asks "what happened,
              and in what order" — a different question the app could not answer. */}
          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <RecordHistory record={record} />
          </Paper>

          {/* Only rendered when there is lineage. An empty panel saying "no lineage
              recorded" is a row the reader has to process to learn nothing. */}
          {(record.parents?.length ?? 0) > 0 && (
            <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
              <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
                Lineage · {record.parents?.length} parent{record.parents?.length === 1 ? '' : 's'}
              </Typography>
              <LineageGraph record={record} />
            </Paper>
          )}

          {/* Only when an agreement exists that could carry an obligation. Otherwise
              this is a panel explaining a feature nobody has used yet. */}
          {licenses.length > 0 && (
            <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
              <HeritableRights record={record} />
            </Paper>
          )}

          {licenses.length > 0 && (
            <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
              <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
                Agreements
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
                      gap: 1,
                      p: 1,
                      borderRadius: 1,
                      '&:hover': { background: 'rgba(255,255,255,0.03)' },
                    }}
                  >
                    <Typography variant="body2" sx={{ minWidth: 0 }} noWrap>
                      {l.terms.licensee || 'unnamed counterparty'} · {l.id}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <AgreementTypeChip type={agreementType(l)} />
                      <LicenseStateChip license={l} />
                    </Stack>
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
              Prove prior possession
            </Button>
            <SendToLab record={record} />
            {/* A holder who mistypes something needs a path that is not deletion. */}
            <CorrectRecord record={record} />
            {/* The wire format. Any implementation can read this and recompute the
                commitment without our code, our chain, or our permission. */}
            <Button variant="text" startIcon={<CodeIcon />} onClick={() => exportEnvelope(record.id)}>
              Export record
            </Button>
          </Stack>

          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Start an agreement — terms bound to the genetics
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                startIcon={<GavelIcon />}
                onClick={() => navigate(`/record/${record.id}/license?type=license`)}
              >
                License
              </Button>
              <Button
                variant="outlined"
                startIcon={<ScienceIcon />}
                onClick={() => navigate(`/record/${record.id}/license?type=lab-transfer`)}
              >
                Send to a lab
              </Button>
              <Button
                variant="outlined"
                startIcon={<ShareIcon />}
                onClick={() => navigate(`/record/${record.id}/license?type=breeder-share`)}
              >
                Share with a breeder
              </Button>
            </Stack>
          </Box>
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
