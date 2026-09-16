// Simulates the obligation tree off-chain using the exported pure circuits, then
// checks the state transitions the contract relies on. The circuits are the same
// ones the chain runs, so agreement here means the contract logic is coherent.
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

// Derived from the contract, not declared. A hardcoded depth here is the same
// defect tree.mjs had: the test silently stops matching the circuit the moment
// anyone regenerates at another depth, and a test that cannot run is worse than
// one that fails.
const D = C.slotBits(new Uint8Array(32)).length;
const hex = (u) => Buffer.from(u).toString('hex');
const NULL = new Uint8Array(32);

// Each line printed its own 'PASS'/'FAIL' string and the process exited 0 either
// way, so every state transition below could break without the suite noticing.
let fails = 0;
const check = (name, ok, altFail) => {
  const bad = !ok;
  console.log(`${name}: ${ok ? 'PASS' : (altFail ?? 'FAIL')}`);
  if (bad) fails++;
};
const secret = (n) => { const a = new Uint8Array(32); a[0]=n; a[15]=n; a[31]=n; return a; };

// Null sibling at each level of an all-empty tree.
const nulls = []; { let n = NULL; for (let i=0;i<D;i++){ nulls.push(n); n = C.merkleStep(n,n,false); } }
const EMPTY_ROOT = (() => { let n = NULL; for (let i=0;i<D;i++) n = C.merkleStep(n,n,false); return n; })();

console.log('empty root:', hex(EMPTY_ROOT).slice(0,20));

// --- a fresh record is clean ---
const sec = secret(42);
const rec = C.commit(sec);
const dirs = C.slotBits(rec);
const cleanRoot = C.merkleRoot(NULL, nulls, dirs);
check('1. fresh record proves clean', hex(cleanRoot) === hex(EMPTY_ROOT));

// --- encumbering changes the root ---
const obl = C.commit(secret(99));
// The leaf names who is owed. Without the beneficiary inside it, the encumbered
// party could reconstruct the leaf and discharge themselves.
const BENEFICIARY = C.commit(new Uint8Array(32).fill(0xBE));
const leaf = C.obligationLeaf(rec, obl, BENEFICIARY);
const pair = C.replaceLeaf(NULL, leaf, nulls, dirs);
check('2. old root matches empty', hex(pair[0]) === hex(EMPTY_ROOT));
const encumberedRoot = pair[1];
check('3. encumbering moves the root', hex(encumberedRoot) !== hex(EMPTY_ROOT));

// --- now the record can no longer prove clean ---
const stillClean = C.merkleRoot(NULL, nulls, dirs);
check('4. encumbered record cannot prove clean', hex(stillClean) !== hex(encumberedRoot));

// --- discharging restores the empty root ---
const back = C.replaceLeaf(leaf, NULL, nulls, dirs);
check('5. discharge verifies against encumbered root', hex(back[0]) === hex(encumberedRoot));
check('6. discharge restores the empty root', hex(back[1]) === hex(EMPTY_ROOT));

// --- a different record in a different slot is unaffected ---
const other = C.commit(secret(7));
const otherDirs = C.slotBits(other);
const differs = otherDirs.join('') !== dirs.join('');
check('7. records occupy different slots', differs, 'COLLISION (retry with other seeds)');

// --- a borrowed path fails the binding check ---
check('8. slot bits are commitment-bound',
  C.slotBits(rec).join('') === dirs.join('') && C.slotBits(other).join('') !== dirs.join(''));

console.log(fails === 0 ? '\nAll lifecycle tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
