// What exists, and how to add to it.
//
// Three implementations, all written by the same author. That shows the rules hold across
// languages; it does not show that someone else could implement the format from the
// document alone, and this page says so. It is also the page a body evaluating the
// format will look for: what exists, how it is checked, and how to add an implementation.
// The vector count is SDK main's conformance/vectors.json (100 since SDK 830498d, 5 October 2026).
//
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { TEAL, TEAL_DIM } from '../config/theme';

const MONO = '"SFMono-Regular", ui-monospace, Menlo, monospace';

const Impl: React.FC<{
  name: string;
  lang: string;
  who: string;
  deps: string;
  note: string;
  href: string;
  hrefLabel: string;
}> = ({ name, lang, who, deps, note, href, hrefLabel }) => (
  <Box sx={{ py: { xs: 3, sm: 4 }, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 2, md: 5 }}>
      <Box sx={{ minWidth: { md: 190 } }}>
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          {name}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: { xs: 13.5, sm: 12.5 }, color: TEAL }}>{lang}</Typography>
      </Box>
      <Box sx={{ flex: 1, maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.75 }}>
          {note}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 0.5, fontSize: { xs: 13.5, sm: 12 } }}
        >
          Written by {who}
        </Typography>
        <Typography variant="caption" sx={{ color: TEAL_DIM, display: 'block', mb: 2, fontSize: { xs: 13.5, sm: 12 } }}>
          Dependencies: {deps}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          href={href}
          target="_blank"
          rel="noopener"
          sx={{ minHeight: { xs: 44, sm: 0 } }}
        >
          {hrefLabel}
        </Button>
      </Box>
    </Stack>
  </Box>
);

export const Implementations: React.FC = () => (
  // Inside the app layout's own container, so no second set of side gutters on a phone.
  <Container maxWidth="lg" sx={{ pb: { xs: 4, sm: 10 }, px: { xs: 0, sm: 3 } }}>
    <Box sx={{ pt: { xs: 2, sm: 6, md: 9 }, pb: { xs: 3, sm: 4, md: 6 } }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 2 }}>
        Implementations
      </Typography>
      <Typography
        variant="h1"
        sx={{ fontSize: { xs: 34, md: 50 }, lineHeight: 1.05, mb: 3, maxWidth: 780, letterSpacing: '-0.02em' }}
      >
        Three implementations, one author, 100 shared tests.
      </Typography>
      <Typography variant="h6" sx={{ color: 'text.secondary', maxWidth: 620, fontWeight: 400, lineHeight: 1.6 }}>
        TypeScript, Python and Rust, all written by the same author. All three agree on the 100 shared test vectors. The
        edge cases we know of where they can still differ (characters added to Unicode since 2021, very deep nesting,
        duplicate keys) are listed in our public notes and being fixed in the spec. That shows the rules hold across
        three languages. It does not yet show that someone else could implement the format from the document alone: an
        implementation by someone else is still the missing test.
      </Typography>
    </Box>

    <Box>
      <Impl
        name="veilcore-records"
        lang="TypeScript"
        who="the same author as the other two"
        deps="none"
        note="The reference implementation. Commitments, canonical serialization, batch inclusion proofs, attester signatures, corrections, challenges and registry resolution. Runs in a browser and in Node with separate entry points, so a frontend build pulls in nothing it cannot use. Version 0.15.0 on npm passes all 100 shared vectors."
        href="https://github.com/hunterincoming/veilcore-sdk"
        hrefLabel="View the repository"
      />
      <Impl
        name="conformance/impl.py"
        lang="Python"
        who="the same author, from the specification"
        deps="standard library only"
        note="A second implementation whose purpose is disagreement. If the specification were ambiguous, this is where it would show: two programs written from the same document, producing different bytes. It passed the early vectors. Then, on 3 October 2026, a differential test on 27,000 inputs found the three implementations disagreeing on some numbers and on unpaired surrogates: the rules were not complete. The specification was tightened (section 4.4, rules 1 and 8), all three were fixed, and they then agreed on 81,000 random inputs."
        href="https://github.com/hunterincoming/veilcore-sdk/blob/main/conformance/impl.py"
        hrefLabel="Read the source"
      />
      <Impl
        name="veilcore-rs"
        lang="Rust"
        who="the same author, from the specification"
        deps="SHA-256, a JSON parser, Unicode normalization"
        note="A third implementation in a language with different string handling, different number formatting, and different map ordering — the three places where a serialization specification usually breaks. The 3 October differential test found it disagreeing too, including on the last digit of some numbers; fixed in veilcore-rs 0.2.0."
        href="https://github.com/hunterincoming/veilcore-rs"
        hrefLabel="View the repository"
      />
    </Box>

    <Box sx={{ pt: { xs: 7, md: 10 }, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1.5 }}>
        How they are checked
      </Typography>
      <Typography
        variant="h3"
        sx={{ fontSize: { xs: 26, md: 34 }, mb: 3, maxWidth: 720, lineHeight: 1.2, letterSpacing: '-0.02em' }}
      >
        A hundred vectors, and one program written to fail them.
      </Typography>

      <Stack spacing={2.5} sx={{ maxWidth: 680 }}>
        <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, fontSize: 16 }}>
          The vectors cover the places serialization goes wrong quietly: key ordering, an omitted field against an
          explicit null, array order, Unicode normalization, nested sorting, and number formatting. Then commitment
          computation across a range of record shapes, including the requirement that changing where a record is
          anchored must not change the record. Since 3 October they also cover the number and surrogate rules the
          differential test exposed.
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.8, fontSize: 16 }}>
          A suite that only ever passes proves nothing, so the repository also contains a deliberately incorrect
          implementation. It uses plain JSON serialization without sorted keys — a bug that produces correct-looking
          output for records whose fields happen to be in the right order, and silently wrong commitments for everything
          else. The suite catches it, including a Unicode case where two visually identical strings hash differently.
        </Typography>
        <Typography variant="body1" sx={{ color: TEAL_DIM, lineHeight: 1.8, fontSize: 16 }}>
          Conformance is demonstrated, not asserted. The vectors are published; you do not need our permission or our
          involvement to test anything, including our own code.
        </Typography>
      </Stack>
    </Box>

    <Box sx={{ pt: { xs: 7, md: 10 }, borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.07)' }}>
      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1.5 }}>
        Adding your own
      </Typography>
      <Typography
        variant="h3"
        sx={{ fontSize: { xs: 26, md: 34 }, mb: 3, maxWidth: 720, lineHeight: 1.2, letterSpacing: '-0.02em' }}
      >
        Nobody has to approve it.
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680, mb: 3, lineHeight: 1.8, fontSize: 16 }}>
        Write a program that reads a job on standard input and writes a result on standard output, then run it against
        the published vectors. It works for any language.
      </Typography>

      <Box
        sx={{
          fontFamily: MONO,
          fontSize: 13,
          p: 2.5,
          borderRadius: 1,
          mb: 3,
          border: '1px solid',
          borderColor: 'rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.02)',
          overflowX: 'auto',
        }}
      >
        node conformance/run-cli.mjs &quot;your-command-here&quot;
      </Box>

      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680, mb: 4, lineHeight: 1.8, fontSize: 16 }}>
        If it passes, it computes the same commitments and proofs as ours, and you owe us nothing for saying so. Nobody
        offers certification today; it could be offered later, by us or anyone. The vectors are public, so anyone can
        check anyone, including checking us.
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
