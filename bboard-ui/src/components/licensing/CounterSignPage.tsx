// CounterSignPage (/license/:id/sign) — the licensee's view. They review the full terms
// and counter-sign; only then does the license become Active. Also lets a licensee prove
// they hold valid rights without exposing the terms or genetics (prove-a-license).
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Container, Divider, Paper, Stack, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import {
  useLicenses,
  getLicense,
  countersignLicense,
  effectiveState,
  agreementType,
  agreementRows,
  AGREEMENT_LABEL,
} from '../../veilcore/licenses';
import { TEAL } from '../../config/theme';

const Line: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
    <Typography variant="body2" color="text.secondary">
      {k}
    </Typography>
    <Typography variant="body2" sx={{ textAlign: 'right' }}>
      {v}
    </Typography>
  </Stack>
);

export const CounterSignPage: React.FC = () => {
  useLicenses();
  const { id = '' } = useParams();
  const license = getLicense(id);
  const [proven, setProven] = useState(false);

  return (
    <Box sx={{ minHeight: '100vh', background: '#04070a' }}>
      <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', justifyContent: 'center', mb: 4 }}>
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', background: TEAL, boxShadow: `0 0 14px ${TEAL}` }} />
          <Typography variant="h6" sx={{ letterSpacing: '0.3em', fontWeight: 600 }}>
            VEILCORE
          </Typography>
        </Stack>

        {!license ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography>No license found for this link.</Typography>
          </Paper>
        ) : (
          <Paper sx={{ p: { xs: 3, md: 4 } }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="h5">You&apos;ve been sent an agreement to review</Typography>
              <Chip size="small" variant="outlined" label={AGREEMENT_LABEL[agreementType(license)]} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Read the terms below. It only becomes binding when you counter-sign.
            </Typography>

            <Stack spacing={1}>
              {agreementRows(license).map((r) => (
                <Line key={r.k} k={r.k} v={r.v} />
              ))}
            </Stack>

            {agreementType(license) === 'breeder-share' && license.terms.mayBreed && (
              <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                You may breed with this cut — but any cultivar you log with it as a parent stays traceable through the
                lineage graph, linking the offspring back to this agreement.
              </Alert>
            )}

            <Divider sx={{ my: 2.5 }} />

            {effectiveState(license) === 'sent' && (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  Signing here is a cryptographic signature binding you to this record. (It is not a qualified/eIDAS
                  electronic signature.)
                </Typography>
                <Button variant="contained" size="large" onClick={() => countersignLicense(license.id)}>
                  Review complete — sign &amp; accept
                </Button>
              </Stack>
            )}

            {effectiveState(license) === 'draft' && (
              <Alert severity="info" variant="outlined">
                This license hasn&apos;t been issued yet — ask the breeder to issue it.
              </Alert>
            )}

            {effectiveState(license) === 'active' && (
              <Stack spacing={1.5}>
                <Alert severity="success" variant="outlined">
                  Active — both parties have signed. These rights are now enforceable and bound to the genetics.
                </Alert>
                {proven ? (
                  <Alert icon={<VerifiedIcon />} severity="success" variant="outlined">
                    ✓ Valid, active license proven — without revealing the terms, the counterparty, or the genetics.
                  </Alert>
                ) : (
                  <Box>
                    <Button variant="outlined" startIcon={<VerifiedIcon />} onClick={() => setProven(true)}>
                      Prove my license
                    </Button>
                    <Chip size="small" variant="outlined" label="zero-knowledge" sx={{ ml: 1 }} />
                  </Box>
                )}
              </Stack>
            )}

            {effectiveState(license) === 'expired' && (
              <Alert severity="info" variant="outlined">This license has expired ({license.terms.endDate}).</Alert>
            )}
            {effectiveState(license) === 'revoked' && (
              <Alert severity="error" variant="outlined">This license was revoked — {license.revokedReason}.</Alert>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>
              Demo — signing and settlement are simulated locally.
            </Typography>
          </Paper>
        )}
      </Container>
    </Box>
  );
};
