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

const MONO = '"SFMono-Regular", ui-monospace, Menlo, monospace';

/* ---------------------------------------------------------------- hero ---- */

const Hero: React.FC = () => {
  const [name, setName] = useState('Harbour Mist');
  const [bred, setBred] = useState('Your name here');
  const [hash, setHash] = useState('');
  const [settling, setSettling] = useState(false);
  const [nonce] = useState(() => newNonce());

  useEffect(() => {
    let live = true;
    setSettling(true);
    void computeCommitment({
      formatVersion: '0.1', recordId: 'demo', subjectType: 'plant-genetic-material',
      profile: 'veilcore/profile/cannabis/v0.1', commitment: '',
      commitmentAlgorithm: 'sha256/canonical-json/v1',
      anchor: { chain: 'midnight', network: 'undeployed' },
      sealedAt: '2026-01-01T00:00:00Z', holder: { id: 'demo' },
      parents: [], attestations: [],
      profileData: { cultivarName: name, breederName: bred, nonce },
    } as never).then((h) => {
      if (!live) return;
      setHash(h);
      setTimeout(() => live && setSettling(false), 260);
    });
    return () => { live = false; };
  }, [name, bred, nonce]);

  return (
    <Box sx={{ pt: { xs: 7, md: 12 }, pb: { xs: 6, md: 10 } }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 2.5 }}>
        Proof of what you hold
      </Typography>

      <Typography
        variant="h1"
        sx={{ fontSize: { xs: 40, sm: 56, md: 72 }, lineHeight: 1.0, mb: 3.5, maxWidth: 900 }}
      >
        Prove you had it first.
        <br />
        <Box component="span" sx={{ color: TEAL }}>Without showing anyone what it is.</Box>
      </Typography>

      <Typography variant="h6" sx={{ color: 'text.secondary', maxWidth: 560, mb: 6, fontWeight: 400, lineHeight: 1.6 }}>
        A record format for genetic material. Change anything below — it stays on this page.
        Only the value underneath is ever published.
      </Typography>

      <Box sx={{ maxWidth: 700 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Cultivar" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />
          <TextField label="Bred by" value={bred} onChange={(e) => setBred(e.target.value)} size="small" fullWidth />
        </Stack>

        {/* The collapse. Everything above reduces to the line below. */}
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2.5 }}>
          <Box sx={{ width: 1, height: 34, background: `linear-gradient(180deg, ${TEAL}00, ${TEAL}88)` }} />
        </Box>

        <Box
          sx={{
            fontFamily: MONO, fontSize: { xs: 11.5, sm: 14 }, lineHeight: 1.9,
            wordBreak: 'break-all', color: TEAL, minHeight: 54,
            opacity: settling ? 0.35 : 1,
            transition: 'opacity 260ms ease',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none', opacity: 1 },
          }}
        >
          {hash}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, maxWidth: 560 }}>
          Thirty-two bytes. It cannot be reversed, and it could not have come from a different
          record. This is the only part anyone else ever sees.
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mt: 5, flexWrap: 'wrap', gap: 2 }}>
        <Button variant="contained" size="large" component={RouterLink} to="/new">
          Log a cultivar
        </Button>
        <Button variant="outlined" size="large" component={RouterLink} to="/records">
          My records
        </Button>
      </Stack>
    </Box>
  );
};

/* --------------------------------------------------------------- spine ---- */

/**
 * A stage in a record's life, attached to the spine.
 *
 * Numbered because these genuinely are a sequence: nothing can be confirmed before it is
 * sealed, and nothing can be licensed before it exists.
 */
const Stage: React.FC<{
  n: string; head: string; body: string; limit: string; last?: boolean;
}> = ({ n, head, body, limit, last }) => (
  <Box sx={{ position: 'relative', pl: { xs: 4, md: 7 }, pb: last ? 0 : { xs: 5, md: 7 } }}>
    <Box
      sx={{
        position: 'absolute', left: { xs: 7, md: 15 }, top: 26, bottom: 0, width: 1,
        background: last ? 'none' : 'linear-gradient(180deg, rgba(47,240,207,0.35), rgba(47,240,207,0.06))',
      }}
    />
    <Box
      sx={{
        position: 'absolute', left: 0, top: 2, width: { xs: 15, md: 31 }, height: { xs: 15, md: 31 },
        borderRadius: '50%', border: '1px solid', borderColor: TEAL_DIM,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontSize: { xs: 8, md: 11 }, color: TEAL,
      }}
    >
      {n}
    </Box>
    <Typography variant="h5" sx={{ mb: 1.25, fontSize: { xs: 19, md: 22 } }}>{head}</Typography>
    <Typography variant="body1" color="text.secondary" sx={{ mb: 1.25, maxWidth: 620, lineHeight: 1.7 }}>
      {body}
    </Typography>
    <Typography variant="body2" sx={{ color: TEAL_DIM, maxWidth: 620 }}>{limit}</Typography>
  </Box>
);

const Rule: React.FC<{ eyebrow: string; title?: string }> = ({ eyebrow, title }) => (
  <Box sx={{ pt: { xs: 7, md: 10 }, pb: title ? 4 : 0, borderTop: '1px solid', borderColor: 'divider' }}>
    <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: title ? 1.5 : 0 }}>
      {eyebrow}
    </Typography>
    {title && (
      <Typography variant="h3" sx={{ fontSize: { xs: 27, md: 36 }, maxWidth: 760, lineHeight: 1.2 }}>
        {title}
      </Typography>
    )}
  </Box>
);

const Audience: React.FC<{ who: string; line: string; to: string; label: string }> = ({
  who, line, to, label,
}) => (
  <Box sx={{ py: 3, borderTop: '1px solid', borderColor: 'divider' }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 4 }}
           sx={{ alignItems: { md: 'baseline' } }}>
      <Typography variant="subtitle1" sx={{ minWidth: { md: 210 } }}>{who}</Typography>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 560, lineHeight: 1.7 }}>
          {line}
        </Typography>
        <Button size="small" variant="outlined" component={RouterLink} to={to}>{label}</Button>
      </Box>
    </Stack>
  </Box>
);

/* --------------------------------------------------------------- page ----- */

export const Landing: React.FC = () => (
  <Container maxWidth="lg" sx={{ pb: 12 }}>
    <Hero />

    <Rule eyebrow="Why this exists" title="Genetics replicate. Paper does not keep up." />
    <Stack spacing={2.5} sx={{ maxWidth: 700, pb: { xs: 2, md: 4 } }}>
      <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        A cutting becomes a thousand cuttings. Whoever bred it is paid once, at the door, and only
        if someone chose to pay. When material turns up where it should not be, the breeder's
        evidence is their own dated notes — produced by the party relying on them, and creatable
        after the fact.
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        The usual remedies do not fit. Depositing a specimen needs storage that is impractical for
        anything grown from a cutting. Having a description notarised means handing it to a
        stranger — the one thing you cannot do with material that is valuable and unprotected.
      </Typography>
    </Stack>

    <Rule eyebrow="What a record accumulates" title="Four stages, none of which require showing the material." />
    <Box sx={{ pt: 1 }}>
      <Stage
        n="01"
        head="Sealed"
        body="Your description is hashed on your own device and only the hash is published. Later you produce the description and anyone can confirm it is the one you committed to. You can also prove you hold the material without producing the description at all."
        limit="It does not prove the description is true. That comes from the next stage."
      />
      <Stage
        n="02"
        head="Sent"
        body="Material moves to a laboratory or another breeder. The recipient receives a record descended from yours — not a copy — and an obligation on offspring travels with it, into cuttings that do not exist yet."
        limit="It does not detect propagation nobody declares. It bites when material surfaces commercially."
      />
      <Stage
        n="03"
        head="Confirmed"
        body="A laboratory signs with a key only they hold. They can withdraw what they issued and nobody else can. Where they list an external accreditation, it is recorded and named, so you can check it with the accreditor yourself."
        limit="We record who vouched. We never vouch."
      />
      <Stage
        n="04"
        head="Licensed"
        body="Both parties sign. Terms bind to the record and to the DNA report, not to a memory of a conversation. Revoking does not stop a grow — it stops a licensee showing clean title to the next buyer, the next lab, or any scheme that requires a record."
        limit="Obligations are recorded. Payments are not processed and funds are never held."
        last
      />
    </Box>

    <Rule eyebrow="Who decides what is seen" title="You do, recipient by recipient." />
    <Stack spacing={2} sx={{ maxWidth: 700, pb: { xs: 2, md: 4 } }}>
      <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        A buyer might see only that a record exists, that it is clean, and that a lab confirmed it.
        A licensee sees the terms. A customs officer sees a date. Facts you do not grant are absent
        from what you send, not hidden inside it.
      </Typography>
      <Typography variant="body1" sx={{ color: TEAL, lineHeight: 1.7 }}>
        The genetics themselves are never disclosable. There is no setting that reveals them.
      </Typography>
    </Stack>

    <Rule eyebrow="Where this is" />
    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 700, mt: 2.5, lineHeight: 1.7 }}>
      The format is published with a conformance suite, and three independent implementations in
      three languages pass the same tests. Records anchor in batches on Midnight, currently on a
      test network. No independent security audit has been completed yet, and the format has been
      used by its authors and by nobody else.
    </Typography>
    <Typography variant="body1" sx={{ color: TEAL_DIM, maxWidth: 700, mt: 2, lineHeight: 1.7 }}>
      We would rather say that here than have you find it out.
    </Typography>

    <Rule eyebrow="Depending on who you are" title="Different people need different things from it." />
    <Box>
      <Audience
        who="Laboratories"
        line="Keep your own system and your own sample numbers. Add a commitment to records you already create, and sign the reports you already issue. A day of intakes anchors in one transaction."
        to="/docs/integrate" label="Integration guide"
      />
      <Audience
        who="Breeders and growers"
        line="Log a cultivar, send a sample to a lab, and hold something you can show a buyer without showing them the genetics."
        to="/new" label="Log a cultivar"
      />
      <Audience
        who="Registries and rights bodies"
        line="Run a registry under your own domain and define a profile for your own kind of material. Nobody grants permission and nothing routes through us."
        to="/docs/spec" label="Read the specification"
      />
      <Audience
        who="Counsel"
        line="How a record is authenticated, which jurisdictions attach a presumption to what, and — set out at length — what it does not prove."
        to="/docs/evidence" label="Evidence note"
      />
      <Audience
        who="Anyone checking a record"
        line="Verification is free, needs no account, and always will be. If we disappear, records already issued keep verifying against the ledger with open-source software."
        to="/docs/integrate" label="How verification works"
      />
    </Box>
  </Container>
);
