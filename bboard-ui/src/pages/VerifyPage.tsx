// VerifyPage (/verify/:id) — the public page a stranger reaches from a link or a
// certificate's QR code. It works for a visitor who has never loaded the app.
//
// What it says is split by who stands behind it (attack round D):
//   - checked in this browser: the record's inclusion proof (bound to its fingerprint,
//     path folding to the batch root) and any signed attestations (bound to the
//     fingerprint, signatures verified here). Only these get a tick, and only when the
//     fingerprint came from the link (`?fp=`), not from the registry's answer. Checked
//     against the registry's own value, a lying registry could answer one record's id
//     with another record's fingerprint and borrow its proof and lab signature (round D
//     verification). A link whose fingerprint the registry does not report gets no
//     checks and a warning; an old link without `fp` gets the checks worded as the
//     registry's report, with no ticks;
//   - reported by the registry: everything else — that a record with this fingerprint
//     exists, when the registry first stored it, an anchor, whether a key is vetted, and
//     the facts the holder chose to share. Worded as reports, never as checks.
// The registry sends only the facts the holder granted (README "Disclosure"); a ?show=
// in the link can narrow that and never widen it. Genetics are never sent.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, Container, Divider, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import { shortFingerprint } from '../veilcore/commitment';
import { DISCLOSURE_FIELDS, LEGACY_NAME, toDisclosureKey, labelOf } from '../veilcore/disclosure';
import { proofFor, type ProofState } from '../veilcore/proofs';
import { attestationsFor, countsAsSigned, type ResolvedAttestation } from '../veilcore/attesters';
import { TEAL } from '../config/theme';
import { NETWORK, isTestNetwork, networkLabel } from '../config/network';
import { Fact, SharedFacts } from '../components/verify/DisclosedFacts';
import { bindingOf, linkFingerprint } from '../veilcore/verify-link';

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
  // The fingerprint the link was made for. It is not sent to the registry: it is what
  // the registry's answer is checked against.
  const fp = params.get('fp');

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

  // The two things this page can check for itself. With a fingerprint in the link they
  // are checked against it (and the registry must report the same one); an old link is
  // checked against the registry's value and shown as its report; on a mismatch nothing
  // is checked.
  const binding = bindingOf(linkFingerprint(fp), result?.found ? result.recordFingerprint : undefined);
  const bound = binding.kind === 'bound';
  const fingerprint = binding.kind === 'mismatch' ? undefined : binding.fingerprint;
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

  // A tick (and the teal mark) only for a check against the link's own fingerprint.
  const checked = bound && proof !== 'checking' && proof.status !== 'none';
  // Before the link's fingerprint is known to match, say whose fingerprint was used.
  const forWhom = bound ? '' : 'For the fingerprint the registry reports: ';
  const reportedNetwork =
    proof !== 'checking' && proof.status === 'anchor-reported'
      ? proof.proof.anchor?.network
      : typeof result?.anchor?.network === 'string'
        ? result.anchor.network
        : undefined;
  const signed = (atts ?? []).filter(countsAsSigned);
  const signedVetted = signed.filter((a) => a.vettedAttester === true);
  const ticked = checked || (bound && signedVetted.length > 0);

  return (
    <Box sx={{ minHeight: '100vh', background: '#04070a' }}>
      <Container maxWidth="sm" sx={{ py: { xs: 5, md: 8 } }}>
        <Stack
          component={RouterLink}
          to="/"
          aria-label="VeilCore home"
          direction="row"
          spacing={1.25}
          sx={{
            alignItems: 'center',
            justifyContent: 'center',
            mb: 2,
            mx: 'auto',
            width: 'fit-content',
            minHeight: 44,
            textDecoration: 'none',
            color: 'text.primary',
          }}
        >
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', background: TEAL, boxShadow: `0 0 14px ${TEAL}` }} />
          <Typography variant="h6" sx={{ letterSpacing: '0.3em', fontWeight: 600 }}>
            VEILCORE
          </Typography>
        </Stack>
        {/* One line for a stranger who arrived from a QR code or a shared link. */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ textAlign: 'center', mb: 4, maxWidth: 460, mx: 'auto' }}
        >
          This page checks a VeilCore record: a dated fingerprint of genetic material, published without the genetics.
          Checking is free and needs no account.{' '}
          <Box component={RouterLink} to="/" sx={{ color: TEAL, whiteSpace: 'nowrap' }}>
            What is VeilCore?
          </Box>
        </Typography>

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
            <Box component={RouterLink} to="/" sx={{ display: 'inline-block', mt: 2, py: 1, color: TEAL }}>
              Go to veilcore.org
            </Box>
          </Paper>
        ) : binding.kind === 'mismatch' ? (
          // The link names a record the registry does not answer for. Its answer is about
          // some other record (or none), so nothing on it is checked or shown as this one.
          <Paper sx={{ p: { xs: 3, md: 4 } }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
              <VerifiedIcon data-checked="no" sx={{ color: 'text.disabled', fontSize: 30 }} />
              <Typography variant="overline" sx={{ color: 'error.main' }}>
                Fingerprint does not match this link · nothing checked
              </Typography>
            </Stack>
            <Alert severity="error" variant="outlined" data-mismatch="yes">
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Do not rely on this page.
              </Typography>
              <Typography variant="body2">
                {binding.linked
                  ? `This link was made for the record with fingerprint ${shortFingerprint(binding.linked)}, `
                  : 'This link carries a fingerprint that is not valid (it should be 64 hexadecimal characters); it may have been cut short or changed, '}
                but the registry reports{' '}
                {binding.reported ? `fingerprint ${shortFingerprint(binding.reported)}` : 'no fingerprint'} for{' '}
                {id || 'this ID'}. Its answer is not about the record the link names, so this page has checked nothing
                and shows none of it. Ask whoever gave you the link for the record itself.
              </Typography>
            </Alert>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {binding.linked
                ? `Fingerprint in the link: ${binding.linked}`
                : `Fingerprint in the link: ${(fp ?? '').slice(0, 80)}`}
            </Typography>
            <Box sx={{ mt: 2, textAlign: 'right' }}>
              <Chip
                size="small"
                variant="outlined"
                label="The registry's answer does not match this link — nothing on this page was checked"
                sx={{ height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
              />
            </Box>
          </Paper>
        ) : (
          <Paper sx={{ p: { xs: 3, md: 4 } }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
              {/* Teal only when something was checked here against the link's own
                  fingerprint: it is in a sealed batch whose path this browser folded. A
                  record with nothing sealed or nothing checkable, or an old link with no
                  fingerprint, gets a grey mark. */}
              <VerifiedIcon
                data-checked={checked ? 'yes' : 'no'}
                sx={{ color: checked ? TEAL : 'text.disabled', fontSize: 30 }}
              />
              <Box>
                <Typography variant="overline" sx={{ color: checked ? TEAL : 'text.secondary' }}>
                  {!result.recordFingerprint
                    ? 'Record found — nothing sealed'
                    : !bound
                      ? 'Registry report · this link carries no fingerprint to check against'
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
              {!result.recordFingerprint ? (
                <Fact ok={false}>
                  This record carries no commitment, so nothing about it can be checked. It exists in the registry and
                  that is all.
                </Fact>
              ) : bound ? (
                <Fact ok={false}>
                  This link was made for fingerprint {shortFingerprint(result.recordFingerprint)}, and the registry
                  reports the same fingerprint for this record
                  {result.registryFirstSeen ? `, first stored on ${fmt(result.registryFirstSeen)}` : ''}. The fields it
                  covers are not shared, so this page cannot recompute it.
                </Fact>
              ) : (
                <>
                  <Fact ok={false}>
                    The registry reports a record with fingerprint {shortFingerprint(result.recordFingerprint)}
                    {result.registryFirstSeen ? `, first stored on ${fmt(result.registryFirstSeen)}` : ''}. The fields
                    it covers are not shared, so this page cannot recompute it.
                  </Fact>
                  <Fact ok={false}>
                    This link does not name the record&apos;s fingerprint, so this page cannot tell whether the registry
                    answered with this record&apos;s fingerprint or another&apos;s. Nothing below is ticked. A link made
                    now from the record ends in ?fp=…; ask the holder for one.
                  </Fact>
                </>
              )}

              {result.recordFingerprint &&
                (proof === 'checking' ? null : proof.status === 'none' ? (
                  <Fact ok={false}>
                    No inclusion proof this page could check: the record is not in a sealed batch yet, so it is not
                    anchored.
                  </Fact>
                ) : (
                  <>
                    {bound ? (
                      <Fact>
                        Checked in this browser: this fingerprint is in batch {proof.proof.batchId}, and its path folds
                        to the batch root {proof.proof.root.slice(0, 16)}….
                      </Fact>
                    ) : (
                      <Fact ok={false}>
                        {forWhom}it is in batch {proof.proof.batchId}, and its path folds to the batch root{' '}
                        {proof.proof.root.slice(0, 16)}…. Checked here, but against the registry&apos;s own fingerprint.
                      </Fact>
                    )}
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
                  who holds a key is the registry operator's word. Ticked only against the
                  link's own fingerprint. */}
              {result.recordFingerprint &&
                atts !== null &&
                (signedVetted.length > 0 ? (
                  <Fact ok={bound}>
                    {forWhom}Signed attestation, signature verified in this browser, from a key VeilCore says it has
                    checked.
                  </Fact>
                ) : signed.length > 0 ? (
                  <Fact ok={false}>
                    {forWhom}Signed attestation, signature verified in this browser, from a key not verified by VeilCore
                    — it does not show who signed.
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
                  ticked
                    ? 'Ticked lines checked in this browser; the rest reported by the VeilCore registry'
                    : !bound && result.recordFingerprint
                      ? 'Reported by the VeilCore registry — this link names no fingerprint, so nothing on this page is ticked'
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
