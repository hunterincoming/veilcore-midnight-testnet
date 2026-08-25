/**
 * VeilCore contract, exercised locally.
 *
 * Runs the compiled circuits in-process against a simulated ledger: no chain,
 * no wallet, no proving, no fees. `createCircuitContext` gives us the state a
 * deployed contract would hold, and each caller is its own Contract instance
 * with its own `localGeneticSecret`, which is exactly how two parties look to
 * the circuits.
 *
 * Part 1 walks the intended flows. Part 2 replays them as an attacker. Every
 * check prints OK or FAIL and the process exits non-zero if anything failed,
 * so this is CI-shaped rather than demo-shaped.
 *
 *   node contract/test-local.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as rt from '@midnight-ntwrk/compact-runtime';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = path.join(here, 'src/managed/veilcore/contract/index.js');
const mod = await import(pathToFileURL(artifact).href);
const { Contract, LicenseState, ledger, pureCircuits } = mod;

let failures = 0;
const ok = (name, cond, detail) => {
    if (cond) { console.log(`OK   ${name}`); }
    else { console.error(`FAIL ${name}${detail ? `  (${detail})` : ''}`); failures++; }
};
/** Runs a circuit and returns the thrown message, or an empty string when it succeeded. */
const rejects = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message ?? e); } };

const b32 = (fill) => new Uint8Array(32).fill(fill);
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// ---------------------------------------------------------------- callers --
// The witness is the caller identity here: same circuits, different secret.
const witnesses = (secret) => ({ localGeneticSecret: (ctx) => [ctx.privateState, secret] });

const BREEDER = b32(0x11);
const LICENSEE = b32(0x22);
const MALLORY = b32(0x99);

const breeder = new Contract(witnesses(BREEDER));
const licensee = new Contract(witnesses(LICENSEE));
const mallory = new Contract(witnesses(MALLORY));

// Commitments as an off-chain party would compute them, through the artifact's
// own pure circuit so the domain separation matches byte for byte.
const commit = (secret) => pureCircuits.commit(secret);
const RECORD = commit(BREEDER);
const LICENSE_SECRET = b32(0x33);    // the licence secret, held by the licensee
const LICENSE2_SECRET = b32(0x34);
const LICENSE = commit(LICENSE_SECRET);
const LICENSE2 = commit(LICENSE2_SECRET);

const ctorCtx = rt.createConstructorContext({}, '00'.repeat(32));
const init = breeder.initialState(ctorCtx);
let ctx = rt.createCircuitContext(
    rt.dummyContractAddress(),
    ctorCtx.initialZswapLocalState.coinPublicKey,
    init.currentContractState.data,
    init.currentPrivateState
);
const run = (contract, name, ...args) => {
    const out = contract.impureCircuits[name](ctx, ...args);
    ctx = out.context;
    return out;
};
const state = () => ledger(ctx.currentQueryContext.state);

console.log('\n== 1. the intended flows ==\n');

run(breeder, 'anchor', RECORD);
ok('anchor: counter moved', state().anchorSeq === 1n, `anchorSeq=${state().anchorSeq}`);
ok('anchor: lastAnchor is the record commitment', same(state().lastAnchor, RECORD));
ok('anchor: a commitment you hold no preimage for is refused',
    rejects(() => run(mallory, 'anchor', RECORD)).includes('does not match'));

const BATCH_ROOT = b32(0x55);
run(breeder, 'anchorBatch', BATCH_ROOT);
ok('anchorBatch: root stored', same(state().lastBatchRoot, BATCH_ROOT));

run(breeder, 'proveOwnership');
ok('proveOwnership: counter moved', state().proofSeq === 1n);

run(breeder, 'pairDna', RECORD, b32(0x66));
ok('pairDna: lastAnchor now carries the DNA commitment', same(state().lastAnchor, b32(0x66)));

run(breeder, 'issueLicense', RECORD, LICENSE);
ok('issueLicense: starts PENDING', state().licenseStatusOf.lookup(LICENSE) === LicenseState.PENDING);
ok('issueLicense: only the record owner may issue',
    rejects(() => run(mallory, 'issueLicense', RECORD, LICENSE2)).includes('Only the record owner'));
ok('issueLicense: no double issue',
    rejects(() => run(breeder, 'issueLicense', RECORD, LICENSE)).includes('already exists'));

run(licensee, 'countersignLicense', LICENSE_SECRET);
ok('countersign: now ACTIVE', state().licenseStatusOf.lookup(LICENSE) === LicenseState.ACTIVE);

run(licensee, 'proveLicense', b32(0x33));
ok('proveLicense: the secret holder passes', true);
ok('proveLicense: a wrong secret fails',
    rejects(() => run(mallory, 'proveLicense', b32(0x77))).includes('No such license'));

// Assignment. The incoming party generates their own secret and hands over only
// its commitment, so after approval the licence lives under a key the outgoing
// party has never seen.
const ASSIGNEE_SECRET = b32(0x44);
const ASSIGNEE_LICENSE = commit(ASSIGNEE_SECRET);
run(licensee, 'proposeTransfer', LICENSE_SECRET, ASSIGNEE_LICENSE);
ok('proposeTransfer: proposal recorded', state().pendingTransferOf.member(LICENSE));

run(breeder, 'approveTransfer', LICENSE, RECORD, ASSIGNEE_LICENSE);
ok('approveTransfer: the new licence is live and ACTIVE',
    state().licenseStatusOf.lookup(ASSIGNEE_LICENSE) === LicenseState.ACTIVE);
ok('approveTransfer: it is issued against the same record',
    same(state().licenseRecordOf.lookup(ASSIGNEE_LICENSE), RECORD));
ok('approveTransfer: proposal cleared', !state().pendingTransferOf.member(LICENSE));

// The point of the whole mechanism. USDA's template calls the obligations
// non-delegable and the identity of the parties material, so an assignment has
// to END the outgoing party's rights rather than add a second holder.
ok('approveTransfer: the OLD licence no longer exists', !state().licenseStatusOf.member(LICENSE));
ok('approveTransfer: the outgoing party can no longer prove the licence',
    rejects(() => run(licensee, 'proveLicense', LICENSE_SECRET)).includes('No such license'));
ok('approveTransfer: the outgoing party can no longer propose another assignment',
    rejects(() => run(licensee, 'proposeTransfer', LICENSE_SECRET, commit(b32(0x55)))) !== '');
ok('approveTransfer: the incoming party can prove it',
    rejects(() => run(licensee, 'proveLicense', ASSIGNEE_SECRET)) === '');

console.log('\n== 2. the same flows, driven by an attacker ==\n');

// F1: countersignLicense authenticates nobody. The licence commitment is
// public: it is disclosed by issueLicense and it is a ledger map key.
run(breeder, 'issueLicense', RECORD, LICENSE2);
const f1 = rejects(() => run(mallory, 'countersignLicense', b32(0xAA)));
ok('F1: a stranger CANNOT activate a pending licence', f1 !== '',
    f1 === '' ? `mallory activated it, status is now ${state().licenseStatusOf.lookup(LICENSE2)}` : f1);

// LICENSE2 is still PENDING: F1 no longer activates it as a side effect, now
// that a stranger cannot countersign. The rightful holder activates it here.
run(licensee, 'countersignLicense', LICENSE2_SECRET);

// F2: approveTransfer reads whatever proposal is pending at execution time and
// proposeTransfer is unauthenticated, so the recipient can be swapped under the
// issuer between reading a proposal and approving it.
const INTENDED = commit(LICENSEE);
const MALLORYS = commit(MALLORY);
run(licensee, 'proposeTransfer', LICENSE2_SECRET, INTENDED);   // the licensee proposes
rejects(() => run(mallory, 'proposeTransfer', b32(0xAA), MALLORYS));  // the sniper tries to overwrite
run(breeder, 'approveTransfer', LICENSE2, RECORD, INTENDED);   // the breeder approves the party it saw
ok('F2: approval lands on the recipient the issuer saw',
    state().licenseStatusOf.member(INTENDED) && !state().licenseStatusOf.member(MALLORYS),
    state().licenseStatusOf.member(MALLORYS) ? 'it landed on the sniper instead' : 'it landed somewhere else');

// F3: withdrawTransfer is unauthenticated too. LICENSE2 was consumed by the
// assignment above — an assignment ends the old licence — so this runs against
// the licence that replaced it.
const INTENDED_SECRET = LICENSEE;
run(licensee, 'proposeTransfer', INTENDED_SECRET, commit(b32(0x56)));
const f3 = rejects(() => run(mallory, 'withdrawTransfer', b32(0xAA)));
ok('F3: a stranger CANNOT withdraw a proposal they did not make', f3 !== '',
    f3 === '' ? 'mallory cancelled it' : f3);

// F4: revocation cleared the licence maps and forgot the pending transfer, so a
// revoked licence could leave an entry behind forever, against the header's
// promise of state bounded by live agreements.
//
// The F3 proposal still stands, and one licence holds one proposal at a time, so
// the holder withdraws before proposing again. This runs against INTENDED, the
// licence that replaced LICENSE2 when it was assigned.
run(licensee, 'withdrawTransfer', INTENDED_SECRET);
run(licensee, 'proposeTransfer', INTENDED_SECRET, commit(b32(0x57)));
run(breeder, 'revokeLicense', INTENDED);
ok('F4: revocation leaves no pending transfer behind', !state().pendingTransferOf.member(INTENDED),
    'pendingTransferOf still holds the revoked licence');

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
