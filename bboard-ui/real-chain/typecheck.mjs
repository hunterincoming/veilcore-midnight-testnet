// Typecheck the site as a real-chain build sees it: every page with its slots applied
// (slots.mjs). `tsc` alone checks the pages as veilcore.org is built, where the slots are
// not there; this catches a slot that names something the page no longer has (a renamed
// variable, a changed prop) before a real-chain build ships it. Part of `npm run typecheck`.
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import ts from 'typescript';
import { SLOT_FILES, SRC, UI_ROOT, applySlots } from './slots.mjs';

const configPath = path.join(UI_ROOT, 'tsconfig.json');
const read = ts.readConfigFile(configPath, ts.sys.readFile);
if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, UI_ROOT);

const patched = new Map(
  SLOT_FILES.map((rel) => {
    const file = path.join(SRC, rel);
    return [path.resolve(file), applySlots(rel, ts.sys.readFile(file) ?? '')];
  }),
);

const host = ts.createCompilerHost(parsed.options, true);
const readFile = host.readFile.bind(host);
host.readFile = (f) => patched.get(path.resolve(f)) ?? readFile(f);
const getSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (f, lang, onError, fresh) => {
  const text = patched.get(path.resolve(f));
  return text === undefined ? getSourceFile(f, lang, onError, fresh) : ts.createSourceFile(f, text, lang, true);
};

const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true }, host });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => UI_ROOT,
      getNewLine: () => '\n',
    }),
  );
  console.error(`Real-chain typecheck: ${diagnostics.length} error(s) in the pages with their slots applied.`);
  process.exit(1);
}
console.log(`Real-chain typecheck: ${SLOT_FILES.length} pages with their slots applied, no errors.`);
