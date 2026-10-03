// The home page, laid out from Mako's 25 September template: hero with the live
// fingerprint, where-to-go tiles, about, demos, team, updates, status, contact.
//
// The fingerprint in the hero is a real record commitment (veilcore-records), not a
// stand-in hash: what a visitor sees change is what the format publishes.
//
// Content rules (Mako's): "prior possession", never "ownership"; no customer, pilot or
// partner claims; the status tiles stay honest and current.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { computeCommitment, newNonce } from 'veilcore-records';
import { useI18n } from '../../i18n';
import { FOUNDERS_MAIL, SDK_REPO, SiteShell, X_HANDLE } from './SiteShell';

const TESTNET_REPO = 'https://github.com/hunterincoming/veilcore-midnight-testnet';

const Fingerprint: React.FC = () => {
  const { t } = useI18n();
  const [cultivar, setCultivar] = useState('Harbour Mist');
  const [bredBy, setBredBy] = useState(() => t('m.hero.bredByDefault'));
  const [hash, setHash] = useState('');
  const prev = useRef('');
  const [nonce] = useState(() => newNonce());

  useEffect(() => {
    let live = true;
    void computeCommitment({
      formatVersion: '0.1',
      recordId: 'demo',
      subjectType: 'plant-genetic-material',
      profile: 'veilcore/profile/cannabis/v0.1',
      commitment: '',
      commitmentAlgorithm: 'sha256/canonical-json/v1',
      anchor: { chain: 'midnight', network: 'undeployed' },
      sealedAt: '2026-01-01T00:00:00Z',
      holder: { id: 'demo' },
      parents: [],
      attestations: [],
      profileData: { cultivarName: cultivar, breederName: bredBy, nonce },
    } as never).then((h) => {
      if (!live) return;
      setHash((old) => {
        prev.current = old;
        return h;
      });
    });
    return () => {
      live = false;
    };
  }, [cultivar, bredBy, nonce]);

  return (
    <div className="hash-demo" aria-label={t('m.hero.demoLabel')}>
      <div className="fields">
        <div className="field">
          <label htmlFor="cv">{t('m.hero.cultivar')}</label>
          <input id="cv" value={cultivar} autoComplete="off" onChange={(e) => setCultivar(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="by">{t('m.hero.bredBy')}</label>
          <input id="by" value={bredBy} autoComplete="off" onChange={(e) => setBredBy(e.target.value)} />
        </div>
      </div>
      <div className="arrow" aria-hidden="true" />
      <div className="digest" aria-live="polite">
        {hash
          ? [...hash].map((c, i) =>
              prev.current && prev.current[i] !== c ? (
                <span key={i} className="chg">
                  {c}
                </span>
              ) : (
                <React.Fragment key={i}>{c}</React.Fragment>
              ),
            )
          : '—'}
      </div>
      <p className="note">{t('m.hero.note')}</p>
    </div>
  );
};

const Icon: React.FC<{ d: React.ReactNode }> = ({ d }) => (
  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);

const Tile: React.FC<{ href: string; n: string; icon: React.ReactNode; title: string; text: string; go: string }> = ({
  href,
  n,
  icon,
  title,
  text,
  go,
}) => (
  <a className="tile" href={href}>
    <Icon d={icon} />
    <span className="n">{n}</span>
    <h3>{title}</h3>
    <p>{text}</p>
    <span className="go">{go}</span>
  </a>
);

const Post: React.FC<{
  href: string;
  date: string;
  iso: string;
  tag: string;
  title: string;
  text: string;
  go: string;
}> = (p) => (
  <a className="post" href={p.href} rel="noopener noreferrer" target="_blank">
    <span>
      <time dateTime={p.iso}>{p.date}</time>
      <span className="tag">{p.tag}</span>
    </span>
    <h3>{p.title}</h3>
    <p>{p.text}</p>
    <span className="go">{p.go}</span>
  </a>
);

export const Home: React.FC = () => {
  const { t, lang } = useI18n();
  const { hash } = useLocation();
  const [showVideo, setShowVideo] = useState(false);

  // Arriving from another page at /#section: the router does not scroll to it.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <SiteShell>
      <header className={`wrap hero${lang === 'ja' ? ' cjk' : ''}`} id="top">
        <div className="label">{t('m.hero.label')}</div>
        <h1>
          {t('m.hero.title1')} <em>{t('m.hero.title2')}</em>
        </h1>
        <p className="lede">{t('m.hero.lede')}</p>
        <div className="hero-actions">
          <a className="btn solid" href="#demo">
            {t('m.hero.chooseDemo')}
          </a>
          <a className="btn" href="#about">
            {t('m.hero.how')}
          </a>
        </div>
        <Fingerprint key={lang} />
      </header>

      <section id="choose">
        <div className="wrap">
          <div className="label">{t('m.choose.label')}</div>
          <h2>{t('m.choose.title')}</h2>
          <div className="choose">
            <Tile
              href="#about"
              n="01"
              icon={
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6M12 7.5v.5" />
                </>
              }
              title={t('m.choose.about.title')}
              text={t('m.choose.about.text')}
              go={t('m.choose.about.go')}
            />
            <Tile
              href="#demo"
              n="02"
              icon={<path d="M8 5l11 7-11 7z" />}
              title={t('m.choose.demo.title')}
              text={t('m.choose.demo.text')}
              go={t('m.choose.demo.go')}
            />
            <Tile
              href="#team"
              n="03"
              icon={
                <>
                  <circle cx="9" cy="8" r="3.2" />
                  <circle cx="17" cy="9" r="2.6" />
                  <path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5M15 14.5c2.6-.3 4.6 1.2 5.2 4" />
                </>
              }
              title={t('m.choose.team.title')}
              text={t('m.choose.team.text')}
              go={t('m.choose.team.go')}
            />
            <Tile
              href="#updates"
              n="04"
              icon={
                <>
                  <path d="M5 4h10l4 4v12H5z" />
                  <path d="M8 11h8M8 15h8M8 7h4" />
                </>
              }
              title={t('m.choose.updates.title')}
              text={t('m.choose.updates.text')}
              go={t('m.choose.updates.go')}
            />
          </div>
        </div>
      </section>

      <section id="about">
        <div className="wrap">
          <div className="label">{t('m.about.label')}</div>
          <h2>
            {t('m.about.title1')} <em>{t('m.about.title2')}</em>
          </h2>
          <p className="lede">{t('m.about.lede')}</p>
          <div className="steps">
            {(['1', '2', '3', '4'] as const).map((n) => (
              <div className="step" key={n}>
                <span className="n">{t(`m.step${n}.n`)}</span>
                <h3>{t(`m.step${n}.title`)}</h3>
                <p>{t(`m.step${n}.text`)}</p>
              </div>
            ))}
          </div>
          <div className="isnt">
            <div className="y">
              <h4>{t('m.is.title')}</h4>
              <ul>
                {(['1', '2', '3', '4', '5'] as const).map((n) => (
                  <li key={n}>
                    <strong>{t(`m.is.${n}a`)}</strong> {t(`m.is.${n}b`)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="no">
              <h4>{t('m.isnt.title')}</h4>
              <ul>
                {(['1', '2', '3', '4'] as const).map((n) => (
                  <li key={n}>
                    <strong>{t(`m.isnt.${n}a`)}</strong> {t(`m.isnt.${n}b`)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="demo">
        <div className="wrap">
          <div className="label">{t('m.demo.label')}</div>
          <h2>
            {t('m.demo.title1')} <em>{t('m.demo.title2')}</em>
          </h2>
          <p className="lede">{t('m.demo.lede')}</p>
          <div className="demos">
            <RouterLink className="demo" to="/new">
              <span className="ic">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 4h10l4 4v12H5z" />
                  <path d="M9 13l2 2 4-4" />
                </svg>
              </span>
              <h3>{t('m.demo.create.title')}</h3>
              <p>{t('m.demo.create.text')}</p>
              <div className="meta-row">
                <span className="chip live">{t('m.chip.interactive')}</span>
                <span className="chip">{t('m.chip.3min')}</span>
              </div>
            </RouterLink>
            <RouterLink className="demo" to="/verify">
              <span className="ic">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M16 16l4.5 4.5" />
                </svg>
              </span>
              <h3>{t('m.demo.verify.title')}</h3>
              <p>{t('m.demo.verify.text')}</p>
              <div className="meta-row">
                <span className="chip live">{t('m.chip.interactive')}</span>
                <span className="chip">{t('m.chip.1min')}</span>
              </div>
            </RouterLink>
            <button
              type="button"
              className="demo"
              aria-expanded={showVideo}
              aria-controls="walkthrough"
              onClick={() => setShowVideo(!showVideo)}
            >
              <span className="ic">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M10 9.5l5 2.5-5 2.5z" />
                </svg>
              </span>
              <h3>{t('m.demo.video.title')}</h3>
              <p>{t('m.demo.video.text')}</p>
              <div className="meta-row">
                <span className="chip">{t('m.chip.video')}</span>
                <span className="chip">{t('m.chip.75s')}</span>
              </div>
            </button>
          </div>
          {showVideo && (
            <div className="walkthrough" id="walkthrough">
              <video
                src="/media/veilcore-walkthrough.mp4"
                poster="/media/veilcore-walkthrough.jpg"
                controls
                autoPlay
                playsInline
                preload="metadata"
                aria-label={t('m.demo.video.title')}
              />
            </div>
          )}
        </div>
      </section>

      <section id="team">
        <div className="wrap">
          <div className="label">{t('m.team.label')}</div>
          <h2>
            {t('m.team.title1')} <em>{t('m.team.title2')}</em>
          </h2>
          <div className="team">
            {(
              [
                ['Mako Steiner', 'MS', '/team/mako.jpg', 'm.mako.role', 'm.mako.short'],
                ['Hunter Roberts', 'HR', '/team/hunter.jpg', 'm.hunter.role', 'm.hunter.short'],
              ] as const
            ).map(([name, initials, photo, role, short]) => (
              <RouterLink className="person" to="/founders" key={name}>
                <span className="avatar">
                  {initials}
                  <img src={photo} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />
                </span>
                <span>
                  <h3>{name}</h3>
                  <span className="role">{t(role)}</span>
                  <p>{t(short)}</p>
                </span>
              </RouterLink>
            ))}
          </div>
          <RouterLink className="more" to="/founders">
            {t('m.team.more')}
          </RouterLink>
        </div>
      </section>

      <section id="updates">
        <div className="wrap">
          <div className="label">{t('m.updates.label')}</div>
          <h2>
            {t('m.updates.title1')} <em>{t('m.updates.title2')}</em>
          </h2>
          <div className="posts">
            <Post
              href={`${TESTNET_REPO}/blob/main/docs/self-audit-3oct.md`}
              iso="2026-10-03"
              date={t('m.post1.date')}
              tag={t('m.post1.tag')}
              title={t('m.post1.title')}
              text={t('m.post1.text')}
              go={t('m.updates.read')}
            />
            <Post
              href={`${TESTNET_REPO}/blob/main/docs/preprod-run-2oct.md`}
              iso="2026-10-02"
              date={t('m.post2.date')}
              tag={t('m.post2.tag')}
              title={t('m.post2.title')}
              text={t('m.post2.text')}
              go={t('m.updates.read')}
            />
            <Post
              href="https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/deployments/veilcore.md#revision--2425-august-2026"
              iso="2026-08-25"
              date={t('m.post3.date')}
              tag={t('m.post3.tag')}
              title={t('m.post3.title')}
              text={t('m.post3.text')}
              go={t('m.updates.read')}
            />
          </div>
          <div className="subscribe">
            <a className="more" href={`${SDK_REPO}/commits/main`} rel="noopener noreferrer" target="_blank">
              {t('m.updates.all')}
            </a>
            <span>·</span>
            <span>
              {t('m.updates.follow')}{' '}
              <a href={X_HANDLE} rel="noopener noreferrer" target="_blank" style={{ color: 'var(--mint)' }}>
                @VeilCoreProof
              </a>
            </span>
          </div>
        </div>
      </section>

      <section id="status">
        <div className="wrap">
          <div className="label">{t('m.status.label')}</div>
          <h2>
            {t('m.status.title1')} <em>{t('m.status.title2')}</em>
          </h2>
          <p className="lede">{t('m.status.lede')}</p>
          <div className="status">
            <div className="stat ok">
              <b>{t('m.stat1.b')}</b>
              <span>{t('m.stat1.s')}</span>
            </div>
            <div className="stat">
              <b>{t('m.stat2.b')}</b>
              <span>{t('m.stat2.s')}</span>
            </div>
            <div className="stat no">
              <b>{t('m.stat3.b')}</b>
              <span>{t('m.stat3.s')}</span>
            </div>
            <div className="stat no">
              <b>{t('m.stat4.b')}</b>
              <span>{t('m.stat4.s')}</span>
            </div>
          </div>
        </div>
      </section>

      <section id="contact">
        <div className="wrap">
          <div className="label">{t('m.contact.label')}</div>
          <h2>
            {t('m.contact.title1')} <em>{t('m.contact.title2')}</em>
          </h2>
          <p className="lede">{t('m.contact.lede')}</p>
          <div className="contact">
            <a className="btn solid" href={FOUNDERS_MAIL}>
              {t('m.contact.email')}
            </a>
            <RouterLink className="btn" to="/docs/spec">
              {t('m.contact.spec')}
            </RouterLink>
            <a className="btn" href={SDK_REPO} rel="noopener noreferrer" target="_blank">
              GitHub
            </a>
          </div>
        </div>
      </section>
    </SiteShell>
  );
};
