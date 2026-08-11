// What needs attention, as a filter rather than a restructure.
//
// The list stays one list. This narrows it. Sections and accordions make a small set
// harder to scan and force the reader to learn a layout before they can read anything —
// so this only appears when there is genuinely too much to take in at a glance.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Chip, Stack, Typography } from '@mui/material';
import type { AttentionState } from '../veilcore/attention';

const COLOR: Partial<Record<AttentionState, 'warning' | 'default' | 'primary'>> = {
  blocked: 'warning',
  'needs-dna': 'default',
  'needs-attester': 'default',
  'in-transit': 'primary',
};

export const AttentionBar: React.FC<{
  summary: { state: AttentionState; label: string; count: number }[];
  active: AttentionState | null;
  onSelect: (s: AttentionState | null) => void;
  total: number;
}> = ({ summary, active, onSelect, total }) => {
  if (summary.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Nothing needs attention.
      </Typography>
    );
  }

  return (
    <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
      <Chip
        size="small"
        label={`All ${total}`}
        onClick={() => onSelect(null)}
        variant={active === null ? 'filled' : 'outlined'}
        color={active === null ? 'primary' : 'default'}
      />
      {summary.map((s) => (
        <Chip
          key={s.state}
          size="small"
          label={`${s.label} · ${s.count}`}
          onClick={() => onSelect(active === s.state ? null : s.state)}
          variant={active === s.state ? 'filled' : 'outlined'}
          color={active === s.state ? 'primary' : COLOR[s.state] ?? 'default'}
        />
      ))}
    </Stack>
  );
};
