// What a second party has said about this record, and what it is worth.
//
// A record can carry attestations of very different weight: unsigned, signed by a key,
// or signed by a key whose holder names an external accreditor. Showing them
// identically overstates the weakest, which is the failure the simulate button was.
//
// Signatures are verified in this browser rather than taken from the registry's word.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import { attestationsFor, strengthLabel, type ResolvedAttestation } from '../veilcore/attesters';
import type { StrainRecord } from '../veilcore/records';

export const AttestationPanel: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [items, setItems] = useState<ResolvedAttestation[] | null>(null);

  useEffect(() => {
    void attestationsFor(record.recordFingerprint).then(setItems);
  }, [record.recordFingerprint]);

  // The legacy transfer-claim attestation, which predates signing.
  const legacy = record.attestation;

  if (items === null) return null;

  if (items.length === 0 && !legacy) {
    return (
      <Stack spacing={1}>
        <Typography variant="overline" sx={{ display: 'block' }}>Attestations</Typography>
        <Typography variant="body2" color="text.secondary">
          Nobody else has confirmed this record yet. A record you signed alone is weaker evidence
          than one a second party confirms — send the cultivar to a lab and their confirmation is
          recorded against their key, not yours.
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="overline" sx={{ display: 'block' }}>Attestations</Typography>

      {legacy && items.length === 0 && (
        <Alert severity="info" variant="outlined">
          Confirmed by {legacy.attesterHandle ?? 'a second party'} on{' '}
          {new Date(legacy.attestedAt).toLocaleDateString()} through a transfer claim. Recorded
          before signing existed, so it identifies a party without proving who they are.
        </Alert>
      )}

      {items.map((a) => {
        const s = strengthLabel(a);
        return (
          <Box key={a.attestationId} sx={{ pl: 1.5, borderLeft: '2px solid rgba(255,255,255,0.12)' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
              <Chip
                size="small"
                variant="outlined"
                color={s.ok ? 'primary' : 'default'}
                label={s.label}
              />
              <Typography variant="caption" color="text.secondary">
                {a.type} · {new Date(a.issuedAt).toLocaleDateString()}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">{s.why}</Typography>
          </Box>
        );
      })}
    </Stack>
  );
};
