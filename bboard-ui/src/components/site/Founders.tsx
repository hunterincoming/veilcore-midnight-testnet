// The founders page (/founders), from Mako's 25 September template.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import type { StringKey } from '../../i18n/en';
import { FOUNDERS_MAIL, SiteShell, X_HANDLE } from './SiteShell';

type Founder = {
  name: string;
  initials: string;
  photo: string;
  role: StringKey;
  bio1: StringKey;
  bio2: StringKey;
  leads: StringKey;
  also: StringKey;
  languages?: StringKey;
  links: { href: string; label: string }[];
};

const FOUNDERS: Founder[] = [
  {
    name: 'Mako Steiner',
    initials: 'MS',
    photo: '/team/mako.jpg',
    role: 'm.mako.role',
    bio1: 'm.mako.bio1',
    bio2: 'm.mako.bio2',
    leads: 'm.mako.leads',
    also: 'm.mako.also',
    languages: 'm.mako.languages',
    links: [
      { href: 'https://www.linkedin.com/in/makoto-steiner-3a6381182', label: 'LinkedIn' },
      { href: 'https://x.com/wasabimako', label: '@wasabimako' },
      { href: 'mailto:mako@veilcore.org', label: 'mako@veilcore.org' },
    ],
  },
  {
    name: 'Hunter Roberts',
    initials: 'HR',
    photo: '/team/hunter.jpg',
    role: 'm.hunter.role',
    bio1: 'm.hunter.bio1',
    bio2: 'm.hunter.bio2',
    leads: 'm.hunter.leads',
    also: 'm.hunter.also',
    links: [
      { href: 'https://www.linkedin.com/in/hunter-roberts-067016203', label: 'LinkedIn' },
      { href: 'https://x.com/hunterincoming', label: '@hunterincoming' },
      { href: 'https://github.com/hunterincoming', label: 'GitHub' },
      { href: 'mailto:hunter@veilcore.org', label: 'hunter@veilcore.org' },
    ],
  },
];

export const Founders: React.FC = () => {
  const { t } = useI18n();
  return (
    <SiteShell>
      <header className="wrap page">
        <div className="label">{t('m.founders.label')}</div>
        <h1>
          {t('m.team.title1')} <em>{t('m.team.title2')}</em>
        </h1>
        <p>{t('m.founders.lede')}</p>
      </header>

      <div className="wrap grid" aria-label={t('m.founders.label')}>
        {FOUNDERS.map((f) => (
          <article className="founder" key={f.name}>
            <div className="photo">
              <span aria-hidden="true">{f.initials}</span>
              <img
                src={f.photo}
                alt={t('m.portraitOf', { name: f.name })}
                loading="lazy"
                onError={(e) => e.currentTarget.remove()}
              />
            </div>
            <div className="fbody">
              <h2>{f.name}</h2>
              <p className="role">{t(f.role)}</p>
              <p className="bio first">{t(f.bio1)}</p>
              <p className="bio">{t(f.bio2)}</p>
              <dl className="meta">
                <div>
                  <dt>{t('m.founders.leads')}</dt>
                  <dd>
                    <ul className="tags">
                      {t(f.leads)
                        .split('|')
                        .map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>{t('m.founders.also')}</dt>
                  <dd>{t(f.also)}</dd>
                </div>
                {f.languages && (
                  <div>
                    <dt>{t('m.founders.languages')}</dt>
                    <dd>{t(f.languages)}</dd>
                  </div>
                )}
              </dl>
              <ul className="links" aria-label={f.name}>
                {f.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      rel="me noopener noreferrer"
                      target={l.href.startsWith('mailto:') ? undefined : '_blank'}
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <section className="band" aria-labelledby="founders-contact">
        <div className="wrap">
          <div className="label">{t('m.contact.label')}</div>
          <h2 id="founders-contact">
            {t('m.founders.band1')} <em>{t('m.founders.band2')}</em> {t('m.founders.band3')}
          </h2>
          <p>{t('m.founders.bandText')}</p>
          <div className="contact">
            <a className="btn solid" href={FOUNDERS_MAIL}>
              {t('m.founders.emailBoth')}
            </a>
            <RouterLink className="btn" to="/docs/spec">
              {t('m.contact.spec')}
            </RouterLink>
            <a className="btn" href={X_HANDLE} rel="noopener noreferrer" target="_blank">
              @VeilCoreProof
            </a>
          </div>
        </div>
      </section>
    </SiteShell>
  );
};

/** /verify with no identifier: ask for one, then open /verify/:id. */
export const VerifyLookup: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [id, setId] = React.useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const v = id.trim();
    if (v) void navigate(`/verify/${encodeURIComponent(v)}`);
  };
  return (
    <SiteShell>
      <header className="wrap page">
        <div className="label">{t('m.verify.label')}</div>
        <h1>{t('m.verify.title')}</h1>
        <p>{t('m.verify.lede')}</p>
        <p className="verify-what">
          {t('m.verify.what')} <RouterLink to="/">{t('m.verify.home')}</RouterLink>
        </p>
        <form className="lookup" onSubmit={go}>
          <div className="field">
            <label htmlFor="vid">{t('m.verify.field')}</label>
            <input id="vid" value={id} autoComplete="off" spellCheck={false} onChange={(e) => setId(e.target.value)} />
          </div>
          <button type="submit" className="btn solid">
            {t('m.verify.go')}
          </button>
        </form>
      </header>
    </SiteShell>
  );
};
