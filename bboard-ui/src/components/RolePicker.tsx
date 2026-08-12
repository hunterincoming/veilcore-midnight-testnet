// Asked once, on first use.
//
// Without this the app has to guess from record fields, which is how a lab ended up
// being told to send its own sample to a lab. One question removes the guesswork and
// halves what most people ever see.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { getRole, setRole, ROLE_COPY, type Role } from '../veilcore/role';
import { TEAL } from '../config/theme';

export const RolePicker: React.FC<{ onChosen?: () => void }> = ({ onChosen }) => {
  const [open, setOpen] = useState(getRole() === null);

  const choose = (r: Role) => {
    setRole(r);
    setOpen(false);
    onChosen?.();
  };

  return (
    <Dialog open={open} maxWidth="xs" fullWidth>
      <DialogTitle>Which of these is you?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This only decides what we put in front of you. You can change it any time, and it does not
          restrict anything — what you can prove is decided by keys, not by this answer.
        </Typography>
        <Stack spacing={1.5} sx={{ pb: 1 }}>
          {(['breeder', 'lab', 'both'] as Role[]).map((r) => (
            <Box
              key={r}
              onClick={() => choose(r)}
              sx={{
                p: 2, borderRadius: 1, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.12)',
                '&:hover': { borderColor: TEAL },
              }}
            >
              <Typography variant="subtitle1">{ROLE_COPY[r].label}</Typography>
              <Typography variant="caption" color="text.secondary">{ROLE_COPY[r].blurb}</Typography>
            </Box>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
