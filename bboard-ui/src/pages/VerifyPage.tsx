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
import { NETWORK, isTestNetwork, networkLabel } from '../config/network';
import { REAL_CHAIN } from '../veilcore/chain/config';
import { VerifierChallengePanel } from '../components/chain/VerifierChallengePanel';

const API = import.meta.env.VITE_API_BASE ?? '';
const fmt = (t: number | string) => new Date(t).toLocaleString();

/** "Anchored on Midnight preprod (test network)", from the anchor's own network. */
const anchoredOn = (r: { anchor?: { network?: string } | null }): string => {
  const n = typeof r.anchor?.network === 'string' ? r.anchor.network : NETWORK;
  return `Anchored on ${networkLabel(n)}`;
};
const anchorIsTest = (r: { anchor?: { network?: string } | null }): boolean =>
  isTestNetwork(typeof r.anchor?.network === 'string' ? r.anchor.network : NETWORK);

type VerifyResult = {
  found: boolean;
  id?: string;
  cultivar?: string;
  recordFingerprint?: string;
  /** The holder paired a DNA report fingerprint themselves. Not a lab's confirmation. */
  dnaPairedByHolder?: boolean;
  /**
   * Older field. From a current registry it means attestedByVettedLab; from an older one
   * it meant any valid signature, so it is never read as "a lab" on its own.
   */
  attested?: boolean;
  /** A valid, unretracted signed attestation exists. Says nothing about who signed. */
  signedAttestation?: boolean;
  /** One of them is from a key the registry operator has checked. */
  attestedByVettedLab?: boolean;
  /** The record's fingerprint is in a batch whose root is anchored on a ledger. */
  anchored?: boolean;
  /** Where the batch root was anchored, when it was. The network says whether it is a test one. */
  anchor?: { network?: string; txHash?: string } | null;
  /** The holder's own statement of when it was logged. The app stores it as epoch ms. */
  loggedAtClaimedByHolder?: string | number | null;
  /** When the registry first received the record. The registry's word, not a ledger's. */
  registryFirstSeen?: string | null;
  disclosed?: string[];
  priorPossession?: boolean;
  sealedAt?: number | string;
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
    bool(r.dnaPairedByHolder) &&
    bool(r.attested) &&
    bool(r.signedAttestation) &&
    bool(r.attestedByVettedLab) &&
    bool(r.anchored) &&
    bool(r.priorPossession) &&
    // The app writes loggedAt as a number, so the registry echoes a number. Accepting
    // only a string made this guard reject every record the app had made, and the page
    // said "No record found" for a record that exists.
    (str(r.loggedAtClaimedByHolder) || num(r.loggedAtClaimedByHolder)) &&
    str(r.registryFirstSeen) &&
    // null is a valid answer here and means "not checked". Requiring a boolean made
    // the guard reject a well-formed response, and the page then reported no record
    // for a record that exists.
    (r.lineageIntact === null || bool(r.lineageIntact)) &&
    (r.sealedAt === undefined || typeof r.sealedAt === 'number' || typeof r.sealedAt === 'string') &&
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
                {/* The headline is the line a reader takes away, so it claims only what was
                    checked: a ledger anchor, or else that the record is unaltered since the
                    registry first saw it. "Since logged" read as the holder's own date. */}
                <Typography variant="overline" sx={{ color: result.recordFingerprint ? TEAL : 'text.secondary' }}>
                  {!result.recordFingerprint
                    ? 'Record found — nothing sealed'
                    : result.anchored
                      ? anchoredOn(result)
                      : 'Unaltered since first seen by this registry'}
                </Typography>
                <Typography variant="h5">{result.cultivar}</Typography>
              </Box>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {result.id}
            </Typography>

            <Divider sx={{ mb: 2 }} />

            <Stack spacing={1.25}>
              {/* Printed on arrival until now, so a record with no commitment was told to
                  the reader as verified and intact. The heading above had the same
                  problem, and it is the line a reader actually takes away. */}
              {result.recordFingerprint ? (
                <Fact>
                  Record exists and its fingerprint is intact: unaltered since
                  {result.registryFirstSeen
                    ? ` this registry first saw it on ${fmt(result.registryFirstSeen)}`
                    : ' this registry first saw it'}
                  .
                </Fact>
              ) : (
                <Fact ok={false}>
                  This record carries no commitment, so nothing about it can be checked. It exists in the registry and
                  that is all.
                </Fact>
              )}

              {isSelective ? (
                <>
                  {disclosed.has('own') &&
                    (result.priorPossession ? (
                      <Fact>
                        {anchoredOn(result)}, which fixes its date.
                        {anchorIsTest(result)
                          ? ' A test network can be reset and its dates carry no evidential weight.'
                          : ''}
                      </Fact>
                    ) : (
                      <Fact ok={false}>
                        Not yet anchored on a ledger. Its date rests on this registry&apos;s records, not on a ledger.
                      </Fact>
                    ))}
                  {disclosed.has('dna') && (
                    <Fact ok={!!result.dnaPairedByHolder}>
                      {result.dnaPairedByHolder
                        ? 'The holder paired a DNA report fingerprint. Not confirmed by a lab.'
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
                  {disclosed.has('sealed') && result.sealedAt && (
                    <Fact>
                      Date stated by the holder: {fmt(result.sealedAt)}.
                      {result.registryFirstSeen
                        ? ` First seen by this registry: ${fmt(result.registryFirstSeen)}.`
                        : ''}
                    </Fact>
                  )}
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
                  <Fact ok={!!result.anchored}>
                    {result.anchored
                      ? `${anchoredOn(result)}${anchorIsTest(result) ? '. Test-network dates carry no evidential weight.' : ''}`
                      : 'Not yet anchored on a ledger'}
                  </Fact>
                  {/* Only a key the registry operator has checked is called a lab. Anyone can
                      register a key in a lab's name and sign their own record (attack
                      round 11). */}
                  {result.attestedByVettedLab === true ? (
                    <Fact>Signed attestation from a lab whose key VeilCore has checked</Fact>
                  ) : result.signedAttestation === true ||
                    (result.attestedByVettedLab === undefined && result.attested === true) ? (
                    <Fact ok={false}>
                      Signed attestation on record from a key not verified by VeilCore — it does not show who signed
                    </Fact>
                  ) : (
                    <Fact ok={false}>No signed attestation</Fact>
                  )}
                  <Fact ok={!!result.dnaPairedByHolder}>
                    {result.dnaPairedByHolder
                      ? 'DNA report paired by the holder (not lab-confirmed)'
                      : 'DNA report not yet paired'}
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
              {/* The last thing a reader sees, and it was printed on every response. A
                  record with no commitment has nothing to verify against anything. */}
              <Chip
                size="small"
                variant="outlined"
                label={
                  result.recordFingerprint
                    ? 'Checked against the VeilCore registry'
                    : 'Read from the registry — nothing verified'
                }
              />
            </Box>
          </Paper>
        )}
        {/* Real-chain builds: the holder's link may name the record's on-chain identity
            (?chain=…&anchorTx=…). It is their statement; the panel checks it on chain. */}
        {REAL_CHAIN && result?.found && params.get('chain') && (
          <VerifierChallengePanel
            claim={{ identity: params.get('chain') ?? '', txId: params.get('anchorTx') ?? undefined }}
          />
        )}
      </Container>
    </Box>
  );
};
