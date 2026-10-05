// Documents, read on this site.
//
// A rights body or a lawyer clicking "read the specification" and landing on a code
// repository is being asked to treat a document as source. It reads as unfinished, and
// it costs nothing to fix: the same markdown, rendered here, with the repository there
// for anyone who wants to check it against the code.
//
// The documents are bundled at build time and sanitised narrowly (veilcore/docs.ts).
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo } from 'react';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import CodeIcon from '@mui/icons-material/CodeOutlined';
import { TEAL } from '../config/theme';
import { DOCS, DOCS_VERSION, REPO_VIEW, docHtml } from '../veilcore/docs';

export const DocPage: React.FC = () => {
  const { doc } = useParams();
  const meta = doc && Object.prototype.hasOwnProperty.call(DOCS, doc) ? DOCS[doc] : undefined;
  const html = useMemo(() => (meta ? docHtml(meta.md) : null), [meta]);

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
    <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
      <Button component={RouterLink} to="/" size="small" startIcon={<ArrowBackIcon />} sx={{ mb: 4 }}>
        Back
      </Button>

      <Typography variant="overline" sx={{ color: TEAL, display: 'block', mb: 1 }}>
        Published document
      </Typography>
      <Typography variant="h3" sx={{ fontSize: { xs: 30, md: 40 }, mb: 2 }}>
        {meta.title}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 640 }}>
        {meta.blurb}
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ mb: 5, flexWrap: 'wrap', gap: 1.5 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<CodeIcon />}
          href={`${REPO_VIEW}/${meta.file}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Source
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          Version {DOCS_VERSION} of the published package
        </Typography>
      </Stack>

      {html && (
        <Box
          // Rendered markdown. Type scale follows the rest of the site so a document
          // reads as part of it rather than as a pasted file.
          dangerouslySetInnerHTML={{ __html: html }}
          sx={{
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
          }}
        />
      )}
    </Container>
  );
};
