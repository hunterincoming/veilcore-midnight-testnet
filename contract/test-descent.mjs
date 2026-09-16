import { DescentGraph } from './src/descent.mjs';
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

const secret = (s) => { const a = new Uint8Array(32); for (let i=0;i<s.length&&i<32;i++) a[i]=s.charCodeAt(i); a[31]=s.length; return a; };
const hex = (u) => Buffer.from(u).toString('hex');
let fails = 0;
const check = (n, ok) => { console.log(ok ? ' PASS' : ' FAIL', n); if (!ok) fails++; };

const g = new DescentGraph();
const mother = C.commit(secret('mother'));
const daughter = C.commit(secret('daughter'));
const grand = C.commit(secret('granddaughter'));
const unrelated = C.commit(secret('unrelated-clean'));

g.observe(daughter, mother);
g.observe(grand, daughter);

check('honest single-generation chain accepted', g.verifyChain(daughter, [mother]).ok);
check('honest two-generation chain accepted', g.verifyChain(grand, [daughter, mother]).ok);

const spoof = g.verifyChain(daughter, [unrelated]);
check('spoofed ancestor rejected', spoof.ok === false);
console.log('   reason:', spoof.reason);

// This was labelled "skipping a generation rejected" and caught something else.
// grand's parent is daughter, not mother, so it fails on SUBSTITUTION — no declared
// edge — and would have passed whatever verifyChain did about omission.
const wrongParent = g.verifyChain(grand, [mother]);
check('naming a non-parent rejected', wrongParent.ok === false);

// A real omission: a chain that stops short rather than one that names the wrong
// party. verifyChain accepts these by design — it checks the links it is given and
// cannot know what was left out — which is why verifyDescent walks the graph itself.
const truncated = g.verifyChain(grand, [daughter]);
check('verifyChain accepts a truncated chain, as documented', truncated.ok === true);

const walked = g.verifyDescent(grand, [hex(daughter)]);
check('verifyDescent refuses a truncated chain', walked.ok === false);
console.log('   reason:', walked.reason);

const complete = g.verifyDescent(grand, [hex(daughter), hex(mother)]);
check('verifyDescent accepts a complete one', complete.ok === true);

check('graph reports full ancestry depth', g.ancestorCount(grand) === 2);
check('an undeclared record has no ancestors', g.ancestorCount(unrelated) === 0);

console.log(fails === 0 ? '\nAll descent-graph tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
