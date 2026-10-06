// The certificate's "on-chain identity" line, shown once the record is anchored from
// this browser (real-chain builds only; real-chain/slots.mjs puts it on the certificate).
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box } from '@mui/material';
import { useRecordKeys } from '../../veilcore/record-keys';
import { shortFingerprint } from '../../veilcore/commitment';

export const CertificateChainField: React.FC<{
  recordId: string;
  Field: React.FC<{ label: string; children: React.ReactNode }>;
}> = ({ recordId, Field }) => {
  const anchored = useRecordKeys()[recordId]?.anchor;
  if (!anchored) return null;
  return (
    <Field label="On-chain identity (test network)">
      <Box component="span" sx={{ wordBreak: 'break-all' }}>
        {shortFingerprint(anchored.identity)} · block {anchored.blockHeight}
      </Box>
    </Field>
  );
};
