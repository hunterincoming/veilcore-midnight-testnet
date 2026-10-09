// The custody vault: encryption round trip, a wrong password refused with nothing
// changed, owner-only files, one partner's vault never opening as another's, nothing
// secret in inspect/JSON/errors, retire and purge.
// SPDX-License-Identifier: Apache-2.0
import { chmod, copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoxKey, KDF, WrongPasswordError, openBox, parseBox } from '../src/box.ts';
import { partnerDir } from '../src/files.ts';
import { PartnerVault, RetiredPartnerError, STATUS_FILE, VAULT_FILE, readStatus, secretsIn } from '../src/vault.ts';
import { NETWORK, PW, PW2, leaked, tempRoot } from './helpers.ts';

let t: Awaited<ReturnType<typeof tempRoot>>;
beforeEach(async () => {
  t = await tempRoot();
});
afterEach(async () => {
  await t.done();
});

const SECRET = 'a1'.repeat(32);
const RECOVERY = 'b2'.repeat(32);

const withRecord = async (v: PartnerVault): Promise<void> =>
  v.update((p) => {
    p.records.push({
      label: 'acc-1',
      secret: SECRET,
      origin: 'cc'.repeat(32),
      current: 'cc'.repeat(32),
      recovery: { heldBy: 'custody', commitment: 'dd'.repeat(32), secret: RECOVERY },
      status: 'anchored',
      createdAt: new Date().toISOString(),
      made: ['cc'.repeat(32)],
      heldRecoveries: ['dd'.repeat(32)],
    });
  });

describe('encryption', () => {
  it('round-trips: what is stored is what opens, under scrypt N=2^17 and AES-256-GCM, and the file holds no secret', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await withRecord(v);
    await v.close();

    const file = path.join(partnerDir(t.root, 'lab-one'), VAULT_FILE);
    const text = await readFile(file, 'utf8');
    expect(leaked(text, [SECRET, RECOVERY])).toEqual([]);
    const box = parseBox(text, { kind: 'custody-vault' });
    expect(box).toMatchObject({
      kdf: { name: 'scrypt', N: 131072, r: 8, p: 1 },
      cipher: 'aes-256-gcm',
      partner: 'lab-one',
    });
    expect(KDF.N).toBe(2 ** 17);

    const again = await PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW });
    expect(again.read().records[0]).toMatchObject({ label: 'acc-1', secret: SECRET, recovery: { secret: RECOVERY } });
    await again.close();
  });

  it('keeps folders 0700 and files 0600', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await withRecord(v);
    await v.close();
    const dir = partnerDir(t.root, 'lab-one');
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(dir, VAULT_FILE))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(dir, STATUS_FILE))).mode & 0o777).toBe(0o600);
  });

  it('refuses a wrong password, says nothing about the contents, and changes nothing', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await withRecord(v);
    await v.close();
    const file = path.join(partnerDir(t.root, 'lab-one'), VAULT_FILE);
    const before = await readFile(file);
    const err = await PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW2 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WrongPasswordError);
    expect(leaked(`${String(err)} ${inspect(err)}`, [SECRET, RECOVERY])).toEqual([]);
    expect(Buffer.compare(await readFile(file), before)).toBe(0);
    // ...and the lock was let go: the right password still opens it.
    const ok = await PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW });
    expect(ok.read().records).toHaveLength(1);
    await ok.close();
  });

  it('refuses a changed file (GCM) as it refuses a wrong password', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await v.close();
    const file = path.join(partnerDir(t.root, 'lab-one'), VAULT_FILE);
    const box = JSON.parse(await readFile(file, 'utf8')) as { ciphertext: string };
    const bytes = Buffer.from(box.ciphertext, 'base64');
    bytes[3] ^= 1;
    await writeFile(file, JSON.stringify({ ...box, ciphertext: bytes.toString('base64') }), { mode: 0o600 });
    await expect(
      PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW }),
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('a weaker key-derivation setting in a header is refused before any derivation', async () => {
    const key = await BoxKey.fresh(PW);
    const { sealBox } = await import('../src/box.ts');
    const box = sealBox(key, { kind: 'custody-vault', partner: 'x', network: NETWORK }, { a: 1 });
    expect(openBox(key, box)).toEqual({ a: 1 });
    expect(() => parseBox(JSON.stringify({ ...box, kdf: { ...box.kdf, N: 1024 } }), { kind: 'custody-vault' })).toThrow(
      /key-derivation setting/,
    );
    expect(() => parseBox(JSON.stringify({ ...box, kind: 'exit-bundle' }), { kind: 'custody-vault' })).toThrow(
      /not a custody-vault/,
    );
    expect(inspect(key)).toBe('BoxKey [redacted]');
  });
});

describe('one store per partner', () => {
  it('never opens one partner’s vault as another’s, even with the right password', async () => {
    for (const id of ['lab-one', 'lab-two']) {
      const v = await PartnerVault.create({ root: t.root, id, displayName: id, network: NETWORK, password: PW });
      await v.close();
    }
    await copyFile(
      path.join(partnerDir(t.root, 'lab-one'), VAULT_FILE),
      path.join(partnerDir(t.root, 'lab-two'), VAULT_FILE),
    );
    await expect(PartnerVault.open({ root: t.root, id: 'lab-two', network: NETWORK, password: PW })).rejects.toThrow(
      /belongs to lab-one/,
    );
  });

  it('refuses a vault that other users can read, and a weak password', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await v.close();
    const file = path.join(partnerDir(t.root, 'lab-one'), VAULT_FILE);
    await chmod(file, 0o644);
    await expect(PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW })).rejects.toThrow(
      /can be read or changed by other users/,
    );
    await expect(
      PartnerVault.create({ root: t.root, id: 'lab-three', displayName: 'x', network: NETWORK, password: 'short' }),
    ).rejects.toThrow(/16 or more characters/);
    await expect(
      PartnerVault.create({ root: t.root, id: '../escape', displayName: 'x', network: NETWORK, password: PW }),
    ).rejects.toThrow(/partner id/);
  });

  it('takes over a lock left by a command that was killed, and only that', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await v.close();
    const lockFile = path.join(partnerDir(t.root, 'lab-one'), '.lock');
    await writeFile(lockFile, '2147483646', { mode: 0o600 }); // no such process
    const again = await PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW });
    await again.close();
    await writeFile(lockFile, String(process.pid), { mode: 0o600 }); // a live one
    await expect(PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW })).rejects.toThrow(
      /Another command/,
    );
  });

  it('lets one command at a time work on a partner', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await expect(PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW })).rejects.toThrow(
      /Another command/,
    );
    await v.close();
  });
});

describe('nothing secret leaves through inspect, JSON or errors', () => {
  it('inspect and JSON show the partner, never the payload', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await withRecord(v);
    expect(secretsIn(v.read())).toEqual(new Set([SECRET, RECOVERY]));
    const shown = [
      inspect(v),
      inspect(v, { showHidden: true, depth: 10 }),
      JSON.stringify(v),
      inspect(v, { customInspect: false, showHidden: true, depth: 10 }),
      JSON.stringify({ v }),
    ].join('\n');
    expect(leaked(shown, [SECRET, RECOVERY, PW])).toEqual([]);
    expect(shown).not.toContain(PW);
    await v.close();
    expect(() => v.read()).toThrow(/closed/);
  });
});

describe('retire and purge', () => {
  it('a retired partner is refused (vault and partner.json), and a purge leaves no secret on disk', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await withRecord(v);
    await expect(v.purge()).rejects.toThrow(/has not left/);
    await v.retire('self', 'ee'.repeat(32));
    await expect(v.assertActive()).rejects.toBeInstanceOf(RetiredPartnerError);
    expect((await readStatus(v.dir))?.retired?.mode).toBe('self');
    await v.purge();
    await v.close();
    const text = await readFile(path.join(partnerDir(t.root, 'lab-one'), VAULT_FILE), 'utf8');
    const reopened = await PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW });
    expect(secretsIn(reopened.read()).size).toBe(0);
    expect(reopened.read().records[0]).toMatchObject({ label: 'acc-1', current: 'cc'.repeat(32) });
    expect(reopened.read().purgedAt).toBeDefined();
    await expect(reopened.assertActive()).rejects.toThrow(/left VeilCore-run/);
    await reopened.close();
    expect(leaked(text, [SECRET, RECOVERY])).toEqual([]);
  });

  it('a changed password opens and the old one does not', async () => {
    const v = await PartnerVault.create({
      root: t.root,
      id: 'lab-one',
      displayName: 'Lab One',
      network: NETWORK,
      password: PW,
    });
    await withRecord(v);
    const v2 = await v.changePassword(PW2);
    await v2.close();
    await expect(
      PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW }),
    ).rejects.toBeInstanceOf(WrongPasswordError);
    const v3 = await PartnerVault.open({ root: t.root, id: 'lab-one', network: NETWORK, password: PW2 });
    expect(v3.read().records[0].secret).toBe(SECRET);
    await v3.close();
  });
});
