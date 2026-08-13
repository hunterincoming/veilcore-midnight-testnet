// The footer.
//
// Documents are reachable from the landing page and nowhere else, which means anyone
// who has started working has to leave what they are doing to find them. A lab needs
// the integration guide while integrating; counsel follows a record back to the
// evidence note. Both are the wrong moment to go hunting.
//
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Container, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const Item: React.FC<{ to: string; children: React.ReactNode; external?: boolean }> = ({
  to, children, external,
}) => (
  <Link
    {...(external
      ? { href: to, target: '_blank', rel: 'noopener' }
      : { component: RouterLink, to })}
    underline="hover"
    color="text.secondary"
    sx={{ fontSize: 14 }}
  >
    {children}
  </Link>
);

export const AppFooter: React.FC = () => (
  <Box
    component="footer"
    sx={{ borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)', mt: 10, py: 5 }}
  >
    <Container maxWidth="lg">
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 3, md: 6 }}
        sx={{ justifyContent: 'space-between' }}
      >
        <Box sx={{ maxWidth: 320 }}>
          <Typography variant="overline" sx={{ display: 'block', mb: 1 }}>VeilCore</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.7 }}>
            An open record format for genetic material. Verification is free, needs no account,
            and does not depend on us continuing to exist.
          </Typography>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 3, sm: 6 }}>
          <Stack spacing={1}>
            <Typography variant="overline" sx={{ fontSize: 10 }}>Documents</Typography>
            <Item to="/docs/spec">Specification</Item>
            <Item to="/docs/evidence">Records in evidence</Item>
            <Item to="/docs/integrate">Integration guide</Item>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="overline" sx={{ fontSize: 10 }}>Source</Typography>
            <Item to="/implementations">All three implementations</Item>
            <Item to="https://github.com/hunterincoming/veilcore-sdk" external>Reference implementation</Item>
            <Item to="https://github.com/hunterincoming/veilcore-rs" external>Rust implementation</Item>
            <Item to="https://www.npmjs.com/package/veilcore-records" external>veilcore-records</Item>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="overline" sx={{ fontSize: 10 }}>This site</Typography>
            <Item to="/">What this is</Item>
            <Item to="/records">Your records</Item>
            <Item to="/licenses">Agreements</Item>
          </Stack>
        </Stack>
      </Stack>
    </Container>
  </Box>
);
