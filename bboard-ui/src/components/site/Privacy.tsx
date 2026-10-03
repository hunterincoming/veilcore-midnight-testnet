// /privacy — a short privacy note for the demo. It states only what is true of the demo
// today: what the app sends to VeilCore's test registry, what never leaves the browser,
// that it runs on a test network, and how to export and delete.
//
// Kept deliberately narrow. Export from the registry in one download (GET /api/export)
// exists only on a branch of veilcore-api, so the page says it is coming rather than that
// it exists. Change that line in the same release that deploys it.
//
// Retention period for demo data: [to be confirmed]. Until the founders set one, the
// page says only that demo data may be deleted when the test network is reset.
//
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { useI18n } from '../../i18n';
import { SiteShell } from './SiteShell';

const SECTIONS = ['stored', 'local', 'test', 'madeup', 'export', 'delete'] as const;

export const Privacy: React.FC = () => {
  const { t } = useI18n();
  return (
    <SiteShell>
      <header className="wrap page">
        <div className="label">{t('m.privacy.label')}</div>
        <h1>{t('m.privacy.title')}</h1>
        <p>{t('m.privacy.lede')}</p>
      </header>
      <section className="privacy-note">
        <div className="wrap">
          <dl>
            {SECTIONS.map((k) => (
              <div key={k}>
                <dt>{t(`m.privacy.${k}.title`)}</dt>
                <dd>{t(`m.privacy.${k}.text`)}</dd>
              </div>
            ))}
          </dl>
          <p className="privacy-contact">
            <a href="mailto:hunter@veilcore.org">{t('m.privacy.contact')}</a>
          </p>
        </div>
      </section>
    </SiteShell>
  );
};
