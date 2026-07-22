// LicenseStateChip — the current lifecycle state, shown everywhere a license appears.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Chip } from '@mui/material';
import { effectiveState, STATE_LABEL, type License } from '../../veilcore/licenses';

const COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  sent: 'warning',
  active: 'success',
  expired: 'default',
  revoked: 'error',
};

export const LicenseStateChip: React.FC<{ license: License; size?: 'small' | 'medium' }> = ({ license, size }) => {
  const s = effectiveState(license);
  return (
    <Chip
      size={size ?? 'small'}
      variant={s === 'active' ? 'filled' : 'outlined'}
      color={COLOR[s]}
      label={STATE_LABEL[s]}
    />
  );
};
