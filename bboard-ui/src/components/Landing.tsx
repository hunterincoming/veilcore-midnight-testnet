// The page a stranger lands on.
//
// Everything else in this product assumes you already know what it is. Someone arriving
// from a specification, a government submission, or a link from a colleague has nowhere
// to understand it. This is that page.
//
// The hero is the product's central idea made visible: type a cultivar name, watch it
// collapse into a commitment. That is the whole thesis in three seconds - everything
// about your material, reduced to something that proves it and reveals nothing.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { Box, Button, Container, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { computeCommitment, newNonce } from 'veilcore-records';
import { TEAL, TEAL_DIM } from '../config/theme';

const MONO = '"SFMono-Regular", ui-monospace, Menlo, monospace';

/** The live commitment. Real SDK, real hash, computed in the visitor browser. */
const Hero: React.FC = () => {
  const [name, setName] = useState('Gelato 41');
  const [bred, setBred] = useState('Sherbinski');
  const [hash, setHash] = useState('');
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
      profileData: { cultivarName: name, breederName: bred, nonce },
    } as never).then((h) => { if (live) setHash(h); });
    return () => { live = false; };
  }, [name, bred, nonce]);

  return (
    <Box sx={{ py: { xs: 8, md: 14 } }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 2 }}>
        Proof of what you hold
      </Typography>

      <Typography
        variant="h1"
        sx={{ fontSize: { xs: 38, sm: 52, md: 68 }, lineHeight: 1.03, mb: 3, maxWidth: 880 }}
      >
        Prove you had it first.
        <Box component="span" sx={{ color: TEAL }}> Without showing anyone what it is.</Box>
      </Typography>

      <Typography variant="h6" sx={{ color: 'text.secondary', maxWidth: 620, mb: 6, fontWeight: 400 }}>
        A record format for genetic material. Type something below — everything you enter stays
        on this page. Only the value underneath is ever published.
      </Typography>

      <Box
        sx={{
          p: { xs: 2.5, md: 3.5 },
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          background: 'rgba(47,240,207,0.02)',
          maxWidth: 720,
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <TextField
            label="Cultivar" value={name} onChange={(e) => setName(e.target.value)}
            size="small" fullWidth
          />
          <TextField
            label="Bred by" value={bred} onChange={(e) => setBred(e.target.value)}
            size="small" fullWidth
          />
        </Stack>

        <Typography variant="overline" sx={{ display: 'block', mb: 1 }}>
          What gets published
        </Typography>
        <Box
          sx={{
            fontFamily: MONO, fontSize: { xs: 11, sm: 13 }, lineHeight: 1.7,
            wordBreak: 'break-all', color: TEAL, minHeight: 44,
          }}
        >
          {hash || '\u2026'}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Thirty-two bytes. It cannot be reversed, and it could not have come from a different
          record. Change a single character above and it changes completely.
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mt: 4, flexWrap: 'wrap', gap: 2 }}>
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

const Section: React.FC<{ eyebrow: string; title: string; children: React.ReactNode }> = ({
  eyebrow, title, children,
}) => (
  <Box sx={{ py: { xs: 6, md: 9 }, borderTop: '1px solid', borderColor: 'divider' }}>
    <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1.5 }}>
      {eyebrow}
    </Typography>
    <Typography variant="h3" sx={{ fontSize: { xs: 26, md: 34 }, mb: 3, maxWidth: 720 }}>
      {title}
    </Typography>
    {children}
  </Box>
);

const Claim: React.FC<{ head: string; body: string; limit: string }> = ({ head, body, limit }) => (
  <Box sx={{ py: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
    <Typography variant="h6" sx={{ mb: 1 }}>{head}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: 660 }}>
      {body}
    </Typography>
    <Typography variant="caption" sx={{ color: TEAL_DIM, display: 'block', maxWidth: 660 }}>
      {limit}
    </Typography>
  </Box>
);

const Audience: React.FC<{ who: string; line: string; to: string; label: string; external?: boolean }> = ({
  who, line, to, label, external,
}) => (
  <Box sx={{ py: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
    <Typography variant="subtitle1" sx={{ mb: 0.5 }}>{who}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 620 }}>{line}</Typography>
    {external ? (
      <Button size="small" variant="outlined" href={to} target="_blank" rel="noopener">{label}</Button>
    ) : (
      <Button size="small" variant="outlined" component={RouterLink} to={to}>{label}</Button>
    )}
  </Box>
);

export const Landing: React.FC = () => (
  <Container maxWidth="lg" sx={{ pb: 10 }}>
    <Hero />

    <Section
      eyebrow="The problem"
      title="Genetics replicate. Paper does not keep up."
    >
      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        <Typography variant="body1" color="text.secondary">
          A cutting becomes a thousand cuttings. Whoever bred it gets paid once, at the door, and
          only if someone chose to pay. When material turns up somewhere it should not be, the
          breeder's evidence is their own dated notes — produced by the party relying on them, and
          creatable after the fact.
        </Typography>
        <Typography variant="body1" color="text.secondary">
          The usual remedies do not fit. Depositing a specimen needs storage that is impractical
          for anything propagated by cutting. Having a description notarised means handing it to a
          stranger, which is the one thing you cannot do with material that is valuable and
          unprotected.
        </Typography>
      </Stack>
    </Section>

    <Section
      eyebrow="What you can establish"
      title="Four things, none of which require showing the material."
    >
      <Claim
        head="That you held it, from a date"
        body="Your description is hashed on your own device and the hash is published. Later you produce the description and anyone can confirm it is the one you committed to. You can also prove you hold the material without producing the description at all."
        limit="It does not prove the description is true. That comes from a second party."
      />
      <Claim
        head="What it descends from, and what came with it"
        body="A record declares its parents. Where a licence carried an obligation on offspring, that obligation follows the genetics into cuttings that do not exist yet — not just the original sale."
        limit="It does not detect propagation nobody declares. It works when material surfaces commercially."
      />
      <Claim
        head="What a laboratory confirmed"
        body="A lab signs with a key only they hold. They can withdraw what they issued and nobody else can. Where they list an external accreditation, that is recorded — and named, so you can check it with the accreditor yourself."
        limit="We record who vouched. We never vouch."
      />
      <Claim
        head="What was agreed, and whether it still stands"
        body="Both parties sign. Terms bind to the record and to the DNA report, not to a memory of a conversation. Revoking a licence does not stop a grow — it makes the licensee unable to show clean title to the next buyer, the next lab, or any scheme that requires a record."
        limit="Obligations are recorded. Payments are not processed and funds are never held."
      />
    </Section>

    <Section
      eyebrow="Who decides what is seen"
      title="You do, recipient by recipient."
    >
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 720, mb: 2 }}>
        A buyer might see only that a record exists, that it is clean, and that a lab confirmed it.
        A licensee sees the terms. A customs officer sees a date. Facts you do not grant are absent
        from what you send — not hidden inside it.
      </Typography>
      <Typography variant="body1" sx={{ color: TEAL, maxWidth: 720 }}>
        The genetics themselves are never disclosable. There is no setting that reveals them.
      </Typography>
    </Section>

    <Section eyebrow="Who this is for" title="Different people need different things from it.">
      <Audience
        who="Laboratories"
        line="Keep your LIMS and your own sample numbers. Add a commitment to records you already create, and sign the reports you already issue. A day of intakes anchors in one transaction."
        to="https://github.com/hunterincoming/veilcore-sdk/blob/main/INTEGRATING.md"
        label="Integration guide" external
      />
      <Audience
        who="Breeders and growers"
        line="Log a cultivar, send a sample to a lab, and hold something you can show a buyer without showing them the genetics."
        to="/records" label="Open the app"
      />
      <Audience
        who="Registries and rights bodies"
        line="Run your own registry under your own domain. Define a profile for your own domain of material. Nobody grants permission and nothing routes through us."
        to="https://github.com/hunterincoming/veilcore-sdk/blob/main/SPEC.md"
        label="Read the specification" external
      />
      <Audience
        who="Counsel"
        line="How a record is authenticated, what hearsay questions it raises, which jurisdictions attach a presumption, and — set out at length — what it does not prove."
        to="https://github.com/hunterincoming/veilcore-sdk/blob/main/EVIDENCE.md"
        label="Evidence note" external
      />
      <Audience
        who="Anyone checking a record"
        line="Verification is free, needs no account, and always will. If we disappear, records already issued keep verifying against the ledger using open-source software."
        to="https://github.com/hunterincoming/veilcore-sdk"
        label="The package" external
      />
    </Section>

    <Box sx={{ py: { xs: 6, md: 9 }, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1.5 }}>
        Where this is
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 700 }}>
        The format is published with a conformance suite, and three independent implementations in
        three languages pass the same tests. Records anchor in batches on Midnight, currently on a
        test network. No independent security audit has been completed yet. We would rather say
        that here than have you find it out.
      </Typography>
    </Box>
  </Container>
);
