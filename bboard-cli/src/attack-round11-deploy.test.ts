// Round 11: adversarial review of the deploy / operator tooling (client side, no network).
// Moved here from contract/src/test on 1 Oct: it imports api/ and bboard-cli/ code, which
// the contract package (rootDir src) cannot compile. Run: cd bboard-cli && npx vitest run
// src/attack-round11-deploy.test.ts
//
// Each finding from the morning's pass now asserts its fix (FIXED); the original attack is
// kept inside the test where it can still be shown (a positive control).
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for async interfaces */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEVER } from 'rxjs';
import { mkdtempSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { type Logger } from 'pino';
import { LandedButUnconfirmedError, RevokedLicenceError, VeilcoreAPI } from '../../api/src/veilcore-api';
import { C, VeilcoreSimulator, as, secret } from '../../contract/src/test/veilcore-simulator';
import { ChallengeBook } from '../../contract/src/verify';
import { forgetPassword, passwordProblem, privateStatePassword, settlePassword } from './password';
import { parseSecret32, parseSigningKey } from './prompt';
import { redactThisSession, scrub } from './logger-utils';
import { isContractRefusal } from './smoke';
import { ChallengeFile } from './challenge-file';

// checkOwnership's indexer lookup, replaced so the test decides what "the state after the
// proof" is (the real one fetches it by transaction id).
const lookup: { state: unknown; data: unknown } = vi.hoisted(() => ({ state: undefined, data: undefined }));
vi.mock('../../api/src/presentation-lookup', () => ({
  callState: async () => lookup.state,
  presentationState: async () => lookup.state,
  singleCallState: async () => ({
    entryPoint: 'proveOwnership',
    state: { data: lookup.data },
    authority: { committee: 1, threshold: 1, counter: 16n, retired: false },
    keys: 'unchecked',
  }),
}));

const ADDR = 'ab'.repeat(32);
const old = new Uint8Array(32).fill(1);
const next = new Uint8Array(32).fill(2);
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** A ledger stand-in with just what the landed check reads: identity `origin` headed by `head`. */
const ledgerHeadedBy = (origin: Uint8Array, head: Uint8Array) => ({
  originOf: { member: (r: Uint8Array) => hex(r) === hex(head), lookup: () => origin },
  headOf: { member: (o: Uint8Array) => hex(o) === hex(origin), lookup: () => head },
  unsealedChanges: false,
});

/** A VeilcoreAPI over in-memory fakes. `calls` decides what each circuit call does. */
const fakeApi = (
  calls: Record<string, (...a: unknown[]) => Promise<unknown>>,
  maintenance?: () => Promise<unknown>,
  // Round D: retirement is provable (an empty committee); it reads the authority first.
  queryContractState: () => Promise<unknown> = async () => ({
    maintenanceAuthority: { committee: [], threshold: 1, counter: 1n },
  }),
) => {
  let ps: Record<string, unknown> = { geneticSecret: old };
  const signingKeys = new Map<string, string>();
  const providers = {
    privateStateProvider: {
      setContractAddress: () => undefined,
      get: async () => ps,
      set: async (_: string, v: Record<string, unknown>) => {
        ps = v;
      },
      setSigningKey: async (a: string, k: string) => void signingKeys.set(a, k),
      getSigningKey: async (a: string) => signingKeys.get(a),
      removeSigningKey: async (a: string) => void signingKeys.delete(a),
    },
    publicDataProvider: { contractStateObservable: () => NEVER, queryContractState },
  };
  const deployed = {
    deployTxData: { public: { contractAddress: ADDR } },
    callTx: calls,
    contractMaintenanceTx: { replaceAuthority: maintenance ?? (async () => ({})) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = new (VeilcoreAPI as any)(deployed, providers) as VeilcoreAPI;
  // Round D: a landed change is believed on two agreeing reads, confirmGapMs apart.
  api.landedCheck = { tries: 2, intervalMs: 1, confirmGapMs: 1 };
  /** What the chain shows when the API looks. */
  const chain = (l: unknown): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).currentLedger = async () => l;
  };
  return { api, privateState: () => ps, signingKeys, chain };
};

const txOk = { public: { txId: 't', txHash: 'h', blockHeight: 1 }, private: { result: new Uint8Array(32) } };
const silent = { error: () => undefined, info: () => undefined, warn: () => undefined } as unknown as Logger;

describe('round 11: operator tooling', () => {
  it('R11-1 FIXED: a recovery that LANDED but whose confirmation failed moves the client to the new secret, and says so', async () => {
    const { api, privateState, chain } = fakeApi({
      recoverRecordSecret: async () => {
        throw new Error('indexer timeout while confirming');
      },
    });
    const origin = new Uint8Array(32).fill(7);
    chain(ledgerHeadedBy(origin, C.commit(next))); // the chain shows the recovery done
    const err = await api
      .recoverRecordSecret(origin, C.commit(next), old, new Uint8Array(32).fill(9), next)
      .catch((e) => e);
    expect(err).toBeInstanceOf(LandedButUnconfirmedError);
    expect((err as Error).message).toMatch(/DID land/);
    expect(((err as Error).cause as Error).message).toMatch(/indexer timeout/);
    expect(privateState().geneticSecret).toEqual(next);
    expect(privateState().recoverySecret).toEqual(new Uint8Array(32)); // still cleared
  });

  it('R11-1 HELD: a recovery that did NOT land leaves the client on its secret and reports the real error', async () => {
    const { api, privateState, chain } = fakeApi({
      recoverRecordSecret: async () => {
        throw new Error('proof server unreachable');
      },
    });
    const origin = new Uint8Array(32).fill(7);
    chain(ledgerHeadedBy(origin, origin)); // nothing moved
    await expect(
      api.recoverRecordSecret(origin, C.commit(next), old, new Uint8Array(32).fill(9), next),
    ).rejects.toThrow('proof server unreachable');
    expect(privateState().geneticSecret).toEqual(old);
  });

  it('R11-2 FIXED: a rotation that LANDED but whose confirmation failed moves the client to the new secret', async () => {
    const { api, privateState, chain } = fakeApi({
      rotateRecordSecret: async () => {
        throw new Error('indexer timeout while confirming');
      },
    });
    chain(ledgerHeadedBy(C.commit(old), C.commit(next)));
    await expect(api.rotateRecordSecret(C.commit(next), next)).rejects.toBeInstanceOf(LandedButUnconfirmedError);
    expect(privateState().geneticSecret).toEqual(next);
  });

  it('R11-2 HELD: a rotation that did not land (the chain unreadable too) keeps the old secret', async () => {
    const { api, privateState, chain } = fakeApi({
      rotateRecordSecret: async () => {
        throw new Error('network down');
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).currentLedger = async () => {
      throw new Error('indexer down');
    };
    void chain;
    await expect(api.rotateRecordSecret(C.commit(next), next)).rejects.toThrow('network down');
    expect(privateState().geneticSecret).toEqual(old);
  });

  it('R11-3 FIXED: a failed retire (menu 33) does not leave the typed authority key in the local store', async () => {
    const realKey = 'cd'.repeat(32);
    const { api, signingKeys } = fakeApi(
      {},
      async () => {
        throw new Error('ReplaceMaintenanceAuthorityTxFailedError / network down');
      },
      // Round D: the provable retirement fails reading the authority, before sending.
      async () => {
        throw new Error('network down');
      },
    );
    await expect(api.retireMaintenanceAuthority(realKey)).rejects.toThrow();
    expect(signingKeys.has(ADDR)).toBe(false); // design.md: it "should not also sit on this machine"
  });

  it('R11-3 HELD: a successful retire leaves no key either', async () => {
    const { api, signingKeys } = fakeApi({});
    await api.retireMaintenanceAuthority('cd'.repeat(32));
    expect(signingKeys.has(ADDR)).toBe(false);
  });
});

describe('R11-4 FIXED: the private-state password is checked with midnight-js rule at startup', () => {
  const saved = process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
  beforeEach(() => {
    delete process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.VEILCORE_PRIVATE_STATE_PASSWORD;
    else process.env.VEILCORE_PRIVATE_STATE_PASSWORD = saved;
  });

  it('every password midnight-js refuses is refused here, with a plain reason', () => {
    // These passed the old length-only check (index.ts) and failed after the sync.
    for (const pw of ['correcthorsebatterystaple', 'aaaaaaaaaaaaaaaaQ1!', 'Abcd1234Abcd1234!', 'short']) {
      expect(() => validatePassword(pw)).toThrow();
      expect(passwordProblem(pw)).not.toBeNull();
    }
    expect(passwordProblem('Abcd1234Abcd1234!')).toMatch(/1234/);
    const good = 'Tq7#mZ9!pL2@vX5$';
    expect(() => validatePassword(good)).not.toThrow();
    expect(passwordProblem(good)).toBeNull();
  });

  it('the environment variable is checked too; a bad one stops the start', async () => {
    process.env.VEILCORE_PRIVATE_STATE_PASSWORD = 'correcthorsebatterystaple';
    const ask = vi.fn(async () => '');
    expect(await settlePassword(ask, silent)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('typed: asked twice, and two different answers stop the start', async () => {
    const answers = ['Tq7#mZ9!pL2@vX5$', 'Tq7#mZ9!pL2@vX5%'];
    expect(await settlePassword(async () => answers.shift() ?? '', silent)).toBe(false);
    expect(process.env.VEILCORE_PRIVATE_STATE_PASSWORD).toBeUndefined();
  });

  it('typed: the same good password twice is taken', async () => {
    const answers = ['Tq7#mZ9!pL2@vX5$', 'Tq7#mZ9!pL2@vX5$'];
    expect(await settlePassword(async () => answers.shift() ?? '', silent)).toBe(true);
    // Round D (D-6): held in memory, never put in the environment for child processes.
    expect(privateStatePassword()).toBe('Tq7#mZ9!pL2@vX5$');
    expect(process.env.VEILCORE_PRIVATE_STATE_PASSWORD).toBeUndefined();
    forgetPassword();
  });
});

describe('R11-F FIXED: typed keys are checked before use, and redacted from every log line', () => {
  it('a leading 0x or a wrong length is refused with a message, not stripped silently', () => {
    const k = 'Ab'.repeat(32);
    expect(parseSigningKey(`0x${k}`)).toEqual({ problem: expect.stringMatching(/0x/) });
    expect(parseSigningKey(k.slice(2))).toEqual({ problem: expect.stringMatching(/62 characters/) });
    expect(parseSigningKey(k)).toEqual({ value: k.toLowerCase() });
    expect('value' in parseSecret32('zz'.repeat(32))).toBe(false);
  });

  it('a key typed this session is redacted in any case, inside any text', () => {
    const k = '0f'.repeat(32);
    expect(scrub(`error: bad key ${k.toUpperCase()}!`)).toContain(k.toUpperCase()); // not typed yet
    parseSigningKey(k); // typing it registers it
    const line = `{"msg":"Found error 'bad signing key 0x${k.toUpperCase()}' and ${k}"}`;
    const out = scrub(line);
    expect(out.toLowerCase()).not.toContain(k);
    expect(out).toContain('[redacted]');
    redactThisSession('word '.repeat(24).trim());
    expect(scrub(`phrase: ${'word '.repeat(24).trim()}`)).toBe('phrase: [redacted]');
  });
});

describe('R11-H FIXED: the smoke test counts only contract refusals as refusals', () => {
  it('a failed Compact assert, as midnight-js surfaces it, is a refusal', () => {
    const sim = new VeilcoreSimulator();
    let assertErr: unknown;
    try {
      sim.call(as(secret('h-unanchored')), 'proveOwnership', secret('h-ch')); // not anchored
    } catch (e) {
      assertErr = e;
    }
    expect(String((assertErr as Error).message)).toMatch(/^failed assert: /);
    // midnight-js-contracts: `throw new Error(error.cause.message, { cause: error })`
    const wrapped = new Error((assertErr as Error).message, {
      cause: { _tag: 'ContractRuntimeError', cause: assertErr },
    });
    expect(isContractRefusal(wrapped)).toBe(true);
    const failedOnChain = Object.assign(new Error('Transaction failed'), { name: 'CallTxFailedError' });
    expect(isContractRefusal(failedOnChain)).toBe(true);
  });

  it('network, proof-server and other errors are not', () => {
    expect(
      isContractRefusal(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:6300') })),
    ).toBe(false);
    expect(isContractRefusal(new Error('The indexer answered 503.'))).toBe(false);
    expect(isContractRefusal(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toBe(false);
    expect(isContractRefusal(undefined)).toBe(false);
  });
});

describe('R11-J FIXED: the CLI keeps the challenge book across runs, encrypted, 0600', () => {
  it('a challenge used in one run is refused in the next', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'r11-cb-'));
    const pw = 'Tq7#mZ9!pL2@vX5$';
    const first = await new ChallengeFile('mainnet', pw, dir).load();
    expect(first.warning).toBeUndefined();
    const { challenge } = first.book.issue('licence');
    const file = new ChallengeFile('mainnet', pw, dir);
    await file.save(first.book);
    expect(statSync(file.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(file.path).toString('latin1')).not.toContain(hex(challenge)); // encrypted

    const second = (await new ChallengeFile('mainnet', pw, dir).load()).book;
    expect(second.consume(challenge, 'licence').ok).toBe(true);
    await file.save(second);
    const third = (await new ChallengeFile('mainnet', pw, dir).load()).book;
    expect(third.consume(challenge, 'licence').ok).toBe(false);

    // Wrong password: nothing earlier is trusted.
    const wrong = await new ChallengeFile('mainnet', 'Other#Pass9!word2', dir).load();
    expect(wrong.warning).toMatch(/could not be read/);
    expect(wrong.book.check(challenge, 'licence').ok).toBe(false);
  });

  it('kinds are kept apart', () => {
    const book = new ChallengeBook();
    const { challenge } = book.issue('ownership');
    expect(book.consume(challenge, 'licence').ok).toBe(false);
    expect(book.consume(challenge, 'ownership').ok).toBe(true);
  });
});

describe("R11-K FIXED: checkOwnership refuses a thief's proof once the owner recovered", () => {
  it('the API reads the current ledger as well as the state after the proof', async () => {
    const sim = new VeilcoreSimulator();
    const OWNER = secret('k-owner');
    const REC = C.commit(OWNER);
    const rcv = secret('k-rcv');
    sim.call(as(OWNER), 'anchor', C.recoveryCommit(rcv));
    const ch = secret('k-ch');
    sim.call(as(OWNER), 'proveOwnership', ch); // the thief, holding the stolen secret
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (): unknown => (sim as any).ctx.currentQueryContext.state;
    lookup.state = sim.state;
    lookup.data = raw();
    const { api } = fakeApi({});
    // The state now, as the API reads it (once, for the ledger and the key check).
    let now = raw();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).currentState = async () => ({ data: now });
    const first = await api.checkOwnership('http://indexer', 'aa', REC, ch);
    expect(first.accepted).toBe(true);
    // Verification review: the authority reported is the one at the proof's state.
    expect(first.authority?.counter).toBe(16n);

    const NEW = secret('k-new');
    sim.call(
      as(secret('k-x'), { recovery: rcv, incoming: NEW }),
      'recoverRecordSecret',
      REC,
      C.commit(NEW),
      C.recoveryCommit(secret('k-rcv2')),
    );
    now = raw();
    const v = await api.checkOwnership('http://indexer', 'aa', REC, ch);
    expect(v.accepted).toBe(false);
    expect(v.reason).toMatch(/ask for a fresh proof/);
  });
});

describe('R11-L FIXED: an issuer never re-admits a licence commitment it revoked', () => {
  const lc = new Uint8Array(32).fill(5);
  const other = new Uint8Array(32).fill(6);
  const rec = new Uint8Array(32).fill(3);

  it('revoke, then re-issue or approve a transfer to the same commitment: refused before anything is sent', async () => {
    const sent: string[] = [];
    const { api, privateState, chain } = fakeApi({
      revokeLicense: async () => (sent.push('revoke'), txOk),
      issueLicense: async () => (sent.push('issue'), txOk),
      approveTransfer: async () => (sent.push('approve'), txOk),
    });
    chain({ unsealedChanges: false });
    await api.issueLicense(lc);
    await api.revokeLicense(lc, rec);
    expect(privateState().revokedLicenses).toEqual([hex(lc)]);
    await expect(api.issueLicense(lc)).rejects.toBeInstanceOf(RevokedLicenceError);
    await expect(api.approveTransfer(other, rec, lc)).rejects.toThrow(/you revoked licence/);
    expect(sent).toEqual(['issue', 'revoke']);
    // Anything else still goes through.
    await api.approveTransfer(other, rec, new Uint8Array(32).fill(8));
    expect(sent).toEqual(['issue', 'revoke', 'approve']);
  });

  it('a revocation whose call failed is remembered too', async () => {
    const { api, privateState } = fakeApi({
      revokeLicense: async () => {
        throw new Error('confirmation timeout');
      },
    });
    await expect(api.revokeLicense(lc, rec)).rejects.toThrow();
    expect(privateState().revokedLicenses).toEqual([hex(lc)]);
  });

  it('private state written before the field existed reads as nothing revoked', async () => {
    const { api } = fakeApi({ issueLicense: async () => txOk });
    await expect(api.issueLicense(lc)).resolves.toBeDefined();
  });
});

// Last: it changes the working directory, and must load testkit for the first time after.
describe('R11-5 FIXED: the Blockfrost project id never reaches testkit logs', () => {
  const cwd = process.cwd();
  afterAll(() => process.chdir(cwd));

  it("the CLI's wallet construction logs nothing; testkit's own (the old path) is the positive control", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'r11-'));
    process.chdir(dir); // testkit resolves its log dir from cwd when it is first loaded
    const { WalletFactory, WalletSeeds } = await import('@midnight-ntwrk/testkit-js');
    const { LedgerParameters } = await import('@midnight-ntwrk/midnight-js-protocol/ledger');
    const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
    const { createWallets, walletConfiguration } = await import('./midnight-wallet-provider');
    setNetworkId('mainnet');
    const env = (id: string) => {
      const q = `?project_id=${id}`;
      return {
        walletNetworkId: 'mainnet',
        networkId: 'mainnet',
        indexer: `https://midnight-mainnet.blockfrost.io/api/v0${q}`,
        indexerWS: `wss://midnight-mainnet.blockfrost.io/api/v0/ws${q}`,
        node: `https://rpc.midnight-mainnet.blockfrost.io/${q}`,
        nodeWS: `wss://rpc.midnight-mainnet.blockfrost.io/${q}`,
        faucet: '',
        proofServer: 'http://127.0.0.1:6300',
      };
    };
    const dust = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };
    const seeds = WalletSeeds.fromMasterSeed('ab'.repeat(32));

    // What MidnightWalletProvider.build does now.
    await createWallets(env('R11OURPATHPROJECTID'), seeds, dust);
    // Positive control: testkit's factory, which FluentWalletBuilder used, still leaks.
    WalletFactory.createDustWallet(walletConfiguration(env('R11TESTKITPROJECTID')) as never, seeds.dust, dust);
    await new Promise((r) => setTimeout(r, 200));

    const logDir = path.join(dir, 'logs', 'tests');
    const text = existsSync(logDir)
      ? readdirSync(logDir)
          .map((f) => readFileSync(path.join(logDir, f), 'utf8'))
          .join('\n')
      : '';
    expect(text).toContain('R11TESTKITPROJECTID'); // the detector works
    expect(text).not.toContain('R11OURPATHPROJECTID'); // and our path writes nothing
  });

  it('no CLI source uses the testkit wallet builders that log configs or seeds', () => {
    const src = path.dirname(new URL(import.meta.url).pathname);
    for (const f of readdirSync(src).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const code = readFileSync(path.join(src, f), 'utf8');
      expect(code, f).not.toMatch(
        /import[^;]*\b(FluentWalletBuilder|WalletFactory)\b|\.withRandomSeed\(|\.buildWithoutStarting\(|\.createDustWallet\(/,
      );
    }
  });
});
