/**
 * Security pass, 30 Sep 2026: every finding, attacked against the compiled artifact.
 *
 * Each case is the attack itself. Before the fix each of these succeeded (or an
 * honest action failed); see docs/security-pass-30sep.md for the before/after.
 *
 *   node contract/attack-30sep.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = await import(pathToFileURL(path.join(here, 'src/managed/veilcore/contract/index.js')).href);
const { LicenseTree } = await import(pathToFileURL(path.join(here, 'src/license-tree.mjs')).href);
const rt = await import('@midnight-ntwrk/compact-runtime');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const hex = (b) => Buffer.from(b).toString('hex');
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();
const C = V.pureCircuits;

// ── harness ────────────────────────────────────────────────────────────────
const NO_LIC = { secret: sec('none'), record: sec('none'), siblings: [], dirs: [], challenge: sec('none') };
let lic = NO_LIC;
const party = (own, { incoming = own, recovery = own } = {}) =>
  new V.Contract({
    localGeneticSecret: (c) => [c.privateState, own],
    incomingGeneticSecret: (c) => [c.privateState, incoming],
    recoverySecret: (c) => [c.privateState, recovery],
    licenseSecret: (c) => [c.privateState, lic.secret],
    licenseRecord: (c) => [c.privateState, lic.record],
    licenseSiblings: (c) => [c.privateState, lic.siblings],
    licenseDirections: (c) => [c.privateState, lic.dirs],
    presentationChallenge: (c) => [c.privateState, lic.challenge],
  });

let ctx, tree;
const fresh = () => {
  const c = party(sec('deployer'));
  ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN,
    c.initialState(rt.createConstructorContext({}, COIN)).currentContractState, {});
  tree = new LicenseTree();
};
const run = (p, circuit, ...args) => { const r = p.impureCircuits[circuit](ctx, ...args); ctx = r.context; return r; };
const tryRun = (p, circuit, ...args) => { try { run(p, circuit, ...args); return ''; } catch (e) { return String(e?.message ?? e); } };
const state = () => V.ledger(ctx.currentQueryContext.state);

// Tree-moving calls: plan a path, set it as witness, apply only if the chain accepted.
const withLic = (l, f) => { lic = { ...NO_LIC, ...l }; try { return f(); } finally { lic = NO_LIC; } };
const countersign = (licSecret, record) => {
  const lc = C.licenseCommit(licSecret, record);
  const p = tree.planInsert(lc);
  const err = withLic({ secret: licSecret, siblings: p.siblings, dirs: p.dirs },
    () => tryRun(party(sec('anyone')), 'countersignLicense', record));
  if (!err) tree.applyInsert(lc, p.index);
  return err;
};
const revoke = (who, lc, issuer) => {
  let p; try { p = tree.planRemove(lc); } catch { p = { siblings: [], dirs: [], index: -1 }; }
  const err = withLic({ siblings: p.siblings, dirs: p.dirs }, () => tryRun(who, 'revokeLicense', lc, issuer));
  if (!err && p.index >= 0) tree.applyRemove(lc, p.index);
  return err;
};
const approve = (who, lc, issuer, nlc) => {
  const p = tree.planReplace(lc);
  const err = withLic({ siblings: p.siblings, dirs: p.dirs }, () => tryRun(who, 'approveTransfer', lc, issuer, nlc));
  if (!err) tree.applyReplace(lc, nlc, p.index);
  return err;
};
const present = (licSecret, record, challenge) => {
  const lc = C.licenseCommit(licSecret, record);
  let p; try { p = tree.pathFor(lc); } catch { p = { siblings: tree.siblingsFor(0), dirs: Array(16).fill(false) }; }
  return withLic({ secret: licSecret, record, siblings: p.siblings, dirs: p.dirs, challenge },
    () => tryRun(party(sec('anyone')), 'proveLicense'));
};

const A = sec('breeder-A'), B = sec('breeder-B'), Cs = sec('breeder-C'), D = sec('breeder-D');
const RECOVERY = sec('recovery'), THIEF = sec('thief');
const A_REC = C.commit(A), B_REC = C.commit(B), C_REC = C.commit(Cs), D_REC = C.commit(D);
const anchorA = () => run(party(A), 'anchor', C.recoveryCommit(RECOVERY));
const L1 = sec('licensee-1'), L2 = sec('licensee-2');

// ── H1: control of licences survives any number of rotations ───────────────
console.log('\n== H1  rotating twice must not strand licences ==');
{
  fresh(); anchorA();
  const lc = C.licenseCommit(L1, A_REC);
  run(party(A), 'issueLicense', lc);
  ok('licensee activates', countersign(L1, A_REC) === '');

  run(party(A, { incoming: B }), 'rotateRecordSecret', B_REC);
  // Transfer proposed after the first rotation, approved by the successor.
  const nlc = C.licenseCommit(L2, A_REC);
  withLic({ secret: L1 }, () => run(party(sec('x')), 'proposeTransfer', A_REC, nlc));
  const aErr = approve(party(B), lc, A_REC, nlc);
  ok('successor approves a transfer on a pre-rotation licence', aErr === '', aErr);

  run(party(B, { incoming: Cs }), 'rotateRecordSecret', C_REC);
  const bErr = revoke(party(B), nlc, A_REC);
  ok('a retired middle record cannot revoke', bErr !== '');
  const cErr = revoke(party(Cs), nlc, A_REC);
  ok('the head after TWO rotations revokes a licence the origin issued', cErr === '', cErr);
  ok('the revoked licence no longer presents', present(L2, A_REC, sec('ch')) !== '');
}

// ── H1b: an unrelated record cannot claim someone else's licences ──────────
console.log('\n== H1b  a stranger cannot pose as the issuer ==');
{
  fresh(); anchorA();
  const lc = C.licenseCommit(L1, A_REC);
  run(party(A), 'issueLicense', lc);
  countersign(L1, A_REC);
  ok('a stranger naming A as issuer cannot revoke', revoke(party(D), lc, A_REC) !== '');
  // A stranger rotating into something does not make them part of A's identity.
  run(party(D, { incoming: sec('D2') }), 'rotateRecordSecret', C.commit(sec('D2')));
  ok("a stranger's successor still cannot revoke", revoke(party(sec('D2')), lc, A_REC) !== '');
  // Nor can anyone rotate into A's own successor to hijack its origin.
  run(party(A, { incoming: B }), 'rotateRecordSecret', B_REC);
  const hijack = tryRun(party(D, { incoming: B }), 'rotateRecordSecret', B_REC);
  ok('rotating into an existing successor is refused', hijack !== '');
}

// ── H2: recovery beats a thief who rotated first ───────────────────────────
console.log('\n== H2  recovery must beat theft, not only loss ==');
{
  fresh(); anchorA();
  const lc = C.licenseCommit(L1, A_REC);
  run(party(A), 'issueLicense', lc);
  countersign(L1, A_REC);

  // The thief has A's secret and rotates to a secret of their own.
  run(party(A, { incoming: THIEF }), 'rotateRecordSecret', C.commit(THIEF));

  // The owner no longer has A (it is the thief's now too) but has the recovery secret.
  const rErr = tryRun(party(sec('nothing'), { incoming: Cs, recovery: RECOVERY }),
    'recoverRecordSecret', A_REC, C_REC);
  ok('owner recovers after the thief rotated', rErr === '', rErr);
  ok("the thief's head is retired", state().rotatedTo.member(C.commit(THIEF)));
  ok('the thief can no longer issue', tryRun(party(THIEF), 'issueLicense', C.licenseCommit(sec('t'), C.commit(THIEF))) !== '');
  ok('the thief can no longer revoke', revoke(party(THIEF), lc, A_REC) !== '');
  ok('the recovered head controls the old licences', revoke(party(Cs), lc, A_REC) === '');

  // The wrong recovery secret does nothing.
  fresh(); anchorA();
  ok('a wrong recovery secret is refused',
    tryRun(party(sec('n'), { incoming: Cs, recovery: sec('guess') }), 'recoverRecordSecret', A_REC, C_REC) !== '');

  // A successor cannot be "recovered" as if it were an origin.
  fresh(); anchorA();
  run(party(A, { incoming: B }), 'rotateRecordSecret', B_REC);
  ok('recovery names only an anchored origin',
    tryRun(party(sec('n'), { incoming: Cs, recovery: RECOVERY }), 'recoverRecordSecret', B_REC, C_REC) !== '');
}

// ── M1: recovery survives rotation ─────────────────────────────────────────
console.log('\n== M1  rotation must not drop recovery ==');
{
  fresh(); anchorA();
  run(party(A, { incoming: B }), 'rotateRecordSecret', B_REC);
  const err = tryRun(party(sec('lost-B'), { incoming: Cs, recovery: RECOVERY }), 'recoverRecordSecret', A_REC, C_REC);
  ok('a rotated record can still be recovered with the original recovery secret', err === '', err);
  ok('the head that was lost (B) is retired', state().rotatedTo.member(B_REC));
}

// ── replacing a leaked recovery secret ─────────────────────────────────────
console.log('\n== recovery secret replacement ==');
{
  fresh(); anchorA();
  const R2 = sec('recovery-2');
  ok('the recovery holder replaces the recovery commitment',
    tryRun(party(sec('n'), { recovery: RECOVERY }), 'replaceRecoveryCommitment', A_REC, C.recoveryCommit(R2)) === '');
  ok('the old recovery secret no longer works',
    tryRun(party(sec('n'), { incoming: Cs, recovery: RECOVERY }), 'recoverRecordSecret', A_REC, C_REC) !== '');
  ok('the new one does',
    tryRun(party(sec('n'), { incoming: Cs, recovery: R2 }), 'recoverRecordSecret', A_REC, C_REC) === '');
  ok('the primary secret alone cannot replace recovery',
    tryRun(party(Cs, { recovery: Cs }), 'replaceRecoveryCommitment', A_REC, C.recoveryCommit(sec('evil'))) !== '');
}

// ── M2: a recovery commitment is not a record commitment ───────────────────
console.log('\n== M2  recovery and record commitments are different things ==');
{
  ok('recoveryCommit differs from commit for the same secret', hex(C.recoveryCommit(RECOVERY)) !== hex(C.commit(RECOVERY)));
  fresh(); anchorA();
  // The recovery holder anchors a record from their secret: it is NOT A's recovery commitment.
  run(party(RECOVERY), 'anchor', C.recoveryCommit(sec('other')));
  ok('anchoring with the recovery secret creates an unrelated record',
    hex(state().lastAnchor) !== hex(state().recoveryOf.lookup(A_REC)));
}

// ── M3: a squatter cannot block an issue ───────────────────────────────────
console.log('\n== M3  squatting a licence commitment ==');
{
  fresh(); anchorA();
  const lc = C.licenseCommit(L1, A_REC);
  run(party(THIEF), 'issueLicense', lc);         // sniper saw lc and got in first
  const err = tryRun(party(A), 'issueLicense', lc);
  ok('the breeder still issues after a squatter', err === '', err);
  ok('the licensee activates the breeder\'s licence', countersign(L1, A_REC) === '');
  ok('the licence presents under the breeder', present(L1, A_REC, sec('ch')) === '');
  ok('activation publishes the licence and its issuer so anyone can rebuild the tree',
    hex(state().lastActivatedLicense) === hex(lc) && hex(state().lastActivatedRecord) === hex(A_REC));
  const rebuilt = new LicenseTree(); rebuilt.insert(state().lastActivatedLicense);
  ok('a tree rebuilt from public data alone matches the chain root',
    hex(rebuilt.root()) === hex(state().activeLicenseRoot));
}

// ── M4: a retired secret cannot prove ownership ────────────────────────────
console.log('\n== M4  proveOwnership after rotation ==');
{
  fresh(); anchorA();
  run(party(A, { incoming: B }), 'rotateRecordSecret', B_REC);
  ok('the retired secret is refused', tryRun(party(A), 'proveOwnership') !== '');
  ok('the live head proves', tryRun(party(B), 'proveOwnership') === '');
}

// ── M6: record is derived, not taken ───────────────────────────────────────
console.log('\n== M6  circuits act for the CALLER\'s record ==');
{
  fresh(); anchorA();
  run(party(D), 'issueLicense', C.licenseCommit(L1, A_REC));
  ok("D's issue does not create a licence under A: A's licensee cannot activate it",
    countersign(L1, A_REC) !== '');
  run(party(D), 'pairDna', sec('dna'));
  ok('pairDna pairs to the caller\'s own record', hex(state().lastPairedRecord) === hex(D_REC));
  ok('pairDna does not overwrite lastAnchor', hex(state().lastAnchor) === hex(A_REC));
  ok('anchor anchors the caller\'s own record', hex(state().lastAnchor) === hex(A_REC));
  ok('a successor cannot re-anchor', (() => {
    run(party(A, { incoming: B }), 'rotateRecordSecret', B_REC);
    return tryRun(party(B), 'anchor', C.recoveryCommit(sec('r'))) !== '';
  })());
}

// ── H3: presentations bind the record and the challenge ────────────────────
console.log('\n== H3  what a licence presentation proves ==');
{
  fresh(); anchorA();
  run(party(B), 'anchor', C.recoveryCommit(sec('rb')));
  const lcA = C.licenseCommit(L1, A_REC);
  run(party(A), 'issueLicense', lcA);
  countersign(L1, A_REC);

  const challenge = sec('verifier-nonce-1');
  ok('a licensee of A presents', present(L1, A_REC, challenge) === '');
  const tag = state().lastPresentation;
  ok('the published tag matches (record A, challenge) — verifier can check',
    hex(tag) === hex(C.presentationTag(A_REC, challenge)));
  ok('the tag does NOT match record B — a licence from A does not pass a check about B',
    hex(tag) !== hex(C.presentationTag(B_REC, challenge)));

  // Claiming a licence from B they do not hold fails outright.
  ok('presenting as a licensee of B is refused', present(L1, B_REC, challenge) !== '');

  // Two presentations of the same licence do not link.
  present(L1, A_REC, sec('verifier-nonce-2'));
  ok('a second presentation publishes an unrelated tag', hex(state().lastPresentation) !== hex(tag));

  // Nothing in the tag names A to someone without the challenge.
  ok('the tag is not the record, the licence, or a hash of the record alone',
    ![hex(A_REC), hex(lcA), hex(C.presentationTag(A_REC, new Uint8Array(32)))].includes(hex(tag)));
}

// ── V1: every argument is validated (Battleship pattern) ───────────────────
console.log('\n== V1  empty (all-zero) inputs are refused ==');
{
  const Z = new Uint8Array(32);
  fresh();
  ok('anchor with an empty recovery commitment', tryRun(party(A), 'anchor', Z) !== '');
  anchorA();
  ok('anchorBatch of an empty root', tryRun(party(A), 'anchorBatch', Z) !== '');
  ok('pairDna with an empty fingerprint', tryRun(party(A), 'pairDna', Z) !== '');
  ok('issueLicense of an empty licence (the tree\'s empty leaf)', tryRun(party(A), 'issueLicense', Z) !== '');
  ok('replacing recovery with an empty commitment',
    tryRun(party(sec('n'), { recovery: RECOVERY }), 'replaceRecoveryCommitment', A_REC, Z) !== '');

  // The one that did damage: transferring a live licence to the empty leaf.
  const lc = C.licenseCommit(L1, A_REC);
  run(party(A), 'issueLicense', lc);
  countersign(L1, A_REC);
  const err = withLic({ secret: L1 }, () => tryRun(party(sec('x')), 'proposeTransfer', A_REC, Z));
  ok('proposing a transfer to the empty leaf', err !== '',
    'approving it would replace a live leaf with the empty leaf: the licence stays ACTIVE in the\n' +
    '     map, cannot be presented by anyone, and its slot looks free to the next countersign');
  ok('presenting without a verifier challenge', present(L1, A_REC, Z) !== '');
  ok('the licence still presents with a real challenge', present(L1, A_REC, sec('real')) === '');
}

// ── L2: licence secrets never ride as arguments ────────────────────────────
console.log('\n== L2  licence secrets are witnesses ==');
{
  // The compiler's own record of each circuit's public arguments.
  const { readFileSync } = await import('node:fs');
  const info = JSON.parse(readFileSync(path.join(here, 'src/managed/veilcore/compiler/contract-info.json'), 'utf8'));
  const argNames = (n) => info.circuits.find((c) => c.name === n).arguments.map((a) => a.name);
  const noSecret = (n) => !argNames(n).some((a) => /secret/i.test(a));
  for (const n of ['countersignLicense', 'proposeTransfer', 'withdrawTransfer', 'anchor', 'issueLicense',
                   'pairDna', 'approveTransfer', 'revokeLicense', 'proveLicense', 'rotateRecordSecret',
                   'recoverRecordSecret', 'replaceRecoveryCommitment']) {
    ok(`${n} takes no secret as an argument (${argNames(n).join(', ') || 'none'})`, noSecret(n));
  }
  ok('anchor, issueLicense and pairDna take no record of the caller\'s', ['anchor', 'issueLicense', 'pairDna']
    .every((n) => !argNames(n).includes('recordCommitment')));
}

console.log(bad === 0 ? '\nsecurity pass 30 Sep: all attacks refused' : `\n${bad} FAILURE(S)`);
process.exit(bad === 0 ? 0 : 1);
