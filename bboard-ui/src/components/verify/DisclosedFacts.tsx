// DisclosedFacts — renders exactly the facts a recipient is allowed to see under a given
// selective-disclosure spec, plus the always-locked genetics row and an honest note that
// the withheld fields still exist and are provable. Shared by the wizard's live preview and
// the public /verify page so the preview is byte-for-byte what the recipient gets.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Divider, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import { allRecords } from '../../veilcore/records';
import { allLicenses, agreementType, AGREEMENT_LABEL } from '../../veilcore/licenses';
import { shortFingerprint } from '../../veilcore/commitment';
import { DISCLOSURE_FIELDS, GENETICS_LABEL, type Disclosure } from '../../veilcore/disclosure';
import type { StrainRecord } from '../../veilcore/records';
import { TEAL } from '../../config/theme';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

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

export const DisclosedFacts: React.FC<{ record: StrainRecord; disclosure: Disclosure }> = ({ record, disclosure }) => {
  const parents = (record.parents ?? []).map((p) => p.name).filter(Boolean);
  const otherRecords = allRecords().filter((r) => r.id !== record.id);
  const otherAgreements = allLicenses().filter((l) => l.recordId !== record.id);
  const withheld = DISCLOSURE_FIELDS.filter((f) => !disclosure[f.key]).map((f) => f.label);

  const anyOn = DISCLOSURE_FIELDS.some((f) => disclosure[f.key]);

  return (
    <Stack spacing={1.25}>
      {!anyOn && (
        <Typography variant="body2" color="text.secondary">
          Nothing selected — the recipient would see only that this record exists. Flip a toggle to share a fact.
        </Typography>
      )}

      {disclosure.own && <Fact>Prior possession proven — sealed to this breeder on this date.</Fact>}
      {disclosure.dna && (
        <Fact ok={!!record.dnaFingerprint}>
          {record.dnaFingerprint ? 'DNA-verified — bound to the paired lab report.' : 'DNA report not yet paired.'}
        </Fact>
      )}
      {disclosure.lineage && <Fact>Lineage intact — unbroken chain back to the sealed record.</Fact>}
      {disclosure.sealed && <Fact>Sealed {fmtDate(record.loggedAt)} — the moment it was logged.</Fact>}

      {disclosure.parents && (
        <Fact ok={parents.length > 0}>
          {parents.length > 0 ? `Parents: ${parents.join('  ×  ')}` : 'No parent cultivars recorded.'}
        </Fact>
      )}
      {disclosure.method && (
        <Fact ok={!!record.breedingMethod}>Breeding method: {record.breedingMethod || 'not recorded'}.</Fact>
      )}
      {disclosure.others && (
        <Fact ok={otherRecords.length > 0}>
          {otherRecords.length > 0
            ? `My other cultivars: ${otherRecords.map((r) => r.strainName).join(', ')}.`
            : 'No other cultivars logged.'}
        </Fact>
      )}
      {disclosure.agreementTerms && (
        <Fact ok={otherAgreements.length > 0}>
          {otherAgreements.length > 0
            ? `My other agreements: ${otherAgreements
                .map((l) => `${AGREEMENT_LABEL[agreementType(l)]} → ${l.terms.licensee || 'unnamed'}`)
                .join('; ')}.`
            : 'No other agreements on file.'}
        </Fact>
      )}

      <Divider sx={{ my: 0.5 }} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <LockIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
        <Typography variant="body2" color="text.disabled">
          {GENETICS_LABEL}
        </Typography>
      </Stack>

      {withheld.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Also sealed and provable on request — deliberately withheld from this recipient: {withheld.join(', ')}.
        </Typography>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        Fingerprint {shortFingerprint(record.recordFingerprint)} · no genetics disclosed.
      </Typography>
    </Stack>
  );
};
