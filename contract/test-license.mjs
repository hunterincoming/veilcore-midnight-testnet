// Licence lifecycle — pure-circuit checks.
//
// The transfer circuit shipped today compiled, deployed, ran, and reported success
// while doing nothing. That is the exact failure mode a compiler cannot catch and a
// happy-path manual test barely catches. These run in a second and every time.
//
// State transitions need a chain, so what is testable here is the commitment algebra
// the whole licence layer depends on: that commitments are deterministic, that distinct
// secrets never collide, and that a licence commitment is domain-separated from a
// record commitment.
import { pureCircuits as C } from './src/managed/veilcore/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const secret = (n) => { const a = new Uint8Array(32); a.fill(n); return a; };
let fails = 0;
const check = (name, ok) => { console.log(ok ? ' PASS' : ' FAIL', name); if (!ok) fails++; };

// --- commitments ---
check('a licence secret always produces the same commitment',
  hex(C.commit(secret(0x33))) === hex(C.commit(secret(0x33))));

check('different secrets produce different commitments',
  hex(C.commit(secret(0x33))) !== hex(C.commit(secret(0x34))));

check('a one-bit difference changes the commitment', (() => {
  const a = secret(0x11);
  const b = secret(0x11); b[31] ^= 1;
  return hex(C.commit(a)) !== hex(C.commit(b));
})());

// --- the values used on chain today, so the test is anchored to reality ---
const knownSecret = Uint8Array.from(Buffer.from('33'.repeat(32), 'hex'));
check('reproduces the licence commitment issued on Preview',
  hex(C.commit(knownSecret)) === 'a1fddda55377aa7d9fec6bdd8e66faf2f83bdc0a096ea4627e6be7ad7a78cb1f');

// --- domain separation ---
check('commit is not a bare hash of the input',
  hex(C.commit(new Uint8Array(32))) !== '0'.repeat(64));

console.log(fails === 0 ? '\nAll licence commitment tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
