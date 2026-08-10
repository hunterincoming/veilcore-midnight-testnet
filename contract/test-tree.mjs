// Off-chain tree builder against the contract's own circuits. A single-leaf test
// passes even when the builder is broken — the multi-leaf cases are the ones that
// catch a wrong sibling, so they run first.
import { ObligationTree, EMPTY_ROOT } from './src/tree.mjs';
import { pureCircuits as C } from './src/managed/lineage/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const secret = (n) => { const a = new Uint8Array(32); a[0]=n; a[7]=(n*3)%256; a[31]=n; return a; };
let failures = 0;
const check = (name, ok) => { console.log(ok ? ' PASS' : ' FAIL', name); if (!ok) failures++; };

const t = new ObligationTree();
check('empty tree matches the empty-root constant', hex(t.root()) === hex(EMPTY_ROOT));

// Eight obligations, so most subtrees hold more than one leaf.
const recs = [], obls = [];
for (let i = 1; i <= 8; i++) { recs.push(C.commit(secret(i))); obls.push(C.commit(secret(100 + i))); }
for (let i = 0; i < 8; i++) t.encumber(recs[i], obls[i]);

const root = t.root();
let allVerify = true;
for (let i = 0; i < 8; i++) {
  const dirs = C.slotBits(recs[i]);
  const r = C.merkleRoot(C.obligationLeaf(recs[i], obls[i]), t.siblingsFor(dirs), dirs);
  if (hex(r) !== hex(root)) allVerify = false;
}
check('all 8 encumbered paths fold to the current root', allVerify);

const cd = C.slotBits(C.commit(secret(200)));
check('an untouched record still proves clean',
  hex(C.merkleRoot(new Uint8Array(32), t.siblingsFor(cd), cd)) === hex(root));

// Discharging one must not disturb the others.
t.discharge(recs[3], obls[3]);
const afterRoot = t.root();
let othersOk = true;
for (const i of [0, 1, 2, 4, 5, 6, 7]) {
  const dirs = C.slotBits(recs[i]);
  const r = C.merkleRoot(C.obligationLeaf(recs[i], obls[i]), t.siblingsFor(dirs), dirs);
  if (hex(r) !== hex(afterRoot)) othersOk = false;
}
check('discharging one leaves the other seven verifiable', othersOk);

const dd = C.slotBits(recs[3]);
check('the discharged record can now prove clean',
  hex(C.merkleRoot(new Uint8Array(32), t.siblingsFor(dd), dd)) === hex(afterRoot));

// Clearing everything must return exactly to the empty root.
for (const i of [0, 1, 2, 4, 5, 6, 7]) t.discharge(recs[i], obls[i]);
check('clearing all obligations restores the empty root', hex(t.root()) === hex(EMPTY_ROOT));

console.log(failures === 0 ? '\nAll tree tests passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
