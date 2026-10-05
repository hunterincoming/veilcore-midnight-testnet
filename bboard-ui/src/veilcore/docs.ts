// The published documents (SPEC, EVIDENCE, INTEGRATING), bundled at build time.
//
// They come from the veilcore-records package the site already depends on, pinned by
// package-lock.json (version and sha512 integrity), and are the same files as the SDK
// repository's tag for that version (attack round D). They used to be fetched at run
// time from the repository's main branch, so whoever could push there decided what
// rendered on veilcore.org, where holder and attester keys live in local storage. The
// sanitiser is also narrower now: no inline styles, ids, forms or inputs, which
// together allowed a full-page fake "re-enter your key" overlay on the real origin.
// SPDX-License-Identifier: Apache-2.0

import { marked } from 'marked';
import DOMPurify, { type Config } from 'dompurify';
import specMd from '@veilcore-docs/SPEC.md?raw';
import evidenceMd from '@veilcore-docs/EVIDENCE.md?raw';
import integratingMd from '@veilcore-docs/INTEGRATING.md?raw';
import sdkPackageJson from '@veilcore-docs/package.json?raw';

/** The SDK version the documents were bundled from. */
export const DOCS_VERSION: string = (JSON.parse(sdkPackageJson) as { version: string }).version;

/**
 * The exact SDK commit for each bundled version, so "Source" opens the same text that is
 * rendered here. A version not listed links to its release tag.
 */
export const DOCS_COMMIT: Record<string, string> = {
  '0.13.0': 'f8cc0c61ac60c727f0d57d6e6cdd8ec4ae8afc81',
};
export const REPO_VIEW = `https://github.com/hunterincoming/veilcore-sdk/blob/${DOCS_COMMIT[DOCS_VERSION] ?? `v${DOCS_VERSION}`}`;

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
