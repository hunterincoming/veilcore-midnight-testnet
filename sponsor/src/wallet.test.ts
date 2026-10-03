import { describe, expect, it } from 'vitest';
import { FacadeWallet, isStaleDustTime, nodeRefusal } from './wallet.js';
import { NotSentError } from './sponsor.js';
import type { SealedTx } from './policy.js';

const REFUSED_171 = new Error('1010: Invalid Transaction: Custom error: 171');
const REFUSED_154 = new Error('1010: Invalid Transaction: Custom error: 154');

const facade = (over: Partial<Record<string, (...a: unknown[]) => Promise<unknown>>> = {}) => {
  const calls: string[] = [];
  const f = {
    balanceFinalizedTransaction: (_tx: unknown, _k: unknown, opts: { tokenKindsToBalance: string[] }) => {
      calls.push(`balance:${opts.tokenKindsToBalance.join(',')}`);
      return Promise.resolve({ type: 'recipe' });
    },
    signRecipe: (r: unknown) => {
      calls.push('sign');
      return Promise.resolve(r);
    },
    finalizeRecipe: () => {
      calls.push('finalize');
      return Promise.resolve({ type: 'finalized' });
    },
    submitTransaction: () => {
      calls.push('submit');
      return Promise.resolve('txid-1');
    },
    revert: (x: { type: string }) => {
      calls.push(`revert:${x.type}`);
      return Promise.resolve();
    },
    ...over,
  };
  return { f, calls };
};

const TX = {} as SealedTx;

describe('sponsor wallet (stand-in facade)', () => {
  it('pays DUST only, signs, finalizes and submits', async () => {
    const { f, calls } = facade();
    expect(await FacadeWallet.forTests(f).payAndSubmit(TX, new Date())).toBe('txid-1');
    expect(calls).toEqual(['balance:dust', 'sign', 'finalize', 'submit']);
  });

  it('releases the coins when finalizing fails, and says nothing was sent', async () => {
    const { f, calls } = facade({ finalizeRecipe: () => Promise.reject(new Error('prover down')) });
    await expect(FacadeWallet.forTests(f).payAndSubmit(TX, new Date())).rejects.toBeInstanceOf(NotSentError);
    expect(calls).toContain('revert:recipe');
  });

  it('a stale-DUST refusal (171) is "try later"; other node refusals are final; both release the coins', async () => {
    const a = facade({ submitTransaction: () => Promise.reject(REFUSED_171) });
    const e1 = await FacadeWallet.forTests(a.f).payAndSubmit(TX, new Date()).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(NotSentError);
    expect((e1 as NotSentError).retryable).toBe(true);
    expect(a.calls).toContain('revert:finalized');
    const b = facade({ submitTransaction: () => Promise.reject(REFUSED_154) });
    const e2 = await FacadeWallet.forTests(b.f).payAndSubmit(TX, new Date()).catch((e: unknown) => e);
    expect((e2 as NotSentError).retryable).toBe(false);
  });

  it('any other submit error may have been sent: not NotSentError, no revert', async () => {
    const { f, calls } = facade({ submitTransaction: () => Promise.reject(new Error('socket hang up')) });
    const e = await FacadeWallet.forTests(f).payAndSubmit(TX, new Date()).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(NotSentError);
    expect(calls.some((c) => c.startsWith('revert'))).toBe(false);
  });

  it('reads node refusals', () => {
    expect(nodeRefusal(REFUSED_171)).toBe('171');
    expect(nodeRefusal(new Error('1010: Invalid Transaction'))).toBe('none');
    expect(nodeRefusal(new Error('timeout'))).toBeUndefined();
    expect(isStaleDustTime(REFUSED_171)).toBe(true);
    expect(isStaleDustTime(REFUSED_154)).toBe(false);
  });
});
