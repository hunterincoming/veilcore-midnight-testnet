// The published documents (SPEC, EVIDENCE, INTEGRATING), bundled at build time.
//
// They are vendored into src/docs/ from one exact commit of the SDK repository
// (DOCS_COMMIT below), byte for byte, and reviewed here like any other source file. They
// used to be fetched at run time from the repository's main branch, so whoever could
// push there decided what rendered on veilcore.org, where holder and attester keys live
// in local storage (attack round D). Then they came from the veilcore-records package,
// whose 0.13.0 copies still named a personal address as the contact; the SDK fixed that
// after the release, so the site now takes the files from that commit instead of waiting
// for a package. To update: copy the three files from a newer SDK commit and change
// DOCS_VERSION and DOCS_COMMIT together. The sanitiser is also narrower now: no inline
// styles, ids, forms or inputs, which together allowed a full-page fake "re-enter your
// key" overlay on the real origin.
// SPDX-License-Identifier: Apache-2.0

import { marked } from 'marked';
import DOMPurify, { type Config } from 'dompurify';
import specMd from '../docs/SPEC.md?raw';
import evidenceMd from '../docs/EVIDENCE.md?raw';
import integratingMd from '../docs/INTEGRATING.md?raw';

/** The SDK version (its package.json at DOCS_COMMIT) the documents were copied from. */
export const DOCS_VERSION = '0.15.0';

/** The exact SDK commit the documents were copied from, so "Source" opens the same text. */
export const DOCS_COMMIT = '46aae7eb43b8db8a9b97839824d0882b81393d49';
export const REPO_VIEW = `https://github.com/hunterincoming/veilcore-sdk/blob/${DOCS_COMMIT}`;

export const DOCS: Record<string, { file: string; md: string; title: string; blurb: string }> = {
  spec: {
    file: 'SPEC.md',
    md: specMd,
    title: 'The record format',
    blurb:
      'The specification. Record structure, canonical serialisation, anchoring, corrections, attester identity, resolution across registries, and verification.',
  },
  evidence: {
    file: 'EVIDENCE.md',
    md: evidenceMd,
    title: 'Records in evidence',
    blurb:
      'For counsel. What a party can establish, how it is authenticated under US law in detail, a sketch of four other jurisdictions, and — at length — what it does not prove.',
  },
  integrate: {
    file: 'INTEGRATING.md',
    md: integratingMd,
    title: 'Integrating VeilCore',
    blurb:
      'For developers adding this to software a laboratory or registry already uses. No account, no server, no key.',
  },
};

/** Links a document may keep: in-page anchors, site paths, and https. Anything else is unlinked. */
export const SAFE_HREF = /^(#|\/(?!\/)|https:\/\/|mailto:)/i;

/** The sanitiser settings for documents. Exported so a test can run them in a real browser. */
export const DOC_SANITIZE: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    'style',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'option',
    'svg',
    'math',
    'iframe',
    'img',
    'video',
    'audio',
    'object',
    'embed',
  ],
  FORBID_ATTR: ['style', 'id', 'name', 'class', 'srcset', 'action', 'formaction'],
};

let hooked = false;
const hookLinks = (): void => {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') return;
    const href = node.getAttribute('href') ?? '';
    if (!SAFE_HREF.test(href)) node.removeAttribute('href');
    if (/^https:/i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
};

/** Markdown to HTML, with nothing that can style the page, take input, or run. */
export const renderDoc = (md: string): string => {
  hookLinks();
  return DOMPurify.sanitize(marked.parse(md, { async: false }), DOC_SANITIZE);
};

type HtmlPolicy = { createHTML: (markdown: string) => string };
let policy: HtmlPolicy | null | undefined;

/**
 * A document as HTML for the page. Where the browser has Trusted Types the HTML comes
 * from a policy whose only rule is renderDoc above (markdown in, sanitised HTML out), so
 * the page keeps working if the site enforces them. Plain string otherwise.
 */
export const docHtml = (md: string): string => {
  if (policy === undefined) {
    const tt = (globalThis as { trustedTypes?: { createPolicy: (n: string, p: HtmlPolicy) => HtmlPolicy } })
      .trustedTypes;
    try {
      policy = tt ? tt.createPolicy('veilcore-docs', { createHTML: (m) => renderDoc(m) }) : null;
    } catch {
      policy = null;
    }
  }
  return policy ? policy.createHTML(md) : renderDoc(md);
};
