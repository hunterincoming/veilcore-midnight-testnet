// VerifyPage (/verify/:id) — the public page a stranger reaches from a link or a
// certificate's QR code. It works for a visitor who has never loaded the app.
//
// What it says is split by who stands behind it (attack round D):
//   - checked in this browser: the record's inclusion proof (bound to its fingerprint,
//     path folding to the batch root) and any signed attestations (bound to the
//     fingerprint, signatures verified here). Only these get a tick;
//   - reported by the registry: everything else — that a record with this fingerprint
//     exists, when the registry first stored it, an anchor, whether a key is vetted, and
//     the facts the holder chose to share. Worded as reports, never as checks.
// The registry sends only the facts the holder granted (README "Disclosure"); a ?show=
// in the link can narrow that and never widen it. Genetics are never sent.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Box, Chip, CircularProgress, Container, Divider, Paper, Stack, Typography } from '@mui/material';
import { useParams, useSearchParams } from 'react-router-dom';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import { shortFingerprint } from '../veilcore/commitment';
import { DISCLOSURE_FIELDS, LEGACY_NAME, toDisclosureKey, labelOf } from '../veilcore/disclosure';
import { proofFor, type ProofState } from '../veilcore/proofs';
import { attestationsFor, countsAsSigned, type ResolvedAttestation } from '../veilcore/attesters';
import { TEAL } from '../config/theme';
import { NETWORK, isTestNetwork, networkLabel } from '../config/network';
import { Fact, SharedFacts } from '../components/verify/DisclosedFacts';

const API = import.meta.env.VITE_API_BASE ?? '';
const fmt = (t: number | string) => new Date(t).toLocaleString();

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
  /** The facts the holder granted, in the registry's older names. Always sent by a current registry. */
  disclosed?: string[];
  /** Keys the link asked for that the holder has not granted (older names). */
  notGranted?: string[];
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
    (r.disclosed === undefined || Array.isArray(r.disclosed)) &&
    (r.parents === undefined || Array.isArray(r.parents)) &&
    (r.unavailable === undefined || Array.isArray(r.unavailable)) &&
    (r.notGranted === undefined || Array.isArray(r.notGranted)) &&
    (r.anchor === undefined || r.anchor === null || (typeof r.anchor === 'object' && !Array.isArray(r.anchor))) &&
    str(r.lineageNote) &&
    str(r.unavailableReason)
  );
};

/**
 * The facts the holder shared, in the registry's older names. A current registry always
 * sends `disclosed`. An older one, which answered everything when the link had no
 * ?show=, did not; for it the shared set is read from which granted fields are present,
 * so a missing field is still "not shared" and never "no".
 */
const sharedOf = (r: VerifyResult): string[] => {
  const names = new Set((r.disclosed ?? []).filter((k): k is string => typeof k === 'string'));
  if (r.disclosed === undefined) {
    if (r.priorPossession !== undefined) names.add('own');
    if (r.dnaPairedByHolder !== undefined) names.add('dna');
    if (r.lineageIntact !== undefined || r.lineageNote !== undefined) names.add('lineage');
    if (r.sealedAt !== undefined) names.add('sealed');
    if (r.parents !== undefined) names.add('parents');
    if (r.breedingMethod !== undefined) names.add('method');
  }
  return DISCLOSURE_FIELDS.map((f) => LEGACY_NAME[f.key]).filter((k) => names.has(k));
};

const labelsOf = (keys: readonly unknown[]): string =>
  keys
    .map((k) => (typeof k === 'string' ? toDisclosureKey(k) : undefined))
    .map((k, i) => (k ? labelOf(k) : String(keys[i])))
    .join('; ');

export const VerifyPage: React.FC = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const show = params.get('show');

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [proof, setProof] = useState<ProofState | 'checking'>('checking');
  const [atts, setAtts] = useState<ResolvedAttestation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // ?show= is passed on so a link made to show less still shows less. It cannot add
    // anything: the registry answers only what the holder granted.
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

  // The two things this page can check for itself, against the fingerprint the
  // registry reported.
  const fingerprint = result?.found ? result.recordFingerprint : undefined;
  useEffect(() => {
    let live = true;
    setProof('checking');
    setAtts(null);
    if (!fingerprint) {
      setProof({ status: 'none' });
      setAtts([]);
      return;
    }
    void proofFor(fingerprint).then((p) => live && setProof(p));
    void attestationsFor(fingerprint).then((a) => live && setAtts(a));
    return () => {
      live = false;
    };
  }, [fingerprint]);

  const checked = proof !== 'checking' && proof.status !== 'none';
  const reportedNetwork =
    proof !== 'checking' && proof.status === 'anchor-reported'
      ? proof.proof.anchor?.network
      : typeof result?.anchor?.network === 'string'
        ? result.anchor.network
        : undefined;
  const signed = (atts ?? []).filter(countsAsSigned);
  const signedVetted = signed.filter((a) => a.vettedAttester === true);

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
              {/* Teal only when something was checked here: the record's fingerprint is in
                  a sealed batch whose path this browser folded. A record with nothing
                  sealed, or nothing checkable, gets a grey mark. */}
              <VerifiedIcon
                data-checked={checked ? 'yes' : 'no'}
                sx={{ color: checked ? TEAL : 'text.disabled', fontSize: 30 }}
              />
              <Box>
                <Typography variant="overline" sx={{ color: checked ? TEAL : 'text.secondary' }}>
                  {!result.recordFingerprint
                    ? 'Record found — nothing sealed'
                    : proof === 'checking'
                      ? 'Checking…'
                      : proof.status === 'anchor-reported'
                        ? 'In a sealed batch · anchor reported, not checked'
                        : proof.status === 'pending'
                          ? 'In a sealed batch · not yet anchored'
                          : 'Fingerprint on file · not in a batch this page could check'}
                </Typography>
                <Typography variant="h5">{result.cultivar}</Typography>
              </Box>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {result.id}
            </Typography>

            <Divider sx={{ mb: 2 }} />

            <Stack spacing={1.25}>
              {result.recordFingerprint ? (
                <Fact ok={false}>
                  The registry reports a record with fingerprint {shortFingerprint(result.recordFingerprint)}
                  {result.registryFirstSeen ? `, first stored on ${fmt(result.registryFirstSeen)}` : ''}. The fields it
                  covers are not shared, so this page cannot recompute it.
                </Fact>
              ) : (
                <Fact ok={false}>
                  This record carries no commitment, so nothing about it can be checked. It exists in the registry and
                  that is all.
                </Fact>
              )}

              {result.recordFingerprint &&
                (proof === 'checking' ? null : proof.status === 'none' ? (
                  <Fact ok={false}>
                    No inclusion proof this page could check: the record is not in a sealed batch yet, so it is not
                    anchored.
                  </Fact>
                ) : (
                  <>
                    <Fact>
                      Checked in this browser: this fingerprint is in batch {proof.proof.batchId}, and its path folds to
                      the batch root {proof.proof.root.slice(0, 16)}….
                    </Fact>
                    {proof.status === 'anchor-reported' ? (
                      <Fact ok={false}>
                        The registry reports that root was recorded on {networkLabel(reportedNetwork ?? NETWORK)}
                        {proof.proof.anchor?.txHash ? ` in transaction ${proof.proof.anchor.txHash}` : ''}. This page
                        has not looked it up; do that before relying on the date.
                        {isTestNetwork(reportedNetwork ?? NETWORK)
                          ? ' A test network can be reset and its dates carry no evidential weight.'
                          : ''}
                      </Fact>
                    ) : (
                      <Fact ok={false}>The batch has not been anchored on a ledger yet.</Fact>
                    )}
                  </>
                ))}

              {/* Base data: shown whatever the holder shared. Signatures are checked here;
                  who holds a key is the registry operator's word. */}
              {result.recordFingerprint &&
                atts !== null &&
                (signedVetted.length > 0 ? (
                  <Fact>
                    Signed attestation, signature verified in this browser, from a key VeilCore says it has checked.
                  </Fact>
                ) : signed.length > 0 ? (
                  <Fact ok={false}>
                    Signed attestation, signature verified in this browser, from a key not verified by VeilCore — it
                    does not show who signed.
                  </Fact>
                ) : result.signedAttestation === true ||
                  result.attestedByVettedLab === true ||
                  result.attested === true ? (
                  <Fact ok={false}>
                    The registry reports a signed attestation, but none could be verified in this browser.
                  </Fact>
                ) : (
                  <Fact ok={false}>No signed attestation.</Fact>
                ))}

              <Divider sx={{ my: 0.5 }} />
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block' }}>
                Shared by the holder · reported by the registry
              </Typography>
              <SharedFacts
                data={{
                  disclosed: sharedOf(result),
                  priorPossession: result.priorPossession,
                  anchorNetwork: reportedNetwork,
                  dnaPairedByHolder: result.dnaPairedByHolder,
                  lineageIntact: result.lineageIntact,
                  sealedAt: result.sealedAt ?? result.loggedAtClaimedByHolder ?? undefined,
                  registryFirstSeen: result.registryFirstSeen,
                  parents: result.parents,
                  breedingMethod: result.breedingMethod,
                }}
              />

              {result.notGranted && result.notGranted.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  This link asked for {labelsOf(result.notGranted)}, which the holder has not chosen to share.
                </Typography>
              )}
              {result.unavailable && result.unavailable.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  This link asked for facts about the holder rather than this record ({result.unavailable.join(', ')}).
                  The registry never answers those.
                </Typography>
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary">
              Fingerprint {shortFingerprint(result.recordFingerprint ?? '')} · only the facts above were sent · no
              genetics disclosed
            </Typography>

            <Box sx={{ mt: 2, textAlign: 'right' }}>
              <Chip
                size="small"
                variant="outlined"
                label={
                  checked
                    ? 'Ticked lines checked in this browser; the rest reported by the VeilCore registry'
                    : 'Reported by the VeilCore registry — nothing on this page could be checked'
                }
                sx={{ height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
              />
            </Box>
          </Paper>
        )}
      </Container>
    </Box>
  );
};
