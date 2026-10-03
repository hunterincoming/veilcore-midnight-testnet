// The page a stranger lands on.
//
// Structure here is not decoration. A record accumulates: it is sealed, it moves, a
// second party confirms it, terms attach to it. That is a chain of custody, so the page
// is built on a single spine with each stage attaching to it in order. The visual
// structure and the subject are the same shape.
//
// The hero shows the collapse rather than describing it: what you type visibly reduces
// to thirty-two bytes. The privacy claim is easier to feel than to read.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Box, Button, Container, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { computeCommitment, newNonce } from 'veilcore-records';
import { TEAL, TEAL_DIM } from '../config/theme';
import { useI18n } from '../i18n';
import { DraftBanner, LanguagePicker } from '../i18n/LanguagePicker';

const MONO = '"SFMono-Regular", ui-monospace, Menlo, monospace';

/* ---------------------------------------------------------------- hero ---- */

const Hero: React.FC = () => {
  const { t, lang } = useI18n();
  // Japanese has no spaces to break at: a smaller size and balanced lines keep a
  // headline from splitting mid-word.
  const cjk = lang === 'ja';
  const [name, setName] = useState('Harbour Mist');
  const [bred, setBred] = useState(() => t('hero.bredByDefault'));
  const [hash, setHash] = useState('');
  const [settling, setSettling] = useState(false);
  const [nonce] = useState(() => newNonce());

  useEffect(() => {
    let live = true;
    setSettling(true);
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
      profileData: { cultivarName: name, breederName: bred, nonce },
    } as never).then((h) => {
      if (!live) return;
      setHash(h);
      setTimeout(() => live && setSettling(false), 260);
    });
    return () => {
      live = false;
    };
  }, [name, bred, nonce]);

  return (
    <Box sx={{ pt: { xs: 7, md: 12 }, pb: { xs: 6, md: 10 } }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 2.5 }}>
        {t('hero.overline')}
      </Typography>

      <Typography
        variant="h1"
        sx={{
          fontSize: cjk ? { xs: 32, sm: 44, md: 56 } : { xs: 40, sm: 56, md: 72 },
          lineHeight: cjk ? 1.25 : 1.0,
          mb: 3.5,
          maxWidth: 900,
          textWrap: 'balance',
          ...(cjk ? { lineBreak: 'strict' } : {}),
        }}
      >
        {t('hero.title1')}
        <br />
        <Box component="span" sx={{ color: TEAL }}>
          {t('hero.title2')}
        </Box>
      </Typography>

      <Typography variant="h6" sx={{ color: 'text.secondary', maxWidth: 560, mb: 6, fontWeight: 400, lineHeight: 1.6 }}>
        {t('hero.lead')}
      </Typography>

      <Box sx={{ maxWidth: 700 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label={t('hero.cultivar')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label={t('hero.bredBy')}
            value={bred}
            onChange={(e) => setBred(e.target.value)}
            size="small"
            fullWidth
          />
        </Stack>

        {/* The collapse. Everything above reduces to the line below. */}
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2.5 }}>
          <Box sx={{ width: '1px', height: 34, background: `linear-gradient(180deg, ${TEAL}00, ${TEAL}88)` }} />
        </Box>

        <Box
          sx={{
            fontFamily: MONO,
            fontSize: { xs: 11.5, sm: 14 },
            lineHeight: 1.9,
            wordBreak: 'break-all',
            color: TEAL,
            minHeight: 54,
            opacity: settling ? 0.35 : 1,
            transition: 'opacity 260ms ease',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none', opacity: 1 },
          }}
        >
          {hash}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, maxWidth: 560 }}>
          {t('hero.caption')}
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mt: 5, flexWrap: 'wrap', gap: 2 }}>
        <Button variant="contained" size="large" component={RouterLink} to="/docs/spec">
          {t('hero.readSpec')}
        </Button>
        <Button variant="outlined" size="large" component={RouterLink} to="/new">
          {t('hero.tryReference')}
        </Button>
      </Stack>
    </Box>
  );
};

/* --------------------------------------------------------------- spine ---- */

/**
 * A stage in a record's life.
 *
 * No connecting line and no numbered bubbles. Those are the decoration that appears on
 * every landing page regardless of what it is selling, and they were doing nothing here
 * that the reading order did not already do. What remains is the sequence stated in
 * words, which is how a person would actually explain it.
 */
const Stage: React.FC<{
  head: string;
  body: string;
  limit: string;
}> = ({ head, body, limit }) => (
  <Box
    sx={{
      py: { xs: 4, md: 5 },
      maxWidth: 680,
      borderTop: '1px solid',
      borderColor: 'rgba(255,255,255,0.07)',
      '&:first-of-type': { borderTop: 'none', pt: { xs: 1, md: 1.5 } },
    }}
  >
    <Typography variant="h5" sx={{ mb: 1.75, fontSize: { xs: 21, md: 25 }, letterSpacing: '-0.01em' }}>
      {head}
    </Typography>
    <Typography variant="body1" color="text.secondary" sx={{ mb: 2, lineHeight: 1.8, fontSize: 16 }}>
      {body}
    </Typography>
    <Typography variant="body2" sx={{ color: TEAL_DIM, lineHeight: 1.7, fontSize: 14.5 }}>
      {limit}
    </Typography>
  </Box>
);

const Rule: React.FC<{ eyebrow: string; title?: string }> = ({ eyebrow, title }) => (
  <Box
    sx={{ pt: { xs: 8, md: 12 }, pb: title ? 4.5 : 0, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}
  >
    <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: title ? 1.5 : 0 }}>
      {eyebrow}
    </Typography>
    {title && (
      <Typography
        variant="h3"
        sx={{ fontSize: { xs: 28, md: 38 }, maxWidth: 780, lineHeight: 1.15, letterSpacing: '-0.02em' }}
      >
        {title}
      </Typography>
    )}
  </Box>
);

const Audience: React.FC<{ who: string; line: string; to: string; label: string }> = ({ who, line, to, label }) => (
  <Box sx={{ py: 3.5, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 4 }} sx={{ alignItems: { md: 'baseline' } }}>
      <Typography variant="subtitle1" sx={{ minWidth: { md: 210 } }}>
        {who}
      </Typography>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 560, lineHeight: 1.7 }}>
          {line}
        </Typography>
        <Button size="small" variant="outlined" component={RouterLink} to={to}>
          {label}
        </Button>
      </Box>
    </Stack>
  </Box>
);

const Person: React.FC<{ name: string; role: string; bio: string; photo: string; extra?: string }> = ({
  name,
  role,
  bio,
  photo,
  extra,
}) => {
  const { t } = useI18n();
  return (
    <Box sx={{ py: 3.5, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 1, md: 4 }}
        sx={{ alignItems: { md: 'flex-start' } }}
      >
        <Box sx={{ minWidth: { md: 210 } }}>
          <Box
            component="img"
            src={photo}
            alt={t('team.portraitOf', { name })}
            width={112}
            height={112}
            loading="lazy"
            sx={{
              display: 'block',
              width: 112,
              height: 112,
              objectFit: 'cover',
              borderRadius: 2,
              border: '1px solid rgba(255,255,255,0.08)',
              mb: 1.5,
              filter: 'grayscale(1)',
              transition: 'filter .4s ease',
              '&:hover': { filter: 'none' },
            }}
          />
          <Typography variant="subtitle1">{name}</Typography>
          <Typography variant="body2" sx={{ color: TEAL_DIM }}>
            {role}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 620, lineHeight: 1.7 }}>
            {bio}
          </Typography>
          {extra && (
            <Typography variant="body2" sx={{ color: TEAL_DIM, mt: 1 }}>
              {extra}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
};

/* --------------------------------------------------------------- page ----- */

const P: React.FC<{ text: string; teal?: boolean }> = ({ text, teal }) => (
  <Typography
    variant="body1"
    color={teal ? undefined : 'text.secondary'}
    sx={{ lineHeight: 1.8, fontSize: 16, ...(teal ? { color: TEAL } : {}) }}
  >
    {text}
  </Typography>
);

export const Landing: React.FC = () => {
  const { t, lang } = useI18n();
  return (
    <Container maxWidth="lg" sx={{ pb: 12 }}>
      <Stack direction="row" sx={{ justifyContent: 'flex-end', pt: 1, mb: 2 }}>
        <LanguagePicker />
      </Stack>
      <DraftBanner />
      <Hero key={lang} />

      <Rule eyebrow={t('why.eyebrow')} title={t('why.title')} />
      <Stack spacing={2.5} sx={{ maxWidth: 700, pb: { xs: 2, md: 4 } }}>
        <P text={t('why.p1')} />
        <P text={t('why.p2')} />
      </Stack>

      <Rule eyebrow={t('stages.eyebrow')} title={t('stages.title')} />
      <Box sx={{ pt: 1 }}>
        <Stage head={t('stage1.head')} body={t('stage1.body')} limit={t('stage1.limit')} />
        <Stage head={t('stage2.head')} body={t('stage2.body')} limit={t('stage2.limit')} />
        <Stage head={t('stage3.head')} body={t('stage3.body')} limit={t('stage3.limit')} />
        <Stage head={t('stage4.head')} body={t('stage4.body')} limit={t('stage4.limit')} />
      </Box>

      <Rule eyebrow={t('disclose.eyebrow')} title={t('disclose.title')} />
      <Stack spacing={2} sx={{ maxWidth: 700, pb: { xs: 2, md: 4 } }}>
        <P text={t('disclose.p1')} />
        <P text={t('disclose.p2')} teal />
      </Stack>

      <Rule eyebrow={t('status.eyebrow')} />
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 700, mt: 2.5, lineHeight: 1.7 }}>
        {t('status.p1')}
      </Typography>
      <Typography variant="body1" sx={{ color: TEAL_DIM, maxWidth: 700, mt: 2, lineHeight: 1.7 }}>
        {t('status.p2')}
      </Typography>

      <Rule eyebrow={t('aud.eyebrow')} title={t('aud.title')} />
      <Box>
        <Audience who={t('aud.labs.who')} line={t('aud.labs.line')} to="/docs/integrate" label={t('aud.labs.label')} />
        <Audience who={t('aud.try.who')} line={t('aud.try.line')} to="/new" label={t('aud.try.label')} />
        <Audience who={t('aud.reg.who')} line={t('aud.reg.line')} to="/docs/spec" label={t('aud.reg.label')} />
        <Audience
          who={t('aud.counsel.who')}
          line={t('aud.counsel.line')}
          to="/docs/evidence"
          label={t('aud.counsel.label')}
        />
        <Audience
          who={t('aud.check.who')}
          line={t('aud.check.line')}
          to="/docs/integrate"
          label={t('aud.check.label')}
        />
      </Box>

      <Rule eyebrow={t('team.eyebrow')} />
      <Box sx={{ pt: 1 }}>
        <Person
          name="Makoto (Mako) Steiner"
          role={t('team.mako.role')}
          photo="/team/mako.jpg"
          bio={t('team.mako.bio')}
          extra={t('team.mako.extra')}
        />
        <Person
          name="Hunter Roberts"
          role={t('team.hunter.role')}
          photo="/team/hunter.jpg"
          bio={t('team.hunter.bio')}
        />
      </Box>
    </Container>
  );
};
