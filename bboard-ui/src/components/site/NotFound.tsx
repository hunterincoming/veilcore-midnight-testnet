// Any address the site has no page for. Before this, an unknown path rendered an empty
// page. The site is served as a single-page app, so the server still answers 200; the page
// says plainly that nothing is here and asks search engines not to index it.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { SiteShell } from './SiteShell';

export const NotFound: React.FC = () => {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${t('m.notfound.title')} · VeilCore`;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [t]);
  return (
    <SiteShell>
      <header className="wrap page">
        <div className="label">404</div>
        <h1>{t('m.notfound.title')}</h1>
        <p>{t('m.notfound.text')}</p>
        <p className="verify-what">
          <RouterLink to="/">{t('m.notfound.home')}</RouterLink>
          {' · '}
          <RouterLink to="/verify">{t('m.foot.verify')}</RouterLink>
        </p>
      </header>
    </SiteShell>
  );
};
