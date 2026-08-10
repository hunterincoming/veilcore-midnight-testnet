// HeritableRights — obligations that ride along with descendants.
//
// An obligation is never entered here. It is created by an agreement that carries an
// offspring royalty, and discharged when that agreement is revoked. Terms live in one
// place; this shows what they mean for anything descended from this cultivar.
//
// A buyer checking clean descent learns only accepted or rejected — never the
// ancestry, never the terms, never the genetics.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import GavelIcon from '@mui/icons-material/GavelOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import { verifyDescent, lineageRoot, type DescentVerdict } from '../veilcore/lineage';
import { allLicenses, createsHeritableObligation } from '../veilcore/licenses';
import { allRecords, type StrainRecord } from '../veilcore/records';
import { TEAL } from '../config/theme';

export const HeritableRights: React.FC<{ record: StrainRecord }> = ({ record }) => {
  const [root, setRoot] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<DescentVerdict | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { lineageRoot().then(setRoot); }, []);

  // Agreements on this record that put an obligation on its offspring.
  const heritable = allLicenses().filter(
    (l) => l.recordId === record.id && l.state === 'active' && createsHeritableObligation(l.type, l.terms),
  );

  const parentIds = (record.parents ?? []).map((p) => p.recordId).filter(Boolean) as string[];
  const parentFingerprints = allRecords()
    .filter((r) => parentIds.includes(r.id))
    .map((r) => r.recordFingerprint);

  const check = async () => {
    setBusy(true);
    setVerdict(await verifyDescent(record.recordFingerprint, parentFingerprints));
    setBusy(false);
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <GavelIcon sx={{ color: TEAL, fontSize: 20 }} />
        <Typography variant="overline" sx={{ color: TEAL }}>Heritable rights</Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        An agreement with an offspring royalty binds every descendant of this cultivar — including
        cuttings that do not exist yet. Descendants cannot prove clean descent until it is discharged.
      </Typography>

      {heritable.length > 0 ? (
        <Stack spacing={1}>
          {heritable.map((l) => (
            <Stack key={l.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" color="warning" label="Obligation outstanding" />
              <Typography variant="body2">
                {l.terms.offspringRoyaltyPct}% of offspring revenue
              </Typography>
              <Button size="small" component={RouterLink} to={`/license/${l.id}`}>
                {l.id}
              </Button>
            </Stack>
          ))}
          <Typography variant="caption" color="text.secondary">
            Discharged by revoking the agreement. The terms are never sent — only their fingerprint.
          </Typography>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No heritable obligation on this cultivar. An agreement with an offspring royalty creates one
          when it is counter-signed.
        </Typography>
      )}

      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button size="small" variant="outlined" onClick={check} disabled={busy}>
            Check clean descent
          </Button>
          <Typography variant="caption" color="text.secondary">
            {parentFingerprints.length > 0
              ? `${parentFingerprints.length} declared ancestor${parentFingerprints.length === 1 ? '' : 's'}`
              : 'no declared ancestry'}
          </Typography>
        </Stack>
      </Box>

      {verdict && (
        <Alert
          severity={verdict.ok ? 'success' : 'warning'}
          icon={verdict.ok ? <CheckCircleIcon /> : <BlockIcon />}
          variant="outlined"
        >
          {verdict.ok
            ? `Clean descent — ${verdict.generationsChecked ?? 0} generation${verdict.generationsChecked === 1 ? '' : 's'} checked.`
            : verdict.reason}
        </Alert>
      )}

      {root && (
        <Typography variant="caption" color="text.secondary">
          Registry root {root.slice(0, 16)}… — one 32-byte value covering every obligation on record.
        </Typography>
      )}
    </Stack>
  );
};
