/**
 * Pre-deployment checks for lineage.compact.
 *
 * Claims the contract or its comments make, each tested rather than
 * reasoned about. A FAIL means the claim does not hold; a pass means the
 * concern was mine and the contract is fine.
 *
 *   node contract/lineage-checks.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = path.join(here, 'src/managed/lineage/contract/index.js');
const mod = await import(pathToFileURL(artifact).href);
const { Contract, ledger, pureCircuits } = mod;
const rt = await import('@midnight-ntwrk/compact-runtime');

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`OK   ${name}`);
  else { console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); failures++; }
};
const note = (s) => console.log(`     ${s}`);
const rejects = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message ?? e); } };

const b32 = (fill) => new Uint8Array(32).fill(fill);
const hex = (b) => Buffer.from(b).toString('hex');
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const COIN = '0'.repeat(64);
const src = (await import('node:fs')).readFileSync(path.join(here, 'src/lineage.compact'), 'utf8');

/**
 * A caller. Every witness the contract declares has to be supplied or the Contract
 * constructor throws before any circuit runs. There is one: the caller's secret.
 */
const party = ({ own = b32(0x11) } = {}) =>
  new Contract({ localGeneticSecret: (ctx) => [ctx.privateState, own] });

const freshCtx = () => {
  const c = party();
  return rt.createCircuitContext(
    rt.sampleContractAddress(), COIN,
    c.initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
  );
};

// Removed: "1. how many records before two share a slot?" — obligations are keyed by the full (record, obligation, beneficiary) hash in a Set; there are no slots to collide.

// ─────────────────────────────────────────── 2. what proveAncestorClean proves
//
// The file header says a verifier cross-checks the caller's ancestry claim against
// confirmed descent edges. That requires knowing which commitment was proven clean.
console.log('\n== 2. does proveAncestorClean name the ancestor it clears? ==');
{
  // This asked its question of the SOURCE once — it grepped for an assignment and
  // called that an answer. A line of source is not a public value: the circuit could
  // disclose nothing, or write the wrong cell, and the grep would still pass. So it
  // runs the circuit and reads the ledger the chain would actually hold.
  const ancestor = pureCircuits.commit(createHash('sha256').update('the-ancestor').digest());

  const caller = party({ own: b32(0x11) });
  let ctx = freshCtx();
  const err = rejects(() => { ctx = caller.impureCircuits.proveAncestorClean(ctx, ancestor).context; });

  if (err) note(`refused: ${err}`);
  ok('a clean ancestor can be proven clean at all', err === '', err);

  const st = ledger(ctx.currentQueryContext.state);
  note(`ancestor passed to the circuit: ${hex(ancestor).slice(0, 24)}…`);
  note(`lastClearedAncestor on chain:  ${hex(st.lastClearedAncestor).slice(0, 24)}…`);
  note(`lastCleanProofBy on chain:     ${hex(st.lastCleanProofBy).slice(0, 24)}…`);

  ok('the cleared ancestor reaches a public position',
     err === '' && same(st.lastClearedAncestor, ancestor),
     'nothing in the transaction says WHICH ancestor was proven clean');
  ok('the proof names the party who made it',
     err === '' && same(st.lastCleanProofBy, pureCircuits.commit(b32(0x11))),
     'the circuit computed the caller\'s commitment and discarded it, so the proof\n' +
     '     restated public state and named nobody');
}

// ──────────────────────────────────────── 3. every declared witness is used
console.log('\n== 3. is every declared witness read? ==');
{
  // Count declarations, not mentions: a comment explaining why a witness was
  // removed is not a witness, and an earlier version of this check failed on
  // exactly that. Uses are counted in code only, comments stripped.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const declared = [...code.matchAll(/^witness (\w+)\(/gm)].map((m) => m[1]);
  const unread = declared.filter((w) => (code.match(new RegExp(`\\b${w}\\(`, 'g')) || []).length < 2);
  note(`declared: ${declared.join(', ') || '(none)'}`);
  for (const w of ['ancestryChain', 'ancestrySiblings', 'ancestryDirections', 'merkleSiblings', 'beneficiarySecret']) {
    if (declared.includes(w)) note(`${w} is still declared`);
  }
  ok('every declared witness is read', declared.length > 0 && unread.length === 0,
     `declared and never read: ${unread.join(', ')} — the interface describes behaviour the\n` +
     '     circuit does not have');
}

// ──────────────────────────────────────────── 4. lastDescent holds one kind of value
console.log('\n== 4. does lastDescent hold one kind of value? ==');
{
  // Also grepped the source once. The question is what a reader of the CELL sees,
  // so both writers run and the cell is read afterwards: an edge hash and a bare
  // commitment are indistinguishable as bytes, and only running both shows whether
  // one cell is being asked to carry both.
  const childSecret = createHash('sha256').update('child').digest();
  const parentSecret = createHash('sha256').update('parent').digest();
  const child = pureCircuits.commit(childSecret);
  const parent = pureCircuits.commit(parentSecret);

  // An edge takes both parties: the child offers, the named parent confirms under
  // their own secret.
  let ctx = freshCtx();
  ctx = party({ own: childSecret }).impureCircuits.proposeParent(ctx, parent).context;
  ctx = party({ own: parentSecret }).impureCircuits.confirmParent(ctx, child).context;
  const afterEdge = ledger(ctx.currentQueryContext.state);
  note(`after confirmParent, lastDescent = ${hex(afterEdge.lastDescent).slice(0, 24)}…`);
  ok('lastDescent holds the edge hash',
     same(afterEdge.lastDescent, pureCircuits.descentEdge(child, parent)));

  const ancestor = pureCircuits.commit(createHash('sha256').update('anc4').digest());
  ctx = party({ own: childSecret }).impureCircuits.proveAncestorClean(ctx, ancestor).context;
  const afterProof = ledger(ctx.currentQueryContext.state);
  note(`after proveAncestorClean, lastDescent = ${hex(afterProof.lastDescent).slice(0, 24)}…`);

  ok('one field, one meaning', same(afterProof.lastDescent, afterEdge.lastDescent),
     'a clean proof overwrote lastDescent with a bare commitment, so a reader of the\n' +
     '     cell could not tell whether it held descentEdge(child,parent) or a record\n' +
     '     commitment, and the two are indistinguishable as bytes.');
}

console.log(`\n${failures === 0 ? 'no findings' : `${failures} finding(s) above`}`);
// Exits non-zero on a finding. It used to exit 0 regardless, so npm test could not see one.
process.exit(failures === 0 ? 0 : 1);
