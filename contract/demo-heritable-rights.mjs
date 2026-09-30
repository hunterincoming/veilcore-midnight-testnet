// Heritable rights, demonstrated.
//
// Every IP registry records objects. Biological IP is not an object — a cut becomes
// a mother becomes ten thousand clones, and a claim from upstream rides along with
// every one of them. A licence agreement cannot bind a plant that does not exist
// yet. This can.
//
// Two mechanisms, and both are necessary:
//   the clean proof shows a claimed ancestor carries no obligation
//   the descent graph shows the claimed ancestor is the real one
//
// Runs the contract's real circuits in the simulator, so every hash and every
// refusal is what the chain computes.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { DescentGraph } from './src/descent.mjs';
import * as L from './src/managed/lineage/contract/index.js';
import * as rt from '@midnight-ntwrk/compact-runtime';

const C = L.pureCircuits;
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();
const hex = (u) => Buffer.from(u).toString('hex');
const short = (u) => hex(u).slice(0, 16) + '…';
const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(74));

// The chain.
const party = (own) => new L.Contract({ localGeneticSecret: (c) => [c.privateState, own] });
let ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN,
  party(sec('deployer')).initialState(rt.createConstructorContext({}, COIN)).currentContractState, {});
const run = (who, circuit, ...args) => { ctx = party(who).impureCircuits[circuit](ctx, ...args).context; };
const tryRun = (who, circuit, ...args) => { try { run(who, circuit, ...args); return ''; } catch (e) { return String(e?.message ?? e); } };
const state = () => L.ledger(ctx.currentQueryContext.state);

// The buyer's view of descent, rebuilt from the edge cells the chain publishes.
const graph = new DescentGraph();
const confirmEdge = (childSecret, parentSecret) => {
  run(childSecret, 'proposeParent', C.commit(parentSecret));
  run(parentSecret, 'confirmParent', C.commit(childSecret));
  const s = state();
  graph.observe(s.lastDescentChild, s.lastDescentParent);
};

const BUYER = sec('buyer');
const cleanProof = (rec) => tryRun(BUYER, 'proveAncestorClean', rec) === '';

/**
 * A full verification: the chain must be genuine AND every link unencumbered.
 *
 * verifyDescent walks the confirmed graph itself and requires every ancestor it
 * finds to have been proven clean, so the buyer is not taking the seller's word for
 * which ancestors exist.
 */
const verify = (record, claimedChain) => {
  const genuine = graph.verifyChain(record, claimedChain);
  if (!genuine.ok) return { ok: false, why: `ancestry rejected — ${genuine.reason}` };
  if (!cleanProof(record)) return { ok: false, why: 'this record carries an unmet obligation' };
  // The buyer clears the ancestors it has proofs for, then makes the graph prove
  // nothing was left out.
  const provenClean = claimedChain.filter(cleanProof).map(hex);
  const walked = graph.verifyDescent(record, provenClean);
  if (!walked.ok) return { ok: false, why: walked.reason };
  return { ok: true, ancestorsChecked: walked.ancestorsChecked };
};

const report = (label, r) => line(`   ${label.padEnd(34)} ${r.ok ? 'ACCEPTED' : 'REJECTED — ' + r.why}`);

rule();
line('VEILCORE — HERITABLE RIGHTS');
line('Obligations that inherit through descent, proven without revealing genetics or terms.');
rule();
line();

line('1. A breeder holds a cultivar and licenses it with a royalty on offspring.');
const MOTHER = sec('mother-gelato-41'), DAUGHTER = sec('daughter-tc-batch-114');
const BREEDER = sec('breeder'), STRANGER = sec('unrelated-clean-record');
const mother = C.commit(MOTHER);
const daughter = C.commit(DAUGHTER);
const stranger = C.commit(STRANGER);
const royalty = sec('royalty-8pct-to-breeder');

line(`   Mother     ${short(mother)}`);
line(`   Daughter   ${short(daughter)}`);
line(`   Obligations in force: ${state().openObligations.size()}`);
line();

line('2. The lab propagates. The daughter proposes the parent link; the mother confirms.');
confirmEdge(DAUGHTER, MOTHER);
line(`   Descent edge  ${short(state().lastDescent)}  (public, permanent)`);
line();

line('3. The breeder proposes the royalty against the mother; her holder accepts it.');
run(BREEDER, 'proposeObligation', mother, royalty);
run(MOTHER, 'acceptObligation', royalty, C.commit(BREEDER));
line(`   Obligations in force: ${state().openObligations.size()}  (owed to ${short(state().lastBeneficiary)})`);
line();

line('4. A buyer asks the daughter to prove clean descent.');
line();
report('honest claim', verify(daughter, [mother]));
line('   The obligation upstream blocks the sale, three words of information.');
line();

line('5. The seller tries to route around it by naming a clean stranger as parent.');
report('spoofed ancestry', verify(daughter, [stranger]));
line('   The clean proof for the stranger would have verified — the descent graph');
line('   is what catches this, and the stranger never confirmed an edge to it.');
line('   Neither mechanism is sufficient alone.');
line();

line('6. The seller tries omitting the ancestry entirely.');
report('empty claim', verify(daughter, []));
line();

line('7. The royalty is paid and the breeder discharges the obligation.');
line(`   The holder cannot do it: ${tryRun(MOTHER, 'discharge', mother, royalty) ? 'refused' : 'ALLOWED'}`);
run(BREEDER, 'discharge', mother, royalty);
line(`   Back to empty: ${state().openObligations.isEmpty() && state().obligationCountOf.isEmpty() ? 'yes' : 'no'}`);
line();
report('honest claim, obligation cleared', verify(daughter, [mother]));
line();

rule();
line('WHAT THE BUYER LEARNED');
line('  accepted or rejected, and nothing else');
line();
line('WHAT WAS NEVER DISCLOSED');
line('  · the genetics — no sequence data exists anywhere in this system');
line('  · the terms — the royalty is a commitment, never a value');
line('  · the secrets — every party acts under a secret only its commitment reveals');
line();
line('WHAT IS DISCLOSED');
line('  · which ancestor was cleared, and by whom. A proof whose subject is hidden');
line('    is a proof a verifier cannot join to a descent edge. A commitment is a hash,');
line('    so what it costs is correlation, not genetics.');
line('  · both ends of every confirmed edge, and the record, obligation commitment');
line('    and beneficiary of every accepted or discharged obligation — so anyone can');
line('    rebuild the graph and the obligation set without the registry.');
line();
line('WHAT THE CHAIN HOLDS');
line('  · four counters and the last event\'s cells');
line('  · open proposals and obligations in force — bounded by open business, not by');
line('    usage: every entry is removed by the circuit that ends it');
line(`  · right now: ${state().openObligations.size()} open, ${state().pendingObligations.size()} proposed, ${state().pendingParentOf.size()} parentage offers pending`);
rule();
