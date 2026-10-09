// The secrets never leave the browser: nothing the app sends to the registry, and nothing
// it exports as a record, carries a record secret or recovery secret.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const local = new Map<string, string>();
const sent: string[] = [];

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
  });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push(
      `${String(url)}\n${JSON.stringify(init?.headers ?? {})}\n${typeof init?.body === 'string' ? init.body : ''}`,
    );
    const method = init?.method ?? 'GET';
    if (method === 'PUT') return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  });
});
afterAll(() => vi.unstubAllGlobals());

const forms = (hex: string): string[] => [hex, hex.toUpperCase(), Buffer.from(hex, 'hex').toString('base64')];

describe('record secrets stay in the browser', () => {
  it('no registry request and no exported envelope carries a secret, through anchor, pairing and correction', async () => {
    const records = await import('./records');
    const { ensureKeys, setAnchor, setDnaOnChain } = await import('./record-keys');
    const { sealEnvelope } = await import('./envelope');
    const { fingerprintRecord, newNonce } = await import('./commitment');
    const { identityOf } = await import('./chain/actions');
    const { dnaPairBinding } = await import('./chain/pairing');

    const nonce = newNonce();
    const fields = {
      nonce,
      strainName: 'Test cultivar',
      bredBy: 'Tester',
      dateCreated: '2026-10-03',
      notes: '',
      loggedAt: Date.now(),
    };
    const rec = records.createRecord({ ...fields, recordFingerprint: await fingerprintRecord(fields) });

    const keys = ensureKeys(rec.id);
    const identity = identityOf(Buffer.from(keys.recordSecret, 'hex'));
    setAnchor(rec.id, {
      identity,
      network: 'preprod',
      contractAddress: 'c0'.repeat(32),
      txId: 'aa'.repeat(32),
      txHash: 'bb'.repeat(32),
      blockHeight: 1,
    });
    records.pairDna(rec.id, 'd7'.repeat(32), 'report.pdf');
    const salt = 'a1b2'.repeat(16);
    const binding = dnaPairBinding('d7'.repeat(32), identity, salt);
    setDnaOnChain(rec.id, { fingerprint: 'd7'.repeat(32), salt, identity, binding, status: 'sending' });
    setDnaOnChain(rec.id, {
      fingerprint: 'd7'.repeat(32),
      salt,
      identity,
      binding,
      status: 'paired',
      txId: 'cc'.repeat(32),
      txHash: 'dd'.repeat(32),
      blockHeight: 2,
    });
    await records.issueCorrection(rec.id, { notes: 'fixed' }, 'typo');
    await new Promise((r) => setTimeout(r, 50)); // let the saves go out

    const puts = sent.filter((s) => s.includes('/api/records'));
    // At least one save each for the record, its pairing and its correction (the registry
    // client on main sends one write per change), so the check below sees real traffic.
    expect(puts.length).toBeGreaterThanOrEqual(3);
    const env = JSON.stringify(await sealEnvelope(records.getRecord(rec.id)!, 'holder'));
    // Neither secret, and not even the public on-chain identity: the registry knows which
    // holder holds which record, so with the identity it could join a holder to their
    // on-chain activity.
    for (const value of [keys.recordSecret, keys.recoverySecret, identity, salt, binding]) {
      for (const f of forms(value)) {
        for (const s of sent) expect(s.includes(f)).toBe(false);
        expect(env.includes(f)).toBe(false);
        expect(JSON.stringify(records.allRecords()).includes(f)).toBe(false);
      }
    }
  });
});

describe('record keys', () => {
  it('are made once per record and kept apart from the records', async () => {
    const { ensureKeys, keysFor, keysWithoutBackup } = await import('./record-keys');
    const a = ensureKeys('VEIL-A');
    expect(ensureKeys('VEIL-A')).toEqual(a);
    expect(a.recordSecret).not.toBe(a.recoverySecret);
    expect(keysFor('VEIL-A')).toEqual(a);
    expect(keysWithoutBackup().some((k) => k.recordId === 'VEIL-A')).toBe(true);
    expect([...local.keys()].filter((k) => k.includes('record-keys'))).toEqual(['veilcore.record-keys.v1']);
  });

  it('restore from a backup file, and refuse one that would replace different keys', async () => {
    const { ensureKeys, backupFile, restoreBackup, forgetKeys, keysFor } = await import('./record-keys');
    const a = ensureKeys('VEIL-B');
    const file = { text: () => Promise.resolve(backupFile(a, {})) } as unknown as File;
    forgetKeys('VEIL-B');
    expect(keysFor('VEIL-B')).toBeUndefined();
    const back = await restoreBackup(file);
    expect(back.recordSecret).toBe(a.recordSecret);
    expect(back.backedUpAt).toBeDefined();
    const other = {
      text: () => Promise.resolve(backupFile({ ...a, recordSecret: 'ee'.repeat(32) }, {})),
    } as unknown as File;
    await expect(restoreBackup(other)).rejects.toThrow(/different keys/);
    const junk = { text: () => Promise.resolve('{"format":"x"}') } as unknown as File;
    await expect(restoreBackup(junk)).rejects.toThrow(/not a VeilCore/);
  });

  it('a pairing salt goes in the backup, comes back on restore, and a new one asks for a fresh backup', async () => {
    const { ensureKeys, backupFile, restoreBackup, forgetKeys, keysFor, setDnaOnChain, downloadBackup } =
      await import('./record-keys');
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
    vi.stubGlobal('document', { createElement: () => ({ click: () => undefined }) });
    const k = ensureKeys('VEIL-D');
    downloadBackup(k, {});
    expect(keysFor('VEIL-D')?.backedUpAt).toBeDefined();
    const d = {
      fingerprint: 'd7'.repeat(32),
      salt: '5a'.repeat(31) + '01',
      identity: 'e0'.repeat(32),
      binding: 'b0'.repeat(32),
      status: 'sending' as const,
    };
    setDnaOnChain('VEIL-D', d);
    expect(keysFor('VEIL-D')?.backedUpAt).toBeUndefined(); // the old backup lacks this salt
    setDnaOnChain('VEIL-D', { ...d, status: 'paired', txId: 'cc'.repeat(32) });
    const withSalt = keysFor('VEIL-D')!;
    const file = { text: () => Promise.resolve(backupFile(withSalt, {})) } as unknown as File;
    forgetKeys('VEIL-D');
    expect((await restoreBackup(file)).dnaOnChain).toMatchObject({ salt: d.salt, status: 'paired' });

    // An older backup, made before the pairing, does not wipe this browser's salt.
    const old = {
      text: () => Promise.resolve(backupFile({ ...withSalt, dnaOnChain: undefined }, {})),
    } as unknown as File;
    expect((await restoreBackup(old)).dnaOnChain?.salt).toBe(d.salt);
    vi.unstubAllGlobals();
  });

  it('when the browser will not store anything, keys last for the session and the app can tell', async () => {
    const { storageKeeps, ensureKeys, keysFor } = await import('./record-keys');
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    });
    expect(storageKeeps()).toBe(false);
    const k = ensureKeys('VEIL-C');
    expect(keysFor('VEIL-C')).toEqual(k);
  });
});
