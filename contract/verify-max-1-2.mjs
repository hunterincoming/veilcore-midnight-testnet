/**
 * Findings 1 and 2, demonstrated fixed.
 *
 * Not "the suite is green" — each check shows the attack or the defect failing
 * now, against the compiled artifact.
 *
 *   node contract/verify-max-1-2.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, 'src/managed/lineage/contract/index.js')).href);
const V = await import(pathToFileURL(path.join(here, 'src/managed/veilcore/contract/index.js')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const COIN = '0'.repeat(64);

// ── finding 1: obligations work on a fresh deployment ───────────────────────
console.log('\n== 1. can an obligation be put in force on a freshly deployed contract? ==');
{
  const secret = createHash('sha256').update('holder').digest();
  const benSecret = createHash('sha256').update('beneficiary').digest();
  const rec = V.pureCircuits.commit(secret);
  const obl = createHash('sha256').update('royalty').digest();
  // An obligation names who is owed, and only they can release it.
  const ben = L.pureCircuits.commit(benSecret);

  const holder = new L.Contract({ localGeneticSecret: (c) => [c.privateState, secret] });
  const beneficiary = new L.Contract({ localGeneticSecret: (c) => [c.privateState, benSecret] });

  // Removed: "the deployed root is the empty tree root" — there is no root; the obligation sets deploy empty.
  const ctor = holder.initialState(rt.createConstructorContext({}, COIN));
  const deployed = L.ledger(ctor.currentContractState.data);
  ok('the obligation sets deploy empty',
     deployed.openObligations.isEmpty() && deployed.pendingObligations.isEmpty() && deployed.obligationCountOf.isEmpty());

  // The thing that had never worked: an obligation reaching the chain at all. It is
  // two transactions now — the beneficiary proposes, the holder accepts.
  const ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN, ctor.currentContractState, {});
  let err = '';
  let after = null;
  try {
    const r1 = beneficiary.impureCircuits.proposeObligation(ctx, rec, obl);
    const r2 = holder.impureCircuits.acceptObligation(r1.context, obl, ben);
    after = L.ledger(r2.context.currentQueryContext.state);
  } catch (e) { err = String(e?.message ?? e); }

  if (err) note(`propose/accept refused: ${err}`);
  ok('an obligation is put in force against a freshly deployed contract', err === '',
     'this call had never succeeded in any deployment of this contract');

  if (after) {
    // Removed: "the root changed" — there is no root; the check below is what an obligation in force now looks like.
    ok('the obligation is in force',
       after.openObligations.member(L.pureCircuits.obligationKey(rec, obl, ben)) &&
       after.obligationCountOf.lookup(rec) === 1n);

    // ── finding 2, lineage side ───────────────────────────────────────────
    console.log('\n== 2a. can a third party rebuild the obligation set from chain state? ==');
    note(`lastObligationRecord: ${hex(after.lastObligationRecord).slice(0, 24)}…`);
    note(`lastObligation      : ${hex(after.lastObligation).slice(0, 24)}…`);
    ok('the encumbered record is on chain',
       hex(after.lastObligationRecord) === hex(rec),
       'if only a digest were published, nobody could tell which record was encumbered');
    ok('the obligation is on chain',
       hex(after.lastObligation) === hex(obl),
       'without the key inputs a third party cannot rebuild the set or check a discharge');
    ok('the beneficiary is on chain',
       hex(after.lastBeneficiary) === hex(ben),
       'the key is a function of the beneficiary too, so without it no one can say\n' +
       '     who may release the obligation or verify that a discharge was theirs');
  }
}

// ── finding 2: descent edges ────────────────────────────────────────────────
console.log('\n== 2b. can a third party enumerate a parent? ==');
{
  const secret = createHash('sha256').update('child-holder').digest();
  const parentSecret = createHash('sha256').update('parent-holder').digest();
  const child = V.pureCircuits.commit(secret);
  // A real parent with a holder, not an arbitrary 32 bytes: the edge only reaches
  // the chain once that holder confirms it under their own secret.
  const parent = L.pureCircuits.commit(parentSecret);

  const contract = new L.Contract({ localGeneticSecret: (c) => [c.privateState, secret] });
  const parentContract = new L.Contract({ localGeneticSecret: (c) => [c.privateState, parentSecret] });

  const ctor = contract.initialState(rt.createConstructorContext({}, COIN));
  let ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN, ctor.currentContractState, {});
  ctx = contract.impureCircuits.proposeParent(ctx, parent).context;
  const r = parentContract.impureCircuits.confirmParent(ctx, child);
  const st = L.ledger(r.context.currentQueryContext.state);

  note(`lastDescentChild : ${hex(st.lastDescentChild).slice(0, 24)}…`);
  note(`lastDescentParent: ${hex(st.lastDescentParent).slice(0, 24)}…`);
  ok('child and parent are both on chain',
     hex(st.lastDescentChild) === hex(child) && hex(st.lastDescentParent) === hex(parent),
     'only the edge hash was published: a verifier could test a pair they already\n' +
     '     suspected but could not enumerate a record\'s parents, so the graph the\n' +
     '     omission check runs on was not independently obtainable');
}

// ── finding 2: veilcore side ────────────────────────────────────────────────
console.log('\n== 2c. is a prior-possession proof checkable by a third party? ==');
{
  const secret = createHash('sha256').update('breeder').digest();
  const contract = new V.Contract({
    localGeneticSecret: (c) => [c.privateState, secret],
    incomingGeneticSecret: (c) => [c.privateState, createHash('sha256').update('incoming').digest()],
    recoverySecret: (c) => [c.privateState, createHash('sha256').update('recovery').digest()],
    // No licence circuit runs in this section; supplied because a missing witness
    // stops the Contract being constructed at all.
    licenseSecret: (c) => [c.privateState, new Uint8Array(32)],
    licenseRecord: (c) => [c.privateState, new Uint8Array(32)],
    licenseSiblings: (c) => [c.privateState, []],
    licenseDirections: (c) => [c.privateState, []],
    presentationChallenge: (c) => [c.privateState, new Uint8Array(32)],
  });
  const ctor = contract.initialState(rt.createConstructorContext({}, COIN));
  const ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN, ctor.currentContractState, {});

  const r = contract.impureCircuits.proveOwnership(ctx);
  const st = V.ledger(r.context.currentQueryContext.state);
  const expected = V.pureCircuits.commit(secret);

  note(`lastOwnershipProof: ${hex(st.lastOwnershipProof).slice(0, 24)}…`);
  note(`expected          : ${hex(expected).slice(0, 24)}…`);
  ok('the proven commitment is in ledger state',
     hex(st.lastOwnershipProof) === hex(expected),
     'the value was only RETURNED, which travels in the blinded communication\n' +
     '     commitment — visible to the caller\'s own DApp and to nobody reading the chain');

  // pairDna
  const dna = createHash('sha256').update('lab-report').digest();
  const r2 = contract.impureCircuits.pairDna(r.context, dna);
  const st2 = V.ledger(r2.context.currentQueryContext.state);
  ok('a DNA pairing names both halves on chain',
     hex(st2.lastPairedRecord) === hex(expected) && hex(st2.lastPairedDna) === hex(dna),
     'only the DNA side was published, so the chain showed a fingerprint attached\n     to nothing');

  // rotation
  // Must match the incoming secret the witness supplies: a rotation now proves the
  // target rather than taking it on trust.
  const fresh = V.pureCircuits.commit(createHash('sha256').update('incoming').digest());
  const r3 = contract.impureCircuits.rotateRecordSecret(r2.context, fresh);
  const st3 = V.ledger(r3.context.currentQueryContext.state);
  note(`lastRotatedFrom: ${hex(st3.lastRotatedFrom).slice(0, 24)}…`);
  note(`lastRotatedTo  : ${hex(st3.lastRotatedTo).slice(0, 24)}…`);
  ok('a rotation links both identities on chain',
     hex(st3.lastRotatedFrom) === hex(expected) && hex(st3.lastRotatedTo) === hex(fresh),
     'the old side was only returned, so a rotation was a new value appearing with\n' +
     '     nothing tying it to what it replaced');

  // finding 10
  console.log('\n== 10. does lastAnchor hold only proven anchors? ==');
  ok('a rotation does not write into lastAnchor',
     hex(st3.lastAnchor) === hex(st2.lastAnchor) && hex(st3.lastAnchor) !== hex(fresh),
     'rotateRecordSecret wrote a commitment nobody proved into the same cell anchor\n' +
     '     uses, so a reader taking that history as dated possession collects claims\n' +
     '     nobody established');
}

console.log(`\n${bad === 0 ? 'findings 1, 2 and 10 demonstrated fixed' : `${bad} still failing`}`);
process.exit(bad === 0 ? 0 : 1);
