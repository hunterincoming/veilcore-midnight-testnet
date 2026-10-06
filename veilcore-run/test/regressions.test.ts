// The independent review's experiments (review-out/review-managed.md), kept as regression
// tests, each now expecting the fixed behaviour. C1, C2 and D are in exit.test.ts; the
// change-password one (H1) is in cli.test.ts.
// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { VeilCore, VeilCoreClaims } from '@veilcore/contracts';
import type * as FsPromises from 'node:fs/promises';

// Holds a command at the moment it takes the partner folder's lock (reviewer A).
const gate = vi.hoisted(() => ({ wait: undefined as undefined | Promise<void> }));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof FsPromises>();
  return {
    ...real,
    open: async (...a: Parameters<typeof real.open>) => {
      if (String(a[0]).endsWith('.lock') && gate.wait !== undefined) await gate.wait;
      return real.open(...a);
    },
  };
});
const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const kit = await import('@veilcore/contracts');
const { VEILCORE_ADDR, CLAIMS_ADDR, fakeChain } = await import('../../partner-kit/test/local-chain.ts');
const op = await import('../src/operator.ts');
const { readAudit, verifyAnchors, verifyReceipt } = await import('../src/audit.ts');
const { PartnerVault } = await import('../src/vault.ts');
const { NETWORK, PW, newPartner, tempRoot } = await import('./helpers.ts');

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
  gate.wait = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await t.done();
});
const onChain = async (txId: string, head: string): Promise<boolean> =>
  (
    await kit.checkBatchAnchor({
      network: 'undeployed',
      indexer: chain.endpoints.indexer,
      address: VEILCORE_ADDR,
      txId,
      root: kit.fromHex(head),
    })
  ).accepted;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('reviewer A (M4): the store is read only after the lock is taken', () => {
  it('a write made while another command waits for the lock is not lost', async () => {
    const a = await newPartner(t.root, 'lab', { vc, claims });
    let release!: () => void;
    gate.wait = new Promise<void>((r) => (release = r));
    const pB = PartnerVault.open({ root: t.root, id: 'lab', network: NETWORK, password: PW }); // waits at the lock
    await new Promise((r) => setTimeout(r, 200));
    gate.wait = undefined;
    await op.licenceRequest(a, { label: 'lic-A', issuerRecord: 'ab'.repeat(32) }); // A holds the lock and writes
    await a.vault.close();
    release();
    const b = await pB;
    expect(b.read().licences.map((l) => l.label)).toEqual(['lic-A']); // B read AFTER A's write
    await b.update((p) => void p.licences.sort()); // any later write
    await b.close();
    const c = await PartnerVault.open({ root: t.root, id: 'lab', network: NETWORK, password: PW });
    expect(c.read().licences.map((l) => l.label)).toEqual(['lic-A']);
    await c.close();
  });
});

describe('reviewer B (M1): what the hash chain does and does not show, and what anchoring adds', () => {
  const rechain = (lines: string[], edit: (e: Record<string, unknown>, i: number) => void): string[] => {
    const out: string[] = [];
    let prev = '0'.repeat(64);
    for (const [i, l] of lines.entries()) {
      const e = JSON.parse(l) as Record<string, unknown>;
      edit(e, i);
      e.prev = prev;
      const s = JSON.stringify(e);
      out.push(s);
      prev = sha(s);
    }
    return out;
  };

  it('a rewritten log still chains; an anchor taken before shows the rewrite; a receipt shows a cut', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    for (const o of ['one', 'two', 'three']) await lab.audit.write({ op: o, ok: true });
    const receipt = await op.anchorAudit(lab); // the partner keeps this
    await lab.audit.write({ op: 'four', ok: true });
    const file = lab.audit.file;
    expect((await verifyAnchors(file, onChain)).problems).toEqual([]);
    expect(await verifyReceipt(file, { seq: receipt.seq, head: receipt.head, txId: receipt.txId }, onChain)).toBe(true);

    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    // Edit line 2 and re-chain everything after it: the hash chain alone reads "intact"...
    await writeFile(
      file,
      rechain(lines, (e, i) => void (i === 2 ? (e.op = 'something-else') : undefined)).join('\n') + '\n',
    );
    expect((await readAudit(file)).intact).toBe(true);
    // ...but the anchor (and the partner's receipt) do not match any more.
    expect((await verifyAnchors(file, onChain)).problems).toEqual([
      expect.stringMatching(/changed after it was anchored/),
    ]);
    expect(await verifyReceipt(file, receipt, onChain)).toBe(false);

    // Cut the log short, anchor line and all: no anchor left to check, but the receipt fails.
    await writeFile(file, lines.slice(0, 2).join('\n') + '\n');
    expect((await readAudit(file)).intact).toBe(true);
    expect((await verifyAnchors(file, onChain)).anchors).toBe(0);
    expect(await verifyReceipt(file, receipt, onChain)).toBe(false);
    // An anchor claiming a transaction that timestamped something else is caught too.
    await writeFile(file, lines.join('\n') + '\n');
    expect(await verifyReceipt(file, { ...receipt, txId: 'ee'.repeat(32) }, onChain)).toBe(false);
    await lab.vault.close();
  });
});
