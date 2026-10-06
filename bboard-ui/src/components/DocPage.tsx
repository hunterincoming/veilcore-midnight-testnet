// Documents, read on this site.
//
// A rights body or a lawyer clicking "read the specification" and landing on a code
// repository is being asked to treat a document as source. It reads as unfinished, and
// it costs nothing to fix: the same markdown, rendered here, with the repository there
// for anyone who wants to check it against the code.
//
// The documents are bundled at build time and sanitised narrowly (veilcore/docs.ts).
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import CodeIcon from '@mui/icons-material/CodeOutlined';
import { TEAL } from '../config/theme';
import { IS_MAINNET } from '../config/network';
import { DOCS, DOCS_COMMIT, DOCS_VERSION, REPO_VIEW, docHtml } from '../veilcore/docs';

/** Phones only. Desktop styles are the ones above, unchanged. */
const PHONE = '@media (max-width: 599.95px)';

export const DocPage: React.FC = () => {
  const { doc } = useParams();
  const meta = doc && Object.prototype.hasOwnProperty.call(DOCS, doc) ? DOCS[doc] : undefined;
  const html = useMemo(() => (meta ? docHtml(meta.md) : null), [meta]);
  const body = useRef<HTMLDivElement>(null);
  // The section headings, for the phone-only "jump to" list. The sanitiser removes ids,
  // so the list scrolls to the heading element itself rather than to an anchor.
  const [sections, setSections] = useState<string[]>([]);
  useEffect(() => {
    const hs = body.current ? [...body.current.querySelectorAll('h2')] : [];
    setSections(hs.map((h) => h.textContent ?? ''));
  }, [html]);
  const jump = (i: number) => body.current?.querySelectorAll('h2')[i]?.scrollIntoView({ behavior: 'smooth' });

  if (!meta) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          No such document
        </Typography>
        <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />}>
          Back
        </Button>
      </Container>
    );
  }

  return (
    // Inside the app layout's own container, so no second set of side gutters on a phone.
    <Container maxWidth="md" sx={{ py: { xs: 1, sm: 5, md: 8 }, px: { xs: 0, sm: 3 } }}>
      <Button
        component={RouterLink}
        to="/"
        size="small"
        startIcon={<ArrowBackIcon />}
        sx={{ mb: { xs: 2, sm: 4 }, minHeight: { xs: 44, sm: 0 }, ml: { xs: -1, sm: 0 } }}
      >
        Back
      </Button>

      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1 }}>
        Published document
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 30, md: 40 }, mb: 2, lineHeight: { xs: 1.15, sm: 1.167 } }}>
        {meta.title}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 640 }}>
        {meta.blurb}
      </Typography>
      {/* The documents are vendored byte for byte from one SDK commit, written before the
          mainnet launch. On the mainnet site, a document that still says VeilCore is on test
          networks only gets a note above it rather than an edit to the vendored text. */}
      {IS_MAINNET && /test network|preprod|not yet on mainnet|production network/i.test(meta.md) && (
        <Alert severity="info" variant="outlined" sx={{ mb: 3, maxWidth: 720 }}>
          Written before VeilCore&apos;s launch on Midnight&apos;s main network. Where it says VeilCore is on test
          networks only, that has changed: records are now dated on Midnight&apos;s main network. The rest stands. An
          updated copy will follow.
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mb: { xs: 3, sm: 5 }, flexWrap: 'wrap', gap: 1.5 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<CodeIcon />}
          sx={{ minHeight: { xs: 44, sm: 0 } }}
          href={`${REPO_VIEW}/${meta.file}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Source
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', fontSize: { xs: 13, sm: 12 } }}>
          SDK {DOCS_VERSION}, commit {DOCS_COMMIT.slice(0, 7)}
        </Typography>
      </Stack>

      {sections.length > 1 && (
        // A long document on a phone: a native list of its sections, which the phone shows
        // as its own picker. Desktop readers scroll and do not get this.
        <Box component="label" sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 0.75, mb: 4 }}>
          <Typography component="span" variant="body2" color="text.secondary">
            Jump to a section
          </Typography>
          <Box
            component="select"
            value=""
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              jump(Number(e.target.value));
              e.target.value = '';
            }}
            sx={{
              minHeight: 48,
              px: 1.5,
              font: 'inherit',
              fontSize: 16,
              color: 'text.primary',
              bgcolor: 'rgba(0,18,15,0.5)',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              width: '100%',
            }}
          >
            <option value="" disabled>
              {sections.length} sections
            </option>
            {sections.map((h, i) => (
              <option key={i} value={i}>
                {h}
              </option>
            ))}
          </Box>
        </Box>
      )}

      {html && (
        <Box
          // Rendered markdown. Type scale follows the rest of the site so a document
          // reads as part of it rather than as a pasted file.
          ref={body}
          dangerouslySetInnerHTML={{ __html: html }}
          sx={{
            minWidth: 0,
            '& h1': { fontFamily: '"Space Grotesk", sans-serif', fontSize: 32, mt: 6, mb: 2, fontWeight: 600 },
            '& h2': {
              fontFamily: '"Space Grotesk", sans-serif',
              fontSize: 24,
              mt: 5,
              mb: 2,
              fontWeight: 600,
              borderTop: '1px solid',
              borderColor: 'divider',
              pt: 4,
            },
            '& h3': { fontFamily: '"Space Grotesk", sans-serif', fontSize: 18, mt: 4, mb: 1.5, fontWeight: 600 },
            '& p': { fontSize: 15.5, lineHeight: 1.75, mb: 2, color: 'text.secondary' },
            '& li': { fontSize: 15.5, lineHeight: 1.75, mb: 0.75, color: 'text.secondary' },
            '& strong': { color: 'text.primary', fontWeight: 600 },
            '& a': { color: TEAL },
            '& code': {
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 13,
              background: 'rgba(47,240,207,0.07)',
              px: 0.7,
              py: 0.2,
              borderRadius: 0.5,
            },
            '& pre': {
              background: 'rgba(255,255,255,0.03)',
              p: 2,
              borderRadius: 1,
              overflowX: 'auto',
              border: '1px solid',
              borderColor: 'divider',
            },
            '& pre code': { background: 'none', px: 0 },
            '& table': { width: '100%', borderCollapse: 'collapse', my: 3, fontSize: 14 },
            '& th': {
              textAlign: 'left',
              p: 1.2,
              borderBottom: '2px solid',
              borderColor: 'divider',
              fontWeight: 600,
              fontSize: 13,
            },
            '& td': {
              p: 1.2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              color: 'text.secondary',
              verticalAlign: 'top',
            },
            '& hr': { border: 0, borderTop: '1px solid', borderColor: 'divider', my: 4 },
            '& blockquote': {
              borderLeft: '2px solid',
              borderColor: TEAL,
              pl: 2,
              ml: 0,
              color: 'text.secondary',
              fontStyle: 'italic',
            },
            // Phones: tables and code scroll inside their own box rather than widening the
            // page, long identifiers wrap, and the type steps down a little.
            [PHONE]: {
              '& h1': { fontSize: 26, mt: 4, lineHeight: 1.2 },
              '& h2': { fontSize: 21, mt: 4, pt: 3, lineHeight: 1.25 },
              '& h3': { fontSize: 17, mt: 3 },
              '& p, & li': { fontSize: 16, lineHeight: 1.7 },
              '& ul, & ol': { pl: 2.5 },
              '& code': { fontSize: 13, overflowWrap: 'anywhere' },
              '& pre': { p: 1.5, mx: 0, maxWidth: '100%', boxSizing: 'border-box' },
              '& pre code': { overflowWrap: 'normal', fontSize: 12.5 },
              '& table': {
                display: 'block',
                width: 'auto',
                maxWidth: '100%',
                overflowX: 'auto',
                fontSize: 13.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              },
              '& th, & td': { p: 1, minWidth: 96 },
              '& blockquote': { mx: 0 },
              // A rule straight before a section heading drew two lines; one is enough.
              '& hr + h2': { borderTop: 0, pt: 0 },
            },
          }}
        />
      )}
    </Container>
  );
};
