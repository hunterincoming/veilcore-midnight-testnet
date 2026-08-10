import { DescentGraph } from './src/descent.mjs';
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

const secret = (s) => { const a = new Uint8Array(32); for (let i=0;i<s.length&&i<32;i++) a[i]=s.charCodeAt(i); a[31]=s.length; return a; };
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

const skipped = g.verifyChain(grand, [mother]);
check('skipping a generation rejected', skipped.ok === false);

check('graph reports full ancestry depth', g.requiredChainLength(grand) === 2);
check('an undeclared record has no ancestors', g.requiredChainLength(unrelated) === 0);

console.log(fails === 0 ? '\nAll descent-graph tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
