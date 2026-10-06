// The re-check's findings (review-out/review-managed.md, "Re-check"), as regression tests:
// a hand-over that lands late (L-R1, its experiment NEW-1), the bundle naming the earlier
// bundle that holds a late-landed secret (L-R2, NEW-2), and L-R3: receipts the partner can
// check from their bundle, unusable bundle keys refused (NEW-3), cancelling an exit that
// sent nothing, and a self exit never handing over a recovery secret the chain made dead.
// SPDX-License-Identifier: Apache-2.0
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { VeilCore, VeilCoreClaims } from '@veilcore/contracts';

const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const kit = await import('@veilcore/contracts');
const { VEILCORE_ADDR, CLAIMS_ADDR, chainLog, fakeChain } = await import('../../partner-kit/test/local-chain.ts');
const op = await import('../src/operator.ts');
const { cancelExit, exitAssisted, exitRequest, exitSelf, exportBundle } = await import('../src/exit.ts');
const { readBundle } = await import('../src/bundle.ts');
const { readAudit, receiptHolds } = await import('../src/audit.ts');
const { answerExit, fingerprintOf, makePool, newMaster, parseAnswer, parsePool } =
  await import('../src/partner-keys.ts');
const { recoverRecords, recordsIn } = await import('../src/partner-side.ts');
const { sealTo } = await import('../src/box.ts');
const { NETWORK, newPartner, tempRoot } = await import('./helpers.ts');

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await t.done();
});
const read = () => ({ network: 'undeployed' as const, indexer: chain.endpoints.indexer, address: VEILCORE_ADDR });
const onChain = async (txId: string, head: string): Promise<boolean> =>
  (await kit.checkBatchAnchor({ ...read(), txId, root: kit.fromHex(head) })).accepted;
const power = async (lab: Awaited<ReturnType<typeof newPartner>>) =>
  op.listPartner(lab.vault.read(), await kit.readLedger(read())).records.map((r) => r.chain!);

describe('L-R1 and L-R2: a hand-over that lands late', () => {
  it('is recorded as done, from the earlier bundle that holds it, not as "taken back" (NEW-1)', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const old = lab.vault.read().records[0];
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    const fp = fingerprintOf(answer);
    const real = vc.rotateRecordSecret.bind(vc);
    let s1: Uint8Array | undefined;
    // Run 1: submitted, not seen: still in flight.
    vi.spyOn(vc, 'rotateRecordSecret').mockImplementationOnce((s: Uint8Array) => {
      s1 = new Uint8Array(s);
      return Promise.reject(new Error('submitted; not seen yet'));
    });
    const p1 = path.join(t.root, 'p1.vcb');
    const r1 = await exitAssisted(lab, { answer, confirmedFingerprint: fp, out: p1 });
    expect(r1.handover[0].status).toBe('failed');
    // Run 2: as it sends, run 1's transaction lands; run 2's own is then refused.
    vi.spyOn(vc, 'rotateRecordSecret').mockImplementationOnce(async () => {
      await vc.useRecordSecret(kit.fromHex(old.secret!));
      await real(s1!);
      throw new Error('refused: not the current secret');
    });
    const r2 = await exitAssisted(lab, { answer, confirmedFingerprint: fp, out: path.join(t.root, 'p2.vcb') });
    expect(r2.complete).toBe(false);
    vi.restoreAllMocks();
    // Run 3 finds run 1's hand-over on chain.
    const p3 = path.join(t.root, 'p3.vcb');
    const r3 = await exitAssisted(lab, { answer, confirmedFingerprint: fp, out: p3 });
    expect(r3.complete).toBe(true);
    const sha1 = lab.vault.read().bundles.find((b) => b.path === p1)!.sha256;
    const st = lab.vault.read().exit!.records['acc-1'];
    expect(st).toMatchObject({ status: 'done', newRecord: kit.toHex(kit.commit.record(s1!)), bundleSha256: sha1 });
    expect(st.note).toMatch(/landed late/);
    expect(
      (await readAudit(lab.audit.file)).entries.some(
        (e) => e.op === 'exit-reconcile' && /landed late/.test(e.note ?? ''),
      ),
    ).toBe(true);
    // L-R2: the last bundle tells the partner which bundle holds that record's secret.
    expect((await readBundle(p3, lab.master)).earlierBundles).toEqual([{ sha256: sha1, labels: ['acc-1'] }]);
    expect((await power(lab))[0]).toMatchObject({
      veilcoreCanAct: false,
      headMadeByVeilcore: true,
      exitComplete: false,
    });
    await lab.vault.close();
  });

  it('the run that finds a landed hand-over names its bundle (NEW-2)', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    const fp = fingerprintOf(answer);
    const real = vc.rotateRecordSecret.bind(vc);
    vi.spyOn(vc, 'rotateRecordSecret').mockImplementationOnce(async (s: Uint8Array) => {
      await real(s);
      vi.spyOn(vc, 'ledger').mockRejectedValueOnce(new Error('indexer down'));
      throw new Error('indexer timed out');
    });
    const p1 = path.join(t.root, 'p1.vcb');
    expect((await exitAssisted(lab, { answer, confirmedFingerprint: fp, out: p1 })).handover[0].status).toBe('failed');
    vi.restoreAllMocks();
    const p2 = path.join(t.root, 'p2.vcb');
    expect((await exitAssisted(lab, { answer, confirmedFingerprint: fp, out: p2 })).complete).toBe(true);
    const sha1 = lab.vault.read().bundles.find((b) => b.path === p1)!.sha256;
    expect((await readBundle(p2, lab.master)).earlierBundles).toEqual([{ sha256: sha1, labels: ['acc-1'] }]);
    await lab.vault.close();
  });
});

describe('L-R3', () => {
  it('(a) a receipt is checked against the log lines carried in the bundle', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const receipt = await op.anchorAudit(lab);
    const out = path.join(t.root, 'copy.vcb');
    await exportBundle(lab, { out });
    const lines = [...(await readBundle(out, lab.master)).auditLines!];
    expect(await receiptHolds(lines, receipt, onChain)).toBe(true);
    const edited = [...lines];
    edited[1] = edited[1].replace('"op":"', '"op":"x');
    expect(await receiptHolds(edited, receipt, onChain)).toBe(false);
    expect(await receiptHolds(lines.slice(0, receipt.seq - 1), receipt, onChain)).toBe(false);
    await lab.vault.close();
  });

  it('(b) a bundle key nothing can be sealed to is refused in a pool and an answer (NEW-3)', () => {
    expect(() => sealTo('00'.repeat(32), { partner: 'x', network: NETWORK }, {})).toThrow();
    const pool = {
      ...makePool({ partner: 'lab', network: NETWORK, master: newMaster(), count: 1 }),
      bundleKey: '00'.repeat(32),
    };
    expect(() => parsePool(JSON.parse(JSON.stringify(pool)))).toThrow(/nothing can be sealed to/);
    const answer = {
      ...answerExit(
        { format: 'veilcore-run/exit-request/1', partner: 'lab', network: NETWORK, records: [], licences: [] },
        newMaster(),
        0,
      ),
      bundleKey: '00'.repeat(32),
    };
    expect(() => parseAnswer(JSON.parse(JSON.stringify(answer)))).toThrow(/nothing can be sealed to/);
  });

  it('(b) an assisted exit that sent nothing can be cancelled, and a new one started; one that sent something cannot', async () => {
    // Partner mode: no recovery replacement; the rotation fails before landing.
    const lab = await newPartner(t.root, 'lab', { vc, claims }, { recovery: 'partner', pool: 3 });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const lost = answerExit(exitRequest(lab.vault.read()), newMaster(), 0); // a master the partner then loses
    vi.spyOn(vc, 'rotateRecordSecret').mockRejectedValueOnce(new Error('no proofs today'));
    expect(
      (
        await exitAssisted(lab, {
          answer: lost,
          confirmedFingerprint: fingerprintOf(lost),
          out: path.join(t.root, 'a.vcb'),
        })
      ).complete,
    ).toBe(false);
    const n = chainLog.length;
    await cancelExit(lab, await kit.readLedger(read()));
    expect(chainLog.length).toBe(n);
    expect(lab.vault.read().exit).toBeUndefined();
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 3);
    expect(
      (
        await exitAssisted(lab, {
          answer,
          confirmedFingerprint: fingerprintOf(answer),
          out: path.join(t.root, 'b.vcb'),
        })
      ).complete,
    ).toBe(true);
    await lab.vault.close();

    // Custody: the recovery replacement landed, so it is refused.
    const lab2 = await newPartner(t.root, 'lab2', { vc, claims });
    await op.anchorRecord(lab2, { label: 'acc-1' });
    const a2 = answerExit(exitRequest(lab2.vault.read()), lab2.master, 0);
    vi.spyOn(vc, 'rotateRecordSecret').mockRejectedValueOnce(new Error('no proofs today'));
    await exitAssisted(lab2, { answer: a2, confirmedFingerprint: fingerprintOf(a2), out: path.join(t.root, 'c.vcb') });
    await expect(cancelExit(lab2, await kit.readLedger(read()))).rejects.toThrow(/already changed the chain \(acc-1\)/);
    await lab2.vault.close();
  });

  it('(c) a recovery replacement that landed unrecorded is found, and the self exit hands over no dead recovery secret', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const vaultSecret = lab.vault.read().records[0].recovery.secret!;
    const answer = answerExit(exitRequest(lab.vault.read()), lab.master, 0);
    const realReplace = vc.replaceRecoveryCommitment.bind(vc);
    vi.spyOn(vc, 'replaceRecoveryCommitment').mockImplementationOnce(async (args) => {
      await realReplace(args); // lands
      throw new Error('process died before recording it'); // nothing recorded
    });
    expect(
      (
        await exitAssisted(lab, {
          answer,
          confirmedFingerprint: fingerprintOf(answer),
          out: path.join(t.root, 'a.vcb'),
        })
      ).complete,
    ).toBe(false);
    expect(lab.vault.read().records[0].recovery.secret).toBe(vaultSecret); // still recorded as VeilCore's: stale
    vi.restoreAllMocks();
    const out = path.join(t.root, 'self.vcb');
    await exitSelf(lab, { out, ledger: await kit.readLedger(read()) });
    const b = await readBundle(out, lab.master);
    expect(b.vault.records[0].recovery).toMatchObject({
      heldBy: 'partner',
      commitment: answer.records[0].recoveryCommitment,
      pool: { index: 0 },
    });
    expect(b.vault.records[0].recovery.secret).toBeUndefined();
    await recoverRecords(vc, recordsIn([b]), lab.master, [lab.master]);
    expect((await power(lab))[0].exitComplete).toBe(true);
    await lab.vault.close();
  });
});
