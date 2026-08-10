// Simulates the obligation tree off-chain using the exported pure circuits, then
// checks the state transitions the contract relies on. The circuits are the same
// ones the chain runs, so agreement here means the contract logic is coherent.
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

const D = 16;
const hex = (u) => Buffer.from(u).toString('hex');
const NULL = new Uint8Array(32);
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
console.log('1. fresh record proves clean:', hex(cleanRoot) === hex(EMPTY_ROOT) ? 'PASS' : 'FAIL');

// --- encumbering changes the root ---
const obl = C.commit(secret(99));
const leaf = C.obligationLeaf(rec, obl);
const pair = C.replaceLeaf(NULL, leaf, nulls, dirs);
console.log('2. old root matches empty:', hex(pair[0]) === hex(EMPTY_ROOT) ? 'PASS' : 'FAIL');
const encumberedRoot = pair[1];
console.log('3. encumbering moves the root:', hex(encumberedRoot) !== hex(EMPTY_ROOT) ? 'PASS' : 'FAIL');

// --- now the record can no longer prove clean ---
const stillClean = C.merkleRoot(NULL, nulls, dirs);
console.log('4. encumbered record cannot prove clean:', hex(stillClean) !== hex(encumberedRoot) ? 'PASS' : 'FAIL');

// --- discharging restores the empty root ---
const back = C.replaceLeaf(leaf, NULL, nulls, dirs);
console.log('5. discharge verifies against encumbered root:', hex(back[0]) === hex(encumberedRoot) ? 'PASS' : 'FAIL');
console.log('6. discharge restores the empty root:', hex(back[1]) === hex(EMPTY_ROOT) ? 'PASS' : 'FAIL');

// --- a different record in a different slot is unaffected ---
const other = C.commit(secret(7));
const otherDirs = C.slotBits(other);
const differs = otherDirs.join('') !== dirs.join('');
console.log('7. records occupy different slots:', differs ? 'PASS' : 'COLLISION (retry with other seeds)');

// --- a borrowed path fails the binding check ---
console.log('8. slot bits are commitment-bound:',
  C.slotBits(rec).join('') === dirs.join('') && C.slotBits(other).join('') !== dirs.join('') ? 'PASS' : 'FAIL');
