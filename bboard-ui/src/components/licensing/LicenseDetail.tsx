// LicenseDetail (/license/:id) — the breeder's view of a license instrument: terms,
// lifecycle actions (issue → shareable counter-sign link → active, revoke, renew), and
// the royalty obligation log (records only — VeilCore never moves money).
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
  agreementType,
  agreementRows,
  AGREEMENT_LABEL,
  VEILCORE_FEE_PCT,
  SHOW_VEILCORE_FEE,
  FEE_NOTE,
  veilcoreFee,
  dealValueOf,
  signedByTwoParties,
  type License,
} from '../../veilcore/licenses';
import { canonicalUrl } from '../../config/network';
import { getRecord, childrenOf } from '../../veilcore/records';
import { shortFingerprint } from '../../veilcore/commitment';
import { AppHeader } from '../AppHeader';
import { LicenseStateChip } from './LicenseStateChip';
import { ShareLicense } from './ShareLicense';
import { AgreementTypeChip } from './AgreementTypeChip';
import { AGREEMENTS_SIMULATED, SIMULATED_TAG } from '../../config/copy';

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const TermsSummary: React.FC<{ l: License }> = ({ l }) => (
  <Stack spacing={1}>
    {agreementRows(l).map((r) => (
      <Row key={r.k} k={r.k} v={r.v} />
    ))}
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
          <Typography sx={{ mb: 1 }}>This agreement isn&apos;t in this browser.</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Agreements open only in the browser that made them, or one where you restored the same holder key.
          </Typography>
          <Button component={RouterLink} to="/licenses" startIcon={<ArrowBackIcon />}>
            Your agreements
          </Button>
        </Paper>
      </Box>
    );
  }

  const state = effectiveState(license);
  const type = agreementType(license);
  const record = getRecord(license.recordId);
  const signLink = canonicalUrl(`/license/${encodeURIComponent(license.id)}/sign`);
  // Breeder-share lineage: if the counterparty may breed with the material, any cultivar
  // they later log with this one as a parent is exposed through the lineage graph.
  const showLineageNote = type === 'breeder-share' && license.terms.mayBreed;
  const knownDerivatives = showLineageNote ? childrenOf(license.recordId).length : 0;

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
    setToast('Royalty owed recorded.');
  };

  const totalOwed = license.royaltyLog.reduce((s, e) => s + e.amountOwed, 0);
  const totalDeal = license.royaltyLog.reduce((s, e) => s + dealValueOf(license, e.input), 0);
  const totalFee = veilcoreFee(totalDeal);
  const royaltyInputLabel =
    license.terms.royaltyType === 'percent' ? 'Reported sales ($)' : `Units (${license.terms.unitBasis})`;

  return (
    <Box>
      <AppHeader />
      <Button component={RouterLink} to="/licenses" size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        All agreements
      </Button>

      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4">
              {AGREEMENT_LABEL[type]} · {record?.strainName ?? license.recordId}
            </Typography>
            <AgreementTypeChip type={type} />
          </Stack>
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
            These terms are attached to the sealed record and its paired report fingerprint
            {license.dnaFingerprint ? ` (${shortFingerprint(license.dnaFingerprint)})` : ''}.
          </Alert>
          {showLineageNote && (
            <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>
              If a cultivar is later logged with {record?.strainName ?? 'this cultivar'} as a parent, and both holders
              confirm it, the link to this agreement shows on its record. Offspring nobody logs are not detected.
              {knownDerivatives > 0
                ? ` ${knownDerivatives} cultivar${knownDerivatives === 1 ? '' : 's'} already logged descend${knownDerivatives === 1 ? 's' : ''} from it.`
                : ''}
            </Alert>
          )}
        </Paper>

        {/* lifecycle actions */}
        <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
          <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
            Status and actions
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.75 }}>
            {AGREEMENTS_SIMULATED}
          </Typography>

          {state === 'draft' && (
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2" color="text.secondary">
                Draft, not issued yet. Issuing it makes a link you send to the other party to counter-sign.
              </Typography>
              <Button
                variant="contained"
                onClick={() =>
                  void issueLicense(license.id).then(() => setToast('Issued. Send the link to the other party.'))
                }
              >
                Issue it
              </Button>
            </Stack>
          )}

          {state === 'sent' && (
            <Stack spacing={1.5}>
              <Alert severity="warning" variant="outlined">
                Issued, waiting for the other party to counter-sign: it is <b>not active yet</b>. For now the
                counter-sign link opens only in your own browser; they can&apos;t sign from theirs yet.
              </Alert>
              <TextField
                label="Counter-sign link (for the other party)"
                value={signLink}
                fullWidth
                size="small"
                slotProps={{ input: { readOnly: true } }}
              />
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => copy(signLink, 'Link copied.')}
                >
                  Copy link
                </Button>
                <Button component={RouterLink} to={`/license/${encodeURIComponent(license.id)}/sign`} variant="text">
                  Open the counter-sign page {SIMULATED_TAG}
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
                {signedByTwoParties(license)
                  ? 'Active: issued and counter-signed from two different holder keys. Effective '
                  : 'Marked active from the issuer’s own browser; the other party has not signed anything in VeilCore. Effective '}
                {new Date(license.licenseeSignedAt ?? license.createdAt).toLocaleDateString()}.
              </Alert>
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
                <ShareLicense license={license} />
                <Button
                  variant="outlined"
                  onClick={() => navigate(`/record/${license.recordId}/license?supersede=${license.id}`)}
                >
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
              <Alert severity="info" variant="outlined">
                Expired on {license.terms.endDate}.
              </Alert>
              <Button
                variant="outlined"
                onClick={() => navigate(`/record/${license.recordId}/license?supersede=${license.id}`)}
              >
                Renew
              </Button>
            </Stack>
          )}

          {state === 'revoked' && (
            <Alert severity="error" variant="outlined">
              Revoked{license.revokedAt ? ` ${new Date(license.revokedAt).toLocaleDateString()}` : ''}:{' '}
              {license.revokedReason}
            </Alert>
          )}
        </Paper>

        {/* royalty ledger — license agreements only; its per-sale/unit mechanics don't apply to
            lab transfers or breeder shares (a breeder share's offspring-royalty fee shows in the
            terms summary above, not as a sales ledger). */}
        {type === 'license' && (state === 'active' || license.royaltyLog.length > 0) && (
          <Paper sx={{ p: { xs: 2.5, md: 3 } }}>
            <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
              Royalty obligations
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              VeilCore records what is owed. It doesn&apos;t process payments: no money moves here.
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
              <Stack spacing={1.25}>
                {license.royaltyLog.map((e, i) => {
                  const dv = dealValueOf(license, e.input);
                  return (
                    <Box key={i} sx={{ p: 1, borderRadius: 1, background: 'rgba(255,255,255,0.02)' }}>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(e.at).toLocaleDateString()}
                        {e.note ? ` · ${e.note}` : ''}
                      </Typography>
                      <Row k="Deal value" v={money(dv)} />
                      <Row k="Your royalty" v={money(e.amountOwed)} />
                      {SHOW_VEILCORE_FEE && (
                        <Row k={`VeilCore fee (${VEILCORE_FEE_PCT}%)`} v={money(veilcoreFee(dv))} />
                      )}
                    </Box>
                  );
                })}
                <Divider />
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="subtitle2">Total deal value</Typography>
                  <Typography variant="subtitle2">{money(totalDeal)}</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">
                    Your royalty (recorded)
                  </Typography>
                  <Typography variant="body2">{money(totalOwed)}</Typography>
                </Stack>
                {SHOW_VEILCORE_FEE && (
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      VeilCore fee ({VEILCORE_FEE_PCT}%)
                    </Typography>
                    <Typography variant="body2">{money(totalFee)}</Typography>
                  </Stack>
                )}
                {SHOW_VEILCORE_FEE && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    {FEE_NOTE}
                  </Typography>
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Nothing recorded yet. Enter sales or units above as the licensee reports them.
                {SHOW_VEILCORE_FEE ? ` ${FEE_NOTE}` : ''}
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
