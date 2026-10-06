// Asked once, on first use, and again whenever someone asks to change it (the link in
// the app footer).
//
// Without this the app has to guess from record fields, which is how a lab ended up
// being told to send its own sample to a lab. One question removes the guesswork and
// halves what most people ever see. A lab is taken to its own first screen (the records
// page shows a lab's actions, not "seal your first record").
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { ButtonBase, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { getRole, setRole, ROLE_COPY, CHANGE_ROLE_EVENT, isLab, isBreeder, type Role } from '../veilcore/role';
import { TEAL } from '../config/theme';

/** `ask`: open on its own when no role is set (app pages). Elsewhere it opens only when asked to. */
export const RolePicker: React.FC<{ ask: boolean }> = ({ ask }) => {
  const [open, setOpen] = useState(ask && getRole() === null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = getRole();

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(CHANGE_ROLE_EVENT, reopen);
    return () => window.removeEventListener(CHANGE_ROLE_EVENT, reopen);
  }, []);

  const choose = (r: Role) => {
    setRole(r);
    setOpen(false);
    // A lab arriving at the record wizard would be asked to seal a cultivar; its own
    // first screen is the records page, which shows receiving and signing.
    if (isLab(r) && !isBreeder(r) && pathname === '/new') void navigate('/records');
  };

  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      // Closable only once there is an answer to fall back on.
      onClose={current ? () => setOpen(false) : undefined}
      aria-labelledby="role-title"
    >
      <DialogTitle id="role-title">Which describes you?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This only changes what we show you first. It doesn&apos;t limit what you can do, and you can change it at the
          bottom of any page.
        </Typography>
        <Stack spacing={1.5} sx={{ pb: 1 }}>
          {(['breeder', 'lab', 'both'] as Role[]).map((r) => (
            <ButtonBase
              key={r}
              onClick={() => choose(r)}
              focusRipple
              sx={{
                display: 'block',
                textAlign: 'left',
                width: '100%',
                p: 2,
                borderRadius: 1,
                border: '1px solid',
                borderColor: r === current ? TEAL : 'rgba(255,255,255,0.12)',
                '&:hover, &.Mui-focusVisible': { borderColor: TEAL },
              }}
            >
              <Typography variant="subtitle1" component="span" sx={{ display: 'block' }}>
                {ROLE_COPY[r].label}
              </Typography>
              <Typography variant="caption" component="span" color="text.secondary" sx={{ display: 'block' }}>
                {ROLE_COPY[r].blurb}
              </Typography>
            </ButtonBase>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
