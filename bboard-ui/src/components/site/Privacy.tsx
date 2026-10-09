// /privacy — a short privacy note for the demo. It states only what is true of the demo
// today: what the app sends to VeilCore's registry, what never leaves the browser, which
// network records are dated on (a test network, or the main network in a mainnet build:
// i18n/en-mainnet.ts), and how to export and delete.
//
// Kept deliberately narrow. Export from the registry in one download (GET /api/export)
// exists only on a branch of veilcore-api, so the page says it is coming rather than that
// it exists. Change that line in the same release that deploys it.
//
// Retention: the founders have set no period, so the page says what happens: the
// registry keeps what it holds until a holder asks for it to be deleted (and, on a test
// network build, that demo data may go when the test network is reset). It also names the
// hosts (Vercel for the site, Railway for the registry), what the browser stores locally
// (veilcore.holder.v1, veilcore.attester.v1, veilcore.role.v1, veilcore.lang) and who
// runs it (VeilCore is not incorporated yet).
//
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { useI18n } from '../../i18n';
import { SiteShell } from './SiteShell';

const SECTIONS = ['stored', 'local', 'browser', 'hosts', 'test', 'madeup', 'export', 'delete', 'who'] as const;

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
