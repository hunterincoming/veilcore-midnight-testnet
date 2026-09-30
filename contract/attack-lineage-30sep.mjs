/**
 * Lineage security pass, 30 Sep 2026: every attack, against the compiled artifact.
 *
 * The first three sections are the attacks confirmed against the previous
 * (tree-based) build: unilateral encumbrance poisoning a stranger's record, a
 * squatter's claim locking out the real one, and a proof prepared before an
 * encumbrance still passing after it. See docs/security-pass-30sep.md.
 *
 *   node contract/attack-lineage-30sep.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();
const C = L.pureCircuits;
const Z = new Uint8Array(32);

const party = (own) => new L.Contract({ localGeneticSecret: (c) => [c.privateState, own] });
let ctx;
const fresh = () => {
  ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN,
    party(sec('deployer')).initialState(rt.createConstructorContext({}, COIN)).currentContractState, {});
};
const run = (who, circuit, ...args) => { const r = party(who).impureCircuits[circuit](ctx, ...args); ctx = r.context; return r; };
const tryRun = (who, circuit, ...args) => { try { run(who, circuit, ...args); return ''; } catch (e) { return String(e?.message ?? e); } };
const state = () => L.ledger(ctx.currentQueryContext.state);
const clean = (ancestor, buyer = BUYER) => tryRun(buyer, 'proveAncestorClean', ancestor) === '';

const GROWER = sec('grower'), BREEDER = sec('breeder'), COMPETITOR = sec('competitor'), BUYER = sec('buyer');
const GROWER_REC = C.commit(GROWER), BREEDER_REC = C.commit(BREEDER);
const ROYALTY = sec('royalty-terms'), FAKE = sec('fake-claim');

// ── 1. a stranger cannot encumber a record ─────────────────────────────────
console.log('\n== 1. can a stranger poison a record? ==');
{
  fresh();
  ok('a competitor may PROPOSE a claim', tryRun(COMPETITOR, 'proposeObligation', GROWER_REC, FAKE) === '');
  ok('but the record still proves clean: a proposal binds nobody', clean(GROWER_REC),
    'before the fix a stranger\'s encumbrance failed every clean proof, releasable only by the stranger');
  ok('the competitor cannot accept on the grower\'s behalf',
    tryRun(COMPETITOR, 'acceptObligation', FAKE, C.commit(COMPETITOR)) !== '' && clean(GROWER_REC));
}

// ── 2. the consent flow, and a squatter cannot lock out the real claim ─────
console.log('\n== 2. real obligations, alongside anyone else\'s ==');
{
  fresh();
  // A competitor's unaccepted proposal sits against the grower's record first.
  run(COMPETITOR, 'proposeObligation', GROWER_REC, FAKE);
  run(BREEDER, 'proposeObligation', GROWER_REC, ROYALTY);
  const err = tryRun(GROWER, 'acceptObligation', ROYALTY, BREEDER_REC);
  ok('the grower accepts the breeder\'s royalty despite the squatter', err === '', err);
  ok('the record now carries an obligation', !clean(GROWER_REC));
  ok('the proposal is gone and the obligation is open',
    !state().pendingObligations.member(C.obligationKey(GROWER_REC, ROYALTY, BREEDER_REC)) &&
    state().openObligations.member(C.obligationKey(GROWER_REC, ROYALTY, BREEDER_REC)));
  ok('the parties are published so anyone can rebuild the set',
    Buffer.from(state().lastObligationRecord).equals(Buffer.from(GROWER_REC)) &&
    Buffer.from(state().lastBeneficiary).equals(Buffer.from(BREEDER_REC)));

  // Two obligations on one record; releasing one does not clear the other.
  const SECOND = sec('second-breeder');
  run(SECOND, 'proposeObligation', GROWER_REC, ROYALTY);
  run(GROWER, 'acceptObligation', ROYALTY, C.commit(SECOND));
  ok('a second obligation on the same record is recorded', state().obligationCountOf.lookup(GROWER_REC) === 2n);
  run(BREEDER, 'discharge', GROWER_REC, ROYALTY);
  ok('releasing one leaves the other in force', !clean(GROWER_REC));
  run(SECOND, 'discharge', GROWER_REC, ROYALTY);
  ok('releasing both makes the record clean again', clean(GROWER_REC));
  ok('and leaves no entry behind', !state().obligationCountOf.member(GROWER_REC));
}

// ── 3. who may release ──────────────────────────────────────────────────────
console.log('\n== 3. only the beneficiary releases ==');
{
  fresh();
  run(BREEDER, 'proposeObligation', GROWER_REC, ROYALTY);
  run(GROWER, 'acceptObligation', ROYALTY, BREEDER_REC);
  ok('the grower cannot discharge their own obligation', tryRun(GROWER, 'discharge', GROWER_REC, ROYALTY) !== '');
  ok('a stranger cannot discharge it', tryRun(COMPETITOR, 'discharge', GROWER_REC, ROYALTY) !== '');
  ok('the grower cannot withdraw it once accepted', tryRun(GROWER, 'withdrawObligation', GROWER_REC, ROYALTY) !== '');
  ok('it is still in force', !clean(GROWER_REC));
  ok('the beneficiary discharges it', tryRun(BREEDER, 'discharge', GROWER_REC, ROYALTY) === '' && clean(GROWER_REC));
  ok('it cannot be discharged twice', tryRun(BREEDER, 'discharge', GROWER_REC, ROYALTY) !== '');
}

// ── 4. no stale window ──────────────────────────────────────────────────────
console.log('\n== 4. can a proof prepared before an encumbrance still pass? ==');
{
  fresh();
  ok('clean before', clean(GROWER_REC));
  run(BREEDER, 'proposeObligation', GROWER_REC, ROYALTY);
  run(GROWER, 'acceptObligation', ROYALTY, BREEDER_REC);
  ok('refused immediately after: a clean proof reads the state it executes against', !clean(GROWER_REC),
    'the tree build accepted any of the last 8 roots, so a seller could defeat a fresh encumbrance');
}

// ── 5. proposals and withdrawals ───────────────────────────────────────────
console.log('\n== 5. proposals ==');
{
  fresh();
  run(BREEDER, 'proposeObligation', GROWER_REC, ROYALTY);
  ok('the same proposal cannot be made twice', tryRun(BREEDER, 'proposeObligation', GROWER_REC, ROYALTY) !== '');
  ok('a stranger cannot withdraw the breeder\'s proposal', tryRun(COMPETITOR, 'withdrawObligation', GROWER_REC, ROYALTY) !== '');
  ok('the breeder withdraws it', tryRun(BREEDER, 'withdrawObligation', GROWER_REC, ROYALTY) === '');
  ok('a withdrawn proposal cannot be accepted', tryRun(GROWER, 'acceptObligation', ROYALTY, BREEDER_REC) !== '');
  ok('a record cannot owe itself', tryRun(GROWER, 'proposeObligation', GROWER_REC, ROYALTY) !== '');
  run(BREEDER, 'proposeObligation', GROWER_REC, ROYALTY);
  run(GROWER, 'acceptObligation', ROYALTY, BREEDER_REC);
  ok('an obligation in force cannot be re-proposed', tryRun(BREEDER, 'proposeObligation', GROWER_REC, ROYALTY) !== '');
}

// ── 6. descent ──────────────────────────────────────────────────────────────
console.log('\n== 6. descent edges take both holders ==');
{
  fresh();
  ok('the child proposes its parent', tryRun(GROWER, 'proposeParent', BREEDER_REC) === '');
  ok('a stranger cannot confirm it', tryRun(COMPETITOR, 'confirmParent', GROWER_REC) !== '');
  ok('one live proposal per child', tryRun(GROWER, 'proposeParent', C.commit(sec('other'))) !== '');
  ok('a stranger cannot withdraw the child\'s proposal', (() => {
    tryRun(COMPETITOR, 'withdrawParent');
    return state().pendingParentOf.member(GROWER_REC);
  })());
  ok('the named parent confirms', tryRun(BREEDER, 'confirmParent', GROWER_REC) === '');
  ok('the edge is published, both ends named',
    Buffer.from(state().lastDescentChild).equals(Buffer.from(GROWER_REC)) &&
    Buffer.from(state().lastDescentParent).equals(Buffer.from(BREEDER_REC)) &&
    Buffer.from(state().lastDescent).equals(Buffer.from(C.descentEdge(GROWER_REC, BREEDER_REC))));
  ok('it cannot be confirmed twice', tryRun(BREEDER, 'confirmParent', GROWER_REC) !== '');

  // Substitution: the child re-proposes elsewhere; the original parent's confirm lands on nothing.
  run(GROWER, 'proposeParent', C.commit(sec('clean-stranger')));
  ok('a parent cannot confirm a proposal naming someone else', tryRun(BREEDER, 'confirmParent', GROWER_REC) !== '');
  ok('the child withdraws its own', tryRun(GROWER, 'withdrawParent') === '');
  ok('a record is not its own parent', tryRun(GROWER, 'proposeParent', GROWER_REC) !== '');
}

// ── 7. clean proofs ─────────────────────────────────────────────────────────
console.log('\n== 7. clean proofs name both sides ==');
{
  fresh();
  run(BUYER, 'proveAncestorClean', BREEDER_REC);
  ok('the proof names the claimant and the ancestor',
    Buffer.from(state().lastCleanProofBy).equals(Buffer.from(C.commit(BUYER))) &&
    Buffer.from(state().lastClearedAncestor).equals(Buffer.from(BREEDER_REC)));
  ok('a record is not its own ancestor', tryRun(BREEDER, 'proveAncestorClean', BREEDER_REC) !== '');
}

// ── 8. every argument validated ────────────────────────────────────────────
console.log('\n== 8. empty (all-zero) inputs ==');
{
  fresh();
  ok('proposeParent(empty)', tryRun(GROWER, 'proposeParent', Z) !== '');
  ok('proposeObligation(empty record)', tryRun(BREEDER, 'proposeObligation', Z, ROYALTY) !== '');
  ok('proposeObligation(empty obligation)', tryRun(BREEDER, 'proposeObligation', GROWER_REC, Z) !== '');
  ok('proveAncestorClean(empty)', tryRun(BUYER, 'proveAncestorClean', Z) !== '');
}

// ── 9. the interface itself ────────────────────────────────────────────────
console.log('\n== 9. no circuit takes a secret, and none takes the caller\'s own record ==');
{
  const info = JSON.parse(readFileSync(path.join(here, 'src/managed/lineage/compiler/contract-info.json'), 'utf8'));
  for (const c of info.circuits.filter((x) => !x.pure)) {
    const names = c.arguments.map((a) => a.name);
    ok(`${c.name}(${names.join(', ') || ''}) takes no secret`, !names.some((n) => /secret/i.test(n)));
  }
  const argsOf = (n) => info.circuits.find((c) => c.name === n).arguments.map((a) => a.name);
  ok('proposeParent / withdrawParent / acceptObligation derive the caller\'s record',
    !argsOf('proposeParent').includes('childCommitment') && argsOf('withdrawParent').length === 0 &&
    !argsOf('acceptObligation').includes('recordCommitment'));
  ok('one witness only: the caller\'s secret', info.witnesses.length === 1);
}

console.log(bad === 0 ? '\nlineage security pass 30 Sep: all attacks refused' : `\n${bad} FAILURE(S)`);
process.exit(bad === 0 ? 0 : 1);
