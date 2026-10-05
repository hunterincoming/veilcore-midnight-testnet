// Receiving a cultivar.
//
// Claiming records that someone holding the sender's code took delivery. A recipient
// with an attester key can then sign a chain-of-custody confirmation about the record
// they received from — their own statement, which is what makes it evidence.
//
// The lab sees exactly what it signs, and signs only when it says so (attack round D).
// The signature used to be made straight after the claim, over a source commitment the
// registry chose, with the dialog saying only "Confirm receipt": a registry that lied
// could get a vetted lab's signature over any record. Now the claim and the signature
// are two steps; the second shows the source record, its full fingerprint and the
// lab's own key, refuses if the registry's answers about the source disagree, and
// reports a signature that was not recorded instead of discarding the result.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/MoveToInboxOutlined';
import { useNavigate } from 'react-router-dom';
import {
  claimTransfer,
  custodySubject,
  parseShareCode,
  publicFingerprintOf,
  type CustodySubject,
} from '../veilcore/transfers';
import { hydrate, sealReceived } from '../veilcore/records';
import { loadAttester, attestRecord, type AttesterProfile } from '../veilcore/attester-keys';

type Stage =
  | { step: 'code' }
  | { step: 'sign'; subject: CustodySubject; attester: AttesterProfile }
  | { step: 'refused'; recordId: string; reason: string };

export const ClaimTransfer: React.FC<{ variant?: 'button' | 'text' }> = ({ variant = 'text' }) => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ step: 'code' });
  const [received, setReceived] = useState(false);
  const navigate = useNavigate();

  const close = () => {
    setOpen(false);
    setStage({ step: 'code' });
    setReceived(false);
    setError(null);
  };

  const finish = (recordId: string) => {
    close();
    setCode('');
    void navigate(`/record/${recordId}`);
  };

  const claim = async () => {
    if (!code.trim()) return;
    const { transferId, claimCode } = parseShareCode(code);
    setBusy(true);
    setError(null);
    const res = await claimTransfer(transferId, claimCode);
    if ('error' in res) {
      setError(res.error);
      setBusy(false);
      return;
    }
    await hydrate();
    // Seal the received record with the recipient's own commitment. They are not
    // copying the sender's evidence — they are committing to what they received:
    // this material, this quantity, this date, from this source.
    const sealed = await sealReceived(res.recordId);

    const attester = loadAttester();
    if (!attester) {
      setBusy(false);
      finish(res.recordId);
      return;
    }
    const subject = custodySubject({
      receivedRecordId: res.recordId,
      sealed,
      claim: res,
      publicFingerprint: sealed?.receivedFrom ? await publicFingerprintOf(sealed.receivedFrom) : null,
    });
    setBusy(false);
    setStage(
      'refuse' in subject
        ? { step: 'refused', recordId: res.recordId, reason: subject.refuse }
        : { step: 'sign', subject, attester },
    );
  };

  const sign = async () => {
    if (stage.step !== 'sign') return;
    setBusy(true);
    setError(null);
    const out = await attestRecord(
      stage.attester,
      stage.subject.sourceCommitment,
      stage.subject.receivedRecordFingerprint,
      'chain-of-custody',
    );
    setBusy(false);
    if (out.error || !out.attestationId) {
      setError(
        `Receipt recorded, but your signed confirmation was not: ${out.error ?? 'no answer from the registry'}.`,
      );
      return;
    }
    finish(stage.subject.receivedRecordId);
  };

  return (
    <>
      <Button
        variant={variant === 'button' ? 'outlined' : 'text'}
        startIcon={<InboxIcon />}
        onClick={() => setOpen(true)}
      >
        Receive a cultivar
      </Button>

      <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>{stage.step === 'sign' ? 'Sign what you received?' : 'Receive a cultivar'}</DialogTitle>
        <DialogContent>
          {stage.step === 'code' && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Enter the transfer code the sender gave you. You&apos;ll get a record descended from theirs, and the
                registry records that someone holding this code took delivery. If you have an attester key you will be
                shown exactly what you would sign before anything is signed.
              </Typography>
              <TextField
                label="Transfer code"
                placeholder="TR-XXXXXXXX.xxxxxxxx…"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void claim();
                }}
                fullWidth
                slotProps={{ htmlInput: { style: { fontFamily: 'monospace', letterSpacing: 1 } } }}
              />
            </Stack>
          )}

          {stage.step === 'sign' && (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                The transfer is claimed. Your key can now sign a chain-of-custody confirmation. This is exactly what it
                says:
              </Typography>
              <Box sx={{ p: 1.5, borderRadius: 1, background: 'rgba(255,255,255,0.04)', fontSize: 13 }}>
                <Typography variant="body2">
                  “I received {stage.subject.quantity ? `${stage.subject.quantity} of ` : ''}
                  {stage.subject.cultivar || 'this material'} from record {stage.subject.sourceRecordId}.”
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  About the record with fingerprint
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {stage.subject.sourceCommitment}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Pointing at your received record
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {stage.subject.receivedRecordFingerprint}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Signed by your key ({stage.attester.displayName ?? 'unnamed'})
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {stage.attester.keypair.publicKey}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                The fingerprint came from the registry and matches what its public page reports for{' '}
                {stage.subject.sourceRecordId}. If the sender gave you a fingerprint, compare it before signing.
              </Typography>
              <FormControlLabel
                control={<Checkbox checked={received} onChange={(e) => setReceived(e.target.checked)} />}
                label={<Typography variant="body2">I physically received this material.</Typography>}
              />
            </Stack>
          )}

          {stage.step === 'refused' && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
              The transfer is claimed and your record created. {stage.reason}
            </Alert>
          )}

          {error && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Only confirm what you actually received. This is a statement other people will rely on.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          {stage.step === 'code' && (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="contained" onClick={() => void claim()} disabled={busy || !code.trim()}>
                Claim transfer
              </Button>
            </>
          )}
          {stage.step === 'sign' && (
            <>
              <Button onClick={() => finish(stage.subject.receivedRecordId)} disabled={busy}>
                Don&apos;t sign
              </Button>
              <Button variant="contained" onClick={() => void sign()} disabled={busy || !received}>
                Sign with my key
              </Button>
            </>
          )}
          {stage.step === 'refused' && (
            <Button variant="contained" onClick={() => finish(stage.recordId)}>
              Go to the record
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};
