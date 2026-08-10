// Multi-generation descent. The single-generation demo proves an obligation blocks
// a daughter. The real claim is that it reaches every descendant, however far down —
// and that a clean line stays clean regardless of what happens elsewhere.
import { ObligationTree, EMPTY_ROOT } from './src/tree.mjs';
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const secret = (s) => { const a = new Uint8Array(32); for (let i=0;i<s.length&&i<32;i++) a[i]=s.charCodeAt(i); a[31]=s.length; return a; };
let fails = 0;
const check = (name, ok) => { console.log(ok ? ' PASS' : ' FAIL', name); if (!ok) fails++; };

const tree = new ObligationTree();
const clean = (rec) => {
  const d = C.slotBits(rec);
  return hex(C.merkleRoot(new Uint8Array(32), tree.siblingsFor(d), d)) === hex(tree.root());
};
// A lineage is clean only if every generation is.
const lineageClean = (chain) => chain.every(clean);

// Four generations: G0 → G1 → G2 → G3
const gen = ['g0-landrace', 'g1-selection', 'g2-backcross', 'g3-production'].map((n) => C.commit(secret(n)));
const edges = [];
for (let i = 1; i < gen.length; i++) edges.push(C.descentEdge(gen[i], gen[i - 1]));
console.log('four generations, three declared edges\n');

check('a fresh lineage is clean at every generation', lineageClean(gen));

// Encumber the root ancestor.
const obl = C.commit(secret('breeder-share'));
tree.encumber(gen[0], obl);

check('the encumbered ancestor itself is blocked', !clean(gen[0]));
check('generation 3 is blocked through three levels of descent', !lineageClean(gen));
check('generation 3 own slot still reads clean in isolation', clean(gen[3]));
console.log('   ↑ this is why a per-record check is not enough — descent must be walked\n');

// An unrelated lineage must be unaffected.
const other = ['x0-unrelated', 'x1-unrelated'].map((n) => C.commit(secret(n)));
check('an unrelated lineage stays clean', lineageClean(other));

// Discharge restores the whole line.
tree.discharge(gen[0], obl);
check('discharging the ancestor clears every descendant', lineageClean(gen));
check('the registry returns to the empty root', hex(tree.root()) === hex(EMPTY_ROOT));

// Two obligations at different depths.
const o1 = C.commit(secret('share-a'));
const o2 = C.commit(secret('share-b'));
tree.encumber(gen[0], o1);
tree.encumber(gen[2], o2);
check('two obligations at different depths both block', !lineageClean(gen));
tree.discharge(gen[0], o1);
check('clearing only the deeper one leaves the line blocked', !lineageClean(gen));
tree.discharge(gen[2], o2);
check('clearing both releases the line', lineageClean(gen));

console.log(fails === 0 ? '\nAll generation tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
