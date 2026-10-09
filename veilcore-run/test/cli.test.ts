// The command line, driven as the operator and the partner would drive it (answers typed
// at the prompts), on the partner kit's chain stand-in: everything printed is checked for
// every secret the partner's vault holds and every password typed.
// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
const { readAudit } = await import('../src/audit.ts');
const { NETWORK, PW, leaked, tempRoot } = await import('./helpers.ts');

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

const printedAll: string[] = [];
const run = async (argv: string[], answers: string[] = []) => {
  const term = terminal(answers);
  const code = await main(argv, term.io, deps);
  const text = term.printed.join('\n');
  printedAll.push(text);
  return { code, text };
};

const secretsOf = async (id: string, password: string): Promise<Set<string>> => {
  const v = await PartnerVault.open({ root: t.root, id, network: NETWORK, password });
  const s = v.secrets();
  await v.close();
  return s;
};

/** Onboard a partner: VeilCore adds them; the partner makes keys; VeilCore imports with the fingerprint read out. */
const onboard = async (recovery: 'partner' | 'custody', count: number) => {
  const added = await run(['add-partner', '--partner', 'lab', '--name', 'Example Lab', '--recovery', recovery], ['']);
  expect(added.code).toBe(0);
  const password = /\n {2}(\S+)\n {2}\(shown once/.exec(added.text)![1];
  const partnerDir = path.join(t.root, 'partner-side');
  await mkdir(partnerDir, { recursive: true });
  const keys = await run(['partner-keys', '--partner', 'lab', '--out-dir', partnerDir, '--count', String(count)], ['']);
  expect(keys.code).toBe(0);
  const fingerprint = /FINGERPRINT: ([0-9a-f ]+)/.exec(keys.text)![1];
  const masterLine = (await readFile(path.join(partnerDir, 'master-sheet.txt'), 'utf8'))
    .split('\n')
    .find((l) => l.includes('(check '))!
    .trim();
  expect(keys.text).not.toContain(masterLine.slice(0, 20));
  const poolFile = path.join(partnerDir, (await readdir(partnerDir)).find((f) => f.startsWith('recovery-pool-'))!);
  return { password, masterLine, fingerprint, poolFile, partnerDir };
};

describe('the operator CLI', () => {
  it('runs a partner from onboarding to exit, the partner’s recovery and purge, and never prints a secret', async () => {
    printedAll.length = 0;
    const { password, masterLine, fingerprint, poolFile } = await onboard('partner', 5);
    // A pool whose fingerprint is not the one the partner reads out is refused.
    const bad = await run(
      ['import-pool', '--partner', 'lab', '--file', poolFile],
      [password, '1111 2222 3333 4444 5555'],
    );
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/not the fingerprint of this pool/);
    expect(bad.text).not.toContain(fingerprint.replace(/ /g, '').slice(0, 8)); // never shown to be copied
    expect((await run(['import-pool', '--partner', 'lab', '--file', poolFile], [password, fingerprint])).code).toBe(0);

    const anchored = await run(['anchor', '--partner', 'lab', '--label', 'acc-1'], [password]);
    expect(anchored.text).toMatch(/Anchored: transaction [0-9a-f]{64}/);
    expect(anchored.text).toMatch(/held by: the partner/);
    const reportFile = path.join(t.root, 'report.pdf');
    await writeFile(reportFile, 'a lab report (test data)');
    const evidence = path.join(t.root, 'pairing.json');
    const pairArgs = ['pair-dna', '--partner', 'lab', '--record', 'acc-1', '--report-file', reportFile];
    expect((await run(pairArgs, [password])).text).toMatch(/needs --evidence/);
    const paired = await run([...pairArgs, '--evidence', evidence], [password]);
    expect(paired.code).toBe(0);
    expect(paired.text).toMatch(/Evidence written to/);
    const ev = JSON.parse(await readFile(evidence, 'utf8')) as {
      reportFile: string;
      salt: string;
      reportSha256: string;
    };
    expect(ev.reportFile).toBe('report.pdf');
    expect(paired.text).not.toContain(ev.salt);
    expect(paired.text).not.toContain(ev.reportSha256);
    // An existing evidence file is refused before anything is sent.
    expect((await run([...pairArgs, '--evidence', evidence], [password])).text).toMatch(/nothing was sent/);
    const again = path.join(t.root, 'pairing-again.json');
    expect(
      (await run(['pair-evidence', '--partner', 'lab', '--record', 'acc-1', '--evidence', again], [password])).code,
    ).toBe(0);
    expect(await readFile(again, 'utf8')).toBe(await readFile(evidence, 'utf8'));
    // Obligation terms come from a prompt (or a file), never the command line.
    expect(
      (
        await run(
          ['obligation-encumber', '--partner', 'lab', '--record', 'acc-1', '--label', 'roy', '--terms', 'x'],
          [password],
        )
      ).text,
    ).toMatch(/Unknown option '--terms'/);
    expect(
      (
        await run(
          ['obligation-encumber', '--partner', 'lab', '--record', 'acc-1', '--label', 'roy'],
          [password, '7% royalty'],
        )
      ).code,
    ).toBe(0);
    const listed = await run(['list', '--partner', 'lab', '--chain'], [password]);
    expect(JSON.parse(listed.text.slice(listed.text.indexOf('{')))).toMatchObject({
      records: [
        {
          label: 'acc-1',
          recoveryHeldBy: 'partner',
          chain: { anchored: true, veilcoreCanAct: true, veilcoreHoldsCurrentRecovery: false },
        },
      ],
    });

    const wrong = await run(['anchor', '--partner', 'lab', '--label', 'acc-2'], ['Not-The-Pass-91xY!']);
    expect(wrong.code).toBe(1);
    expect(wrong.text).toMatch(/STOPPED: That password does not open this file/);
    expect(wrong.text).not.toContain('Not-The-Pass-91xY!');

    // Anchor the audit log; the receipt goes to the partner.
    const anchoredLog = await run(['audit-anchor', '--partner', 'lab'], [password]);
    expect(anchoredLog.text).toMatch(/Receipt for the partner .* head [0-9a-f]{64}, transaction [0-9a-f]{64}/);

    // Export (no passphrase anywhere), opened on the partner's side with their master.
    const copy = path.join(t.root, 'copy.vcb');
    expect((await run(['export', '--partner', 'lab', '--out', copy], [password])).code).toBe(0);
    const opened = await run(['open-bundle', '--file', copy], [masterLine]);
    // The partner checks the receipt against the log lines their bundle carries.
    const [, line, head, tx] = /line (\d+), head ([0-9a-f]{64}), transaction ([0-9a-f]{64})/.exec(anchoredLog.text)!;
    const receiptArgs = ['partner-check-receipt', '--partner', 'lab', '--bundle', copy, '--line', line, '--tx', tx];
    const holds = await run([...receiptArgs, '--head', head], [masterLine]);
    expect(holds.code).toBe(0);
    expect(holds.text).toMatch(/The receipt holds/);
    expect((await run([...receiptArgs, '--head', 'ab'.repeat(32)], [masterLine])).text).toMatch(/does NOT hold/);
    expect(opened.text).toMatch(/1 records/);
    expect((await run(['open-bundle', '--file', copy], ['00'.repeat(32) + ' (check 0000)'])).code).toBe(1);

    // Leave (self), then the partner's REQUIRED recovery, then exit-check.
    const out = path.join(t.root, 'exit.vcb');
    expect((await run(['exit', '--partner', 'lab', '--mode', 'self', '--out', out], [password, 'lab'])).code).toBe(0);
    const n = chainLog.length;
    const refused = await run(
      [
        'pair-dna',
        '--partner',
        'lab',
        '--record',
        'acc-1',
        '--report',
        'cd'.repeat(32),
        '--evidence',
        path.join(t.root, 'x.json'),
      ],
      [password],
    );
    expect(refused.text).toMatch(/left VeilCore-run/);
    expect(chainLog.length).toBe(n);
    expect((await run(['exit-check', '--partner', 'lab'], [password])).code).toBe(1);
    expect((await run(['partner-check', '--partner', 'lab', '--bundle', out], [masterLine])).text).toMatch(
      /NOT yet yours/,
    );
    const recovered = await run(['partner-recover', '--partner', 'lab', '--bundle', out], [masterLine]);
    expect(recovered.code).toBe(0);
    expect(recovered.text).toMatch(/Every record is yours/);
    const check = await run(['exit-check', '--partner', 'lab'], [password]);
    expect(check.code).toBe(0);
    expect(check.text).toMatch(/Exit complete on chain/);
    expect((await run(['partners'])).text).toMatch(/lab {2}Example Lab .* LEFT .* \(self\)/);

    // Nothing printed, in the whole run, held a secret or a password typed.
    const secrets = await secretsOf('lab', password);
    expect(secrets.size).toBeGreaterThan(0);
    const all = printedAll.join('\n');
    expect(leaked(all, secrets)).toEqual([]);
    expect(all.split(password).length - 1).toBe(1); // only the one-time display at add-partner
    expect(all).not.toContain(masterLine.slice(0, 19));

    const purged = await run(['purge', '--partner', 'lab'], [password, 'PURGE lab']);
    expect(purged.code).toBe(0);
    expect(purged.text).toMatch(/Deleted: .*copy\.vcb/);
    expect((await secretsOf('lab', password)).size).toBe(0);
    const audit = await run(['audit', '--partner', 'lab', '--verify']);
    expect(audit.code).toBe(0);
    expect(audit.text).toMatch(/2 anchors checked on chain; every one matches/); // the second covers the purge line
    expect(purged.text).toMatch(/Receipt for the partner \(covers the purge line\)/);
    expect(audit.text).toMatch(/purge/);
  });

  it('change-password changes it, says so, and logs it (reviewer H1)', async () => {
    expect((await run(['add-partner', '--partner', 'lab', '--name', 'Lab'], [PW, PW])).code).toBe(0);
    const NEW = 'Another-Vault-Pw-91zQ!';
    const r = await run(['change-password', '--partner', 'lab'], [PW, NEW, NEW]);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/Password changed/);
    await expect(PartnerVault.open({ root: t.root, id: 'lab', network: NETWORK, password: PW })).rejects.toThrow();
    const v = await PartnerVault.open({ root: t.root, id: 'lab', network: NETWORK, password: NEW });
    const log = await readAudit(path.join(v.dir, 'audit.jsonl'));
    await v.close();
    expect(log.entries.map((e) => e.op)).toContain('change-password');
  });

  it('an assisted exit needs the answer’s fingerprint as the partner reads it; a wrong one sends nothing', async () => {
    const { password, masterLine, fingerprint, poolFile, partnerDir } = await onboard('custody', 0);
    expect((await run(['import-pool', '--partner', 'lab', '--file', poolFile], [password, fingerprint])).code).toBe(0);
    await run(['anchor', '--partner', 'lab', '--label', 'acc-1'], [password]);
    const request = path.join(t.root, 'request.json');
    expect((await run(['exit-request', '--partner', 'lab', '--out', request], [password])).code).toBe(0);
    const answerDir = path.join(partnerDir, 'exit');
    await mkdir(answerDir);
    const made = await run(
      ['partner-keys', '--partner', 'lab', '--out-dir', answerDir, '--request', request, '--start', '0'],
      [masterLine],
    );
    const answerFp = /FINGERPRINT: ([0-9a-f ]+)/.exec(made.text)![1];
    const answer = path.join(answerDir, 'exit-answer.json');
    const n = chainLog.length;
    const wrong = await run(
      ['exit', '--partner', 'lab', '--mode', 'assisted', '--answer', answer, '--out', path.join(t.root, 'x.vcb')],
      [password, '0000 0000 0000 0000 0000', 'lab'],
    );
    expect(wrong.code).toBe(1);
    expect(wrong.text).toMatch(/not the fingerprint of this answer/);
    expect(chainLog.length).toBe(n);
    const out = path.join(t.root, 'assisted.vcb');
    const ok = await run(
      ['exit', '--partner', 'lab', '--mode', 'assisted', '--answer', answer, '--out', out],
      [password, answerFp, 'lab'],
    );
    expect(ok.code).toBe(0);
    expect(ok.text).toMatch(/partner-recover \(REQUIRED\)/);
    expect((await run(['exit-check', '--partner', 'lab'], [password])).text).toMatch(
      /hand-over secret VeilCore's software made still controls it/,
    );
    expect((await run(['partner-recover', '--partner', 'lab', '--bundle', out], [masterLine])).code).toBe(0);
    expect((await run(['exit-check', '--partner', 'lab'], [password])).code).toBe(0);
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
    expect(
      (await run(['add-partner', '--partner', 'lab', '--name', 'Lab', '--recovery', 'custody'], [PW, PW])).code,
    ).toBe(0);
    const term = terminal([PW]);
    const r = await main(['anchor', '--partner', 'lab', '--label', 'a'], term.io, {
      env: { VEILCORE_RUN_DIR: t.root, VEILCORE_NETWORK: NETWORK, VEILCORE_PROOF_SERVER: 'https://proofs.example.com' },
    });
    expect(r).toBe(1);
    expect(term.printed.join('\n')).toMatch(/is not on this machine\. Refused/);
    expect(chainLog).toHaveLength(0);
  });
});
