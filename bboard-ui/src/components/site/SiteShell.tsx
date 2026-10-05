// The frame of the public pages: navigation, language picker, draft banner, footer.
// Laid out from Mako's 25 September templates. The record app keeps its own layout.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { DraftBanner, LanguagePicker } from '../../i18n/LanguagePicker';
import './site.css';

export const SDK_REPO = 'https://github.com/hunterincoming/veilcore-sdk';
export const X_HANDLE = 'https://x.com/VeilCoreProof';
export const FOUNDERS_MAIL = 'mailto:mako@veilcore.org?cc=hunter@veilcore.org';

/** An in-page section link that works from any public page: on home it scrolls, elsewhere it goes home first. */
const Section: React.FC<{ id: string; className?: string; children: React.ReactNode; onClick?: () => void }> = ({
  id,
  className,
  children,
  onClick,
}) => {
  const onHome = useLocation().pathname === '/';
  return onHome ? (
    <a href={`#${id}`} className={className} onClick={onClick}>
      {children}
    </a>
  ) : (
    <RouterLink to={`/#${id}`} className={className} onClick={onClick}>
      {children}
    </RouterLink>
  );
};

export const SiteShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="vcm">
      <nav className="top" aria-label="Main">
        <div className="nav-in">
          <RouterLink className="brand" to="/">
            <i aria-hidden="true" />
            VeilCore
          </RouterLink>
          <div className="nav-right">
            <button
              type="button"
              className="menu-btn"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen(!open)}
            >
              {t('m.nav.menu')}
            </button>
            <ul className={`nav-links${open ? ' open' : ''}`} id="site-menu">
              <li>
                <Section id="about" onClick={close}>
                  {t('m.nav.about')}
                </Section>
              </li>
              <li>
                <RouterLink to="/founders" onClick={close}>
                  {t('m.nav.team')}
                </RouterLink>
              </li>
              <li>
                <Section id="updates" onClick={close}>
                  {t('m.nav.updates')}
                </Section>
              </li>
              <li>
                <RouterLink to="/docs/spec" onClick={close}>
                  {t('m.nav.spec')}
                </RouterLink>
              </li>
              <li>
                <Section id="demo" className="nav-cta" onClick={close}>
                  {t('m.nav.demo')}
                </Section>
              </li>
            </ul>
            <LanguagePicker />
          </div>
        </div>
      </nav>

      <main>
        <div className="wrap" style={{ paddingTop: 16 }}>
          <DraftBanner />
        </div>
        {children}
      </main>

      <footer className="bottom">
        <div className="wrap">
          <div className="foot">
            <div>
              <RouterLink className="brand" to="/">
                <i aria-hidden="true" />
                VeilCore
              </RouterLink>
              <p style={{ marginTop: 10, maxWidth: '34ch' }}>{t('m.foot.about')}</p>
            </div>
            <div>
              <h4>{t('m.foot.explore')}</h4>
              <ul>
                <li>
                  <Section id="about">{t('m.nav.about')}</Section>
                </li>
                <li>
                  <Section id="demo">{t('m.foot.demo')}</Section>
                </li>
                <li>
                  <RouterLink to="/founders">{t('m.nav.team')}</RouterLink>
                </li>
                <li>
                  <Section id="updates">{t('m.nav.updates')}</Section>
                </li>
              </ul>
            </div>
            <div>
              <h4>{t('m.foot.build')}</h4>
              <ul>
                <li>
                  <RouterLink to="/docs/spec">{t('footer.spec')}</RouterLink>
                </li>
                <li>
                  <RouterLink to="/docs/integrate">{t('footer.integrate')}</RouterLink>
                </li>
                <li>
                  <RouterLink to="/docs/evidence">{t('footer.evidence')}</RouterLink>
                </li>
                <li>
                  <RouterLink to="/implementations">{t('footer.allImplementations')}</RouterLink>
                </li>
                <li>
                  <a href={SDK_REPO} rel="noopener noreferrer" target="_blank">
                    GitHub
                  </a>
                </li>
                <li>
                  <RouterLink to="/verify">{t('m.foot.verify')}</RouterLink>
                </li>
              </ul>
            </div>
            <div>
              <h4>{t('m.foot.contact')}</h4>
              <ul>
                <li>
                  <a href="mailto:mako@veilcore.org">mako@veilcore.org</a>
                </li>
                <li>
                  <a href="mailto:hunter@veilcore.org">hunter@veilcore.org</a>
                </li>
                <li>
                  <a href={X_HANDLE} rel="noopener noreferrer" target="_blank">
                    @VeilCoreProof
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="fine">
            <span>© 2026 VeilCore</span>
            <span>{t('m.foot.fine')}</span>
            <RouterLink to="/privacy">{t('m.foot.privacy')}</RouterLink>
          </div>
        </div>
      </footer>
    </div>
  );
};
