// Licence state machine.
//
// The commitment tests cover the algebra. This covers the transitions — where today's
// bug actually lived: approveTransfer cleared the proposal and never moved the licence,
// which compiled, deployed, and reported success.
//
// The ledger is modelled here rather than run on chain, so these execute in a second.
// The model mirrors veilcore.compact; if the contract changes, this must change with it
// or it is testing a fiction.
import { pureCircuits as C } from './src/managed/veilcore/contract/index.js';

const hex = (u) => Buffer.from(u).toString('hex');
const sec = (n) => { const a = new Uint8Array(32); a.fill(n); return a; };
let fails = 0;
const check = (n, ok) => { console.log(ok ? ' PASS' : ' FAIL', n); if (!ok) fails++; };

const NONE = 0, PENDING = 1, ACTIVE = 2;

const ledger = () => ({
  status: new Map(), record: new Map(), holder: new Map(), pending: new Map(),
});

const issueLicense = (L, recordC, licenseC) => {
  if (L.status.has(hex(licenseC))) throw new Error('License already exists');
  L.status.set(hex(licenseC), PENDING);
  L.record.set(hex(licenseC), hex(recordC));
  L.holder.set(hex(licenseC), hex(recordC));
};

const countersign = (L, licenseC) => {
  if (!L.status.has(hex(licenseC))) throw new Error('No such license');
  L.status.set(hex(licenseC), ACTIVE);
};

const proposeTransfer = (L, licenseC, newHolderC) => {
  if (!L.status.has(hex(licenseC))) throw new Error('No such license');
  if (L.status.get(hex(licenseC)) !== ACTIVE) throw new Error('Only an active license can be transferred');
  L.pending.set(hex(licenseC), hex(newHolderC));
};

const approveTransfer = (L, licenseC, recordC) => {
  if (!L.pending.has(hex(licenseC))) throw new Error('No transfer proposed');
  if (L.record.get(hex(licenseC)) !== hex(recordC)) throw new Error('Not your license');
  L.holder.set(hex(licenseC), L.pending.get(hex(licenseC)));
  L.pending.delete(hex(licenseC));
};

const revoke = (L, licenseC) => {
  if (!L.status.has(hex(licenseC))) throw new Error('No such license');
  L.status.delete(hex(licenseC));
  L.record.delete(hex(licenseC));
  L.holder.delete(hex(licenseC));
};

const record = C.commit(sec(0xaa));
const lic = C.commit(sec(0x33));
const newHolder = C.commit(sec(0x22));

// --- the bug that shipped today ---
{
  const L = ledger();
  issueLicense(L, record, lic);
  countersign(L, lic);
  const before = L.holder.get(hex(lic));
  proposeTransfer(L, lic, newHolder);
  approveTransfer(L, lic, record);
  check('approving a transfer actually changes the holder', L.holder.get(hex(lic)) !== before);
  check('the new holder is the proposed one', L.holder.get(hex(lic)) === hex(newHolder));
  check('the proposal is cleared once approved', !L.pending.has(hex(lic)));
}

// --- permissioning ---
{
  const L = ledger();
  issueLicense(L, record, lic);
  countersign(L, lic);
  proposeTransfer(L, lic, newHolder);
  let refused = false;
  try { approveTransfer(L, lic, C.commit(sec(0xbb))); } catch { refused = true; }
  check('only the issuing record holder can approve', refused);
}

{
  const L = ledger();
  issueLicense(L, record, lic);
  let refused = false;
  try { proposeTransfer(L, lic, newHolder); } catch { refused = true; }
  check('a pending licence cannot be transferred', refused);
}

// --- revocation clears every map ---
{
  const L = ledger();
  issueLicense(L, record, lic);
  countersign(L, lic);
  revoke(L, lic);
  check('revocation clears status', !L.status.has(hex(lic)));
  check('revocation clears the record binding', !L.record.has(hex(lic)));
  check('revocation clears the holder — state stays bounded', !L.holder.has(hex(lic)));
  let refused = false;
  try { countersign(L, lic); } catch { refused = true; }
  check('a revoked licence cannot be acted on', refused);
}

// --- no duplicates ---
{
  const L = ledger();
  issueLicense(L, record, lic);
  let refused = false;
  try { issueLicense(L, record, lic); } catch { refused = true; }
  check('the same licence cannot be issued twice', refused);
}

console.log(fails === 0 ? '\nAll licence state tests passed.' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
