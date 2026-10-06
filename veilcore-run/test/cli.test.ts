// The operator's command line, driven as the operator would drive it (answers typed at
// the prompts), on the partner kit's chain stand-in: everything it prints is checked for
// every secret the partner's vault holds and every password typed.
// SPDX-License-Identifier: Apache-2.0
import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const kit = await import('@veilcore/contracts');
const { VEILCORE_ADDR, CLAIMS_ADDR, chainLog, fakeChain } = await import('../../partner-kit/test/local-chain.ts');
const { main } = await import('../src/cli.ts');
const { PartnerVault } = await import('../src/vault.ts');
const { NETWORK, PASSPHRASE, PW, leaked, tempRoot } = await import('./helpers.ts');

let t: Awaited<ReturnType<typeof tempRoot>>;
let chain: ReturnType<typeof fakeChain>;
let deps: Parameters<typeof main>[2];
beforeEach(async () => {
  setNetworkId('undeployed');
  t = await tempRoot();
  chain = fakeChain(fake as never);
  const vc = await kit.VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
  const claims = await kit.VeilCoreClaims.join(chain.conn, { address: CLAIMS_ADDR });
  deps = {
    env: { VEILCORE_RUN_DIR: t.root, VEILCORE_NETWORK: NETWORK, VEILCORE_ADDRESS: VEILCORE_ADDR },
    chain: () => Promise.resolve({ vc, claims, stop: () => Promise.resolve() }),
  };
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await t.done();
});

/** A terminal: answers given in order, everything printed kept. */
const terminal = (answers: string[]) => {
  const printed: string[] = [];
  const next = (): Promise<string> => {
    const a = answers.shift();
    if (a === undefined) throw new Error('the test ran out of answers');
    return Promise.resolve(a);
  };
  return { io: { print: (s: string) => void printed.push(s), ask: next, askHidden: next }, printed };
};

const run = async (argv: string[], answers: string[] = []) => {
  const term = terminal(answers);
  const code = await main(argv, term.io, deps);
  return { code, text: term.printed.join('\n') };
};

const secretsOf = async (id: string, password: string): Promise<Set<string>> => {
  const v = await PartnerVault.open({ root: t.root, id, network: NETWORK, password });
  const s = v.secrets();
  await v.close();
  return s;
};

describe('the operator CLI', () => {
  it('runs a partner from onboarding to exit and purge, and never prints a secret', async () => {
    const printed: string[] = [];
    const keep = async (argv: string[], answers: string[] = []) => {
      const r = await run(argv, answers);
      printed.push(r.text);
      return r;
    };
    // Onboard, with a password the CLI makes (shown once).
    const added = await run(
      ['add-partner', '--partner', 'lab', '--name', 'Example Lab', '--recovery', 'partner'],
      [''],
    );
    expect(added.code).toBe(0);
    const generated = /\n {2}(\S+)\n {2}\(shown once/.exec(added.text)?.[1];
    expect(generated).toBeDefined();
    expect(added.text.split(generated!).length - 1).toBe(1);

    // The partner, on their own computer: a master sheet and a pool; VeilCore imports the pool.
    const partnerDir = path.join(t.root, 'partner-side');
    await (await import('node:fs/promises')).mkdir(partnerDir);
    const keys = await keep(['partner-keys', '--partner', 'lab', '--out-dir', partnerDir, '--count', '5'], ['']);
    expect(keys.code).toBe(0);
    const poolFile = (await readdir(partnerDir)).find((f) => f.startsWith('recovery-pool-'))!;
    const sheet = await readFile(path.join(partnerDir, 'master-sheet.txt'), 'utf8');
    const masterLine = sheet
      .split('\n')
      .find((l) => l.includes('(check '))!
      .trim();
    expect(keys.text).not.toContain(masterLine.slice(0, 20));
    expect(
      (await keep(['import-pool', '--partner', 'lab', '--file', path.join(partnerDir, poolFile)], [generated!])).code,
    ).toBe(0);

    // Operations.
    const anchored = await keep(['anchor', '--partner', 'lab', '--label', 'acc-1'], [generated!]);
    expect(anchored.code).toBe(0);
    expect(anchored.text).toMatch(/Anchored: transaction [0-9a-f]{64}/);
    expect(anchored.text).toMatch(/held by: the partner/);
    expect(
      (await keep(['pair-dna', '--partner', 'lab', '--record', 'acc-1', '--report', 'ab'.repeat(32)], [generated!]))
        .code,
    ).toBe(0);
    const listed = await keep(['list', '--partner', 'lab', '--chain'], [generated!]);
    expect(JSON.parse(listed.text.slice(listed.text.indexOf('{')))).toMatchObject({
      records: [{ label: 'acc-1', recoveryHeldBy: 'partner', chain: { anchored: true, veilcoreCanAct: true } }],
    });

    // A wrong password: refused, nothing printed but the refusal.
    const wrong = await run(['anchor', '--partner', 'lab', '--label', 'acc-2'], ['Not-The-Pass-91xY!']);
    expect(wrong.code).toBe(1);
    expect(wrong.text).toMatch(/STOPPED: That password does not open this file/);
    expect(wrong.text).not.toContain('Not-The-Pass-91xY!');

    // Export, opened on the partner's side.
    const bundle = path.join(t.root, 'copy.vcb');
    expect(
      (await keep(['export', '--partner', 'lab', '--out', bundle], [generated!, PASSPHRASE, PASSPHRASE])).code,
    ).toBe(0);
    const sameAsVault = await run(
      ['export', '--partner', 'lab', '--out', path.join(t.root, 'x.vcb')],
      [generated!, generated!],
    );
    expect(sameAsVault.text).toMatch(/That is VeilCore's password/);
    const opened = await keep(['open-bundle', '--file', bundle], [PASSPHRASE]);
    expect(opened.text).toMatch(/1 records/);

    // Leave: the operator types the partner id; the partner types their passphrase.
    const out = path.join(t.root, 'exit.vcb');
    const left = await keep(
      ['exit', '--partner', 'lab', '--mode', 'self', '--out', out],
      [generated!, 'lab', PASSPHRASE, PASSPHRASE],
    );
    expect(left.code).toBe(0);
    const n = chainLog.length;
    const refused = await keep(
      ['pair-dna', '--partner', 'lab', '--record', 'acc-1', '--report', 'cd'.repeat(32)],
      [generated!],
    );
    expect(refused.code).toBe(1);
    expect(refused.text).toMatch(/left VeilCore-run/);
    expect(chainLog.length).toBe(n);
    expect((await run(['partners'])).text).toMatch(/lab {2}Example Lab .* LEFT .* \(self\)/);

    // Nothing printed, in the whole run, held a secret or a password typed.
    const secrets = await secretsOf('lab', generated!);
    expect(secrets.size).toBeGreaterThan(0);
    const all = printed.join('\n');
    expect(leaked(all, secrets)).toEqual([]);
    expect(all).not.toContain(generated!);
    expect(all).not.toContain(PASSPHRASE);

    const purged = await keep(['purge', '--partner', 'lab'], [generated!, 'PURGE lab']);
    expect(purged.code).toBe(0);
    expect((await secretsOf('lab', generated!)).size).toBe(0);
    const audit = await run(['audit', '--partner', 'lab']);
    expect(audit.code).toBe(0);
    expect(audit.text).toMatch(/anchor .* tx [0-9a-f]{64}/);
    expect(audit.text).toMatch(/purge/);
    expect(audit.text).toMatch(/chain of hashes is intact/);
  });

  it('an error that quotes a secret or a password is printed with it removed, in any case', async () => {
    const { describeError } = await import('../src/io.ts');
    const secret = 'ab12'.repeat(16);
    const e = new Error('outer', { cause: new Error(`inner ${secret.toUpperCase()} with ${PW} and 0x${secret}`) });
    const shown = describeError(e, [secret, PW]);
    expect(shown).toMatch(/outer\n {2}cause: inner \[redacted\] with \[redacted\] and 0x\[redacted\]/);
    expect(leaked(shown, [secret])).toEqual([]);
  });

  it('refuses a proof server that is not on this machine before anything starts', async () => {
    const add = await run(['add-partner', '--partner', 'lab', '--name', 'Lab', '--recovery', 'custody'], [PW, PW]);
    expect(add.code).toBe(0);
    const term = terminal([PW]);
    const r = await main(['anchor', '--partner', 'lab', '--label', 'a'], term.io, {
      env: { VEILCORE_RUN_DIR: t.root, VEILCORE_NETWORK: NETWORK, VEILCORE_PROOF_SERVER: 'https://proofs.example.com' },
    });
    expect(r).toBe(1);
    expect(term.printed.join('\n')).toMatch(/is not on this machine\. Refused/);
    expect(chainLog).toHaveLength(0);
  });
});
