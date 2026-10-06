// Handing a partner their secrets, and leaving ("rotate us out"), against the partner
// kit's chain stand-in: bundles sealed to the partner's key (never openable on VeilCore's
// side), a self exit and an assisted exit each FINISHED by the partner's own recovery,
// exit-check from what VeilCore really holds, resuming an exit after errors and kills, the
// cases an exit cannot simply rotate, and purge removing the bundle files.
// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { FieldSetFile, VeilCore, VeilCoreClaims } from '@veilcore/contracts';

const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const kit = await import('@veilcore/contracts');
const { VEILCORE_ADDR, CLAIMS_ADDR, chainLog, fakeChain } = await import('../../partner-kit/test/local-chain.ts');
const op = await import('../src/operator.ts');
const { exitAssisted, exitBlockers, exitRequest, exitSelf, exportBundle } = await import('../src/exit.ts');
const { readBundle } = await import('../src/bundle.ts');
const { answerExit, fingerprintOf, licenceSecretAt, newMaster, recoverySecretAt } =
  await import('../src/partner-keys.ts');
const { checkRecords, recordsIn, recoverRecords } = await import('../src/partner-side.ts');
const { RetiredPartnerError } = await import('../src/vault.ts');
const { PW2, allText, leaked, newPartner, tempRoot } = await import('./helpers.ts');

const VECTORS = JSON.parse(
  (await import('node:fs')).readFileSync(new URL('../../contract/vectors/fields-v1.json', import.meta.url), 'utf8'),
) as { fieldSets: { input: Omit<FieldSetFile, 'jsonDigest'> }[] };
const FILE: FieldSetFile = { ...VECTORS.fieldSets[0].input, jsonDigest: '0a'.repeat(32) };

let t: Awaited<ReturnType<typeof tempRoot>>;
let chain: ReturnType<typeof fakeChain>;
let vc: VeilCore;
let claims: VeilCoreClaims;
beforeEach(async () => {
  setNetworkId('undeployed');
  t = await tempRoot();
  chain = fakeChain(fake as never);
  vc = await kit.VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
  claims = await kit.VeilCoreClaims.join(chain.conn, { address: CLAIMS_ADDR });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await t.done();
});
const read = () => ({ network: 'undeployed' as const, indexer: chain.endpoints.indexer, address: VEILCORE_ADDR });
const power = async (lab: Awaited<ReturnType<typeof setUp>>['lab']) =>
  op.listPartner(lab.vault.read(), await kit.readLedger(read())).records.map((r) => ({ label: r.label, ...r.chain! }));

/** A lab with two custody records, a licence it holds from a breeder, a field set and a lab key. */
const setUp = async () => {
  const breeder = await newPartner(t.root, 'breeder', { vc, claims }, { password: PW2 });
  const lab = await newPartner(t.root, 'lab', { vc, claims });
  const mother = await op.anchorRecord(breeder, { label: 'mother' });
  await op.anchorRecord(lab, { label: 'acc-1' });
  await op.anchorRecord(lab, { label: 'acc-2' });
  const req = await op.licenceRequest(lab, { label: 'lic', issuerRecord: mother.record });
  await op.licenceIssue(breeder, { record: 'mother', licenceCommitment: req.licenceCommitment, label: 'to-lab' });
  await op.licenceCountersign(lab, { label: 'lic' });
  await op.sealFieldSet(lab, { label: 'lot-1', file: FILE });
  await op.labKeyNew(lab, { label: 'k' });
  return { breeder, lab, mother };
};

/** Every operation a retired partner might be asked for, each refused before anything is sent. */
const allRefused = async (lab: Awaited<ReturnType<typeof setUp>>['lab']): Promise<void> => {
  const n = chainLog.length;
  const attempts = [
    op.anchorRecord(lab, { label: 'acc-9' }),
    op.pairDna(lab, { record: 'acc-1', report: 'ab'.repeat(32) }),
    op.proveOwnership(lab, { record: 'acc-1', challenge: 'cd'.repeat(32) }),
    op.rotateRecord(lab, { record: 'acc-1' }),
    op.licenceProve(lab, { label: 'lic', challenge: 'cd'.repeat(32) }),
    op.dateRoot(lab, { root: 'ef'.repeat(32) }),
    op.makeClaim(lab, { kind: 'attested', fields: 'lot-1', labKey: 'k' }),
    op.obligationEncumber(lab, { record: 'acc-1', terms: 'x', label: 'o' }),
    op.labKeyNew(lab, { label: 'k2' }),
    exitSelf(lab, { out: path.join(t.root, 'again.vcb') }),
  ];
  for (const a of attempts) await expect(a).rejects.toBeInstanceOf(RetiredPartnerError);
  expect(chainLog.length).toBe(n);
};

describe('bundles are sealed to the partner’s key', () => {
  it('opens with the partner’s master only; holds no secret in clear; needs no passphrase; is recorded for purge', async () => {
    const { lab, breeder } = await setUp();
    const out = path.join(t.root, 'lab-copy.vcb');
    await exportBundle(lab, { out });
    const b = await readBundle(out, lab.master);
    expect(b.vault.records).toEqual(lab.vault.read().records);
    expect(b.kind).toBe('export');
    await expect(readBundle(out, newMaster())).rejects.toThrow(/different master/);
    expect(leaked(await readFile(out, 'utf8'), lab.vault.secrets())).toEqual([]);
    expect(lab.vault.read().bundles.map((x) => x.path)).toEqual([out]);
    await expect(exportBundle(lab, { out })).rejects.toThrow(/already exists/);
    await lab.vault.assertActive(); // still in

    // A partner who never gave a bundle key gets no bundle.
    const noKey = await newPartner(t.root, 'nokey', { vc, claims }, { noKey: true });
    await expect(exportBundle(noKey, { out: path.join(t.root, 'n.vcb') })).rejects.toThrow(/has given no bundle key/);
    await noKey.vault.close();
    await lab.vault.close();
    await breeder.vault.close();
  });
});

describe('self exit: VeilCore hands over; the partner’s own recovery finishes it', () => {
  it('retires the store; partner-recover takes every record back; exit-check then says complete', async () => {
    const { lab, breeder } = await setUp();
    const out = path.join(t.root, 'lab-exit.vcb');
    await exitSelf(lab, { out });
    await allRefused(lab);
    // Until the partner recovers, VeilCore can still act (it holds the record and recovery secrets).
    expect((await power(lab)).map((p) => [p.veilcoreCanAct, p.veilcoreHoldsCurrentRecovery, p.exitComplete])).toEqual([
      [true, true, false],
      [true, true, false],
    ]);

    const b = await readBundle(out, lab.master);
    expect(b.kind).toBe('exit-self');
    expect(b.procedure).toMatch(/REQUIRED/);
    // A second copy for a partner who lost the first, until the purge.
    const copy = path.join(t.root, 'lab-exit-copy.vcb');
    await exportBundle(lab, { out: copy });
    expect((await readBundle(copy, lab.master)).kind).toBe('exit-self');

    // The partner, on their computer, with their master and their own wallet.
    const records = recordsIn([b]);
    const done = await recoverRecords(vc, records, lab.master, [lab.master]);
    expect(done.map((d) => d.outcome)).toEqual([
      'recovered to your own secrets (generation 0)',
      'recovered to your own secrets (generation 0)',
    ]);
    expect(checkRecords(await kit.readLedger(read()), records, lab.master).every((c) => c.yours)).toBe(true);
    expect((await recoverRecords(vc, records, lab.master, [lab.master])).map((d) => d.outcome)).toEqual([
      'already yours',
      'already yours',
    ]);
    expect((await power(lab)).every((p) => p.exitComplete && !p.veilcoreCanAct)).toBe(true);

    const r = await lab.vault.purge();
    expect(r.deleted.sort()).toEqual([copy, out].sort());
    expect(existsSync(out) || existsSync(copy)).toBe(false);
    expect(lab.vault.secrets().size).toBe(0);
    expect((await power(lab)).every((p) => p.holdsNothing && p.exitComplete)).toBe(true);
    await lab.vault.close();
    await breeder.vault.close();
  });

  it('a partner who ROTATES instead of recovering is told VeilCore still holds the recovery (reviewer C2)', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const out = path.join(t.root, 's.vcb');
    await exitSelf(lab, { out });
    const rec = (await readBundle(out, lab.master)).vault.records[0];
    await vc.useRecordSecret(kit.fromHex(rec.secret!));
    await vc.rotateRecordSecret(kit.newSecret());
    const [p] = await power(lab);
    expect(p).toMatchObject({
      veilcoreHoldsLiveSecret: false,
      veilcoreHoldsCurrentRecovery: true,
      veilcoreCanAct: true,
      exitComplete: false,
    });
    await lab.vault.close();
  });
});

describe('assisted exit: VeilCore sends the transactions', () => {
  it('refuses an answer whose fingerprint was not confirmed, before sending anything', async () => {
    const { lab, breeder } = await setUp();
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    // An attacker's answer, built from their own master, with the real fingerprint typed: refused.
    const forged = answerExit(exitRequest(lab.vault.read()), newMaster(), 0);
    const n = chainLog.length;
    for (const [a, typed] of [
      [answer, '0000 0000 0000 0000 0000'],
      [forged, fingerprintOf(answer)],
    ] as const)
      await expect(
        exitAssisted(lab, { answer: a, confirmedFingerprint: typed, out: path.join(t.root, 'x.vcb') }),
      ).rejects.toThrow(/not the fingerprint/);
    const missing = answerExit({ ...exitRequest(lab.vault.read()), records: [] }, lab.master, 0);
    await expect(
      exitAssisted(lab, {
        answer: missing,
        confirmedFingerprint: fingerprintOf(missing),
        out: path.join(t.root, 'y.vcb'),
      }),
    ).rejects.toThrow(/no new recovery commitment for record "acc-1"/);
    const other = answerExit({ ...exitRequest(lab.vault.read()), partner: 'breeder' }, lab.master, 0);
    await expect(
      exitAssisted(lab, { answer: other, confirmedFingerprint: fingerprintOf(other), out: path.join(t.root, 'z.vcb') }),
    ).rejects.toThrow(/made for breeder/);
    expect(chainLog.length).toBe(n);
    expect(lab.vault.read().exit).toBeUndefined();
    await lab.vault.close();
    await breeder.vault.close();
  });

  it('hands over with secrets never stored by VeilCore; only the partner’s recovery completes it', async () => {
    const { lab, breeder } = await setUp();
    // acc-3 keeps the partner's own recovery secret from the start (partner mode).
    const pool = (await import('../src/partner-keys.ts')).makePool({
      partner: 'lab',
      network: 'undeployed',
      master: lab.master,
      count: 2,
    });
    await op.importPool(lab, pool, fingerprintOf(pool));
    await op.anchorRecord(lab, { label: 'acc-3', recovery: 'partner' });
    const old = lab.vault.read();
    const request = exitRequest(old);
    expect(request.records.map((r) => r.label)).toEqual(['acc-1', 'acc-2']);
    const answer = answerExit(request, lab.master, 2); // indexes after the pool's
    const out = path.join(t.root, 'lab-assisted.vcb');
    const r = await exitAssisted(lab, { answer, confirmedFingerprint: fingerprintOf(answer), out });
    expect(r.complete).toBe(true);
    expect(r.handover.map((h) => [h.label, h.status])).toEqual([
      ['acc-1', 'done'],
      ['acc-2', 'done'],
      ['acc-3', 'done'],
    ]);
    await allRefused(lab);

    // The hand-over secrets are in the sealed bundle only: not in VeilCore's folder, not in the result.
    const b = await readBundle(out, lab.master);
    const handed = b.vault.records.map((x) => x.pendingSecret!);
    expect(handed.every((s) => /^[0-9a-f]{64}$/.test(s))).toBe(true);
    expect(leaked(await allText(lab.vault.dir), handed)).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(new RegExp(handed.join('|')));
    const ledger = await kit.readLedger(read());
    for (const s of handed) expect(kit.isLive(ledger, kit.commit.record(kit.fromHex(s)))).toBe(true);
    for (const x of old.records) expect(kit.isLive(ledger, kit.fromHex(x.current))).toBe(false);
    for (const [i, label] of ['acc-1', 'acc-2'].entries()) {
      const rec = old.records.find((x) => x.label === label)!;
      expect(await vc.recoverySecretIsCurrent(kit.fromHex(rec.origin), kit.fromHex(rec.recovery.secret!))).toBe(false);
      expect(await vc.recoverySecretIsCurrent(kit.fromHex(rec.origin), recoverySecretAt(lab.master, 2 + i))).toBe(true);
    }

    // VeilCore holds nothing that acts (reviewer C1 said "can act: true"), but the exit is not complete.
    expect((await power(lab)).map((p) => [p.veilcoreCanAct, p.headMadeByVeilcore, p.exitComplete])).toEqual([
      [false, true, false],
      [false, true, false],
      [false, true, false],
    ]);
    expect(b.procedure).toMatch(/REQUIRED/);
    expect(b.procedure).toMatch(/partner-recover/);

    // The partner's REQUIRED step: then it is.
    const records = recordsIn([b]);
    await recoverRecords(vc, records, lab.master, [lab.master]);
    expect(checkRecords(await kit.readLedger(read()), records, lab.master).every((c) => c.yours)).toBe(true);
    expect((await power(lab)).every((p) => p.exitComplete)).toBe(true);

    // The licence: VeilCore proposed the move; the breeder approves; the old secret is dead.
    const lic = lab.vault.read().licences[0];
    expect(lic).toMatchObject({ status: 'transfer-proposed', transferTo: answer.licences[0].licenceCommitment });
    await op.licenceTransferApprove(breeder, {
      label: 'to-lab',
      newCommitment: answer.licences[0].licenceCommitment,
      newLabel: 'to-lab-2',
    });
    const issuer = kit.fromHex(breeder.vault.read().records[0].current);
    await vc.proveLicense(licenceSecretAt(lab.master, 2), issuer, kit.newChallenge());
    const refused = await vc
      .proveLicense(kit.fromHex(lic.role === 'licensee' ? lic.secret! : ''), issuer, kit.newChallenge())
      .catch((e: unknown) => e);
    expect(kit.isContractRefusal(refused)).toBe(true);

    // The audit head was anchored at the end: a receipt for the partner.
    const { readAudit } = await import('../src/audit.ts');
    expect((await readAudit(lab.audit.file)).entries.some((e) => e.op === 'audit-anchor')).toBe(true);
    await expect(exportBundle(lab, { out: path.join(t.root, 'again.vcb') })).rejects.toThrow(
      /only in their exit bundle/,
    );
    await lab.vault.close();
    await breeder.vault.close();
  });

  it('stops on an error, is not retired, and resumes with the same answer: one new secret only where needed', async () => {
    const { lab, breeder } = await setUp();
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    const confirmedFingerprint = fingerprintOf(answer);
    const real = vc.rotateRecordSecret.bind(vc);
    let calls = 0;
    vi.spyOn(vc, 'rotateRecordSecret').mockImplementation(async (s: Uint8Array) => {
      if (++calls === 2) throw new Error('proof server went away'); // did not land
      return real(s);
    });
    const first = path.join(t.root, 'part-1.vcb');
    const r1 = await exitAssisted(lab, { answer, confirmedFingerprint, out: first });
    expect(r1.complete).toBe(false);
    expect(r1.handover.map((h) => h.status)).toEqual(['done', 'failed']);
    await lab.vault.assertActive(); // not retired
    expect(lab.vault.read().exit?.records['acc-2'].status).toBe('failed');

    // A fresh exit with another answer is refused while this one is under way.
    const other = answerExit(exitRequest(lab.vault.read()), newMaster(), 0);
    await expect(
      exitAssisted(lab, { answer: other, confirmedFingerprint: fingerprintOf(other), out: path.join(t.root, 'o.vcb') }),
    ).rejects.toThrow(/already under way/);

    vi.restoreAllMocks();
    const second = path.join(t.root, 'part-2.vcb');
    const r2 = await exitAssisted(lab, { answer, confirmedFingerprint, out: second });
    expect(r2.complete).toBe(true);
    expect(r2.handover.map((h) => h.label)).toEqual(['acc-2']); // acc-1 was done: no second secret for it
    const b1 = await readBundle(first, lab.master);
    const b2 = await readBundle(second, lab.master);
    expect(b2.earlierBundles).toEqual([{ sha256: expect.any(String) as string, labels: ['acc-1'] }]);
    const ledger = await kit.readLedger(read());
    expect(kit.isLive(ledger, kit.commit.record(kit.fromHex(b1.vault.records[0].pendingSecret!)))).toBe(true);
    expect(kit.isLive(ledger, kit.commit.record(kit.fromHex(b2.vault.records[1].pendingSecret!)))).toBe(true);
    // The partner recovers from both bundles together.
    await recoverRecords(vc, recordsIn([b1, b2]), lab.master, [lab.master]);
    expect((await power(lab)).every((p) => p.exitComplete)).toBe(true);
    await lab.vault.close();
    await breeder.vault.close();
  });

  it('a rotation that LANDED but reported an error is found on chain, in the same run or the next (reviewer D)', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    await op.anchorRecord(lab, { label: 'acc-2' });
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    const confirmedFingerprint = fingerprintOf(answer);
    const real = vc.rotateRecordSecret.bind(vc);
    const realLedger = vc.ledger.bind(vc);
    let calls = 0;
    vi.spyOn(vc, 'rotateRecordSecret').mockImplementation(async (s: Uint8Array) => {
      const r = await real(s);
      if (++calls === 2) {
        // Landed; then the indexer times out, and so does the check that follows.
        vi.spyOn(vc, 'ledger').mockRejectedValueOnce(new Error('indexer down'));
        throw new Error('indexer timed out');
      }
      return r;
    });
    const r1 = await exitAssisted(lab, { answer, confirmedFingerprint, out: path.join(t.root, 'p1.vcb') });
    expect(r1.handover.map((h) => h.status)).toEqual(['done', 'failed']);
    vi.restoreAllMocks();
    void realLedger;
    const r2 = await exitAssisted(lab, { answer, confirmedFingerprint, out: path.join(t.root, 'p2.vcb') });
    expect(r2.complete).toBe(true);
    expect(r2.handover).toEqual([]); // nothing new made: acc-2 was found on chain
    expect(lab.vault.read().exit?.records['acc-2']).toMatchObject({ status: 'done', note: 'found on chain' });
    const b1 = await readBundle(path.join(t.root, 'p1.vcb'), lab.master);
    expect(
      kit.isLive(await kit.readLedger(read()), kit.commit.record(kit.fromHex(b1.vault.records[1].pendingSecret!))),
    ).toBe(true);
    await lab.vault.close();
  });

  it('when one landed and only its check failed in the same run, it is done at once', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    const real = vc.rotateRecordSecret.bind(vc);
    vi.spyOn(vc, 'rotateRecordSecret').mockImplementation(async (s: Uint8Array) => {
      await real(s);
      throw new Error('indexer timed out');
    });
    const r = await exitAssisted(lab, {
      answer,
      confirmedFingerprint: fingerprintOf(answer),
      out: path.join(t.root, 'p.vcb'),
    });
    expect(r.complete).toBe(true);
    expect(r.handover[0].status).toBe('done');
    await lab.vault.close();
  });

  it('falls back to a self exit while an assisted one is under way', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    await op.anchorRecord(lab, { label: 'acc-2' });
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    vi.spyOn(vc, 'rotateRecordSecret').mockRejectedValue(new Error('no proofs today'));
    const r = await exitAssisted(lab, {
      answer,
      confirmedFingerprint: fingerprintOf(answer),
      out: path.join(t.root, 'a.vcb'),
    });
    expect(r.complete).toBe(false);
    vi.restoreAllMocks();
    const out = path.join(t.root, 'self.vcb');
    await exitSelf(lab, { out });
    const b = await readBundle(out, lab.master);
    // acc-1's recovery was replaced with the partner's before the rotation failed.
    await recoverRecords(vc, recordsIn([b]), lab.master, [lab.master]);
    expect((await power(lab)).every((p) => p.exitComplete)).toBe(true);
    await lab.vault.close();
  });
});

describe('what an exit cannot simply rotate', () => {
  it('refuses to start with a record never anchored or a licence never countersigned; abandon clears them', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    vi.spyOn(vc, 'anchor').mockRejectedValueOnce(new Error('indexer timeout'));
    await expect(op.anchorRecord(lab, { label: 'half' })).rejects.toThrow(/indexer timeout/);
    await op.licenceRequest(lab, { label: 'req', issuerRecord: 'ab'.repeat(32) });
    expect(exitBlockers(lab.vault.read())).toHaveLength(2);
    await expect(exitSelf(lab, { out: path.join(t.root, 'x.vcb') })).rejects.toThrow(
      /never anchored.*never countersigned/,
    );
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    await expect(
      exitAssisted(lab, { answer, confirmedFingerprint: fingerprintOf(answer), out: path.join(t.root, 'y.vcb') }),
    ).rejects.toThrow(/never anchored/);
    await op.abandonRecord(lab, { label: 'half' });
    await op.abandonLicence(lab, { label: 'req' });
    expect(exitBlockers(lab.vault.read())).toEqual([]);
    expect(lab.vault.read().records.map((r) => r.label)).toEqual(['acc-1']);
    await lab.vault.close();
  });

  it('a record with all 16 rotations used is not rotated: its recovery becomes the partner’s, and their recovery takes it', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    for (let i = 0; i < 16; i++) await op.rotateRecord(lab, { record: 'acc-1' });
    await expect(op.rotateRecord(lab, { record: 'acc-1' })).rejects.toThrow();
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    const out = path.join(t.root, 'r.vcb');
    const r = await exitAssisted(lab, { answer, confirmedFingerprint: fingerprintOf(answer), out });
    expect(r.handover[0]).toMatchObject({ status: 'not-rotatable' });
    expect(r.complete).toBe(true);
    // VeilCore's record secret still works until the partner's recovery: the listing says so.
    expect((await power(lab))[0]).toMatchObject({ veilcoreCanAct: true, veilcoreHoldsCurrentRecovery: false });
    const b = await readBundle(out, lab.master);
    await recoverRecords(vc, recordsIn([b]), lab.master, [lab.master]);
    expect((await power(lab))[0]).toMatchObject({ veilcoreCanAct: false, exitComplete: true });
    await lab.vault.close();
  });
});
