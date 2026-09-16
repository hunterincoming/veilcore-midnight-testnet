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
const tree = await import(pathToFileURL(path.join(here, 'src/tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const note = (s) => console.log(`     ${s}`);
const hex = (b) => Buffer.from(b).toString('hex');
const COIN = '0'.repeat(64);

// ── finding 1: the tree deploys usable ──────────────────────────────────────
console.log('\n== 1. does lineage deploy with a live tree? ==');
{
  const secret = createHash('sha256').update('holder').digest();
  const benSecret = createHash('sha256').update('beneficiary').digest();
  const t = new tree.ObligationTree();
  const rec = V.pureCircuits.commit(secret);
  const obl = createHash('sha256').update('royalty').digest();
  // An obligation names who is owed, so the leaf — and therefore the path — is a
  // function of the beneficiary as well. Building the path without one produced a
  // leaf the circuit would never compute.
  const ben = L.pureCircuits.commit(benSecret);
  const p = t.encumber(rec, obl, ben);

  const contract = new L.Contract({
    localGeneticSecret: (c) => [c.privateState, secret],
    beneficiarySecret: (c) => [c.privateState, benSecret],
    // Read only by proveAncestorClean, which this section does not call; supplied
    // because a missing witness stops the Contract being constructed at all.
    slotIsEmpty: (c) => [c.privateState, true],
    slotOccupantRecord: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantObligation: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantBeneficiary: (c) => [c.privateState, new Uint8Array(32)],
    merkleSiblings: (c) => [c.privateState, p.siblings],
    merkleDirections: (c) => [c.privateState, p.dirs],
    ancestryChain: (c) => [c.privateState, [rec, rec, rec, rec]],
  });

  const ctor = contract.initialState(rt.createConstructorContext({}, COIN));
  const state = L.ledger(ctor.currentContractState.data);
  note(`deployed root : ${hex(state.encumberedRoot).slice(0, 32)}…`);
  note(`empty tree    : ${hex(tree.EMPTY_ROOT).slice(0, 32)}…`);
  ok('the deployed root is the empty tree root',
     hex(state.encumberedRoot) === hex(tree.EMPTY_ROOT),
     'it deploys to a value no fold can produce, so nothing can ever succeed');

  // The thing that has never worked.
  const ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN, ctor.currentContractState, {});
  let err = '';
  let after = null;
  try {
    const r = contract.impureCircuits.encumber(ctx, rec, obl);
    after = L.ledger(r.context.currentQueryContext.state);
  } catch (e) { err = String(e?.message ?? e); }

  if (err) note(`encumber refused: ${err}`);
  ok('encumber succeeds against a freshly deployed contract', err === '',
     'this call has never succeeded in any deployment of this contract');

  if (after) {
    note(`root moved to : ${hex(after.encumberedRoot).slice(0, 32)}…`);
    ok('the root changed', hex(after.encumberedRoot) !== hex(tree.EMPTY_ROOT));

    // ── finding 2, lineage side ───────────────────────────────────────────
    console.log('\n== 2a. can a third party rebuild the tree from chain state? ==');
    note(`lastEncumberedRecord: ${hex(after.lastEncumberedRecord).slice(0, 24)}…`);
    note(`lastObligation      : ${hex(after.lastObligation).slice(0, 24)}…`);
    ok('the encumbered record is on chain',
       hex(after.lastEncumberedRecord) === hex(rec),
       'only the root was published, so nobody could tell which record was encumbered');
    ok('the obligation is on chain',
       hex(after.lastObligation) === hex(obl),
       'without the leaf inputs a third party cannot rebuild a sibling path');
    ok('the beneficiary is on chain',
       hex(after.lastBeneficiary) === hex(ben),
       'the leaf is a function of the beneficiary too, so without it no sibling path\n' +
       '     can be reconstructed and no discharge verified');
  }
}

// ── finding 2: descent edges ────────────────────────────────────────────────
console.log('\n== 2b. can a third party enumerate a parent? ==');
{
  const secret = createHash('sha256').update('child-holder').digest();
  const child = V.pureCircuits.commit(secret);
  const parent = createHash('sha256').update('parent-commitment').digest();

  const contract = new L.Contract({
    localGeneticSecret: (c) => [c.privateState, secret],
    beneficiarySecret: (c) => [c.privateState, secret],
    slotIsEmpty: (c) => [c.privateState, true],
    slotOccupantRecord: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantObligation: (c) => [c.privateState, new Uint8Array(32)],
    slotOccupantBeneficiary: (c) => [c.privateState, new Uint8Array(32)],
    merkleSiblings: (c) => [c.privateState, []],
    merkleDirections: (c) => [c.privateState, []],
    ancestryChain: (c) => [c.privateState, [child, child, child, child]],
  });
  const ctor = contract.initialState(rt.createConstructorContext({}, COIN));
  const ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN, ctor.currentContractState, {});
  const r = contract.impureCircuits.declareParent(ctx, child, parent);
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
  const r2 = contract.impureCircuits.pairDna(r.context, expected, dna);
  const st2 = V.ledger(r2.context.currentQueryContext.state);
  ok('a DNA pairing names both halves on chain',
     hex(st2.lastPairedRecord) === hex(expected) && hex(st2.lastAnchor) === hex(dna),
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
     hex(st3.lastAnchor) === hex(dna),
     'rotateRecordSecret wrote a commitment nobody proved into the same cell anchor\n' +
     '     uses, so a reader taking that history as dated possession collects claims\n' +
     '     nobody established');
}

console.log(`\n${bad === 0 ? 'findings 1, 2 and 10 demonstrated fixed' : `${bad} still failing`}`);
process.exit(bad === 0 ? 0 : 1);
