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
          <Box sx={{ width: '1px', height: 34, background: `linear-gradient(180deg, ${TEAL}00, ${TEAL}88)` }} />
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
 * A stage in a record's life.
 *
 * No connecting line and no numbered bubbles. Those are the decoration that appears on
 * every landing page regardless of what it is selling, and they were doing nothing here
 * that the reading order did not already do. What remains is the sequence stated in
 * words, which is how a person would actually explain it.
 */
const Stage: React.FC<{
  head: string; body: string; limit: string;
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
    <Typography
      variant="h5"
      sx={{ mb: 1.75, fontSize: { xs: 21, md: 25 }, letterSpacing: '-0.01em' }}
    >
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
  <Box sx={{ pt: { xs: 8, md: 12 }, pb: title ? 4.5 : 0, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
    <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: title ? 1.5 : 0 }}>
      {eyebrow}
    </Typography>
    {title && (
      <Typography variant="h3" sx={{ fontSize: { xs: 28, md: 38 }, maxWidth: 780, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
        {title}
      </Typography>
    )}
  </Box>
);

const Audience: React.FC<{ who: string; line: string; to: string; label: string }> = ({
  who, line, to, label,
}) => (
  <Box sx={{ py: 3.5, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
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
      <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, fontSize: 16 }}>
        A cutting becomes a thousand cuttings. Whoever bred it is paid once, at the door, and only
        if someone chose to pay. When material turns up where it should not be, the breeder's
        evidence is their own dated notes — produced by the party relying on them, and creatable
        after the fact.
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, fontSize: 16 }}>
        The usual remedies do not fit. Depositing a specimen needs storage that is impractical for
        anything grown from a cutting. Having a description notarised means handing it to a
        stranger — the one thing you cannot do with material that is valuable and unprotected.
      </Typography>
    </Stack>

    <Rule eyebrow="What a record accumulates" title="From your notebook to a licence, without showing anyone the genetics." />
    <Box sx={{ pt: 1 }}>
      <Stage
        head="Log what you bred"
        body="Write down the cultivar, its parents, when you selected it. It is sealed on your own device and only a hash of it is published — so from that moment you can prove to anyone that this description existed on this date, without showing them a word of it. You can even prove you hold the material without producing the description at all."
        limit="It fixes what you wrote and when. It does not prove what you wrote is true — that is what the next stages are for."
      />
      <Stage
        head="Send a sample for testing"
        body="Give a lab a transfer code with the sample. When they confirm it arrived, that confirmation is signed with their key and lands on your record. The material they hold is now traceable back to yours, and any royalty you attached travels with it — including into cuttings that do not exist yet."
        limit="It cannot see material nobody declares. It bites when that material surfaces commercially."
      />
      <Stage
        head="Their report becomes your evidence"
        body="The lab attaches the DNA report they produced, signed by them. Your record is now tied to actual genetics rather than a name anyone could reuse — and it carries a statement from someone other than you. Only that lab can withdraw it. Nobody, including us, can forge one."
        limit="We record which accreditation a lab claims, and who accredited them. We never vouch for it — you check that with the accreditor."
      />
      <Stage
        head="License it, and get paid on what grows from it"
        body="Set terms, including a royalty on offspring, and both parties sign. The terms bind to the record and to the DNA report rather than to a memory of a conversation. If a licensee stops holding up their end, you revoke — which does not stop their grow, but does stop them showing clean title to the next buyer, the next lab, or any programme that asks for a record."
        limit="We record what is owed. We never take payments and never hold your money."
      />
    </Box>

    <Rule eyebrow="Who decides what is seen" title="You do, recipient by recipient." />
    <Stack spacing={2} sx={{ maxWidth: 700, pb: { xs: 2, md: 4 } }}>
      <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, fontSize: 16 }}>
        A buyer might see only that a record exists, that it is clean, and that a lab confirmed it.
        A licensee sees the terms. A customs officer sees a date. Facts you do not grant are absent
        from what you send, not hidden inside it.
      </Typography>
      <Typography variant="body1" sx={{ color: TEAL, lineHeight: 1.8, fontSize: 16 }}>
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
