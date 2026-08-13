// Finding a record among many.
//
// Two different questions, and they are not the same control. The attention bar answers
// "what needs doing". This answers "where is the one I am looking for" - which for a lab
// with hundreds of intakes is search, and for a breeder with thirty is a sort.
//
// Both appear only when there is enough to warrant them. Offering search over four
// records is offering a solution to a problem nobody has.
//
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, InputAdornment, MenuItem, Stack, TextField } from '@mui/material';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import type { StrainRecord } from '../veilcore/records';

export type SortKey = 'recent' | 'oldest' | 'name' | 'breeder';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Cultivar name' },
  { key: 'breeder', label: 'Bred by' },
];

/**
 * Search across the fields a person actually remembers.
 *
 * Cultivar, breeder, the record identifier, and any internal reference - because a lab
 * looking for a record has their own sample number, not ours.
 */
export const matchesQuery = (r: StrainRecord, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.strainName, r.bredBy, r.id, r.refId, r.breedingMethod]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle));
};

export const sortRecords = (records: StrainRecord[], by: SortKey): StrainRecord[] => {
  const out = [...records];
  const name = (r: StrainRecord) => (r.strainName ?? '').toLowerCase();
  const breeder = (r: StrainRecord) => (r.bredBy ?? '').toLowerCase();
  switch (by) {
    case 'oldest': return out.sort((a, b) => a.loggedAt - b.loggedAt);
    case 'name': return out.sort((a, b) => name(a).localeCompare(name(b)));
    case 'breeder': return out.sort((a, b) => breeder(a).localeCompare(breeder(b)) || name(a).localeCompare(name(b)));
    default: return out.sort((a, b) => b.loggedAt - a.loggedAt);
  }
};

export const RecordFinder: React.FC<{
  query: string;
  onQuery: (q: string) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  showSearch: boolean;
  matched: number;
  total: number;
}> = ({ query, onQuery, sort, onSort, showSearch, matched, total }) => (
  <Box sx={{ mb: 2 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      {showSearch && (
        <TextField
          size="small"
          placeholder="Cultivar, breeder, or your own reference"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          fullWidth
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ),
            },
          }}
        />
      )}
      <TextField
        select size="small" value={sort} onChange={(e) => onSort(e.target.value as SortKey)}
        sx={{ minWidth: 170 }}
      >
        {SORTS.map((s) => <MenuItem key={s.key} value={s.key}>{s.label}</MenuItem>)}
      </TextField>
    </Stack>

    {query.trim() && (
      <Box sx={{ mt: 1, fontSize: 13, color: 'text.secondary' }}>
        {matched === 0
          ? `Nothing matches "${query.trim()}". Search covers the cultivar, who bred it, the record identifier, and your own reference.`
          : `${matched} of ${total}`}
      </Box>
    )}
  </Box>
);
