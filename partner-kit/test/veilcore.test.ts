// The partner client for the main contract (src/veilcore.ts) and the wallet-free
// verifier helpers (src/verify.ts), against the compiled contract run locally
// (test/local-chain.ts). Each flow a partner runs, and each refusal that protects them.
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const { VeilCore } = await import('../src/veilcore');
const { commit, newChallenge, newSecret, toHex } = await import('../src/commitments');
const { checkBatchAnchor, checkOwnership, checkPresentation, readLedger } = await import('../src/verify');
const { RevokedLicenceError } = await import('../../api/src/veilcore-api');
const { isContractRefusal } = await import('../src/errors');
/** The promise is refused by the contract, and by nothing else. */
const refusedByContract = async (p: Promise<unknown>): Promise<boolean> =>
  p.then(
    () => false,
    (e: unknown) => isContractRefusal(e),
  );
const { VEILCORE_ADDR, chainLog, fakeChain } = await import('./local-chain');
const Veilcore = await import('../../contract/src/managed/veilcore/contract/index.js');

const same = (a: Uint8Array, b: Uint8Array): boolean => toHex(a) === toHex(b);

let chain: ReturnType<typeof fakeChain>;
beforeEach(() => {
  setNetworkId('undeployed');
  chain = fakeChain(fake as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setNetworkId('undeployed');
});

const read = () => ({ network: 'undeployed' as const, indexer: chain.endpoints.indexer, address: VEILCORE_ADDR });

describe('joining', () => {
  it('needs an address on a network with no default, and reads nothing without one', async () => {
    await expect(VeilCore.join(chain.conn)).rejects.toThrow(/Give the VeilCore contract's address on undeployed/);
    expect(chainLog).toHaveLength(0);
  });

  it('on mainnet, refuses any address but the pinned one before anything is read; with none given, uses the pin', async () => {
    setNetworkId('mainnet');
    const conn = { ...chain.conn, network: 'mainnet' as const };
    const spy = vi.spyOn(conn.providers.veilcore.publicDataProvider, 'queryContractState');
    await expect(VeilCore.join(conn, { address: VEILCORE_ADDR })).rejects.toThrow(
      /on mainnet the VeilCore contract is a04de0a2.*Nothing was read or sent/,
    );
    expect(spy).not.toHaveBeenCalled();
    // No address: the pinned mainnet contract, which this local stand-in chain does not have.
    await expect(VeilCore.join(conn)).rejects.toThrow(/no contract at a04de0a2/);
  });

  it('joins a contract that started from the constructor and has every circuit', async () => {
    const vc = await VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
    expect(vc.address).toBe(VEILCORE_ADDR);
    expect(vc.network).toBe('undeployed');
  });
});

describe('a laboratory: anchor, prove possession, timestamp a batch, pair a report', () => {
  it('runs end to end, and a verifier with no wallet accepts exactly what it should', async () => {
    const vc = await VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
    const labSecret = newSecret();
    const recovery = newSecret();
    const lab = commit.record(labSecret);
    expect(await vc.useRecordSecret(labSecret)).toEqual({ anchored: false });

    await vc.anchor(commit.recovery(recovery));
    const me = await vc.whoAmI();
    expect(same(me.record, lab) && me.anchored && me.live).toBe(true);
    expect(same((await readLedger(read())).lastAnchor, lab)).toBe(true);

    const challenge = newChallenge();
    const proof = await vc.proveOwnership(challenge);
    expect((await checkOwnership({ ...read(), txId: proof.txId, record: lab, challenge })).accepted).toBe(true);
    expect((await vc.checkOwnership(proof.txId, lab, challenge)).accepted).toBe(true);
    const other = await checkOwnership({ ...read(), txId: proof.txId, record: lab, challenge: newChallenge() });
    expect(other).toMatchObject({ accepted: false, reason: 'that transaction did not answer this challenge' });

    const root = newSecret();
    const batch = await vc.anchorBatch(root);
    expect(await checkBatchAnchor({ ...read(), txId: batch.txId, root })).toMatchObject({ accepted: true });
    expect((await checkBatchAnchor({ ...read(), txId: batch.txId, root: newSecret() })).accepted).toBe(false);
    await expect(checkBatchAnchor({ ...read(), txId: proof.txId, root })).rejects.toThrow(
      /not a single anchorBatch call/,
    );

    const report = newSecret();
    const paired = await vc.pairDna(report);
    expect(same(paired.recordCommitment, lab)).toBe(true);
    expect(same((await vc.ledger()).lastPairedDna, report)).toBe(true);
  });

  it('a verifier helper refuses an address that is not the one it was told', async () => {
    await expect(readLedger({ ...read(), address: 'ef'.repeat(32) })).rejects.toThrow(/no contract at/);
    await expect(readLedger({ network: 'mainnet', indexer: chain.endpoints.indexer })).rejects.toThrow(
      /no contract at a04de0a2/,
    );
    await expect(
      readLedger({ network: 'mainnet', indexer: chain.endpoints.indexer, address: 'ef'.repeat(32) }),
    ).rejects.toThrow(/on mainnet the VeilCore contract is a04de0a2/);
  });
});

describe('a breeder licenses a grower: issue, countersign, prove, verify, transfer, revoke', () => {
  it('runs end to end', async () => {
    const vc = await VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
    const breederSecret = newSecret();
    const breeder = commit.record(breederSecret);
    await vc.useRecordSecret(breederSecret);
    await vc.anchor(commit.recovery(newSecret()));

    // The licensee makes its secret and sends only the commitment.
    const L1 = newSecret();
    const lc1 = commit.license(L1, breeder);
    await vc.issueLicense(lc1);
    await vc.countersignLicense(L1, breeder);

    const challenge = newChallenge();
    const issuedAt = Date.now();
    const shown = await vc.proveLicense(L1, breeder, challenge);
    expect(same(shown.tag, commit.presentationTag(breeder, challenge))).toBe(true);
    const v = await checkPresentation({ ...read(), txId: shown.txId, issuer: breeder, challenge, issuedAt });
    expect(v.accepted).toBe(true);
    expect(v.reason).toMatch(/^the licence was live when presented/);
    expect((await vc.checkPresentation(shown.txId, breeder, challenge, issuedAt)).accepted).toBe(true);
    // With the contract's history (every call's state), the issuer-scoped rule decides;
    // a history that does not end with this presentation is refused.
    const history = chainLog.filter((c) => c.address === VEILCORE_ADDR).map((c) => Veilcore.ledger(c.state.data));
    const withHistory = { ...read(), txId: shown.txId, issuer: breeder, challenge, issuedAt };
    expect((await checkPresentation({ ...withHistory, history })).accepted).toBe(true);
    expect((await checkPresentation({ ...withHistory, history: history.slice(0, -1) })).reason).toMatch(
      /does not end with this presentation/,
    );
    expect((await checkPresentation({ ...withHistory, history: history.slice(0, -1), rule: 'strict' })).accepted).toBe(
      true,
    );
    expect(
      (await checkPresentation({ ...read(), txId: shown.txId, issuer: breeder, challenge: newChallenge() })).accepted,
    ).toBe(false);
    expect(
      (await checkPresentation({ ...read(), txId: shown.txId, issuer: commit.record(newSecret()), challenge }))
        .accepted,
    ).toBe(false);

    // Transfer to a new holder; the first seal is made at once.
    const L2 = newSecret();
    const lc2 = commit.license(L2, breeder);
    await vc.proposeTransfer(L1, breeder, lc2);
    expect((await vc.approveTransfer(lc1, breeder, lc2)).sealed).toBe(true);
    expect(await refusedByContract(vc.proveLicense(L1, breeder, newChallenge()))).toBe(true);
    await vc.proveLicense(L2, breeder, newChallenge());

    // Revoke: gone, and never issued again from this client.
    await vc.revokeLicense(lc2, breeder);
    expect(await refusedByContract(vc.proveLicense(L2, breeder, newChallenge()))).toBe(true);
    await expect(vc.issueLicense(lc2)).rejects.toBeInstanceOf(RevokedLicenceError);
  });
});

describe('lineage, obligations and keys of your own identity', () => {
  it('both holders confirm descent; a royalty follows it until its beneficiary releases it', async () => {
    const vc = await VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
    const breederSecret = newSecret();
    const growerSecret = newSecret();
    const breeder = commit.record(breederSecret);
    const grower = commit.record(growerSecret);
    await vc.useRecordSecret(breederSecret);
    await vc.anchor(commit.recovery(newSecret()));
    await vc.useRecordSecret(growerSecret);
    await vc.anchor(commit.recovery(newSecret()));

    await vc.proposeParent(breeder);
    await vc.useRecordSecret(breederSecret);
    await vc.confirmParent(grower);
    expect((await vc.ledger()).parentsOf.lookup(grower).member(breeder)).toBe(true);

    const royalty = commit.obligation('7% royalty on every sale', newSecret());
    await vc.encumberOwnRecord(royalty);
    expect((await vc.checkLineage(grower)).clean).toBe(false);
    await vc.useRecordSecret(growerSecret);
    expect(await refusedByContract(vc.discharge(breeder, royalty))).toBe(true);
    await vc.useRecordSecret(breederSecret);
    await vc.discharge(breeder, royalty);
    expect((await vc.checkLineage(grower)).clean).toBe(true);
  });

  it('rotates, and recovers with the recovery secret; a retired secret is refused', async () => {
    const vc = await VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
    const first = newSecret();
    const recovery = newSecret();
    const origin = commit.record(first);
    await vc.useRecordSecret(first);
    await vc.anchor(commit.recovery(recovery));

    const second = newSecret();
    await vc.rotateRecordSecret(second);
    expect(same((await vc.whoAmI()).record, commit.record(second))).toBe(true);
    expect((await vc.whoAmI()).identity).toEqual(origin);
    await expect(vc.useRecordSecret(first)).rejects.toThrow(/not the current one of its identity/);

    const third = newSecret();
    const nextRecovery = newSecret();
    await vc.recoverRecordSecret({
      originalRecord: origin,
      recoverySecret: recovery,
      newRecordSecret: third,
      newRecoveryCommitment: commit.recovery(nextRecovery),
    });
    const me = await vc.whoAmI();
    expect(same(me.record, commit.record(third)) && me.live && me.anchored).toBe(true);
    expect(await vc.recoverySecretIsCurrent(origin, nextRecovery)).toBe(true);
    expect(await vc.recoverySecretIsCurrent(origin, recovery)).toBe(false);
    await expect(vc.useRecordSecret(second)).rejects.toThrow(/not the current one/);
  });
});

describe('commitments', () => {
  it('are the contract’s own, and refuse anything that is not 32 bytes', () => {
    const s = newSecret();
    expect(commit.record(s)).toHaveLength(32);
    expect(() => commit.record(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => commit.obligation(' ', newSecret())).toThrow(/needs terms/);
    // SHA-256(salt || terms), as the CLI computes it.
    const salt = new Uint8Array(32).fill(7);
    const expected = new Uint8Array(createHash('sha256').update(salt).update('terms', 'utf8').digest());
    expect(commit.obligation('terms', salt)).toEqual(expected);
  });
});
