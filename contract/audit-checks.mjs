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

const witnesses = (secret) => ({ localGeneticSecret: (ctx) => [ctx.privateState, secret] });
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

  // A return from an exported circuit is a public position, same as a ledger
  // write. Checking only the ledger asked the wrong question.
  const returned = r.result;
  note(`returned value: ${returned ? hex(returned).slice(0, 24) + '…' : '(none)'}`);
  ok('proveOwnership publishes the commitment', returned != null && same(returned, expected),
     'nothing reaches a public position — a verifier cannot tell which record was proven');

  // What the transaction itself carries is the other half of the question.
  // Print it so it can be inspected by eye rather than asserted blindly.
  note('public transcript of the call:');
  try {
    console.log(JSON.stringify(r.result ?? null));
    console.log(JSON.stringify(r.context?.transcript ?? r.proofData ?? '(no transcript field)').slice(0, 400));
  } catch { note('(transcript not serialisable — inspect manually)'); }
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

  note(`returned value:    ${r.result ? hex(r.result).slice(0, 24) + '…' : '(none)'}`);
  ok('lastAnchor holds the DNA commitment', same(after.lastAnchor, dc));
  ok('the record commitment also reaches a public position', r.result != null && same(r.result, rc),
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
    const lc = pureCircuits.commit(b32(i + 1));
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
  const msg = rejects(() => contract.impureCircuits.anchor(ctx, wrong));
  note(`message: "${msg}"`);
  const leaks = /[0-9a-f]{16,}/i.test(msg);
  ok('no hex-looking material in the failure message', !leaks);
}

console.log(`\n${failures === 0 ? 'no findings' : `${failures} finding(s) — see FAIL lines above`}`);
process.exit(0);
