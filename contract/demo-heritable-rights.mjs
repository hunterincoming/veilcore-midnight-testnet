// Heritable rights, demonstrated.
//
// Every IP registry records objects. Biological IP is not an object — a cut becomes
// a mother becomes ten thousand clones, and a claim from upstream rides along with
// every one of them. A licence agreement cannot bind a plant that does not exist
// yet. This can.
//
// Two mechanisms, and both are necessary:
//   the Merkle proof shows a claimed ancestor carries no obligation
//   the descent graph shows the claimed ancestor is the real one
//
// Runs the contract's real circuits, so every hash is what the chain computes.
// SPDX-License-Identifier: Apache-2.0

import { ObligationTree, EMPTY_ROOT } from './src/tree.mjs';
import { DescentGraph } from './src/descent.mjs';
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const short = (u) => hex(u).slice(0, 16) + '…';
const secret = (s) => { const a = new Uint8Array(32); for (let i=0;i<s.length&&i<32;i++) a[i]=s.charCodeAt(i); a[31]=s.length; return a; };
const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(74));

const tree = new ObligationTree();
const graph = new DescentGraph();

const merkleClean = (rec) => {
  const d = C.slotBits(rec);
  return hex(C.merkleRoot(new Uint8Array(32), tree.siblingsFor(d), d)) === hex(tree.root());
};

/** A full verification: the chain must be genuine AND every link unencumbered. */
const verify = (record, claimedChain) => {
  const genuine = graph.verifyChain(record, claimedChain);
  if (!genuine.ok) return { ok: false, why: `ancestry rejected — ${genuine.reason}` };
  if (claimedChain.length < graph.requiredChainLength(record))
    return { ok: false, why: 'ancestry incomplete — a generation was omitted' };
  if (!merkleClean(record)) return { ok: false, why: 'this record carries an unmet obligation' };
  for (const a of claimedChain)
    if (!merkleClean(a)) return { ok: false, why: 'an ancestor carries an unmet obligation' };
  return { ok: true };
};

const report = (label, r) => line(`   ${label.padEnd(34)} ${r.ok ? 'ACCEPTED' : 'REJECTED — ' + r.why}`);

rule();
line('VEILCORE — HERITABLE RIGHTS');
line('Obligations that inherit through descent, proven without revealing lineage.');
rule();
line();

line('1. A breeder holds a cultivar and licenses it with a royalty on offspring.');
const mother = C.commit(secret('mother-gelato-41'));
const daughter = C.commit(secret('daughter-tc-batch-114'));
const stranger = C.commit(secret('unrelated-clean-record'));
const royalty = C.commit(secret('royalty-8pct-to-breeder'));

line(`   Mother     ${short(mother)}`);
line(`   Daughter   ${short(daughter)}`);
line(`   Registry   ${short(tree.root())}  (empty)`);
line();

line('2. The lab propagates. The parent link is declared on chain.');
graph.observe(daughter, mother);
line(`   Descent edge  ${short(C.descentEdge(daughter, mother))}  (public, permanent)`);
line();

line('3. The royalty is attached to the mother.');
const e = tree.encumber(mother, royalty);
line(`   Root  ${short(e.oldRoot)}  →  ${short(e.newRoot)}`);
line();

line('4. A buyer asks the daughter to prove clean descent.');
line();
report('honest claim', verify(daughter, [mother]));
line('   The obligation upstream blocks the sale, three words of information.');
line();

line('5. The seller tries to route around it by naming a clean stranger as parent.');
report('spoofed ancestry', verify(daughter, [stranger]));
line('   The Merkle proof for the stranger would have verified — the descent graph');
line('   is what catches this. Neither mechanism is sufficient alone.');
line();

line('6. The seller tries omitting the ancestry entirely.');
report('empty claim', verify(daughter, []));
line();

line('7. The royalty is paid and the obligation discharged.');
const d = tree.discharge(mother, royalty);
line(`   Root  ${short(d.oldRoot)}  →  ${short(d.newRoot)}`);
line(`   Back to empty: ${hex(d.newRoot) === hex(EMPTY_ROOT) ? 'yes' : 'no'}`);
line();
report('honest claim, obligation cleared', verify(daughter, [mother]));
line();

rule();
line('WHAT THE BUYER LEARNED');
line('  accepted or rejected, and nothing else');
line();
line('WHAT WAS NEVER DISCLOSED');
line('  · the genetics — no sequence data exists anywhere in this system');
line('  · which ancestor was checked, or what it was');
line('  · the terms — the royalty is a commitment, never a value');
line('  · the depth — every proof costs the same regardless of generations');
line();
line('WHAT THE CHAIN HOLDS');
line('  · four counters and one 32-byte root — state does not grow with usage');
line(`  · current root  ${hex(tree.root()).slice(0, 32)}…`);
rule();
