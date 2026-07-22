// LicenseDetail (/license/:id) — the breeder's view of a license instrument: terms,
// lifecycle actions (issue → shareable counter-sign link → active, revoke, renew), and
// the royalty obligation log (records only — Veilcore never moves money).
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Divider, Paper, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import {
  useLicenses,
  getLicense,
  issueLicense,
  revokeLicense,
  addRoyalty,
  effectiveState,
  RIGHTS_LABEL,
  type License,
} from '../../veilcore/licenses';
import { getRecord } from '../../veilcore/records';
import { shortFingerprint } from '../../veilcore/commitment';
import { AppHeader } from '../AppHeader';
import { LicenseStateChip } from './LicenseStateChip';

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const TermsSummary: React.FC<{ l: License }> = ({ l }) => (
  <Stack spacing={1}>
    <Row k="Licensee" v={l.terms.licensee} />
    <Row k="Rights" v={RIGHTS_LABEL[l.terms.rights]} />
    <Row k="Territory" v={l.terms.territory || '—'} />
    <Row k="Term" v={`${l.terms.startDate} → ${l.terms.endDate}`} />
    <Row
      k="Royalty"
      v={
        l.terms.royaltyType === 'percent'
          ? `${l.terms.royaltyAmount}% ${l.terms.unitBasis}`
          : `${money(Number(l.terms.royaltyAmount) || 0)} ${l.terms.unitBasis}`
      }
    />
    <Row k="Exclusivity" v={l.terms.exclusive ? 'Exclusive' : 'Non-exclusive'} />
    <Row k="Sublicensing" v={l.terms.sublicensable ? 'Allowed' : 'Not allowed'} />
    {l.terms.extraTerms && <Row k="Additional terms" v={l.terms.extraTerms} />}
  </Stack>
);

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

export const LicenseDetail: React.FC = () => {
  useLicenses();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const license = getLicense(id);
  const [toast, setToast] = useState<string>();
  const [royaltyInput, setRoyaltyInput] = useState('');
  const [royaltyNote, setRoyaltyNote] = useState('');

  if (!license) {
    return (
      <Box>
        <AppHeader />
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ mb: 1 }}>License not found.</Typography>
          <Button component={RouterLink} to="/licenses" startIcon={<ArrowBackIcon />}>
            Licensing hub
          </Button>
        </Paper>
      </Box>
    );
  }

  const state = effectiveState(license);
  const record = getRecord(license.recordId);
  const signLink = `${window.location.origin}/license/${license.id}/sign`;

  const copy = async (text: string, msg: string) => {
    await navigator.clipboard.writeText(text);
    setToast(msg);
  };

  const onRevoke = () => {
    const reason = window.prompt('Reason for revoking this license?');
    if (reason !== null) {
      revokeLicense(license.id, reason || 'No reason given');
      setToast('License revoked.');
    }
  };

  const owed = (n: number) =>
    license.terms.royaltyType === 'percent'
      ? n * ((Number(license.terms.royaltyAmount) || 0) / 100)
      : n * (Number(license.terms.royaltyAmount) || 0);

  const onLogRoyalty = () => {
    const n = Number(royaltyInput);
    if (!n) return;
    addRoyalty(license.id, n, owed(n), royaltyNote.trim());
    setRoyaltyInput('');
    setRoyaltyNote('');
    setToast('Royalty obligation recorded.');
  };

  const totalOwed = license.royaltyLog.reduce((s, e) => s + e.amountOwed, 0);
  const royaltyInputLabel =
    license.terms.royaltyType === 'percent' ? 'Reported sales ($)' : `Units (${license.terms.unitBasis})`;

  return (
    <Box>
      <AppHeader />
      <Button component={RouterLink} to="/licenses" size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Licensing hub
      </Button>

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Box>
          <Typography variant="h4">
            License · {record?.strainName ?? license.recordId}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {license.id} {license.supersedesId ? `· amends ${license.supersedesId}` : ''}
          </Typography>
        </Box>
        <LicenseStateChip license={license} size="medium" />
      </Stack>

      <Stack spacing={2.5}>
        <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
          <Typography variant="overline" sx={{ display: 'block', mb: 1.5 }}>
            Agreement terms
          </Typography>
          <TermsSummary l={license} />
          <Divider sx={{ my: 2 }} />
          <Alert severity="info" variant="outlined">
            These terms travel with the genetics — bound to {record?.strainName ?? 'the strain'} and its DNA fingerprint
            {license.dnaFingerprint ? ` (${shortFingerprint(license.dnaFingerprint)})` : ''}. Anyone who tests this plant
            can trace it back to this agreement — including someone who never signed it.
          </Alert>
        </Paper>

        {/* lifecycle actions */}
        <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
          <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
            Status &amp; actions
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.75 }}>
            Demo — signatures and settlement are simulated locally; nothing is recorded on a live network yet.
          </Typography>

          {state === 'draft' && (
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2" color="text.secondary">
                Draft — not yet issued. Signing produces a link you send to the licensee to counter-sign.
              </Typography>
              <Button variant="contained" onClick={() => (issueLicense(license.id), setToast('Issued — send the link to your licensee.'))}>
                Issue &amp; sign
              </Button>
            </Stack>
          )}

          {state === 'sent' && (
            <Stack spacing={1.5}>
              <Alert severity="warning" variant="outlined">
                You&apos;ve signed. Awaiting the licensee&apos;s counter-signature — the license is <b>not active yet</b>.
              </Alert>
              <TextField
                label="Counter-sign link (send to licensee)"
                value={signLink}
                fullWidth
                size="small"
                slotProps={{ input: { readOnly: true } }}
              />
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
                <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copy(signLink, 'Link copied.')}>
                  Copy link
                </Button>
                <Button component={RouterLink} to={`/license/${license.id}/sign`} variant="text">
                  Open counter-sign page (demo)
                </Button>
                <Button color="error" variant="text" onClick={onRevoke}>
                  Revoke
                </Button>
              </Stack>
            </Stack>
          )}

          {state === 'active' && (
            <Stack spacing={1.5}>
              <Alert severity="success" variant="outlined">
                Active — both parties signed. Effective {new Date(license.licenseeSignedAt ?? license.createdAt).toLocaleDateString()}.
              </Alert>
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
                <Button variant="outlined" onClick={() => navigate(`/record/${license.recordId}/license?supersede=${license.id}`)}>
                  Renew / amend
                </Button>
                <Button color="error" variant="text" onClick={onRevoke}>
                  Revoke
                </Button>
              </Stack>
            </Stack>
          )}

          {state === 'expired' && (
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Alert severity="info" variant="outlined">Expired on {license.terms.endDate}.</Alert>
              <Button variant="outlined" onClick={() => navigate(`/record/${license.recordId}/license?supersede=${license.id}`)}>
                Renew
              </Button>
            </Stack>
          )}

          {state === 'revoked' && (
            <Alert severity="error" variant="outlined">
              Revoked {license.revokedAt ? new Date(license.revokedAt).toLocaleDateString() : ''} — {license.revokedReason}
            </Alert>
          )}
        </Paper>

        {/* royalty ledger */}
        {(state === 'active' || license.royaltyLog.length > 0) && (
          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
              Royalty obligations
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Veilcore records and proves obligations. It does not process payments — no money moves here.
            </Typography>
            {state === 'active' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                <TextField
                  label={royaltyInputLabel}
                  value={royaltyInput}
                  onChange={(e) => setRoyaltyInput(e.target.value)}
                  size="small"
                  sx={{ maxWidth: 200 }}
                />
                <TextField
                  label="Note (optional)"
                  value={royaltyNote}
                  onChange={(e) => setRoyaltyNote(e.target.value)}
                  size="small"
                  fullWidth
                />
                <Button variant="outlined" onClick={onLogRoyalty}>
                  Record
                </Button>
              </Stack>
            )}
            {license.royaltyLog.length > 0 ? (
              <Stack spacing={1}>
                {license.royaltyLog.map((e, i) => (
                  <Stack key={i} direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(e.at).toLocaleDateString()} · {e.input} {license.terms.royaltyType === 'percent' ? 'in sales' : 'units'}
                      {e.note ? ` · ${e.note}` : ''}
                    </Typography>
                    <Typography variant="body2">{money(e.amountOwed)}</Typography>
                  </Stack>
                ))}
                <Divider />
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="subtitle2">Total owed (recorded)</Typography>
                  <Typography variant="subtitle2">{money(totalOwed)}</Typography>
                </Stack>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No obligations recorded yet.
              </Typography>
            )}
          </Paper>
        )}
      </Stack>

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(undefined)}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};
