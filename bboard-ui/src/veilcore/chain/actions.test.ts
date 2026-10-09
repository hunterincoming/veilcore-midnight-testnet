// The browser's three real calls, end to end against stand-ins: the real compiled
// contract and circuit IR, the real sealing, and the real sponsor policy and proof of
// work. The checks that matter most: the sponsor would pay for each call, and no secret
// is in anything that leaves the browser.
import { describe, expect, it } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { anchorOnChain, identityOf, pairDnaOnChain, proveOwnershipOnChain, recoveryCommitmentOf } from './actions';
import { contractStateAfter, standIns } from './test-chain';

setNetworkId('preprod');

const RECORD = new Uint8Array(32).fill(0x5a);
const RECOVERY = new Uint8Array(32).fill(0xa5);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** True when `needle` appears anywhere in `hay`. */
const contains = (hay: Uint8Array, needle: Uint8Array): boolean => Buffer.from(hay).indexOf(Buffer.from(needle)) !== -1;

const leaks = (r: ReturnType<typeof standIns>) => {
  const texts = r.requests.map((q) => `${q.url} ${q.body ?? ''} ${JSON.stringify(q.headers ?? {})}`).join('\n');
  const secrets = [RECORD, RECOVERY];
  return (
    secrets.some((s) => texts.includes(hex(s)) || texts.includes(Buffer.from(s).toString('base64'))) ||
    r.sealed.some((b) => secrets.some((s) => contains(b, s)))
  );
};

describe('real calls from the browser (stand-in network)', () => {
  it('stops before proving when this site serves proving files that are not the contract’s', async () => {
    const r = standIns(contractStateAfter(), { servedKeys: 'wrong' });
    await expect(anchorOnChain(RECORD, RECOVERY, { deps: r.deps })).rejects.toThrow(
      /proving files are not the ones the contract.*Nothing was sent/,
    );
    expect(r.checkedCircuits).toEqual([]);
    expect(r.sealed).toHaveLength(0);
    expect(r.requests.some((q) => q.url.includes('/sponsor'))).toBe(false);
  });

  it('anchor: proved, sealed, accepted by the sponsor policy, and carries no secret', async () => {
    const r = standIns(contractStateAfter());
    const progress: string[] = [];
    const receipt = await anchorOnChain(RECORD, RECOVERY, { deps: r.deps, progress: (m) => progress.push(m) });
    expect(receipt).toMatchObject({ circuit: 'anchor', blockHeight: 42 });
    expect(r.checkedCircuits).toEqual(['anchor']);
    expect(r.sealed).toHaveLength(1);
    expect(leaks(r)).toBe(false);
    // What goes on chain is the identity and the recovery COMMITMENT, which it may carry.
    expect(contains(r.sealed[0], Buffer.from(identityOf(RECORD), 'hex'))).toBe(true);
    expect(contains(r.sealed[0], recoveryCommitmentOf(RECOVERY))).toBe(true);
    expect(progress.some((m) => /Proving on your device/.test(m))).toBe(true);
  });

  it('proveOwnership answers the verifier’s challenge, without the secret', async () => {
    const r = standIns(
      contractStateAfter([{ secret: RECORD, circuit: 'anchor', args: [recoveryCommitmentOf(RECOVERY)] }]),
    );
    const challenge = 'c4'.repeat(32);
    await proveOwnershipOnChain(RECORD, challenge, { deps: r.deps });
    expect(r.checkedCircuits).toEqual(['proveOwnership']);
    expect(contains(r.sealed[0], Buffer.from(challenge, 'hex'))).toBe(true);
    expect(leaks(r)).toBe(false);
  });

  it('pairDna publishes the report fingerprint, without the secret', async () => {
    const r = standIns(
      contractStateAfter([{ secret: RECORD, circuit: 'anchor', args: [recoveryCommitmentOf(RECOVERY)] }]),
    );
    await pairDnaOnChain(RECORD, 'd7'.repeat(32), { deps: r.deps });
    expect(r.checkedCircuits).toEqual(['pairDna']);
    expect(leaks(r)).toBe(false);
  });

  it('refuses here, before anything is sent, when the contract would refuse', async () => {
    const r = standIns(contractStateAfter()); // not anchored
    await expect(proveOwnershipOnChain(RECORD, 'c4'.repeat(32), { deps: r.deps })).rejects.toThrow();
    // Only this site's own proving key was read; nothing went to the sponsor.
    expect(r.requests.filter((q) => !q.url.startsWith('https://veilcore.test/keys/'))).toHaveLength(0);
  });

  it('refuses a contract carrying a circuit this build does not know', async () => {
    const state = contractStateAfter();
    const any = state.operation('anchor')!;
    state.setOperation('backdoor', any);
    const r = standIns(state);
    await expect(anchorOnChain(RECORD, RECOVERY, { deps: r.deps })).rejects.toThrow(
      /not the one this site was built for/,
    );
    expect(r.requests).toHaveLength(0);
  });

  it('a sponsor refusal surfaces as an error and nothing is reported as sent', async () => {
    const r = standIns(contractStateAfter());
    // The site's own files load; the sponsor answers 503.
    const deps = {
      ...r.deps,
      fetch: ((input: string, init?: RequestInit) =>
        input.includes('/keys/')
          ? r.deps.fetch(input, init)
          : Promise.resolve(new Response('{}', { status: 503 }))) as typeof fetch,
    };
    await expect(anchorOnChain(RECORD, RECOVERY, { deps })).rejects.toThrow(/not answering/);
  });
});
