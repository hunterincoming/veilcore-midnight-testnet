// What exists, and how to add to it.
//
// "Three independent implementations" is a claim that means nothing until someone can
// see the three, see what they agree on, and see how they were checked. This page is
// that, and it is also the page a body evaluating the format will look for: not what we
// say about it, but who else has built it and whether it held.
//
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { TEAL, TEAL_DIM } from '../config/theme';

const MONO = '"SFMono-Regular", ui-monospace, Menlo, monospace';

const Impl: React.FC<{
  name: string; lang: string; who: string; deps: string; note: string;
  href: string; hrefLabel: string;
}> = ({ name, lang, who, deps, note, href, hrefLabel }) => (
  <Box sx={{ py: 4, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 2, md: 5 }}>
      <Box sx={{ minWidth: { md: 190 } }}>
        <Typography variant="h6" sx={{ mb: 0.5 }}>{name}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: 12.5, color: TEAL }}>{lang}</Typography>
      </Box>
      <Box sx={{ flex: 1, maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.75 }}>
          {note}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Written by {who}
        </Typography>
        <Typography variant="caption" sx={{ color: TEAL_DIM, display: 'block', mb: 2 }}>
          Dependencies: {deps}
        </Typography>
        <Button size="small" variant="outlined" href={href} target="_blank" rel="noopener">
          {hrefLabel}
        </Button>
      </Box>
    </Stack>
  </Box>
);

export const Implementations: React.FC = () => (
  <Container maxWidth="lg" sx={{ pb: 10 }}>
    <Box sx={{ pt: { xs: 6, md: 9 }, pb: { xs: 4, md: 6 } }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 2 }}>
        Implementations
      </Typography>
      <Typography variant="h1" sx={{ fontSize: { xs: 34, md: 50 }, lineHeight: 1.05, mb: 3, maxWidth: 780, letterSpacing: '-0.02em' }}>
        Three programs, written separately, that agree exactly.
      </Typography>
      <Typography variant="h6" sx={{ color: 'text.secondary', maxWidth: 620, fontWeight: 400, lineHeight: 1.6 }}>
        A format one team implements is documentation. A format three independent programs agree on
        is a specification. Each of these was written from the published document rather than
        translated from the others, and each passes the same thirteen test vectors.
      </Typography>
    </Box>

    <Box>
      <Impl
        name="veilcore-records"
        lang="TypeScript"
        who="the authors of the specification"
        deps="none"
        note="The reference implementation, published on npm. Commitments, canonical serialisation, batch inclusion proofs, attester signatures, corrections, challenges and registry resolution. Runs in a browser and in Node with separate entry points, so a frontend build pulls in nothing it cannot use."
        href="https://www.npmjs.com/package/veilcore-records"
        hrefLabel="View on npm"
      />
      <Impl
        name="conformance/impl.py"
        lang="Python"
        who="the authors, from the specification rather than from the TypeScript"
        deps="standard library only"
        note="A second implementation whose purpose is disagreement. If the specification were ambiguous, this is where it would show: two programs written from the same document, producing different bytes. It passed on the first run, which is the evidence that the serialisation rules are complete."
        href="https://github.com/hunterincoming/veilcore-sdk/blob/main/conformance/impl.py"
        hrefLabel="Read the source"
      />
      <Impl
        name="veilcore-rs"
        lang="Rust"
        who="the authors, from the specification"
        deps="SHA-256, a JSON parser, Unicode normalisation"
        note="A third implementation in a language with different string handling, different number formatting, and different map ordering — the three places where a serialisation specification usually breaks. It also passed on the first run."
        href="https://github.com/hunterincoming/veilcore-rs"
        hrefLabel="View the repository"
      />
    </Box>

    <Box sx={{ pt: { xs: 7, md: 10 }, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1.5 }}>
        How they are checked
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 26, md: 34 }, mb: 3, maxWidth: 720, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
        Thirteen vectors, and one program written to fail them.
      </Typography>

      <Stack spacing={2.5} sx={{ maxWidth: 680 }}>
        <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, fontSize: 16 }}>
          The vectors cover the places serialisation goes wrong quietly: key ordering, an omitted
          field against an explicit null, array order, Unicode normalisation, nested sorting, and
          number formatting. Then commitment computation across a range of record shapes, including
          the requirement that changing where a record is anchored must not change the record.
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, fontSize: 16 }}>
          A suite that only ever passes proves nothing, so the repository also contains a
          deliberately incorrect implementation. It uses plain JSON serialisation without sorted
          keys — a bug that produces correct-looking output for records whose fields happen to be
          in the right order, and silently wrong commitments for everything else. The suite catches
          it, including a Unicode case where two visually identical strings hash differently.
        </Typography>
        <Typography variant="body1" sx={{ color: TEAL_DIM, lineHeight: 1.8, fontSize: 16 }}>
          Conformance is demonstrated, not asserted. The vectors are published; you do not need our
          permission or our involvement to test anything, including our own code.
        </Typography>
      </Stack>
    </Box>

    <Box sx={{ pt: { xs: 7, md: 10 }, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1.5 }}>
        Adding your own
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 26, md: 34 }, mb: 3, maxWidth: 720, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
        Nobody has to approve it.
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680, mb: 3, lineHeight: 1.8, fontSize: 16 }}>
        Write a program that reads a job on standard input and writes a result on standard output,
        then run it against the published vectors. It works for any language.
      </Typography>

      <Box
        sx={{
          fontFamily: MONO, fontSize: 13, p: 2.5, borderRadius: 1, mb: 3,
          border: '1px solid', borderColor: 'rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.02)', overflowX: 'auto',
        }}
      >
        node conformance/run-cli.mjs "your-command-here"
      </Box>

      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680, mb: 4, lineHeight: 1.8, fontSize: 16 }}>
        If it passes, it is conformant, and you owe us nothing for saying so. We offer certification
        as a service for anyone who wants a third party to attest to it — but the vectors are
        public, so anyone can check anyone, including checking us.
      </Typography>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
        <Button variant="contained" component={RouterLink} to="/docs/spec">
          Read the specification
        </Button>
        <Button variant="outlined" component={RouterLink} to="/docs/integrate">
          Integration guide
        </Button>
      </Stack>
    </Box>
  </Container>
);
