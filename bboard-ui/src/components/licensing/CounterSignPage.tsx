// CounterSignPage (/license/:id/sign) — meant as the licensee's view. It is not one yet:
// the agreement is read from this browser's own registry set, so the page only opens for
// the issuer, and the issuer is the only one who can press "sign" (attack round D). It
// says so, records which holder key pressed it, and never says "both parties have
// signed" unless two different keys did. Counter-signing by the other party needs the
// registry to serve the agreement to them and take their key's signature; not built.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Container, Divider, Paper, Stack, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import {
  useLicenses,
  getLicense,
  countersignLicense,
  signedByTwoParties,
  isIssuer,
  startLicenseSync,
  effectiveState,
  agreementType,
  agreementRows,
  AGREEMENT_LABEL,
} from '../../veilcore/licenses';
import { TEAL } from '../../config/theme';
import { startRecordSync } from '../../veilcore/records';

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
  useEffect(() => {
    startLicenseSync();
    startRecordSync();
  }, []);
  const { id = '' } = useParams();
  const license = getLicense(id);
  const [issuerHere, setIssuerHere] = useState<boolean | null>(null);
  useEffect(() => {
    if (license) void isIssuer(license).then(setIssuerHere);
  }, [license]);

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
            <Typography sx={{ mb: 1 }}>No agreement found for this link in this browser.</Typography>
            <Typography variant="body2" color="text.secondary">
              Agreements can be opened only from the browser that holds them for now. Counter-signing from the other
              party&apos;s own browser is not built yet.
            </Typography>
          </Paper>
        ) : (
          <Paper sx={{ p: { xs: 3, md: 4 } }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="h5">You&apos;ve been sent an agreement to review</Typography>
              <Chip size="small" variant="outlined" label={AGREEMENT_LABEL[agreementType(license)]} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Read the terms below. It becomes active in this demo when you counter-sign.
            </Typography>

            <Stack spacing={1}>
              {agreementRows(license).map((r) => (
                <Line key={r.k} k={r.k} v={r.v} />
              ))}
            </Stack>

            {agreementType(license) === 'breeder-share' && license.terms.mayBreed && (
              <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                You may breed with this material. A cultivar logged with it as a parent links back to this agreement in
                the lineage graph. Offspring nobody logs are not detected.
              </Alert>
            )}

            <Divider sx={{ my: 2.5 }} />

            {effectiveState(license) === 'sent' && (
              <Stack spacing={1.5}>
                {issuerHere !== false && (
                  <Alert severity="warning" variant="outlined">
                    This browser holds the key that issued this agreement, so pressing the button below records that the
                    issuer marked it active — not that the other party agreed. They cannot open or sign it from their
                    own browser yet.
                  </Alert>
                )}
                <Typography variant="body2" color="text.secondary">
                  This records a time and the holder key that pressed it in VeilCore&apos;s registry. It is not a
                  cryptographic signature and not a qualified (eIDAS) electronic signature.
                </Typography>
                <Button variant="contained" size="large" onClick={() => void countersignLicense(license.id)}>
                  {issuerHere === false ? 'Review complete — sign & accept' : 'Mark active as the issuer (demo)'}
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
                <Alert severity={signedByTwoParties(license) ? 'success' : 'info'} variant="outlined">
                  {signedByTwoParties(license)
                    ? 'Active: issued and counter-signed from two different holder keys (not cryptographic signatures).'
                    : 'Marked active by the issuer. The other party has not signed anything in VeilCore.'}{' '}
                  The terms are attached to the record. What they are worth in a dispute is for the parties and, if it
                  comes to it, a court.
                </Alert>
                {/* This button used to set a boolean and render "license proven". No
                    circuit ran, nothing was checked, and the word next to it was
                    zero-knowledge — a button that prints a success message is the
                    simulate button this project removed once already. It now says what
                    it is. Wiring it to proveLicense means a wallet, a proof server and
                    a deployed contract, which the web app does not have. */}
                <Alert severity="info" variant="outlined">
                  Proving a licence without revealing its terms runs the proveLicense circuit, which needs a wallet and
                  a proof server. The CLI in <code>bboard-cli</code> does it against the deployed contract. This page
                  cannot, and will not pretend to.
                </Alert>
              </Stack>
            )}

            {effectiveState(license) === 'expired' && (
              <Alert severity="info" variant="outlined">
                This license has expired ({license.terms.endDate}).
              </Alert>
            )}
            {effectiveState(license) === 'revoked' && (
              <Alert severity="error" variant="outlined">
                This license was revoked — {license.revokedReason}.
              </Alert>
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
