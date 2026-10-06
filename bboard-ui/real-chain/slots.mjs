// Real transactions from the website (VITE_REAL_CHAIN=1): where the real-chain panels
// go into the site's existing pages, applied at build time and only in a real-chain build.
//
// Why at build time: a build without the flag must be byte for byte the site veilcore.org
// serves now (bboard-ui/src/real-chain-build.test.ts compares them). A flag read at run
// time, or even `{FLAG && <Panel />}` folded away by the bundler, still leaves a trace in
// the output. So the site's own pages carry no trace of this feature. A real-chain build
// adds each panel below at a named place in the page's source, and nothing else.
//
// Each slot names one exact piece of the page's source (`anchor`, which must appear
// exactly once) and what goes before or after it. If a page is edited so that an anchor
// is gone or appears twice, the real-chain build stops with the slot's name: nothing is
// put in the wrong place. The slots are typechecked as patched (real-chain/typecheck.mjs,
// part of `npm run typecheck`), and checked against the current pages by a unit test.
//
// The panels themselves live in src/components/chain/ and src/veilcore/chain/, typed and
// linted like the rest of the site. A slot is one line that renders one of them.
// SPDX-License-Identifier: Apache-2.0

import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SRC = path.join(UI_ROOT, 'src');
/** The public proving parameters (scripts/fetch-params.mjs). Outside public/ so only a real-chain build ships them. */
export const PARAMS_DIR = path.join(UI_ROOT, 'real-chain', 'params');

/**
 * @typedef {{
 *   name: string;
 *   file: string;
 *   anchor: string;
 *   where: 'before' | 'after' | 'before-box' | 'before-stack';
 *   code: string;
 *   imports: string[];
 * }} Slot
 */

/** @type {Slot[]} */
export const SLOTS = [
  {
    name: 'record-detail: anchor panel under the settlement status',
    file: 'components/RecordDetail.tsx',
    anchor: '<SettlementStatus record={record} />',
    where: 'after',
    code: '<AnchorOnChainPanel recordId={record.id} />',
    imports: ["import { AnchorOnChainPanel } from './chain/AnchorOnChainPanel';"],
  },
  {
    name: 'wizard step 1: anchor panel after sealing',
    file: 'components/wizard/Step1LogStrain.tsx',
    anchor: '<Button variant="contained" size="large" onClick={() => onDone(record.id)}>',
    // Before the Box that holds the Continue button: the Box opens on the line above.
    where: 'before-box',
    code: '<AnchorOnChainPanel recordId={record.id} />',
    imports: ["import { AnchorOnChainPanel } from '../chain/AnchorOnChainPanel';"],
  },
  {
    name: 'wizard step 2: publish the pairing (optional)',
    file: 'components/wizard/Step2PairDna.tsx',
    anchor: '<Button variant="contained" size="large" onClick={onDone}>',
    where: 'before-box',
    code: '<PairDnaOnChainPanel recordId={paired.id} />',
    imports: ["import { PairDnaOnChainPanel } from '../chain/PairDnaOnChainPanel';"],
  },
  {
    name: 'wizard step 3: on-chain identity line on the certificate',
    file: 'components/wizard/Step3Certificate.tsx',
    anchor: '<Field label="DNA report paired">',
    where: 'before',
    code: '<CertificateChainField recordId={recordId} Field={Field} />',
    imports: ["import { CertificateChainField } from '../chain/CertificateChainField';"],
  },
  {
    name: 'wizard step 3: prove you held it',
    file: 'components/wizard/Step3Certificate.tsx',
    anchor: '<Button variant="text" onClick={onBack}>',
    // Before the Stack that holds the Back button.
    where: 'before-stack',
    code: '<ProveOwnershipPanel recordId={recordId} />',
    imports: ["import { ProveOwnershipPanel } from '../chain/ProveOwnershipPanel';"],
  },
  {
    name: 'dashboard: warn before starting over with keys that have no backup',
    file: 'components/Dashboard.tsx',
    anchor: 'const onReset = () => {',
    where: 'after',
    code: 'if (!confirmUnsavedChainKeys()) return;',
    imports: ["import { confirmUnsavedChainKeys } from './chain/confirm-unsaved-keys';"],
  },
  {
    name: 'verify page: ask the holder to prove they hold the record',
    file: 'pages/VerifyPage.tsx',
    anchor: '</Container>',
    where: 'before',
    code: "<VerifierChallengeSlot params={params} found={!!result?.found && binding.kind !== 'mismatch'} />",
    imports: ["import { VerifierChallengeSlot } from '../components/chain/VerifierChallengePanel';"],
  },
];

const count = (hay, needle) => hay.split(needle).length - 1;

/** The offset of the line start of the last line at or before `at` that opens `tag`. */
const openerBefore = (code, at, tag) => {
  const lineStart = code.lastIndexOf('\n', at) + 1;
  const prevStart = code.lastIndexOf('\n', lineStart - 2) + 1;
  const prev = code.slice(prevStart, lineStart);
  if (prev.trim() !== tag) return -1;
  return prevStart;
};

/**
 * Apply the slots for one source file. Returns the patched text, or throws naming the
 * slot that cannot be placed. `rel` is the file's path under src/, with forward slashes.
 */
export const applySlots = (rel, code) => {
  const slots = SLOTS.filter((s) => s.file === rel);
  if (slots.length === 0) return code;
  let out = code;
  for (const s of slots) {
    const n = count(out, s.anchor);
    if (n !== 1) {
      throw new Error(
        `Real-chain slot "${s.name}": ${n === 0 ? 'its anchor is gone from' : `its anchor appears ${n} times in`} ` +
          `src/${s.file}. Update bboard-ui/real-chain/slots.mjs to the page as it is now. Anchor: ${s.anchor}`,
      );
    }
    const at = out.indexOf(s.anchor);
    let insertAt;
    if (s.where === 'before') insertAt = out.lastIndexOf('\n', at) + 1;
    else if (s.where === 'after') insertAt = at + s.anchor.length;
    else {
      const tag =
        s.where === 'before-box' ? '<Box>' : '<Stack direction="row" spacing={1.5} sx={{ flexWrap: \'wrap\' }}>';
      insertAt = openerBefore(out, at, tag);
      if (insertAt < 0) {
        throw new Error(
          `Real-chain slot "${s.name}": the line above its anchor in src/${s.file} is no longer ${tag}. ` +
            'Update bboard-ui/real-chain/slots.mjs to the page as it is now.',
        );
      }
    }
    const piece = s.where === 'after' ? `\n${s.code}\n` : `${s.code}\n`;
    out = out.slice(0, insertAt) + piece + out.slice(insertAt);
  }
  const imports = [...new Set(slots.flatMap((s) => s.imports))].join('\n');
  return `${imports}\n${out}`;
};

/** The files the slots patch, as paths under src/. */
export const SLOT_FILES = [...new Set(SLOTS.map((s) => s.file))];

const relOf = (id) => {
  const file = id.split('?')[0];
  if (!file.startsWith(SRC + path.sep)) return undefined;
  return path.relative(SRC, file).split(path.sep).join('/');
};

/** The Vite plugin. Add it only to a real-chain build (vite.config.ts). */
export const realChainPlugin = () => {
  const applied = new Set();
  return {
    name: 'veilcore-real-chain-slots',
    enforce: 'pre',
    buildStart() {
      applied.clear();
    },
    transform(code, id) {
      const rel = relOf(id);
      if (!rel || !SLOT_FILES.includes(rel)) return null;
      applied.add(rel);
      return { code: applySlots(rel, code), map: null };
    },
    buildEnd(err) {
      if (err) return;
      const missing = SLOT_FILES.filter((f) => !applied.has(f));
      if (missing.length > 0 && this.meta.watchMode !== true) {
        this.error(
          `Real-chain build: these pages were never built, so their panels are missing: ${missing.join(', ')}`,
        );
      }
    },
    writeBundle(options) {
      // The proving parameters, served by the site itself (zk-material.ts fetches /params).
      const dist = options.dir ?? path.join(UI_ROOT, 'dist');
      if (existsSync(PARAMS_DIR)) cpSync(PARAMS_DIR, path.join(dist, 'params'), { recursive: true });
      else
        this.warn(
          'Real-chain build without the proving parameters: run node scripts/fetch-params.mjs first, or proving fails on the site.',
        );
    },
  };
};
