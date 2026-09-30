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
const rt = await import('@midnight-ntwrk/compact-runtime');
const ocrt = await import('@midnight-ntwrk/onchain-runtime-v3');

let bad = 0;
const ok = (n, c, d) => { if (c) console.log(`OK   ${n}`); else { console.error(`FAIL ${n}${d ? `\n     ${d}` : ''}`); bad++; } };
const hex = (b) => Buffer.from(b).toString('hex');
const COIN = '0'.repeat(64);
const sec = (s) => createHash('sha256').update(s).digest();
const C = V.pureCircuits;

// ── harness ────────────────────────────────────────────────────────────────
// `path` is null outside a presentation, and the licensePath witness THROWS when read
// with no path set: every writer (countersign, approve, revoke) runs with it null, so
// a writer that still needed a path would fail loudly here rather than pass on a stub.
const NO_LIC = { secret: sec('none'), record: sec('none'), path: null, challenge: sec('none') };
let lic = NO_LIC;
const party = (own, { incoming = own, recovery = own } = {}) =>
  new V.Contract({
    localGeneticSecret: (c) => [c.privateState, own],
    incomingGeneticSecret: (c) => [c.privateState, incoming],
    recoverySecret: (c) => [c.privateState, recovery],
    licenseSecret: (c) => [c.privateState, lic.secret],
    licenseRecord: (c) => [c.privateState, lic.record],
    licensePath: (c) => {
      if (!lic.path) throw new Error('licensePath witness read by a circuit that should not need it');
      return [c.privateState, lic.path];
    },
    presentationChallenge: (c) => [c.privateState, lic.challenge],
  });

let ctx;
const fresh = () => {
  const c = party(sec('deployer'));
  ctx = rt.createCircuitContext(rt.sampleContractAddress(), COIN,
    c.initialState(rt.createConstructorContext({}, COIN)).currentContractState, {});
};
const run = (p, circuit, ...args) => { const r = p.impureCircuits[circuit](ctx, ...args); ctx = r.context; return r; };
const tryRun = (p, circuit, ...args) => { try { run(p, circuit, ...args); return ''; } catch (e) { return String(e?.message ?? e); } };
const state = () => V.ledger(ctx.currentQueryContext.state);
const freeSlot = () => { let s = 0n; while (state().licenseAtSlot.member(s)) s++; return s; };

// Writers take no path: the ledger places and clears leaves itself.
const withLic = (l, f) => { lic = { ...NO_LIC, ...l }; try { return f(); } finally { lic = NO_LIC; } };
const countersign = (licSecret, record) =>
  withLic({ secret: licSecret }, () => tryRun(party(sec('anyone')), 'countersignLicense', record, freeSlot()));
const revoke = (who, lc, issuer) => tryRun(who, 'revokeLicense', lc, issuer);
const approve = (who, lc, issuer, nlc) => tryRun(who, 'approveTransfer', lc, issuer, nlc);

// No live leaf: a well-formed path for that leaf at slot 0 (real siblings when the tree
// has a slot 0, all-zero ones before the first activation). Passes the leaf check; the
// root check must refuse it.
const stubPath = (tree, leaf) => {
  try { return tree.pathForLeaf(0n, leaf); }
  catch { return { leaf, path: Array.from({ length: 24 }, () => ({ sibling: { field: 0n }, goes_left: true })) }; }
};
/**
 * The licensee's path, as the SDK gets it: findPathForLeaf on the CURRENT ledger tree.
 * With no live leaf there is no path to find, so this hands over a well-formed path for
 * the right leaf at slot 0 — it passes the leaf check and must be refused by the root.
 */
const pathFor = (licSecret, record, st = state()) => {
  const leaf = C.licenseKey(C.licenseCommit(licSecret, record), record);
  return st.activeLicenses.findPathForLeaf(leaf) ?? stubPath(st.activeLicenses, leaf);
};
const present = (licSecret, record, challenge, p = pathFor(licSecret, record)) =>
  withLic({ secret: licSecret, record, path: p, challenge },
    () => tryRun(party(sec('anyone')), 'proveLicense'));

// ── transcript replay ──────────────────────────────────────────────────────
// A transaction is proved against the state its author saw (S0) and lands against
// whatever state the chain holds by then (S1). The reviewer's technique: run the
// circuit in-process on S0 to get its public transcript, then run THAT transcript
// against S1 with the on-chain runtime. A transcript that lands on S1 is a
// transaction that lands on chain; one rejected on S1 is one an adversary starved.
const CM = ocrt.CostModel.initialCostModel();
const GAS = { readTime: 10n ** 15n, computeTime: 10n ** 15n, bytesWritten: 10n ** 12n, bytesDeleted: 10n ** 12n };
/** Returns the ledger after landing, or the rejection as a string. */
const replay = (p, circuit, args, ctxProve, ctxLand) => {
  const r = p.impureCircuits[circuit](ctxProve, ...args);
  const q = new ocrt.QueryContext(ctxLand.currentQueryContext.state, ctxLand.currentQueryContext.address);
  try {
    const landed = q.runTranscript(
      { gas: GAS, effects: r.context.currentQueryContext.effects, program: r.proofData.publicTranscript }, CM);
    return V.ledger(landed.state);
  } catch (e) { return `REJECTED ON CHAIN: ${String(e?.message ?? e).slice(0, 160)}`; }
};
const lands = (x) => typeof x !== 'string';

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
  // (D anchors first: only an anchored identity may rotate now — see L-b.)
  run(party(D), 'anchor', C.recoveryCommit(sec('recovery-D')));
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
  // Was rotatedTo.member(thief): recovery no longer writes rotatedTo (it would have to
  // read the head to know what to retire). Liveness is headOf, so that is what is read.
  ok("the thief's head is no longer A's head", hex(state().headOf.lookup(A_REC)) === hex(C_REC));
  ok("the thief's head is retired (cannot prove ownership)", tryRun(party(THIEF), 'proveOwnership') !== '');
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
  // Was rotatedTo.member(B): recovery no longer writes rotatedTo; liveness is headOf.
  ok('the head that was lost (B) is replaced', hex(state().headOf.lookup(A_REC)) === hex(C_REC));
  ok('the head that was lost (B) is retired (cannot prove ownership)', tryRun(party(B), 'proveOwnership') !== '');
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
  ok('activation publishes the licence and its issuer',
    hex(state().lastActivatedLicense) === hex(lc) && hex(state().lastActivatedRecord) === hex(A_REC));
  // Was "a locally rebuilt LicenseTree matches activeLicenseRoot": there is no local tree
  // any more; the tree is ledger state. The equivalent claim: the leaf is computable from
  // the published cells alone and is in the ledger tree.
  ok('the leaf named by the published cells is in the ledger tree',
    state().activeLicenses.findPathForLeaf(
      C.licenseKey(state().lastActivatedLicense, state().lastActivatedRecord)) !== undefined);
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

// ══ Second round: the independent review of 30 Sep. Each scenario below is the
// reviewer's demonstrated attack on the previous build (review-30sep/zz-attack1..5).

// ── F1: a transfer cannot mint a licence from another issuer ───────────────
console.log('\n== F1  a transfer by issuer M cannot forge a licence from B ==');
{
  fresh();
  const Bf = sec('famous-breeder-B'), Bf_REC = C.commit(Bf);
  run(party(Bf), 'anchor', C.recoveryCommit(sec('rb')));        // B exists and does nothing else
  const M = sec('mallory'), M_REC = C.commit(M);
  const X1 = sec('mallory-lic-1'), X2 = sec('mallory-lic-2');
  const lcM = C.licenseCommit(X1, M_REC);
  run(party(M), 'issueLicense', lcM);
  ok('M activates a licence it issued to itself', countersign(X1, M_REC) === '');
  const forged = C.licenseCommit(X2, Bf_REC);                     // built against B's record
  ok('M proposes a transfer to a commitment built against B',
    withLic({ secret: X1 }, () => tryRun(party(M), 'proposeTransfer', M_REC, forged)) === '');
  ok('M approves it as the issuer', approve(party(M), lcM, M_REC, forged) === '');
  const ch = sec('verifier-challenge-about-B');
  const before = state().lastPresentation;
  ok('the transferred licence does NOT present as a licence from B', present(X2, Bf_REC, ch) !== '');
  ok('no tag for (B, challenge) was published',
    hex(state().lastPresentation) === hex(before) &&
    hex(state().lastPresentation) !== hex(C.presentationTag(Bf_REC, ch)));
  ok('there is no licence entry under B', !state().licenseStatusOf.member(C.licenseKey(forged, Bf_REC)));
  ok('the moved leaf is keyed to its real issuer M, not to B',
    state().activeLicenses.findPathForLeaf(C.licenseKey(forged, M_REC)) !== undefined &&
    state().activeLicenses.findPathForLeaf(C.licenseKey(forged, Bf_REC)) === undefined);
}
console.log('\n== F1b  one commitment live under two issuers; B revokes, it stops presenting under B ==');
{
  fresh();
  const Aa = sec('A'), Aa_REC = C.commit(Aa), Bb = sec('B'), Bb_REC = C.commit(Bb);
  const G1 = sec('L1'), G2 = sec('L2');                           // one grower, a licence from each
  const lcB = C.licenseCommit(G2, Bb_REC), lcA = C.licenseCommit(G1, Aa_REC);
  run(party(Bb), 'issueLicense', lcB); countersign(G2, Bb_REC);
  run(party(Aa), 'issueLicense', lcA); countersign(G1, Aa_REC);
  // The grower asks A to assign their A-licence to "a partner", handing over lcB.
  withLic({ secret: G1 }, () => run(party(sec('g')), 'proposeTransfer', Aa_REC, lcB));
  ok('A approves the opaque incoming commitment', approve(party(Aa), lcA, Aa_REC, lcB) === '');
  ok('lcB is now live under both issuers',
    state().licenseStatusOf.member(C.licenseKey(lcB, Aa_REC)) && state().licenseStatusOf.member(C.licenseKey(lcB, Bb_REC)));
  ok('before revocation the grower presents under B', present(G2, Bb_REC, sec('v0')) === '');
  ok('B revokes lcB', revoke(party(Bb), lcB, Bb_REC) === '');
  ok("B's entry is gone", !state().licenseStatusOf.member(C.licenseKey(lcB, Bb_REC)));
  ok('the grower can NOT present under B after revocation (no duplicate leaf survives)',
    present(G2, Bb_REC, sec('v')) !== '');
  // Even handed a path to the leaf A's transfer placed, the B-claim fails: the leaf differs.
  const aLeafPath = state().activeLicenses.findPathForLeaf(C.licenseKey(lcB, Aa_REC));
  ok("a path to A's leaf for the same commitment does not open a B presentation",
    aLeafPath !== undefined && present(G2, Bb_REC, sec('v2'), aLeafPath) !== '');
  ok("B cannot revoke A's entry by naming itself, and A's entry is untouched",
    revoke(party(Bb), lcB, Bb_REC) !== '' && state().licenseStatusOf.member(C.licenseKey(lcB, Aa_REC)));
}

// ── F2: revocation cannot be starved; presentations survive activations ────
console.log('\n== F2a  revocation needs no path and cannot be starved by the licensee ==');
{
  fresh(); anchorA();
  const lc = C.licenseCommit(L1, A_REC);
  run(party(A), 'issueLicense', lc); countersign(L1, A_REC);
  // In-process: the licensePath witness throws if read, and the revoke still lands.
  {
    const save = ctx;
    withLic({ secret: L1 }, () => run(party(sec('g')), 'proposeTransfer', A_REC, C.licenseCommit(sec('friend'), A_REC)));
    const err = revoke(party(A), lc, A_REC);
    ok('in-process: revoke with a transfer pending, no path supplied, succeeds', err === '', err);
    ok('in-process: the pending proposal is cleared with it', !state().pendingTransferOf.member(C.licenseKey(lc, A_REC)));
    ctx = save;
  }
  // Replay: prove against S0 (no proposal); the licensee proposes -> S1; land on S1.
  const s0 = ctx;
  withLic({ secret: L1 }, () => run(party(sec('g')), 'proposeTransfer', A_REC, C.licenseCommit(sec('friend'), A_REC)));
  const s1 = ctx;
  const r1 = replay(party(A), 'revokeLicense', [lc, A_REC], s0, s1);
  ok('replay: revoke proved with no proposal LANDS after the licensee proposes', lands(r1), r1);
  ok('replay: and the licence is gone in the landed state',
    lands(r1) && !r1.licenseStatusOf.member(C.licenseKey(lc, A_REC)));
  // Replay: prove against S1 (proposal pending); the licensee withdraws -> S2; land on S2.
  withLic({ secret: L1 }, () => run(party(sec('g')), 'withdrawTransfer', A_REC));
  const s2 = ctx;
  const r2 = replay(party(A), 'revokeLicense', [lc, A_REC], s1, s2);
  ok('replay: revoke proved with a proposal pending LANDS after the licensee withdraws', lands(r2), r2);
  // Control: the replay can refuse. A revoke replayed after the licence is already gone.
  run(party(A), 'revokeLicense', lc, A_REC);
  const r3 = replay(party(A), 'revokeLicense', [lc, A_REC], s2, ctx);
  ok('control: a revoke replayed after the licence was already revoked is REJECTED', !lands(r3));
}
console.log('\n== F2b  presentations: activations do not invalidate, revocation does ==');
{
  fresh(); anchorA();
  const lc = C.licenseCommit(L1, A_REC);
  run(party(A), 'issueLicense', lc); countersign(L1, A_REC);
  const s0 = ctx;
  const p0 = pathFor(L1, A_REC);
  const proveAt = (ch) => (from, to) => withLic({ secret: L1, record: A_REC, path: p0, challenge: sec(ch) },
    () => replay(party(sec('x')), 'proveLicense', [], from, to));
  ok('control: a presentation proved at S0 lands at S0', lands(proveAt('c0')(s0, s0)));
  // An unrelated party activates a throwaway self-issued licence.
  const M = sec('spam'), M_REC = C.commit(M), S = sec('spam-lic');
  run(party(M), 'issueLicense', C.licenseCommit(S, M_REC));
  ok('an unrelated activation lands', countersign(S, M_REC) === '');
  const s1 = ctx;
  const r1 = proveAt('c1')(s0, s1);
  ok('replay: a presentation proved before an unrelated ACTIVATION lands after it', lands(r1), r1);
  ok('in-process: the pre-activation path still proves on the new state', present(L1, A_REC, sec('c1b'), p0) === '');
  // Control: everything up to here (activation, another presentation) still lets it land.
  ok('control: the S0 presentation still lands on the state just before the revocation',
    lands(proveAt('c1c')(s0, ctx)));
  // A revokes this licence; the presentation proved at S0 must not land.
  ok('A revokes the licence', revoke(party(A), lc, A_REC) === '');
  const r2 = proveAt('c2')(s0, ctx);
  ok('replay: a presentation proved before a REVOCATION of that licence is REJECTED after it', !lands(r2));
  ok('in-process: the pre-revocation path no longer proves', present(L1, A_REC, sec('c2b'), p0) !== '');
  ok('in-process: nor does a fresh one (there is no leaf to find)', present(L1, A_REC, sec('c2c')) !== '');
}

// ── F3: a thief rotating again cannot starve recovery ──────────────────────
console.log('\n== F3  recovery proved before the thief rotates again still lands ==');
{
  fresh(); anchorA();
  const T1 = sec('t1'), T2 = sec('t2'), OWNERNEW = sec('owner-new');
  run(party(A, { incoming: T1 }), 'rotateRecordSecret', C.commit(T1));   // the thief rotates first
  const s0 = ctx;
  const owner = party(sec('lost'), { incoming: OWNERNEW, recovery: RECOVERY });
  ok('control: recovery replayed on the state it was proved against lands',
    lands(replay(owner, 'recoverRecordSecret', [A_REC, C.commit(OWNERNEW)], s0, s0)));
  run(party(T1, { incoming: T2 }), 'rotateRecordSecret', C.commit(T2));   // again, while it is in flight
  const r = replay(owner, 'recoverRecordSecret', [A_REC, C.commit(OWNERNEW)], s0, ctx);
  ok('replay: recovery proved before the thief\'s second rotation LANDS after it', lands(r), r);
  ok('replay: in the landed state the owner\'s new record is A\'s head',
    lands(r) && hex(r.headOf.lookup(A_REC)) === hex(C.commit(OWNERNEW)));
  // The same in-process, and the thief's latest head is dead afterwards.
  ok('in-process: recovery after two thief rotations succeeds',
    tryRun(owner, 'recoverRecordSecret', A_REC, C.commit(OWNERNEW)) === '');
  ok("in-process: the thief's latest head can no longer act", tryRun(party(T2), 'proveOwnership') !== '');
  ok('in-process: the recovered head can', tryRun(party(OWNERNEW), 'proveOwnership') === '');
}

// ── L-a: the all-zero recovery SECRET is refused, not only the all-zero commitment ─
console.log('\n== L-a  recoveryCommit(all-zero) is refused ==');
{
  const Z = new Uint8Array(32);
  fresh();
  const err = tryRun(party(A), 'anchor', C.recoveryCommit(Z));
  ok('anchor with recoveryCommit(all-zero) is refused', err !== '', 'a stranger could then recover it with the zero key');
  ok('and nobody recovers A with the zero key',
    tryRun(party(sec('stranger'), { incoming: sec('s2'), recovery: Z }), 'recoverRecordSecret', A_REC, C.commit(sec('s2'))) !== '');
  anchorA();
  ok('replacing recovery with recoveryCommit(all-zero) is refused',
    tryRun(party(sec('n'), { recovery: RECOVERY }), 'replaceRecoveryCommitment', A_REC, C.recoveryCommit(Z)) !== '');
}

// ── L-b: an unanchored record cannot rotate ────────────────────────────────
console.log('\n== L-b  rotating an unanchored record is refused ==');
{
  fresh();
  const X = sec('X'), Y = sec('Y');
  run(party(X), 'issueLicense', C.licenseCommit(sec('l'), C.commit(X)));
  const err = tryRun(party(X, { incoming: Y }), 'rotateRecordSecret', C.commit(Y));
  ok('rotating an unanchored record is refused with a clear message',
    err.includes('Anchor this record before rotating it'), err || 'accepted');
  ok('the refused rotation leaves X anchorable', tryRun(party(X), 'anchor', C.recoveryCommit(sec('r'))) === '');
  ok('and once anchored, X rotates', tryRun(party(X, { incoming: Y }), 'rotateRecordSecret', C.commit(Y)) === '');
}

// ── R2-L1: activations cannot be starved by a shared counter ───────────────
console.log('\n== R2-L1  one activation per block? ==');
{
  fresh(); anchorA();
  const lc1 = C.licenseCommit(L1, A_REC), lc2 = C.licenseCommit(L2, A_REC);
  run(party(A), 'issueLicense', lc1);
  run(party(A), 'issueLicense', lc2);
  const S0 = ctx;
  // Activation 1 lands first, at slot 5.
  withLic({ secret: L1 }, () => run(party(sec('x')), 'countersignLicense', A_REC, 5n));
  const S1 = ctx;
  const other = withLic({ secret: L2 }, () => replay(party(sec('y')), 'countersignLicense', [A_REC, 6n], S0, S1));
  ok('a second activation proved on the same state lands if it picked another slot', lands(other),
    typeof other === 'string' ? other : '');
  const same = withLic({ secret: L2 }, () => replay(party(sec('y')), 'countersignLicense', [A_REC, 5n], S0, S1));
  ok('one that picked the SAME slot is refused, and nothing is overwritten', !lands(same));
  ctx = S1;
  ok('a taken slot is refused in-process too',
    withLic({ secret: L2 }, () => tryRun(party(sec('y')), 'countersignLicense', A_REC, 5n)) !== '');
  ok('a slot outside the tree is refused',
    withLic({ secret: L2 }, () => tryRun(party(sec('y')), 'countersignLicense', A_REC, 16777216n)) !== '');
  // Slots are reused after revocation, and the old leaf's paths do not come back.
  run(party(A), 'revokeLicense', lc1, A_REC);
  ok('a revoked licence frees its slot', !state().licenseAtSlot.member(5n));
  ok('the freed slot can be used again',
    withLic({ secret: L2 }, () => tryRun(party(sec('y')), 'countersignLicense', A_REC, 5n)) === '');
  ok('the revoked licence does not present from the reused slot', present(L1, A_REC, sec('ch')) !== '');
  ok('the new occupant does', present(L2, A_REC, sec('ch')) === '');
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
