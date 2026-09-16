/**
 * Pre-deployment checks against Midnight's security guide.
 *
 * Each block tests a claim the contract or its comments make, rather than a
 * claim the documentation makes. Where a check fails, the finding is real;
 * where it passes, the concern was mine and not the contract's.
 *
 *   node contract/audit-checks.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = path.join(here, 'src/managed/veilcore/contract/index.js');
const mod = await import(pathToFileURL(artifact).href);
const { Contract, LicenseState, ledger, pureCircuits } = mod;
const rt = await import('@midnight-ntwrk/compact-runtime');

let failures = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`OK   ${name}`);
  else { console.error(`FAIL ${name}${detail ? `  (${detail})` : ''}`); failures++; }
};
const note = (s) => console.log(`     ${s}`);
const rejects = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message ?? e); } };

const b32 = (fill) => new Uint8Array(32).fill(fill);
const hex = (b) => Buffer.from(b).toString('hex');
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// Every declared witness has to be supplied or the Contract constructor throws
// before a single circuit runs, which is how this file stopped executing when
// rotation and recovery were added. A party that never rotates never reads the
// last two, so defaulting them to its own secret leaves every case unchanged.
const witnesses = (secret, incoming = secret, recovery = secret) => ({
  localGeneticSecret: (ctx) => [ctx.privateState, secret],
  incomingGeneticSecret: (ctx) => [ctx.privateState, incoming],
  recoverySecret: (ctx) => [ctx.privateState, recovery],
  // The active-licence tree. proveLicense reads only witnesses, so the licence and
  // the record it was issued against are supplied here rather than as arguments.
  licenseSecret: (ctx) => [ctx.privateState, licPath.secret],
  licenseRecord: (ctx) => [ctx.privateState, licPath.record],
  licenseSiblings: (ctx) => [ctx.privateState, licPath.siblings],
  licenseDirections: (ctx) => [ctx.privateState, licPath.dirs],
});

// No licence circuit that moves a leaf runs in this file — section 3 only issues,
// which leaves licences PENDING and outside the tree — so the path stays null.
const licPath = { secret: b32(0), record: b32(0), siblings: [], dirs: [] };
const COIN = '0'.repeat(64);
const ADDR = rt.sampleContractAddress();

const fresh = (secret) => {
  const contract = new Contract(witnesses(secret));
  const ctor = contract.initialState(rt.createConstructorContext({}, COIN));
  return { contract, ctx: rt.createCircuitContext(ADDR, COIN, ctor.currentContractState, {}) };
};

const BREEDER = b32(0x11);
const GRIEFER = b32(0x99);

// ───────────────────────────────────────────────── 1. proveOwnership visibility
//
// The circuit computes `disclose(commit(secret))` into a local that is never
// written to the ledger or returned. Midnight's guide says a disclosed value
// becomes visible only when it crosses a public boundary. If that holds, a
// verifier cannot tell WHICH record was proven, only that something was.
console.log('\n== 1. does proveOwnership publish the commitment? ==');
{
  const { contract, ctx } = fresh(BREEDER);
  const expected = pureCircuits.commit(BREEDER);
  const before = ledger(ctx.currentQueryContext.state);
  const beforeSeq = before.proofSeq;

  const r = contract.impureCircuits.proveOwnership(ctx);
  const after = ledger(r.context.currentQueryContext.state);

  note(`commitment that should be provable: ${hex(expected).slice(0, 24)}…`);
  note(`proofSeq ${beforeSeq} -> ${after.proofSeq}`);
  note(`lastAnchor after: ${hex(after.lastAnchor).slice(0, 24)}…`);

  // A RETURN IS NOT A PUBLIC POSITION, and this check asserted on one. The return
  // travels in the call's communication commitment, which is blinded with
  // randomness: it reaches the caller's own DApp and nobody reading the chain. The
  // check therefore passed while the question in its own name — does a verifier
  // learn which record was proven — was still answered no. The ledger cell is what
  // the chain carries, so that is what is read.
  const returned = r.result;
  note(`returned value:     ${returned ? hex(returned).slice(0, 24) + '…' : '(none)'}`);
  note(`lastOwnershipProof: ${hex(after.lastOwnershipProof).slice(0, 24)}…`);
  ok('proveOwnership publishes the commitment', same(after.lastOwnershipProof, expected),
     'nothing reaches a public position — a verifier cannot tell which record was proven');
}

// ───────────────────────────────────────────────────── 2. pairDna binding
//
// pairDna discloses BOTH commitments but writes only the DNA one to lastAnchor.
// If the record commitment never reaches a public position, the binding between
// a record and its DNA report is not on chain.
console.log('\n== 2. does pairDna bind the record to the DNA report on chain? ==');
{
  const { contract, ctx } = fresh(BREEDER);
  const rc = pureCircuits.commit(BREEDER);
  const dc = b32(0x44);

  const r = contract.impureCircuits.pairDna(ctx, rc, dc);
  const after = ledger(r.context.currentQueryContext.state);

  note(`record commitment: ${hex(rc).slice(0, 24)}…`);
  note(`dna commitment:    ${hex(dc).slice(0, 24)}…`);
  note(`lastAnchor holds:  ${hex(after.lastAnchor).slice(0, 24)}…`);

  note(`lastPairedRecord:  ${hex(after.lastPairedRecord).slice(0, 24)}…`);
  ok('lastAnchor holds the DNA commitment', same(after.lastAnchor, dc));
  // Was asserted on r.result, for the same reason and with the same defect as 1.
  ok('the record commitment also reaches a public position', same(after.lastPairedRecord, rc),
     'only the DNA side is public — the pairing is not checkable on chain');
}

// ──────────────────────────────────────────── 3. unbounded state under attack
//
// The header says state is "bounded by open business rather than by total usage".
// issueLicense requires owning a record, but anyone can own one by committing
// any secret. Test whether a single party can grow the maps without limit.
console.log('\n== 3. can a stranger grow licence state without bound? ==');
{
  const { contract, ctx } = fresh(GRIEFER);
  const griefRecord = pureCircuits.commit(GRIEFER);
  let cur = ctx;
  const N = 50;

  for (let i = 0; i < N; i++) {
    // licenseCommit, not commit: records and licences no longer share a domain
    // tag, and the commitment is bound to the record it is issued against.
    const lc = pureCircuits.licenseCommit(b32(i + 1), griefRecord);
    cur = contract.impureCircuits.issueLicense(cur, griefRecord, lc).context;
  }

  const after = ledger(cur.currentQueryContext.state);
  let count = 0;
  for (const _ of after.licenseStatusOf) count++;

  note(`a single caller, owning no real material, inserted ${count} live licences`);
  note('each entry is permanent until that caller revokes it');
  ok('licence state resists growth by a single unauthorised party', count < N,
     `${count} entries created by one party with a self-chosen secret`);
}

// ───────────────────────────────────────────────────── 4. key recovery path
//
// Midnight's checklist: "Confirm no role is permanently lockable by a single
// lost secret." Test whether a record owner has any way to move to a new secret.
console.log('\n== 4. is there a recovery path for a lost secret? ==');
{
  const names = Object.keys(new Contract(witnesses(BREEDER)).impureCircuits);
  note(`circuits: ${names.join(', ')}`);
  const hasRotation = names.some((n) => /rotate|recover|reassign|migrate/i.test(n));
  ok('a rotation or recovery circuit exists', hasRotation,
     'a breeder who loses their genetic secret can never act on those records again');
}

// ────────────────────────────────────────────── 5. anchorBatch authorisation
//
// anchorBatch takes any root from any caller and overwrites lastBatchRoot.
// Test whether a stranger can overwrite a root the registry just published.
console.log('\n== 5. can a stranger overwrite the published batch root? ==');
{
  const { contract, ctx } = fresh(BREEDER);
  const realRoot = b32(0xaa);
  const afterReal = contract.impureCircuits.anchorBatch(ctx, realRoot).context;

  // Same ledger, different caller with their own secret.
  const stranger = new Contract(witnesses(GRIEFER));
  const fakeRoot = b32(0xbb);
  const afterFake = stranger.impureCircuits.anchorBatch(afterReal, fakeRoot).context;
  const st = ledger(afterFake.currentQueryContext.state);

  note(`registry published: ${hex(realRoot).slice(0, 16)}…`);
  note(`stranger published: ${hex(fakeRoot).slice(0, 16)}…`);
  note(`lastBatchRoot now:  ${hex(st.lastBatchRoot).slice(0, 16)}…`);
  ok('lastBatchRoot still holds the registry root', same(st.lastBatchRoot, realRoot),
     'any caller can overwrite the slot; it carries no authority about who anchored');
}

// ────────────────────────────────────────── 6. assert messages leak nothing
console.log('\n== 6. do assert messages leak private state? ==');
{
  const { contract, ctx } = fresh(BREEDER);
  const wrong = b32(0x77);
  const msg = rejects(() => contract.impureCircuits.anchor(ctx, wrong, pureCircuits.commit(b32(0xB1))));
  note(`message: "${msg}"`);
  const leaks = /[0-9a-f]{16,}/i.test(msg);
  ok('no hex-looking material in the failure message', !leaks);
}

console.log(`\n${failures === 0 ? 'no findings' : `${failures} finding(s) — see FAIL lines above`}`);
process.exit(0);
