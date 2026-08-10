// Heritable rights, demonstrated.
//
// Every IP registry records objects. Biological IP is not an object — a cut becomes
// a mother becomes ten thousand clones, and a claim from upstream rides along with
// every one of them. A licence agreement cannot bind a plant that does not exist
// yet. This can.
//
// Runs the contract's real circuits off-chain, so every hash and every proof check
// is the same code the chain executes.
//
// SPDX-License-Identifier: Apache-2.0

import { ObligationTree, EMPTY_ROOT } from './src/tree.mjs';
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const short = (u) => hex(u).slice(0, 16) + '…';
const secret = (label) => {
  const a = new Uint8Array(32);
  for (let i = 0; i < label.length && i < 32; i++) a[i] = label.charCodeAt(i);
  a[31] = label.length;
  return a;
};
const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(72));

// The registry's obligation tree. On chain only its root is stored.
const tree = new ObligationTree();

// Verifies a clean-descent claim exactly as the circuit does: fold the null leaf
// up the supplied path and compare to the root the chain holds.
const provesClean = (recordCommitment) => {
  const dirs = C.slotBits(recordCommitment);
  const folded = C.merkleRoot(new Uint8Array(32), tree.siblingsFor(dirs), dirs);
  return hex(folded) === hex(tree.root());
};

rule();
line('VEILCORE — HERITABLE RIGHTS');
line('Obligations that inherit through descent, proven without revealing lineage.');
rule();
line();

// ── Act 1 ──────────────────────────────────────────────────────────────────
line('1. A breeder holds a cultivar.');
const motherSecret = secret('mother-gelato-41');
const mother = C.commit(motherSecret);
line(`   Mother record   ${short(mother)}`);
line(`   Registry root   ${short(tree.root())}  (empty — no obligations outstanding)`);
line(`   Proves clean?   ${provesClean(mother) ? 'yes' : 'no'}`);
line();

// ── Act 2 ──────────────────────────────────────────────────────────────────
line('2. The breeder licenses it to a lab, with a royalty owed on offspring.');
const royalty = C.commit(secret('royalty-8pct-to-breeder'));
const e = tree.encumber(mother, royalty);
line(`   Obligation      ${short(royalty)}`);
line(`   Root before     ${short(e.oldRoot)}`);
line(`   Root after      ${short(e.newRoot)}`);
line(`   Mother clean?   ${provesClean(mother) ? 'yes' : 'NO — an obligation is outstanding'}`);
line();

// ── Act 3 ──────────────────────────────────────────────────────────────────
line('3. The lab propagates. A daughter cultivar is created and its parent declared.');
const daughterSecret = secret('daughter-tc-batch-114');
const daughter = C.commit(daughterSecret);
const edge = C.descentEdge(daughter, mother);
line(`   Daughter record ${short(daughter)}`);
line(`   Descent edge    ${short(edge)}  (disclosed into the transaction, not stored)`);
line();

// ── Act 4 ──────────────────────────────────────────────────────────────────
line('4. A buyer asks the daughter to prove clean descent.');
line();
line('   The daughter\'s own slot is untouched, so a naive check passes:');
line(`     daughter slot clean?  ${provesClean(daughter) ? 'yes' : 'no'}`);
line();
line('   But clean descent requires every ancestor to be clean too. The prover');
line('   supplies one proof per generation, each against the same registry root:');
line(`     generation 1 (mother)  ${provesClean(mother) ? 'clean' : 'BLOCKED — unmet obligation'}`);
line();
line('   Result: the sale cannot complete on a clean-descent basis.');
line('   The buyer learns only that. Not who the ancestor is, not what is owed.');
line();

// ── Act 5 ──────────────────────────────────────────────────────────────────
line('5. The royalty is paid. The breeder discharges the obligation.');
const d = tree.discharge(mother, royalty);
line(`   Root before     ${short(d.oldRoot)}`);
line(`   Root after      ${short(d.newRoot)}`);
line(`   Back to empty?  ${hex(d.newRoot) === hex(EMPTY_ROOT) ? 'yes' : 'no'}`);
line();

// ── Act 6 ──────────────────────────────────────────────────────────────────
line('6. The daughter proves clean descent and the sale completes.');
line(`     generation 1 (mother)  ${provesClean(mother) ? 'clean' : 'BLOCKED'}`);
line(`     daughter               ${provesClean(daughter) ? 'clean' : 'BLOCKED'}`);
line();

rule();
line('WHAT WAS NEVER DISCLOSED');
line('  · the genetics — no sequence data exists anywhere in this system');
line('  · the ancestry — the buyer never learns which cultivar the mother was');
line('  · the terms — the royalty percentage is a commitment, never a value');
line('  · the depth — every proof costs the same regardless of generations');
line();
line('WHAT THE CHAIN HOLDS');
line('  · four counters and one 32-byte root — state does not grow with usage');
line(`  · current root: ${hex(tree.root()).slice(0, 32)}…`);
rule();
