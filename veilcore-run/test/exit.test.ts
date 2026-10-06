// Handing a partner their secrets, and leaving ("rotate us out"), against the partner
// kit's chain stand-in: the bundle round trip, the printable sheet, a self exit the
// partner finishes with the kit, an assisted exit after which VeilCore's copies control
// nothing (and the new secrets were never in VeilCore's vault), an interrupted assisted
// exit finished later, and a retired partner refused everything.
// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
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
const { exitAssisted, exitRequest, exitSelf, exportBundle } = await import('../src/exit.ts');
const { readBundle } = await import('../src/bundle.ts');
const { answerExit, licenceSecretAt, makePool, newMaster, recoverySecretAt } = await import('../src/partner-keys.ts');
const { fromPaper, forPaper } = await import('../src/sheet.ts');
const { RetiredPartnerError } = await import('../src/vault.ts');
const { WrongPasswordError } = await import('../src/box.ts');
const { NETWORK, PASSPHRASE, PW2, allText, leaked, newPartner, tempRoot } = await import('./helpers.ts');

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
    exitSelf(lab, { passphrase: PASSPHRASE, out: path.join(t.root, 'again.vcb') }),
  ];
  for (const a of attempts) await expect(a).rejects.toBeInstanceOf(RetiredPartnerError);
  expect(chainLog.length).toBe(n);
};

describe('export: a copy for the partner, who stays in', () => {
  it('round-trips under the partner’s passphrase, refuses any other, and prints a sheet that reads back', async () => {
    const { lab, breeder } = await setUp();
    const out = path.join(t.root, 'lab-copy.vcb');
    const sheet = path.join(t.root, 'lab-sheet.txt');
    await expect(exportBundle(lab, { passphrase: 'weak', out })).rejects.toThrow(/16 or more/);
    await exportBundle(lab, { passphrase: PASSPHRASE, out, sheet });
    const b = await readBundle(out, PASSPHRASE);
    expect(b.vault).toEqual(lab.vault.read());
    expect(b.kind).toBe('export');
    expect(b.audit.length).toBeGreaterThan(0);
    await expect(readBundle(out, PW2)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(leaked(await readFile(out, 'utf8'), lab.vault.secrets())).toEqual([]);

    const text = await readFile(sheet, 'utf8');
    const rec = lab.vault.read().records[0];
    expect(text).toContain(forPaper(rec.secret!));
    const line = text.split('\n').find((l) => l.includes('record secret:'))!;
    expect(kit.toHex(fromPaper(line.split('record secret:')[1]))).toBe(rec.secret);
    expect(() => fromPaper(line.split('record secret:')[1].replace(/check (....)/, 'check 0000'))).toThrow(
      /check does not match/,
    );
    await expect(exportBundle(lab, { passphrase: PASSPHRASE, out })).rejects.toThrow(/already exists/);
    await lab.vault.assertActive(); // still in
    await lab.vault.close();
    await breeder.vault.close();
  });
});

describe('self exit: VeilCore hands over, the partner sends the transactions', () => {
  it('retires the store; the partner recovers each record with the kit; VeilCore’s copies then control nothing', async () => {
    const { lab, breeder } = await setUp();
    const out = path.join(t.root, 'lab-exit.vcb');
    await exitSelf(lab, { passphrase: PASSPHRASE, out });
    await allRefused(lab);

    const b = await readBundle(out, PASSPHRASE);
    expect(b.kind).toBe('exit-self');
    // A second copy for a partner who lost the first, until the purge.
    const copy = path.join(t.root, 'lab-exit-copy.vcb');
    await exportBundle(lab, { passphrase: PASSPHRASE, out: copy });
    expect((await readBundle(copy, PASSPHRASE)).kind).toBe('exit-self');
    expect(b.procedure).toMatch(/recoverRecordSecret/);
    // The partner, with the kit and their own wallet: one recovery per record.
    for (const r of b.vault.records) {
      await vc.recoverRecordSecret({
        originalRecord: kit.fromHex(r.origin),
        recoverySecret: kit.fromHex(r.recovery.secret!),
        newRecordSecret: kit.newSecret(),
        newRecoveryCommitment: kit.commit.recovery(kit.newSecret()),
      });
    }
    const listed = op.listPartner(lab.vault.read(), await kit.readLedger(read()));
    expect(listed.records.map((r) => r.chain?.veilcoreCanAct)).toEqual([false, false]);
    for (const r of lab.vault.read().records) {
      await expect(vc.useRecordSecret(kit.fromHex(r.secret!))).rejects.toThrow(/not the current one/);
      expect(await vc.recoverySecretIsCurrent(kit.fromHex(r.origin), kit.fromHex(r.recovery.secret!))).toBe(false);
    }
    await lab.vault.purge();
    expect(lab.vault.secrets().size).toBe(0);
    expect(
      leaked(
        await allText(lab.vault.dir),
        b.vault.records.map((r) => r.secret!),
      ),
    ).toEqual([]);
    await lab.vault.close();
    await breeder.vault.close();
  });
});

describe('assisted exit: VeilCore sends the transactions', () => {
  it('installs the partner’s recovery commitments, rotates to secrets only the bundle holds, proposes the licence move', async () => {
    const { lab, breeder } = await setUp();
    // acc-3 is a partner-mode record: its recovery secret was never VeilCore's.
    const firstMaster = newMaster();
    await op.importPool(lab, makePool({ partner: 'lab', network: NETWORK, master: firstMaster, count: 2 }));
    await op.anchorRecord(lab, { label: 'acc-3', recovery: 'partner' });
    const old = lab.vault.read();

    const request = exitRequest(old);
    expect(request.records.map((r) => r.label)).toEqual(['acc-1', 'acc-2']); // custody ones only
    expect(request.licences.map((l) => l.label)).toEqual(['lic']);
    expect(JSON.stringify(request)).not.toMatch(new RegExp([...lab.vault.secrets()].join('|')));
    // On the partner's computer: a new master, and commitments only back to VeilCore.
    const master = newMaster();
    const answer = answerExit(request, master, 0);

    const out = path.join(t.root, 'lab-assisted.vcb');
    const r = await exitAssisted(lab, { answer, passphrase: PASSPHRASE, out });
    expect(r.complete).toBe(true);
    expect(r.handover.map((h) => [h.label, h.status])).toEqual([
      ['acc-1', 'done'],
      ['acc-2', 'done'],
      ['acc-3', 'done'],
    ]);
    await allRefused(lab);

    const b = await readBundle(out, PASSPHRASE);
    const ledger = await kit.readLedger(read());
    for (const rec of old.records) {
      const mine = b.vault.records.find((x) => x.label === rec.label)!;
      // VeilCore's old record secret controls nothing; the bundle's is live.
      expect(kit.isLive(ledger, kit.fromHex(rec.current))).toBe(false);
      expect(kit.isLive(ledger, kit.commit.record(kit.fromHex(mine.secret!)))).toBe(true);
      expect(mine.pendingSecret).toBeUndefined();
    }
    // Custody records: only the partner's derived recovery secret works now.
    for (const [i, label] of ['acc-1', 'acc-2'].entries()) {
      const rec = old.records.find((x) => x.label === label)!;
      expect(await vc.recoverySecretIsCurrent(kit.fromHex(rec.origin), kit.fromHex(rec.recovery.secret!))).toBe(false);
      expect(await vc.recoverySecretIsCurrent(kit.fromHex(rec.origin), recoverySecretAt(master, i))).toBe(true);
    }
    // The partner-mode record kept the partner's own recovery secret throughout.
    const acc3 = old.records.find((x) => x.label === 'acc-3')!;
    expect(await vc.recoverySecretIsCurrent(kit.fromHex(acc3.origin), recoverySecretAt(firstMaster, 0))).toBe(true);

    // The new record secrets were never written to VeilCore's side: vault, status or audit log.
    const newSecrets = r.handover.map((h) => h.newSecret);
    expect(leaked(await allText(lab.vault.dir), newSecrets)).toEqual([]);
    expect(lab.vault.read().records.every((x) => x.secret === undefined && x.status === 'handed-over')).toBe(true);

    // The licence: VeilCore proposed the move; the breeder approves; the old secret is dead.
    const lic = lab.vault.read().licences[0];
    expect(lic).toMatchObject({ status: 'transfer-proposed', transferTo: answer.licences[0].licenceCommitment });
    await op.licenceTransferApprove(breeder, {
      label: 'to-lab',
      newCommitment: lic.role === 'licensee' ? lic.transferTo! : '',
      newLabel: 'to-lab-2',
    });
    const issuer = kit.fromHex(breeder.vault.read().records[0].current);
    await vc.proveLicense(licenceSecretAt(master, 0), issuer, kit.newChallenge());
    const refused = await vc
      .proveLicense(kit.fromHex(lic.role === 'licensee' ? lic.secret! : ''), issuer, kit.newChallenge())
      .catch((e: unknown) => e);
    expect(kit.isContractRefusal(refused)).toBe(true);

    expect(b.procedure).toMatch(/which VeilCore\s+never saw/);
    // What is left in VeilCore's store controls nothing: it is never exported as if it did.
    await expect(exportBundle(lab, { passphrase: PASSPHRASE, out: path.join(t.root, 'again.vcb') })).rejects.toThrow(
      /only in their exit bundle/,
    );
    await lab.vault.close();
    await breeder.vault.close();
  });

  it('refuses an answer missing a custody record, and an answer for another partner, before sending anything', async () => {
    const { lab, breeder } = await setUp();
    const request = exitRequest(lab.vault.read());
    const answer = answerExit({ ...request, records: request.records.slice(1) }, newMaster(), 0);
    const n = chainLog.length;
    await expect(
      exitAssisted(lab, { answer, passphrase: PASSPHRASE, out: path.join(t.root, 'x.vcb') }),
    ).rejects.toThrow(/no new recovery commitment for record "acc-1"/);
    const other = answerExit({ ...request, partner: 'breeder' }, newMaster(), 0);
    await expect(
      exitAssisted(lab, { answer: other, passphrase: PASSPHRASE, out: path.join(t.root, 'y.vcb') }),
    ).rejects.toThrow(/made for breeder/);
    expect(chainLog.length).toBe(n);
    await lab.vault.assertActive();
    await lab.vault.close();
    await breeder.vault.close();
  });

  it('an exit interrupted part-way is not retired, and finishes with --previous, keeping the secrets already handed over', async () => {
    const { lab, breeder } = await setUp();
    const master = newMaster();
    const answer = answerExit(exitRequest(lab.vault.read()), master, 0);
    const real = vc.rotateRecordSecret.bind(vc);
    let calls = 0;
    vi.spyOn(vc, 'rotateRecordSecret').mockImplementation(async (s: Uint8Array) => {
      if (++calls === 2) throw new Error('proof server went away');
      return real(s);
    });
    const first = path.join(t.root, 'part-1.vcb');
    const r1 = await exitAssisted(lab, { answer, passphrase: PASSPHRASE, out: first });
    expect(r1.complete).toBe(false);
    expect(r1.handover.map((h) => h.status)).toEqual(['done', 'failed']);
    await lab.vault.assertActive(); // not retired

    vi.restoreAllMocks();
    const second = path.join(t.root, 'part-2.vcb');
    const r2 = await exitAssisted(lab, { answer, passphrase: PASSPHRASE, out: second, previous: first });
    expect(r2.complete).toBe(true);
    const b1 = await readBundle(first, PASSPHRASE);
    const b2 = await readBundle(second, PASSPHRASE);
    expect(b2.handover![0].newSecret).toBe(b1.handover![0].newSecret);
    const ledger = await kit.readLedger(read());
    for (const rec of b2.vault.records)
      expect(kit.isLive(ledger, kit.commit.record(kit.fromHex(rec.secret!)))).toBe(true);
    await expect(lab.vault.assertActive()).rejects.toBeInstanceOf(RetiredPartnerError);
    await lab.vault.close();
    await breeder.vault.close();
  });
});
