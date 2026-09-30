/**
 * Finding 3, answered by building the third party.
 *
 * The review's fix was "publish the record, obligation and beneficiary from the
 * obligation circuits, and child and parent from the edge circuits, through ledger
 * writes". Cells were added for all of those. The open question was whether that is
 * actually SUFFICIENT — and the only honest way to answer it is to write the
 * outsider and make them do the work.
 *
 * The Observer below sees one thing per transaction: the ledger the chain holds
 * afterwards. No witnesses, no secrets, no entry point. From the event cells and
 * counters alone it has to reconstruct the descent graph and the set of OPEN
 * obligations (record, obligation, beneficiary). The chain's own openObligations
 * set and obligationCountOf map are recorded too, but only to GRADE the rebuild —
 * the replay never reads them to decide anything.
 *
 *   node contract/verify-max-3.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);
const { DescentGraph } = await import(pathToFileURL(path.join(here, 'src/descent.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const sec = (s) => createHash('sha256').update(s).digest();
const C = L.pureCircuits;
const COIN = '0'.repeat(64);

// ── the chain ───────────────────────────────────────────────────────────────
const party = (own) => new L.Contract({ localGeneticSecret: (c) => [c.privateState, own] });

let ctx = rt.createCircuitContext(
  rt.sampleContractAddress(), COIN,
  party(sec('x')).initialState(rt.createConstructorContext({}, COIN)).currentContractState, {},
);
const state = () => L.ledger(ctx.currentQueryContext.state);

/**
 * What a chain indexer gets: the ledger after each transaction, nothing else.
 * Deliberately NOT the entry point. The chain does carry it, and an indexer may use
 * it — but a reconstruction that needs it is one that breaks the moment two circuits
 * write the same cells (accept and discharge do), so this proves the stronger
 * property.
 */
const chainLog = [];
const observe = () => {
  const s = state();
  chainLog.push({
    lastObligationRecord: hex(s.lastObligationRecord),
    lastObligation: hex(s.lastObligation),
    lastBeneficiary: hex(s.lastBeneficiary),
    lastDescentChild: hex(s.lastDescentChild),
    lastDescentParent: hex(s.lastDescentParent),
    lastClearedAncestor: hex(s.lastClearedAncestor),
    lastCleanProofBy: hex(s.lastCleanProofBy),
    obligationSeq: Number(s.obligationSeq),
    descentSeq: Number(s.descentSeq),
    descentProposalSeq: Number(s.descentProposalSeq),
    cleanProofSeq: Number(s.cleanProofSeq),
    // For grading only. The replay does not read these.
    chainOpen: [...s.openObligations].map(hex).sort(),
    chainCounts: new Map([...s.obligationCountOf].map(([k, v]) => [hex(k), Number(v)])),
  });
};
observe(); // the deployed state

// The callers' own record of what is open, which the observer never sees.
const insider = new Set();
const run = (who, circuit, ...args) => {
  ctx = party(who).impureCircuits[circuit](ctx, ...args).context;
  observe();
};

// ── a season of activity ────────────────────────────────────────────────────
console.log('\n== a season of transactions ==');
const holder = (n) => sec(`holder-${n}`);
const rec = (n) => C.commit(holder(n));
const benSec = (n) => sec(`beneficiary-${n}`);
const ben = (n) => C.commit(benSec(n));
const obl = (n) => sec(`obligation-${n}`);

// Four records, a two-generation pedigree with a cross at the top.
//
// Each edge is two transactions: the child offers and the named parent confirms
// under their own secret. Only the confirmation moves descentSeq, so the observer
// below counts edges rather than offers — an unconfirmed proposal is an assertion,
// not a link.
for (const [child, parent] of [[2, 1], [3, 1], [4, 2], [4, 3]]) {
  run(holder(child), 'proposeParent', rec(parent));
  run(holder(parent), 'confirmParent', rec(child));
}

// Obligations take the beneficiary's proposal and the holder's acceptance. One is
// later discharged and re-attached under a different obligation — the case where an
// observer that guessed the operation from the cells alone would diverge and never
// recover. A proposal that is never accepted is thrown in too: it must not appear
// in the rebuilt set.
const attach = (r, o, b) => {
  run(benSec(b), 'proposeObligation', rec(r), obl(o));
  run(holder(r), 'acceptObligation', obl(o), ben(b));
  insider.add(hex(C.obligationKey(rec(r), obl(o), ben(b))));
};
const release = (r, o, b) => {
  run(benSec(b), 'discharge', rec(r), obl(o));
  insider.delete(hex(C.obligationKey(rec(r), obl(o), ben(b))));
};

attach(1, 'royalty', 1);
attach(2, 'levy', 2);
release(1, 'royalty', 1);
attach(1, 'second-royalty', 1);
run(benSec(3), 'proposeObligation', rec(4), obl('never-accepted'));
attach(3, 'levy', 2);

// A clean proof on record 4, which carries nothing (the proposal against it binds nobody).
run(holder(9), 'proveAncestorClean', rec(4));
note(`${chainLog.length - 1} transactions, ${insider.size} obligations outstanding`);
note(`${chainLog.at(-1).descentSeq} confirmed edges from ${chainLog.at(-1).descentProposalSeq} proposals`);

// ── the outsider ────────────────────────────────────────────────────────────
/**
 * Rebuilds both structures from the cell log alone.
 *
 * The operation is NOT published — acceptObligation and discharge write the same
 * three cells and both increment obligationSeq — but it does not have to be. The set
 * the observer already holds settles it: accept requires a key that is not open
 * (proposeObligation refuses one that is), and discharge requires one that is. So a
 * key the observer does not hold was accepted, and a key it does hold was
 * discharged. After each step the rebuilt set is graded against the chain's own
 * openObligations and obligationCountOf; any mismatch is reported, not guessed past.
 */
const replay = (log) => {
  const open = new Map(); // key -> { r, o, b }
  const graph = new DescentGraph();
  const cleanProofs = [];  // { ancestor, by }
  const problems = [];
  let prev = log[0];

  for (let i = 1; i < log.length; i++) {
    const e = log[i];
    if (e.descentSeq > prev.descentSeq) {
      graph.observe(Buffer.from(e.lastDescentChild, 'hex'), Buffer.from(e.lastDescentParent, 'hex'));
    }
    if (e.cleanProofSeq > prev.cleanProofSeq) {
      cleanProofs.push({ ancestor: e.lastClearedAncestor, by: e.lastCleanProofBy });
    }
    if (e.obligationSeq > prev.obligationSeq) {
      const r = Buffer.from(e.lastObligationRecord, 'hex');
      const o = Buffer.from(e.lastObligation, 'hex');
      const b = Buffer.from(e.lastBeneficiary, 'hex');
      const k = hex(C.obligationKey(r, o, b));
      if (open.has(k)) open.delete(k);
      else open.set(k, { r: hex(r), o: hex(o), b: hex(b) });

      const rebuilt = [...open.keys()].sort();
      if (rebuilt.join() !== e.chainOpen.join())
        problems.push(`tx ${i}: rebuilt ${rebuilt.length} open obligation(s), chain holds ${e.chainOpen.length}`);
      const counts = new Map();
      for (const v of open.values()) counts.set(v.r, (counts.get(v.r) ?? 0) + 1);
      const same = counts.size === e.chainCounts.size &&
        [...counts].every(([rk, n]) => e.chainCounts.get(rk) === n);
      if (!same) problems.push(`tx ${i}: rebuilt per-record counts differ from obligationCountOf`);
    }
    prev = e;
  }
  return { open, graph, cleanProofs, problems };
};

const heldBy = (o) => (r) => [...o.open.values()].some((v) => v.r === hex(r));

console.log('\n== 1. can an outsider reproduce the open-obligation set at every transaction? ==');
const out = replay(chainLog);
for (const p of out.problems) note(p);
ok('the rebuilt set matches the chain\'s openObligations and obligationCountOf at every transaction',
   out.problems.length === 0,
   'the event cells on chain are not enough to follow the obligation set');
ok('the outsider ends holding exactly the obligations the callers hold',
   [...out.open.keys()].sort().join() === [...insider].sort().join());
ok('an unaccepted proposal does not appear in the rebuilt set',
   ![...out.open.values()].some((v) => v.r === hex(rec(4))));

console.log('\n== 2. can the outsider tell which records are encumbered? ==');
{
  const got = [1, 2, 3, 4].map((n) => `${n}:${heldBy(out)(rec(n)) ? 'held' : 'clean'}`).join(' ');
  const want = [1, 2, 3, 4].map((n) => `${n}:${state().obligationCountOf.member(rec(n)) ? 'held' : 'clean'}`).join(' ');
  note(`outsider: ${got}`);
  note(`actual  : ${want}`);
  ok('the outsider\'s encumbrance answers match the contract', got === want,
     'a third party saw a sequence of events and could not tell which records they concerned');
  ok('and it knows who each one is owed to',
     [...out.open.values()].every((v) => v.b === hex(ben(1)) || v.b === hex(ben(2))));
}

// Removed: "build a sibling path the CIRCUIT accepts" — there is no tree and no path; clean proofs read the set directly.
console.log('\n== 3. does the circuit agree with the outsider\'s verdict on every record? ==');
{
  // The test of a rebuilt set is not that it agrees with itself. For each record,
  // the outsider's clean/held answer is put to the contract's own clean proof.
  // Run against a copy of the context so the check leaves no trace in the log.
  const saved = ctx;
  const circuitSaysClean = (r) => {
    try { party(sec('auditor')).impureCircuits.proveAncestorClean(saved, r); return true; }
    catch { return false; }
  };
  const disagree = [1, 2, 3, 4].filter((n) => circuitSaysClean(rec(n)) === heldBy(out)(rec(n)));
  ctx = saved;
  ok('the contract\'s clean proof accepts exactly the records the outsider calls clean',
     disagree.length === 0, `disagreement on record(s) ${disagree.join(', ')}`);
}

console.log('\n== 4. can the outsider enumerate a record\'s parents? ==');
{
  const parents = out.graph.parentsOf.get(hex(rec(4))) ?? [];
  note(`record 4 declared parents: ${parents.length}`);
  ok('both sides of a cross are enumerable', parents.length === 2 &&
     parents.includes(hex(rec(2))) && parents.includes(hex(rec(3))),
     'the edge hash alone let a verifier TEST a pair they already suspected; it did\n' +
     '     not let them ENUMERATE, so the graph verifyDescent walks was not\n' +
     '     independently obtainable');

  note(`ancestorCount(record 4) = ${out.graph.ancestorCount(rec(4))}`);
  ok('the full ancestry is reachable', out.graph.ancestorCount(rec(4)) === 3);
}

console.log('\n== 5. does the outsider reach the same verdict as the insider? ==');
{
  // The whole point of rebuilding: answering clean descent without asking anyone.
  const proven = out.graph.ancestorsOf(rec(4))
    .filter((h) => !heldBy(out)(Buffer.from(h, 'hex')));
  const verdict = out.graph.verifyDescent(rec(4), proven);
  note(verdict.ok ? `accepted, ${verdict.ancestorsChecked} ancestors checked` : `rejected: ${verdict.reason}`);
  ok('record 4 is refused while an ancestor is encumbered', !verdict.ok,
     'records 1, 2 and 3 are upstream of 4 and all three carry obligations');

  // Clear them and the same walk accepts.
  release(2, 'levy', 2);
  release(3, 'levy', 2);
  release(1, 'second-royalty', 1);
  const out2 = replay(chainLog);
  const v2 = out2.graph.verifyDescent(rec(4),
    out2.graph.ancestorsOf(rec(4)).filter((h) => !heldBy(out2)(Buffer.from(h, 'hex'))));
  note(v2.ok ? `after discharge: accepted, ${v2.ancestorsChecked} checked` : `after discharge: ${v2.reason}`);
  ok('the same walk accepts once every ancestor is discharged', v2.ok);
  ok('the outsider tracked three more discharges without being told the operation',
     out2.problems.length === 0, out2.problems.join('; '));
  ok('and the set is back to empty', out2.open.size === 0 && state().openObligations.isEmpty());
}

console.log('\n== 6. clean proofs are attributable ==');
{
  const proof = out.cleanProofs.at(-1);
  note(`a clean proof names ancestor ${proof.ancestor.slice(0, 16)}… and prover ${proof.by.slice(0, 16)}…`);
  ok('a clean proof is attributable from chain data',
     proof.ancestor === hex(rec(4)) && proof.by === hex(C.commit(holder(9))));
  note('proveAncestorClean reads the set as it stands when the transaction executes, so');
  note('a proof says "clean at that point in history" and nothing later. An observer');
  note('reading an old proof re-checks the ancestor against the set it rebuilt rather');
  note('than trusting the proof — which it can, because it has the set.');
}

// ── the condition sufficiency actually rests on ─────────────────────────────
// Removed: "current state alone does NOT rebuild the tree" — there is no tree; the equivalent questions are asked below.
console.log('\n== 7. what current state alone is and is NOT sufficient for ==');
{
  // "Single cells are enough; history keeps them" is the claim, and the second half
  // is doing the work for the parts that live only in event cells. A cell holds one
  // value: everything before it is recoverable only from per-transaction history.
  // Two obligations in force, so the question has something to answer.
  attach(2, 'final-levy', 2);
  attach(3, 'final-levy', 2);
  const currentStateOnly = replay([chainLog[0], chainLog.at(-1)]);

  // What changed with the redesign: obligationCountOf is a live map, so WHICH records
  // are encumbered right now is readable from a single state query. Say so.
  const snap = state();
  ok('current state alone DOES say which records are encumbered right now',
     snap.obligationCountOf.member(rec(2)) && snap.obligationCountOf.member(rec(3)) &&
     !snap.obligationCountOf.member(rec(1)) && !snap.obligationCountOf.member(rec(4)));

  // But the open set is stored as keys — hashes of (record, obligation, beneficiary)
  // — and a hash does not give its inputs back. Who is owed, and for what, is only
  // in the event cells, and the cells hold the LAST event only.
  note(`from current state alone, rebuilt ${currentStateOnly.open.size} obligation(s) with terms — chain holds ${snap.openObligations.size()}`);
  ok('current state alone does NOT give the terms and beneficiary of every open obligation',
     currentStateOnly.open.size < Number(snap.openObligations.size()) && currentStateOnly.problems.length > 0,
     'if one snapshot were enough, the cells would be carrying history they cannot hold');

  const edges = currentStateOnly.graph.parentsOf.get(hex(rec(4)))?.length ?? 0;
  note(`from current state alone, record 4 has ${edges} discoverable parent(s) of 2`);
  ok('current ledger state alone does NOT rebuild the graph', edges < 2);
  note('So finding 3 is closed against an ARCHIVAL indexer, which is what the contract');
  note('header claims and what a registry consuming this has to run. A verifier with');
  note('only a state query can tell whether a record is encumbered, but not who it is');
  note('owed to or what its ancestors are — for that it still has to be given the history.');
}

console.log(`\n${bad === 0 ? 'finding 3: the published cells are sufficient — the outsider rebuilt both structures' : `${bad} still failing`}`);
process.exit(bad === 0 ? 0 : 1);
