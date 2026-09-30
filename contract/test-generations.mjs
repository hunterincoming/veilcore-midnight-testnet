// Multi-generation descent. The single-generation demo proves an obligation blocks
// a daughter. The real claim is that it reaches every descendant, however far down —
// and that a clean line stays clean regardless of what happens elsewhere.
//
// Runs against the compiled contract: edges are confirmed on chain by both holders,
// obligations are proposed by the beneficiary and accepted by the holder, and
// "clean" means proveAncestorClean succeeds for a buyer asking about that record.
import { createHash } from 'node:crypto';
import * as L from './src/managed/lineage/contract/index.js';
import * as rt from '@midnight-ntwrk/compact-runtime';

const C = L.pureCircuits;
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();
let fails = 0;
const check = (name, ok) => { console.log(ok ? ' PASS' : ' FAIL', name); if (!ok) fails++; };

const party = (own) => new L.Contract({ localGeneticSecret: (c) => [c.privateState, own] });
let ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN,
  party(sec('deployer')).initialState(rt.createConstructorContext({}, COIN)).currentContractState, {});
const run = (who, circuit, ...args) => { ctx = party(who).impureCircuits[circuit](ctx, ...args).context; };
const tryRun = (who, circuit, ...args) => { try { run(who, circuit, ...args); return ''; } catch (e) { return String(e?.message ?? e); } };
const state = () => L.ledger(ctx.currentQueryContext.state);

// Obligations name who is owed. Only the beneficiary can release, so the
// encumbered party cannot release themselves.
const BENEFICIARY = sec('beneficiary');
const BUYER = sec('buyer');

// A record is clean if a buyer's clean proof about it executes.
const clean = (rec) => tryRun(BUYER, 'proveAncestorClean', rec) === '';
// A lineage is clean only if every generation is.
const lineageClean = (chain) => chain.every(clean);

const encumber = (rec, recSecret, obl) => {
  run(BENEFICIARY, 'proposeObligation', rec, obl);
  run(recSecret, 'acceptObligation', obl, C.commit(BENEFICIARY));
};
const discharge = (rec, obl) => run(BENEFICIARY, 'discharge', rec, obl);

// Four generations: G0 → G1 → G2 → G3, each edge proposed by the child and
// confirmed by the parent.
const genSec = ['g0-landrace', 'g1-selection', 'g2-backcross', 'g3-production'].map(sec);
const gen = genSec.map((s) => C.commit(s));
for (let i = 1; i < gen.length; i++) {
  run(genSec[i], 'proposeParent', gen[i - 1]);
  run(genSec[i - 1], 'confirmParent', gen[i]);
}
check('three edges confirmed on chain', state().descentSeq === 3n);
console.log('four generations, three confirmed edges\n');

check('a fresh lineage is clean at every generation', lineageClean(gen));

// Encumber the root ancestor.
const obl = sec('breeder-share');
encumber(gen[0], genSec[0], obl);

check('the encumbered ancestor itself is blocked', !clean(gen[0]));
check('generation 3 is blocked through three levels of descent', !lineageClean(gen));
check('generation 3 own record still reads clean in isolation', clean(gen[3]));
console.log('   ↑ this is why a per-record check is not enough — descent must be walked\n');

// An unrelated lineage must be unaffected.
const other = ['x0-unrelated', 'x1-unrelated'].map((n) => C.commit(sec(n)));
check('an unrelated lineage stays clean', lineageClean(other));

// Discharge restores the whole line.
discharge(gen[0], obl);
check('discharging the ancestor clears every descendant', lineageClean(gen));
check('the registry returns to empty',
  state().openObligations.isEmpty() && state().obligationCountOf.isEmpty() && state().pendingObligations.isEmpty());

// Two obligations at different depths.
const o1 = sec('share-a');
const o2 = sec('share-b');
encumber(gen[0], genSec[0], o1);
encumber(gen[2], genSec[2], o2);
check('two obligations at different depths both block', !lineageClean(gen));
discharge(gen[0], o1);
check('clearing the founding ancestor alone leaves the line blocked', !lineageClean(gen));
discharge(gen[2], o2);
check('clearing both releases the line', lineageClean(gen));

console.log(fails === 0 ? '\nAll generation tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
