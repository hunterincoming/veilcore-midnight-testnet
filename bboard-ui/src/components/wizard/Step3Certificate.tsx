// Step 3 — The record certificate. A downloadable summary with a QR code to the
// record's verify page. Every check it shows is computed when it is shown: the integrity
// line recomputes the fingerprint from the stored fields (records.checkIntegrity, which
// uses veilcore-records' canonical serialisation), and the anchor line asks the registry
// for the batch proof and verifies it locally. Nothing is printed as a pass unless it was
// checked. The time is this device's clock until the record is anchored.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Divider, Snackbar, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/DownloadOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import VerifiedIcon from '@mui/icons-material/VerifiedOutlined';
import { QRCodeSVG } from 'qrcode.react';
import { toPng } from 'html-to-image';
import { getRecord, checkIntegrity, type IntegrityCheck } from '../../veilcore/records';
import { proofFor, type ProofState } from '../../veilcore/proofs';
import { NETWORK, networkLabel } from '../../config/network';
import { useLicenses, activeLicenseCount, licensesForRecord } from '../../veilcore/licenses';
import { shortFingerprint } from '../../veilcore/commitment';
import { TEAL } from '../../config/theme';

const fmtStamp = (ms: number) => new Date(ms).toLocaleString();

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box>
    <Typography variant="overline" sx={{ display: 'block', mb: 0.25 }}>
      {label}
    </Typography>
    <Typography variant="body2" sx={{ color: 'text.primary' }}>
      {children}
    </Typography>
  </Box>
);

export const Step3Certificate: React.FC<{ recordId: string; onDone: () => void; onBack: () => void }> = ({
  recordId,
  onDone,
  onBack,
}) => {
  useLicenses();
  const certRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string>();
  const record = getRecord(recordId);
  const [integrity, setIntegrity] = useState<IntegrityCheck | 'checking'>('checking');
  const [anchor, setAnchor] = useState<ProofState | 'checking'>('checking');

  useEffect(() => {
    if (!record) return;
    let live = true;
    void checkIntegrity(record).then((r) => live && setIntegrity(r));
    void proofFor(record.recordFingerprint).then((p) => live && setAnchor(p));
    return () => {
      live = false;
    };
  }, [record]);

  if (!record) return <Typography>Record not found.</Typography>;

  const integrityText: Record<IntegrityCheck | 'checking', string> = {
    checking: 'checking…',
    match: '✓ fingerprint recomputed from the stored fields: it matches',
    mismatch: '✗ fingerprint recomputed from the stored fields: it does NOT match',
    unsealed: 'not sealed yet',
    'no-nonce': 'cannot be recomputed (this record predates stored nonces)',
  };
  const integrityLine = integrityText[integrity];

  const anchorLine =
    anchor === 'checking'
      ? 'checking…'
      : anchor.status === 'anchored'
        ? `anchored on ${networkLabel(anchor.proof.anchor?.network ?? NETWORK)} · tx ${anchor.proof.anchor?.txHash ?? ''}`
        : anchor.status === 'pending'
          ? 'Not yet: in a batch awaiting anchoring. Until then, its date rests on this registry’s records.'
          : 'Not yet. Until it is anchored, its date rests on this registry’s records.';

  const verifyLink = `${window.location.origin}/verify/${record.id}`;

  const downloadJson = () => {
    const data = {
      record,
      licenses: licensesForRecord(record.id),
      integrity: integrityLine,
      anchored: anchorLine,
      sealedAtSource: "the sealing device's clock",
      generatedAt: new Date().toISOString(),
      note: 'VeilCore record summary. No genetic data or lab files; it contains the record details.',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${record.id}-evidence.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast('Evidence data (JSON) downloaded.');
  };

  const download = async () => {
    if (!certRef.current) return;
    try {
      const dataUrl = await toPng(certRef.current, { pixelRatio: 2, backgroundColor: '#0a1114', cacheBust: true });
      const a = document.createElement('a');
      a.download = `${record.id}-veilcore-certificate.png`;
      a.href = dataUrl;
      a.click();
      setToast('Certificate downloaded.');
    } catch {
      setToast('Could not render the certificate image.');
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(verifyLink);
    setToast('Verification link copied.');
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>
          Your record summary
        </Typography>
        <Typography variant="body2" color="text.secondary">
          A summary for your records and your lawyer: the sealed record, a fresh integrity check, whether it is
          anchored, the report pairing, any lab attestation and active licenses. It contains the record details but no
          genetic data or lab files.
        </Typography>
      </Box>

      {/* the certificate itself (captured for download) */}
      <Box
        ref={certRef}
        sx={{
          p: 3.5,
          borderRadius: 3,
          background: 'linear-gradient(160deg, #0b1417 0%, #060b0d 100%)',
          border: `1px solid ${TEAL}55`,
          boxShadow: `0 0 40px rgba(47,240,207,0.10)`,
        }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box>
            <Typography variant="overline" sx={{ color: TEAL }}>
              VeilCore
            </Typography>
            <Typography variant="h5" sx={{ lineHeight: 1.1 }}>
              Record certificate
            </Typography>
          </Box>
          <VerifiedIcon sx={{ color: TEAL, fontSize: 32 }} />
        </Stack>

        <Divider sx={{ mb: 2.5 }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
          <Stack spacing={2} sx={{ flex: 1 }}>
            <Field label="Cultivar">{record.strainName}</Field>
            <Field label="Bred by">{record.bredBy}</Field>
            <Field label="Stated creation date (breeder's claim)">{record.dateCreated}</Field>
            {record.taxon && <Field label="Species">{record.taxon}</Field>}
            <Field label="Logged (the sealing device's clock)">{fmtStamp(record.loggedAt)}</Field>
            <Field label="Anchored">
              <Box
                component="span"
                sx={{
                  color: anchor !== 'checking' && anchor.status === 'anchored' ? TEAL : 'text.secondary',
                  wordBreak: 'break-all',
                }}
              >
                {anchorLine}
              </Box>
            </Field>
            <Field label="DNA report paired">
              {record.dnaFingerprint ? (
                <Box component="span" sx={{ color: TEAL }}>
                  ✓ paired {record.dnaPairedAt ? `· ${new Date(record.dnaPairedAt).toLocaleDateString()}` : ''}
                </Box>
              ) : (
                'not paired'
              )}
            </Field>
            <Field label="Integrity">
              <Box
                component="span"
                sx={{
                  color: integrity === 'match' ? TEAL : integrity === 'mismatch' ? 'error.main' : 'text.secondary',
                }}
              >
                {integrityLine}
              </Box>
            </Field>
            <Field label="Lab attestation">{record.attestation ? `✓ ${record.attestation.lab}` : 'awaiting'}</Field>
            <Field label="Active licenses">{activeLicenseCount(record.id)}</Field>
            <Field label="Record ID">
              <Box component="span" sx={{ fontFamily: '"Space Grotesk", monospace' }}>
                {record.id}
              </Box>
            </Field>
          </Stack>

          <Stack spacing={1} sx={{ alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ p: 1.5, background: '#fff', borderRadius: 2 }}>
              <QRCodeSVG value={verifyLink} size={120} bgColor="#ffffff" fgColor="#04070a" level="M" />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Scan to verify
            </Typography>
          </Stack>
        </Stack>

        <Divider sx={{ my: 2.5 }} />
        <Typography variant="caption" color="text.secondary">
          Tamper-evident · no genetic data or lab files on this certificate · fingerprint{' '}
          {shortFingerprint(record.recordFingerprint)}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyLink}>
          Copy verification link
        </Button>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={download}>
          Download (PNG)
        </Button>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={downloadJson}>
          Download data (JSON)
        </Button>
        <Button variant="contained" onClick={onDone}>
          Continue — prove what you choose
        </Button>
      </Stack>

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(undefined)}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  );
};
