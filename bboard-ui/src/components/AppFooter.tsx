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
import { useI18n } from '../i18n';
import { requestRoleChange, useRole, ROLE_VIEW } from '../veilcore/role';

const Item: React.FC<{ to: string; children: React.ReactNode; external?: boolean }> = ({ to, children, external }) => (
  <Link
    {...(external ? { href: to, target: '_blank', rel: 'noopener' } : { component: RouterLink, to })}
    underline="hover"
    color="text.secondary"
    // Phones: each link a full finger-sized row. Desktop keeps the compact list.
    sx={{ fontSize: { xs: 15, sm: 14 }, py: { xs: 1.25, sm: 0 }, display: { xs: 'block', sm: 'inline' } }}
  >
    {children}
  </Link>
);

export const AppFooter: React.FC = () => {
  const { t } = useI18n();
  const role = useRole();
  return (
    <Box
      component="footer"
      sx={{
        borderTop: '1px solid',
        borderColor: 'rgba(255,255,255,0.07)',
        mt: { xs: 6, sm: 10 },
        py: { xs: 4, sm: 5 },
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={{ xs: 3, md: 6 }}
          sx={{ justifyContent: 'space-between' }}
        >
          <Box sx={{ maxWidth: 320 }}>
            <Typography variant="overline" sx={{ display: 'block', mb: 1 }}>
              VeilCore
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.7, fontSize: { xs: 14, sm: 12 } }}>
              {t('footer.about')}
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 3, sm: 6 }}>
            <Stack spacing={{ xs: 0, sm: 1 }}>
              <Typography variant="overline" sx={{ fontSize: { xs: 13, sm: 10 } }}>
                {t('footer.documents')}
              </Typography>
              <Item to="/docs/spec">{t('footer.spec')}</Item>
              <Item to="/docs/evidence">{t('footer.evidence')}</Item>
              <Item to="/docs/integrate">{t('footer.integrate')}</Item>
            </Stack>

            <Stack spacing={{ xs: 0, sm: 1 }}>
              <Typography variant="overline" sx={{ fontSize: { xs: 13, sm: 10 } }}>
                {t('footer.source')}
              </Typography>
              <Item to="/implementations">{t('footer.allImplementations')}</Item>
              <Item to="https://github.com/hunterincoming/veilcore-sdk" external>
                {t('footer.referenceImplementation')}
              </Item>
              <Item to="https://github.com/hunterincoming/veilcore-rs" external>
                {t('footer.rustImplementation')}
              </Item>
            </Stack>

            <Stack spacing={{ xs: 0, sm: 1 }}>
              <Typography variant="overline" sx={{ fontSize: { xs: 13, sm: 10 } }}>
                {t('footer.thisSite')}
              </Typography>
              <Item to="/">{t('footer.whatThisIs')}</Item>
              <Item to="/records">{t('footer.yourRecords')}</Item>
              <Item to="/licenses">{t('footer.agreements')}</Item>
              <Item to="/privacy">{t('footer.privacy')}</Item>
              <Link
                component="button"
                type="button"
                onClick={requestRoleChange}
                underline="hover"
                color="text.secondary"
                sx={{
                  fontSize: { xs: 15, sm: 14 },
                  py: { xs: 1.25, sm: 0 },
                  display: { xs: 'block', sm: 'inline' },
                  textAlign: 'left',
                }}
              >
                {role ? `${ROLE_VIEW[role]} · change` : 'Breeder or lab? Choose your view'}
              </Link>
            </Stack>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
};
