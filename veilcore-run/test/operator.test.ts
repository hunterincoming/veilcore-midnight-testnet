// The operator flow, end to end, against the partner kit's chain stand-in (the compiled
// contracts' real circuits, in memory): two partners in VeilCore-run, a lab and a
// breeder, doing every kind of operation; a verifier with no wallet checks the results;
// and nothing secret reaches the audit logs.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
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
const { VEILCORE_ADDR, CLAIMS_ADDR, fakeChain } = await import('../../partner-kit/test/local-chain.ts');
const op = await import('../src/operator.ts');
const { fingerprintOf, makePool, newMaster, recoverySecretAt } = await import('../src/partner-keys.ts');
const { readAudit } = await import('../src/audit.ts');
const { NETWORK, PW2, allText, leaked, newPartner, tempRoot } = await import('./helpers.ts');

const VECTORS = JSON.parse(readFileSync(new URL('../../contract/vectors/fields-v1.json', import.meta.url), 'utf8')) as {
  fieldSets: { input: Omit<FieldSetFile, 'jsonDigest'> }[];
};
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
  await t.done();
});

const read = () => ({ network: 'undeployed' as const, indexer: chain.endpoints.indexer, address: VEILCORE_ADDR });

describe('records', () => {
  it('partner mode: the record is anchored with the partner’s pool commitment; VeilCore never holds the recovery secret', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims }, { recovery: 'partner' });
    await expect(op.anchorRecord(lab, { label: 'acc-1' })).rejects.toThrow(/no unused recovery commitment/);
    const master = lab.master; // made on the partner's computer
    const pool = makePool({ partner: 'lab', network: NETWORK, master, count: 3 });
    await expect(op.importPool(lab, pool, 'abcd abcd abcd abcd abcd')).rejects.toThrow(/not the fingerprint/);
    await expect(
      op.importPool(
        lab,
        makePool({ partner: 'lab', network: NETWORK, master: newMaster(), count: 3 }),
        fingerprintOf(pool),
      ),
    ).rejects.toThrow(/not the fingerprint/);
    await op.importPool(lab, pool, fingerprintOf(pool));
    const r = await op.anchorRecord(lab, { label: 'acc-1' });
    expect(r).toMatchObject({ label: 'acc-1', recoveryHeldBy: 'partner' });
    const stored = lab.vault.read().records[0];
    expect(stored.recovery).toMatchObject({ heldBy: 'partner', pool: { index: 0 } });
    expect(stored.recovery.secret).toBeUndefined();
    // The partner's derived recovery secret is the one the chain holds.
    expect(await vc.recoverySecretIsCurrent(kit.fromHex(stored.origin), recoverySecretAt(master, 0))).toBe(true);
    // The next record takes the next commitment: no two records share one (unlinkable on chain).
    await op.anchorRecord(lab, { label: 'acc-2' });
    const [a, b] = lab.vault.read().records;
    expect(a.recovery.commitment).not.toBe(b.recovery.commitment);
    expect(op.unusedPool(lab.vault.read())).toBe(1);
    await expect(op.anchorRecord(lab, { label: 'acc-1' })).rejects.toThrow(/already exists/);
    await lab.vault.close();
  });

  it('custody mode: anchor, pair a report, prove possession to a verifier with no wallet, rotate', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    const r = await op.anchorRecord(lab, { label: 'acc-1' });
    expect(r.recoveryHeldBy).toBe('custody');
    const record = kit.fromHex(r.record);
    // A bound pairing: the report's hash never goes on chain, and the evidence file checks out.
    const report = 'ab'.repeat(32);
    const paired = await op.pairDna(lab, { record: 'acc-1', report });
    const onChain = kit.toHex((await vc.ledger()).lastPairedDna);
    expect(onChain).not.toBe(report);
    expect(onChain).toBe(paired.evidence.binding);
    expect(lab.vault.read().pairings).toMatchObject([
      { status: 'paired', txId: paired.evidence.txId, reportSha256: report },
    ]);
    const ev = kit.readPairingEvidence(JSON.stringify(paired.evidence));
    const verdict = await kit.checkPairing({ ...ev, ...read(), indexerWS: chain.endpoints.indexerWS });
    expect(verdict).toMatchObject({ accepted: true, publishedRawEarlier: [] });
    // The same report again is refused: the first pairing is the one that dates it.
    await expect(op.pairDna(lab, { record: 'acc-1', report })).rejects.toThrow(/already paired this report/);
    await expect(op.pairDna(lab, { record: 'acc-1' })).rejects.toThrow(/one of the two/);

    const challenge = kit.newChallenge(); // the verifier's
    const proof = await op.proveOwnership(lab, { record: 'acc-1', challenge: kit.toHex(challenge) });
    expect((await kit.checkOwnership({ ...read(), txId: proof.txId, record, challenge })).accepted).toBe(true);

    const before = lab.vault.read().records[0].secret!;
    await op.rotateRecord(lab, { record: 'acc-1' });
    const after = lab.vault.read().records[0];
    // The pairing still shows after a rotation (it is bound to the identity), from the vault alone.
    const again = op.pairEvidence(lab, { record: 'acc-1' });
    expect(again).toEqual(paired.evidence);
    expect(
      (await kit.checkPairing({ ...kit.readPairingEvidence(again), ...read(), indexerWS: chain.endpoints.indexerWS }))
        .accepted,
    ).toBe(true);
    expect(after.secret).not.toBe(before);
    expect(after.pendingSecret).toBeUndefined();
    await expect(vc.useRecordSecret(kit.fromHex(before))).rejects.toThrow(/not the current one/);
    const ledger = await kit.readLedger(read());
    expect(op.listPartner(lab.vault.read(), ledger).records[0].chain).toMatchObject({
      anchored: true,
      veilcoreCanAct: true,
    });
    await op.dateRoot(lab, { root: 'cd'.repeat(32) });
    await lab.vault.close();
  });

  it('an anchor interrupted after storing its secret is finished by running it again', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    const spy = vi.spyOn(vc, 'anchor').mockRejectedValueOnce(new Error('indexer timeout'));
    await expect(op.anchorRecord(lab, { label: 'acc-1' })).rejects.toThrow(/indexer timeout/);
    expect(lab.vault.read().records[0].status).toBe('new');
    spy.mockRestore();
    const r = await op.anchorRecord(lab, { label: 'acc-1' });
    expect(r.resumed).toBe(true);
    expect(lab.vault.read().records[0].status).toBe('anchored');
    await lab.vault.close();
  });
});

describe('licences, lineage and obligations between two VeilCore-run partners', () => {
  it('a breeder licenses a lab; the lab proves it; the breeder revokes it and cannot re-issue it', async () => {
    const breeder = await newPartner(t.root, 'breeder', { vc, claims }, { password: PW2 });
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    const mother = await op.anchorRecord(breeder, { label: 'mother' });

    const req = await op.licenceRequest(lab, { label: 'lic-1', issuerRecord: mother.record });
    await op.licenceIssue(breeder, { record: 'mother', licenceCommitment: req.licenceCommitment, label: 'to-lab' });
    await op.licenceCountersign(lab, { label: 'lic-1' });
    const challenge = kit.newChallenge();
    const issuedAt = Date.now();
    const shown = await op.licenceProve(lab, { label: 'lic-1', challenge: kit.toHex(challenge) });
    const v = await kit.checkPresentation({
      ...read(),
      txId: shown.txId,
      issuer: kit.fromHex(mother.record),
      challenge,
      issuedAt,
    });
    expect(v.accepted).toBe(true);

    await op.licenceRevoke(breeder, { label: 'to-lab' });
    expect(breeder.vault.read().licences[0].status).toBe('revoked');
    const refused = await op
      .licenceProve(lab, { label: 'lic-1', challenge: kit.toHex(kit.newChallenge()) })
      .catch((e: unknown) => e);
    expect(kit.isContractRefusal(refused)).toBe(true);
    await expect(
      op.licenceIssue(breeder, { record: 'mother', licenceCommitment: req.licenceCommitment, label: 'again' }),
    ).rejects.toThrow(/revoked licence .* before/);
    await breeder.vault.close();
    await lab.vault.close();
  });

  it('lineage both sides confirm; a royalty follows it until the breeder discharges it', async () => {
    const breeder = await newPartner(t.root, 'breeder', { vc, claims }, { password: PW2 });
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    const mother = await op.anchorRecord(breeder, { label: 'mother' });
    const clone = await op.anchorRecord(lab, { label: 'clone-1' });
    await op.lineagePropose(lab, { record: 'clone-1', parent: mother.record });
    await op.lineageConfirm(breeder, { record: 'mother', child: clone.record });
    expect((await vc.ledger()).parentsOf.lookup(kit.fromHex(clone.record)).member(kit.fromHex(mother.record))).toBe(
      true,
    );

    await op.obligationEncumber(breeder, { record: 'mother', terms: '7% royalty on every sale', label: 'royalty' });
    expect((await vc.checkLineage(kit.fromHex(clone.record))).clean).toBe(false);
    await op.obligationDischarge(breeder, { label: 'royalty' });
    expect((await vc.checkLineage(kit.fromHex(clone.record))).clean).toBe(true);
    expect(breeder.vault.read().obligations[0]).toMatchObject({
      status: 'discharged',
      terms: '7% royalty on every sale',
    });

    await op.obligationPropose(breeder, {
      record: 'mother',
      on: clone.record,
      terms: 'report yearly',
      label: 'report',
    });
    const prop = breeder.vault.read().obligations[1];
    await op.obligationAccept(lab, { record: 'clone-1', commitment: prop.commitment, beneficiary: mother.record });
    expect((await vc.checkLineage(kit.fromHex(clone.record))).clean).toBe(false);
    await breeder.vault.close();
    await lab.vault.close();
  });
});

describe('claims', () => {
  it('seals a field set into custody, proves a bound and the lab’s signature; a verifier reads them', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    const sealed = await op.sealFieldSet(lab, { label: 'lot-1', file: FILE, date: true });
    expect(sealed.tx).toBeDefined();
    const key = await op.labKeyNew(lab, { label: 'lab-key' });
    const range = await op.makeClaim(lab, {
      kind: 'range',
      fields: 'lot-1',
      slot: 12,
      direction: 'at least',
      bound: 9500n,
    });
    const att = await op.makeClaim(lab, { kind: 'attested', fields: 'lot-1', labKey: 'lab-key' });
    const r = await kit.readClaim({
      network: 'undeployed',
      indexer: chain.endpoints.indexer,
      address: CLAIMS_ADDR,
      txId: range.txId,
    });
    expect(r.claim).toMatchObject({ kind: 'range', bound: 9500n, slot: 12 });
    expect(kit.toHex(r.claim.record)).toBe(sealed.commitment);
    const a = await kit.readClaim({
      network: 'undeployed',
      indexer: chain.endpoints.indexer,
      address: CLAIMS_ADDR,
      txId: att.txId,
    });
    expect(a.claim.attester).toEqual({ x: BigInt(`0x${key.x}`), y: BigInt(`0x${key.y}`) });
    await expect(op.makeClaim(lab, { kind: 'value', fields: 'lot-1', slot: 12, publish: false })).rejects.toThrow(
      /PUBLISHES/,
    );
    await lab.vault.close();
  });
});

describe('the audit log', () => {
  it('records every action with its transaction id, chains its lines, and holds no secret', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    await op.pairDna(lab, { record: 'acc-1', report: 'ab'.repeat(32) });
    await op.licenceRequest(lab, { label: 'lic', issuerRecord: lab.vault.read().records[0].current });
    await op.obligationEncumber(lab, { record: 'acc-1', terms: 'keep it', label: 'ob' });
    await op.sealFieldSet(lab, { label: 'lot-1', file: FILE });
    await op.labKeyNew(lab, { label: 'k' });
    await op.makeClaim(lab, { kind: 'attested', fields: 'lot-1', labKey: 'k' });
    await op.rotateRecord(lab, { record: 'acc-1' });
    // A refusal is logged too, without its message.
    await op.licenceProve(lab, { label: 'lic', challenge: kit.toHex(kit.newChallenge()) }).catch(() => undefined);

    const log = await readAudit(lab.audit.file);
    expect(log.intact).toBe(true);
    expect(log.entries.map((e) => e.op)).toEqual(
      expect.arrayContaining([
        'anchor',
        'pair-dna',
        'licence-request',
        'obligation-encumber',
        'seal-fields',
        'claim-attested',
        'rotate',
      ]),
    );
    // A line before each transaction, and one after with its id.
    const anchorLines = log.entries.filter((e) => e.op === 'anchor');
    expect(anchorLines.map((e) => e.phase ?? 'done')).toEqual(['sending', 'done']);
    expect(anchorLines[1].txId).toMatch(/^[0-9a-f]{64}$/);
    expect(log.entries.at(-1)).toMatchObject({ op: 'licence-prove', ok: false });

    // Every secret the vault ever held (the rotated-away one included) is absent from the log.
    const p = lab.vault.read();
    const everything = new Set([
      ...lab.vault.secrets(),
      FILE.fieldSecret.replace(/^0x/, ''),
      ...p.records.map((r) => r.secret!),
    ]);
    const text = await allText(path.dirname(lab.audit.file));
    const logText = (await import('node:fs/promises')).readFile(lab.audit.file, 'utf8');
    expect(leaked(await logText, everything)).toEqual([]);
    expect(text).toContain('"op":"anchor"');
    expect(await logText).not.toContain('keep it'); // obligation terms are private too

    // Changing a line breaks the chain.
    const fs = await import('node:fs/promises');
    const lines = (await fs.readFile(lab.audit.file, 'utf8')).split('\n');
    lines[1] = lines[1].replace('"op":"', '"op":"x');
    await fs.writeFile(lab.audit.file, lines.join('\n'));
    expect((await readAudit(lab.audit.file)).intact).toBe(false);
    await lab.vault.close();
  });

  it('refuses to write a line that would hold a secret', async () => {
    const lab = await newPartner(t.root, 'lab', { vc, claims });
    await op.anchorRecord(lab, { label: 'acc-1' });
    const secret = lab.vault.read().records[0].secret!;
    await expect(lab.audit.write({ op: 'oops', ok: true, note: `x ${secret.toUpperCase()}` })).rejects.toThrow(
      /holds a secret/,
    );
    await lab.vault.close();
  });
});
