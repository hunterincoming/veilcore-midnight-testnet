/**
 * Does the descent graph catch what the contract cannot?
 *
 * The circuit proves a named commitment sits in a clean slot. It cannot prove
 * that commitment is the caller's ancestor — contract state holds no descent
 * graph. descent.mjs is where that join happens, so a hole here is a hole in the
 * whole clean-descent claim, and the circuit will not catch it.
 *
 *   node contract/descent-checks.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const { DescentGraph } = await import(pathToFileURL(path.join(here, 'src/descent.mjs')).href);
const { pureCircuits: C } =
  await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`OK   ${name}`);
  else { console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); failures++; }
};
const note = (s) => console.log(`     ${s}`);
const rec = (n) => C.commit(createHash('sha256').update(`rec-${n}`).digest());
const hexOf = (u) => Buffer.from(u).toString('hex');

// ── 1. a substituted ancestor is refused ────────────────────────────────────
console.log('\n== 1. is an unrelated ancestor caught? ==');
{
  const g = new DescentGraph();
  const child = rec('child'), parent = rec('parent'), stranger = rec('stranger');
  g.observe(child, parent);

  ok('a declared edge verifies', g.verifyChain(child, [parent]).ok);
  const bad = g.verifyChain(child, [stranger]);
  note(bad.ok ? 'accepted' : `refused: ${bad.reason}`);
  ok('naming a convenient unrelated record is refused', !bad.ok,
     'the Merkle proof would verify for any clean record; this is the only thing stopping it');
}

// ── 2. a truncated chain ────────────────────────────────────────────────────
//
// The seller's grandparent carries an obligation. They declare the parent edge
// only, prove the parent clean, and present a one-element chain.
console.log('\n== 2. is a chain that stops short of a dirty ancestor caught? ==');
{
  const g = new DescentGraph();
  const child = rec('c2'), parent = rec('p2'), grandparent = rec('gp2');
  g.observe(child, parent);
  g.observe(parent, grandparent);

  note(`declared: child -> parent -> grandparent`);
  note(`grandparent carries the obligation; the seller presents [parent] only`);

  note(`verifyChain alone: ${g.verifyChain(child, [parent]).ok ? 'ok, it only checks stated links' : 'refused'}`);
  const truncated = g.verifyDescent(child, [hexOf(parent)]);
  note(truncated.ok ? 'verifyDescent: ok' : `verifyDescent: ${truncated.reason}`);

  ok('a chain stopping short of a known ancestor is refused', !truncated.ok,
     'verifyChain confirms each claimed link and never checks the chain reaches the top.\n' +
     '     requiredChainLength exists for this and nothing calls it, so a seller whose\n' +
     '     grandparent is encumbered declares only the parent edge, proves the parent\n' +
     '     clean, and passes. The whole point of walking descent is that a per-record\n' +
     '     check is not enough.');
}

// ── 3. a cross has two parents ──────────────────────────────────────────────
//
// plant-variety/v1 lists seed-parent and pollen-parent. Branching is the normal
// case for a breeding programme, not an edge case.
console.log('\n== 3. does it handle a record with two parents? ==');
{
  const g = new DescentGraph();
  const child = rec('c3'), seedP = rec('seed3'), pollenP = rec('pollen3');
  g.observe(child, seedP);
  g.observe(child, pollenP);

  note(`two declared parents, ancestorCount says ${g.ancestorCount(child)}`);
  const both = g.verifyDescent(child, [hexOf(seedP), hexOf(pollenP)]);
  note(both.ok ? `verifyDescent with both cleared: ok, ${both.ancestorsChecked} checked` : `refused: ${both.reason}`);

  ok('clearing every declared parent verifies', both.ok,
     `requiredChainLength counts every ancestor transitively while verifyChain follows a\n` +
     '     single line, so on any branching pedigree the number it returns cannot be met.\n' +
     '     A cross has two parents by definition, so this is the ordinary case.');
}

// ── 4. both branches of a cross have to be cleared ──────────────────────────
console.log('\n== 4. is one clean parent enough when the other is dirty? ==');
{
  const g = new DescentGraph();
  const child = rec('c4'), cleanP = rec('clean4'), dirtyP = rec('dirty4');
  g.observe(child, cleanP);
  g.observe(child, dirtyP);

  const partial = g.verifyDescent(child, [hexOf(cleanP)]);
  note(`both parents declared; the seller clears the clean one only`);
  note(partial.ok ? 'verifyDescent: ok' : `verifyDescent: ${partial.reason}`);
  ok('clearing one parent of a cross is refused', !partial.ok,
     'an obligation on either parent should block the descendant, so clearing one branch\n' +
     '     and staying silent about the other is the same omission as case 2.');
}

console.log(`\n${failures === 0 ? 'no findings' : `${failures} finding(s) above`}`);
process.exit(0);
