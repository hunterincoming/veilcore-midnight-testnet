// VerifyPage (/verify/:id) — public, shareable proof anyone can open to confirm a
// record exists and is intact, WITHOUT seeing any genetics.
//
// The server decides what this page receives. Facts the holder did not disclose are
// never transmitted, so they cannot be recovered from the client. This page works for
// a visitor who has never loaded the app — a QR scan from a printed certificate.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Box, Chip, CircularProgress, Container, Divider, Paper, Stack, Typography } from '@mui/material';
import { useParams, useSearchParams } from 'react-router-dom';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import { shortFingerprint } from '../veilcore/commitment';
import { GENETICS_LABEL } from '../veilcore/disclosure';
import { TEAL } from '../config/theme';

const API = import.meta.env.VITE_API_BASE ?? '';
const fmt = (ms: number) => new Date(ms).toLocaleString();

type VerifyResult = {
  found: boolean;
  id?: string;
  cultivar?: string;
  recordFingerprint?: string;
  dnaPaired?: boolean;
  attested?: boolean;
  activeLicenses?: number;
  disclosed?: string[];
  priorPossession?: boolean;
  sealedAt?: number;
  /** null when the endpoint did not check descent — not the same as false. */
  lineageIntact?: boolean | null;
  lineageNote?: string;
  /** Keys the caller asked for that the server declines to answer. */
  unavailable?: string[];
  unavailableReason?: string;
  parents?: string[];
  breedingMethod?: string | null;
  otherRecordCount?: number;
  otherAgreements?: { id: string; status: string; type: string }[];
};

/**
 * The fields this page reads. Anything absent renders as not disclosed, which is
 * the same as the holder choosing not to show it, so only `found` has to be there.
 */
const isVerifyResult = (v: unknown): v is VerifyResult => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.found !== 'boolean') return false;
  const str = (x: unknown) => x === undefined || x === null || typeof x === 'string';
  const num = (x: unknown) => x === undefined || typeof x === 'number';
  const bool = (x: unknown) => x === undefined || typeof x === 'boolean';
  return (
    str(r.id) &&
    str(r.cultivar) &&
    str(r.recordFingerprint) &&
    str(r.breedingMethod) &&
    bool(r.dnaPaired) &&
    bool(r.attested) &&
    bool(r.priorPossession) &&
    // null is a valid answer here and means "not checked". Requiring a boolean made
    // the guard reject a well-formed response, and the page then reported no record
    // for a record that exists.
    (r.lineageIntact === null || bool(r.lineageIntact)) &&
    num(r.activeLicenses) &&
    num(r.sealedAt) &&
    num(r.otherRecordCount) &&
    (r.disclosed === undefined || Array.isArray(r.disclosed)) &&
    (r.parents === undefined || Array.isArray(r.parents)) &&
    (r.otherAgreements === undefined || Array.isArray(r.otherAgreements)) &&
    (r.unavailable === undefined || Array.isArray(r.unavailable)) &&
    str(r.lineageNote) &&
    str(r.unavailableReason)
  );
};

const Fact: React.FC<{ ok?: boolean; children: React.ReactNode }> = ({ ok = true, children }) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
    {ok ? (
      <CheckCircleIcon sx={{ fontSize: 18, color: TEAL, mt: '2px' }} />
    ) : (
      <CancelIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '2px' }} />
    )}
    <Typography variant="body2" sx={{ color: ok ? 'text.primary' : 'text.secondary' }}>
      {children}
    </Typography>
  </Stack>
);

export const VerifyPage: React.FC = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const show = params.get('show');
  const recipient = params.get('to')?.trim();

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const url = `${API}/verify/${encodeURIComponent(id)}${show !== null ? `?show=${encodeURIComponent(show)}` : ''}`;
    fetch(url)
      .then((r): Promise<unknown> => r.json())
      .then((data) => {
        if (!cancelled) {
          // A shareable link is opened by someone who has no other way to check what
          // they are being shown. A body that is not a verdict is treated as no
          // record rather than rendered with blank fields, because a page that looks
          // like a verification and is not one is worse than an error.
          setResult(isVerifyResult(data) ? data : null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ found: false });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, show]);

  const disclosed = new Set(result?.disclosed ?? []);
  const isSelective = result?.disclosed !== undefined;

  return (
    <Box sx={{ minHeight: '100vh', background: '#04070a' }}>
      <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', justifyContent: 'center', mb: 4 }}>
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', background: TEAL, boxShadow: `0 0 14px ${TEAL}` }} />
          <Typography variant="h6" sx={{ letterSpacing: '0.3em', fontWeight: 600 }}>
            VEILCORE
          </Typography>
        </Stack>

        {loading ? (
          <Paper sx={{ p: 6, textAlign: 'center' }}>
            <CircularProgress size={28} sx={{ color: TEAL }} />
          </Paper>
        ) : !result?.found ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              No record found for {id || 'this ID'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This verification link doesn&apos;t match any record in the registry. Check the link is complete and
              unmodified.
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
                <Typography variant="h5">{result.cultivar}</Typography>
              </Box>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {recipient ? `Prepared for ${recipient} · ` : ''}
              {result.id}
            </Typography>

            <Divider sx={{ mb: 2 }} />

            <Stack spacing={1.25}>
              <Fact>Record exists and its fingerprint is intact — unaltered since it was sealed.</Fact>

              {isSelective ? (
                <>
                  {disclosed.has('own') && <Fact>Prior possession proven — sealed to this breeder.</Fact>}
                  {disclosed.has('dna') && (
                    <Fact ok={!!result.dnaPaired}>
                      {result.dnaPaired
                        ? 'DNA-verified — bound to the paired lab report.'
                        : 'DNA report not yet paired.'}
                    </Fact>
                  )}
                  {disclosed.has('lineage') &&
                    (result.lineageIntact === true ? (
                      <Fact>Lineage intact — unbroken chain back to the sealed record.</Fact>
                    ) : (
                      // Printed on the request rather than the answer until now, so the
                      // page asserted an unbroken chain whatever the server reported.
                      <Fact ok={false}>{result.lineageNote ?? 'Lineage was not checked for this record.'}</Fact>
                    ))}
                  {disclosed.has('sealed') && result.sealedAt && <Fact>Sealed {fmt(result.sealedAt)}.</Fact>}
                  {disclosed.has('parents') && (
                    <Fact ok={(result.parents?.length ?? 0) > 0}>
                      {result.parents?.length ? `Parents: ${result.parents.join(' × ')}` : 'No parents recorded.'}
                    </Fact>
                  )}
                  {disclosed.has('method') && result.breedingMethod && (
                    <Fact>Breeding method: {result.breedingMethod}</Fact>
                  )}
                  {/* These two disclosed facts about the HOLDER rather than this record —
                      how many other cultivars they hold, and the status of agreements on
                      records the reader was never shown. The server no longer answers
                      them, and `?? 0` would print "0 other cultivars" as though an
                      absent answer were a finding. */}
                  {disclosed.has('others') &&
                    (result.otherRecordCount === undefined ? (
                      <Fact ok={false}>Not disclosed: what else this breeder holds.</Fact>
                    ) : (
                      <Fact>{result.otherRecordCount} other cultivars held by this breeder.</Fact>
                    ))}
                  {disclosed.has('agreementTerms') &&
                    (result.otherAgreements === undefined ? (
                      <Fact ok={false}>Not disclosed: this breeder&apos;s other agreements.</Fact>
                    ) : (
                      <Fact>{result.otherAgreements.length} other agreements on record.</Fact>
                    ))}
                </>
              ) : (
                <>
                  <Fact ok={!!result.dnaPaired}>DNA report {result.dnaPaired ? 'paired' : 'not yet paired'}</Fact>
                  <Fact ok={!!result.attested}>{result.attested ? 'Lab attested' : 'No lab attestation yet'}</Fact>
                  <Fact ok={(result.activeLicenses ?? 0) > 0}>
                    {(result.activeLicenses ?? 0) > 0
                      ? `${result.activeLicenses} active license${result.activeLicenses === 1 ? '' : 's'} on record`
                      : 'No active license'}
                  </Fact>
                </>
              )}

              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', pt: 0.5 }}>
                <LockIcon sx={{ fontSize: 18, color: 'text.secondary', mt: '2px' }} />
                <Typography variant="body2" color="text.secondary">
                  {GENETICS_LABEL}
                </Typography>
              </Stack>
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary">
              Fingerprint {shortFingerprint(result.recordFingerprint ?? '')}
              {isSelective ? ' · only the facts above were transmitted' : ' · no genetics disclosed'}
            </Typography>

            <Box sx={{ mt: 2, textAlign: 'right' }}>
              <Chip size="small" variant="outlined" label="Verified against the registry" />
            </Box>
          </Paper>
        )}
      </Container>
    </Box>
  );
};
