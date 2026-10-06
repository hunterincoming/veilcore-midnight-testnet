// The claims contract on mainnet: the deploy gate (assertClaimsDeployAllowed), the
// address pin (assertClaimsJoinAllowed, MAINNET_CLAIMS_ADDRESS), the claims table of
// docs/fingerprints.md (keys-check.ts, contract/fingerprints.mjs), and the CLI options
// 34-36 that use them. Every refusal is checked to happen before anything is sent.
// Run: cd bboard-cli && npx vitest run --maxWorkers=1 src/claims-mainnet.test.ts
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @typescript-eslint/require-await -- fakes */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// findDeployedContract is the first thing a join reads from the chain: reaching it means
// the address pin let the join through.
const REACHED = 'reached findDeployedContract';
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    findDeployedContract: async () => {
      throw new Error(REACHED);
    },
  };
});

const { ClaimsAPI, assertClaimsDeployAllowed } = await import('../../api/src/claims-api');
const { MAINNET_CLAIMS_ADDRESS, assertClaimsJoinAllowed, assertJoinAllowed } =
  await import('../../api/src/deploy-guard');
const { CLAIMS_HEADING, assertKeysMatchRecord, parseFingerprints } = await import('./keys-check');
const { handleClaimsChoice } = await import('./claims-menu');

const ADDR = 'ab'.repeat(32);
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;
const REVISION = 'VEILCORE_DEPLOYMENT_RECORD_REVISION';
const CLAIMS_CIRCUITS = ['proveAttested', 'proveDistinct', 'proveRange', 'proveUnchanged', 'proveValue'];
const MAIN_CIRCUITS = ['anchor', 'proveOwnership', 'pairDna'];
const REPO_DOC = readFileSync(new URL('../../docs/fingerprints.md', import.meta.url), 'utf8');
const FINGERPRINTS_MJS = new URL('../../contract/fingerprints.mjs', import.meta.url);

const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex');

/** A compiled contract's artefacts, as `npm run compact` lays them out, with made-up contents. */
const fakeBuild = (root: string, name: string, circuits: readonly string[]): string => {
  const dir = path.join(root, 'contract', 'src', 'managed', name);
  for (const d of ['keys', 'zkir', 'contract']) mkdirSync(path.join(dir, d), { recursive: true });
  for (const c of circuits) {
    for (const k of ['prover', 'verifier']) writeFileSync(path.join(dir, 'keys', `${c}.${k}`), `${name} ${c} ${k}`);
    for (const z of ['zkir', 'bzkir']) writeFileSync(path.join(dir, 'zkir', `${c}.${z}`), `${name} ${c} ${z}`);
  }
  writeFileSync(path.join(dir, 'contract', 'index.js'), `// ${name}`);
  return dir;
};

/** The table rows fingerprints.mjs writes for a build. */
const rowsFor = (dir: string): string[] => {
  const files = [
    ...readdirSync(path.join(dir, 'keys'))
      .sort()
      .map((f) => `keys/${f}`),
    ...readdirSync(path.join(dir, 'zkir'))
      .sort()
      .map((f) => `zkir/${f}`),
    'contract/index.js',
  ];
  return files.map((f) => `| \`${f}\` | \`${sha(path.join(dir, f))}\` |`);
};

const mainPart = (dir: string): string =>
  [
    '# Build fingerprints',
    '',
    'Commit `test`, compiler `0.31.1`.',
    '',
    '| Artefact | SHA-256 |',
    '|---|---|',
    ...rowsFor(dir),
  ].join('\n');
/** The claims part before `npm run fingerprints:claims` has run (fingerprints.mjs writes it). */
const { claimsPlaceholder } = (await import('../../contract/fingerprints.mjs')) as { claimsPlaceholder: () => string };
const placeholder: string = claimsPlaceholder();
const claimsPart = (dir: string): string =>
  [
    `${CLAIMS_HEADING} (\`veilcore-claims\`)`,
    '',
    'Commit `test`.',
    '',
    '| Artefact | SHA-256 |',
    '|---|---|',
    ...rowsFor(dir),
  ].join('\n');

const git = (cwd: string, ...args: string[]): void => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
};

/** A repository whose committed docs/fingerprints.md is `doc`, with both builds beside it. */
const repoWith = (doc: (main: string, claims: string) => string) => {
  const root = mkdtempSync(path.join(tmpdir(), 'vc-claims-fp-'));
  const main = fakeBuild(root, 'veilcore', MAIN_CIRCUITS);
  const claims = fakeBuild(root, 'veilcore-claims', CLAIMS_CIRCUITS);
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs', 'fingerprints.md'), doc(main, claims));
  git(root, 'init', '-q');
  git(root, 'add', 'docs/fingerprints.md');
  git(root, 'commit', '-q', '-m', 'fingerprints');
  return { root, main, claims, check: () => assertKeysMatchRecord(claims, root, 'claims') };
};

const generated = () => repoWith((m, c) => `${mainPart(m)}\n\n${claimsPart(c)}\n`);
const notGenerated = () => repoWith((m) => `${mainPart(m)}\n\n${placeholder}\n`);

/** Run `f` with the record revision set to `value` (or unset), then put it back. */
const withRevision = async (value: string | undefined, f: () => unknown): Promise<void> => {
  const saved = process.env[REVISION];
  if (value === undefined) delete process.env[REVISION];
  else process.env[REVISION] = value;
  try {
    await f();
  } finally {
    if (saved === undefined) delete process.env[REVISION];
    else process.env[REVISION] = saved;
  }
};

beforeEach(() => setNetworkId('mainnet'));
afterEach(() => setNetworkId('undeployed'));

// ─────────────────────────────────────────────── the committed file

describe('docs/fingerprints.md: one table per contract', () => {
  it('as committed: the main table is untouched (97 rows) and the claims table has 21 rows', () => {
    expect(parseFingerprints(REPO_DOC).size).toBe(97);
    expect(parseFingerprints(REPO_DOC, 'main').size).toBe(97);
    expect(parseFingerprints(REPO_DOC, 'claims').size).toBe(21);
    expect(placeholder).toMatch(/^## Claims contract \(`veilcore-claims`\)\n\nNot yet generated\./);
    expect(placeholder).toContain('cd contract && npm run compact && npm run fingerprints:claims');
  });

  it("each table is read on its own: claims rows never count towards the main contract's check", () => {
    const r = generated();
    const text = readFileSync(path.join(r.root, 'docs', 'fingerprints.md'), 'utf8');
    expect(parseFingerprints(text, 'main').size).toBe(4 * MAIN_CIRCUITS.length + 1);
    expect(parseFingerprints(text, 'claims').size).toBe(4 * CLAIMS_CIRCUITS.length + 1);
    // The main contract's mainnet check passes with the claims table present, and the
    // claims build is checked against its own table.
    expect(assertKeysMatchRecord(r.main, r.root)).toBe(13);
    expect(r.check()).toBe(21);
    // Neither build passes against the other's table.
    expect(() => assertKeysMatchRecord(r.claims, r.root)).toThrow(/artefacts; the record lists 13/);
    expect(() => assertKeysMatchRecord(r.main, r.root, 'claims')).toThrow(/artefacts; the record lists 21/);
    // A table under any other heading belongs to neither.
    expect(
      parseFingerprints(`${text}\n## Notes\n\n| \`keys/x.prover\` | \`${'0'.repeat(64)}\` |\n`, 'claims').size,
    ).toBe(21);
  });
});

// ─────────────────────────────────────────────── the deploy gate

describe('assertClaimsDeployAllowed', () => {
  it('test networks are unchanged: allowed, with nothing checked, whatever the plan', async () => {
    for (const n of ['undeployed', 'preview', 'preprod']) {
      setNetworkId(n);
      await withRevision(undefined, () => {
        const checkBuild = vi.fn(() => 0);
        expect(assertClaimsDeployAllowed({ authority: 'empty-committee' })).toBe('development');
        expect(assertClaimsDeployAllowed({ authority: 'kept', checkBuild })).toBe('development');
        expect(checkBuild).not.toHaveBeenCalled();
      });
    }
  });

  it('mainnet: refused while the claims fingerprints are not generated', async () => {
    const r = notGenerated();
    await withRevision('4', () => {
      expect(() => assertClaimsDeployAllowed({ authority: 'empty-committee', checkBuild: r.check })).toThrow(
        /Refusing to deploy the claims contract on mainnet: .*no claims contract fingerprints yet.*npm run fingerprints:claims.*Nothing was made or sent/,
      );
      // And with no check at all.
      expect(() => assertClaimsDeployAllowed({ authority: 'empty-committee' })).toThrow(
        /nothing checked this build against the committed claims fingerprints/,
      );
    });
  });

  it('mainnet: refused when a built key does not match the committed table', async () => {
    const r = generated();
    writeFileSync(path.join(r.claims, 'keys', 'proveDistinct.verifier'), 'another verifier key');
    await withRevision('4', () => {
      expect(() => assertClaimsDeployAllowed({ authority: 'empty-committee', checkBuild: r.check })).toThrow(
        /Refusing to deploy the claims contract on mainnet: this build is not the one .*keys\/proveDistinct\.verifier does not match the record/,
      );
    });
  });

  it('mainnet: refused when docs/fingerprints.md is changed and not committed', async () => {
    const r = generated();
    const doc = path.join(r.root, 'docs', 'fingerprints.md');
    writeFileSync(doc, `${readFileSync(doc, 'utf8')}\n`);
    await withRevision('4', () => {
      expect(() => assertClaimsDeployAllowed({ authority: 'empty-committee', checkBuild: r.check })).toThrow(
        /differs from the committed copy/,
      );
    });
  });

  it('mainnet: refused when the deploy would keep a maintenance authority, before the build is even read', async () => {
    const r = generated();
    const checkBuild = vi.fn(r.check);
    await withRevision('4', () => {
      expect(() => assertClaimsDeployAllowed({ authority: 'kept', checkBuild })).toThrow(
        /Refusing to deploy the claims contract on mainnet: off a test network it is deployed only without a maintenance authority/,
      );
    });
    expect(checkBuild).not.toHaveBeenCalled();
  });

  it('mainnet: refused when the deployment record revision is not declared, as for the main contract', async () => {
    const r = generated();
    for (const v of [undefined, '3', 'v4'])
      await withRevision(v, () => {
        expect(() => assertClaimsDeployAllowed({ authority: 'empty-committee', checkBuild: r.check })).toThrow(
          /Refusing to deploy veilcore-claims\. Network "mainnet" requires a filed deployment record/,
        );
      });
  });

  it('mainnet: allowed when all hold (record declared, build matches, no authority kept)', async () => {
    const r = generated();
    const lines: string[] = [];
    const logger = { info: (m: string) => void lines.push(m) } as never;
    await withRevision('4', () => {
      expect(assertClaimsDeployAllowed({ authority: 'empty-committee', checkBuild: r.check }, logger)).toBe('checked');
    });
    expect(lines.join('\n')).toMatch(/all 21 build artefacts match the committed claims fingerprints/);
  });

  it('a network name not on the test list gets the mainnet rules', async () => {
    const r = generated();
    setNetworkId('main');
    await withRevision('4', () => {
      expect(() => assertClaimsDeployAllowed({ authority: 'empty-committee' })).toThrow(/on main: nothing checked/);
      expect(assertClaimsDeployAllowed({ authority: 'empty-committee', checkBuild: r.check })).toBe('checked');
    });
  });

  it('ClaimsAPI.deploy itself enforces it: on mainnet without a build check nothing is made or sent', async () => {
    const providers = new Proxy(
      {},
      {
        get: () => {
          throw new Error('a provider was touched');
        },
      },
    );
    await withRevision('4', () =>
      expect(ClaimsAPI.deploy(providers as never, silent)).rejects.toThrow(/nothing checked this build/),
    );
  });
});

// ─────────────────────────────────────────────── the address pin

describe('joining the claims contract on mainnet: the pinned address only', () => {
  const providers = () => {
    const set = vi.fn();
    return {
      set,
      providers: {
        privateStateProvider: { setContractAddress: set, removeSigningKey: async () => undefined },
        publicDataProvider: {
          queryContractState: async () => ({
            maintenanceAuthority: { committee: [], threshold: 1, counter: 1n },
            operations: () => [],
          }),
        },
      },
    };
  };

  it('no join while no address is pinned; nothing is read or written', async () => {
    expect(MAINNET_CLAIMS_ADDRESS).toBe(''); // empty until the claims deploy, by design
    const p = providers();
    await expect(ClaimsAPI.join(p.providers as never, ADDR, silent)).rejects.toThrow(
      /Refusing to join a VeilCore claims contract on mainnet: this build pins no address yet \(MAINNET_CLAIMS_ADDRESS/,
    );
    expect(p.set).not.toHaveBeenCalled();
  });

  it('once pinned, only that address (any case, with or without 0x)', () => {
    expect(() => assertClaimsJoinAllowed(ADDR, silent, 'cd'.repeat(32))).toThrow(
      /Refusing to join abab.*the VeilCore claims contract is cdcd.*Nothing was sent/,
    );
    expect(assertClaimsJoinAllowed(ADDR.toUpperCase(), silent, `0x${ADDR}`)).toBe('pinned');
  });

  it("the two pins are separate: the main contract's address does not open the claims contract", () => {
    expect(assertJoinAllowed(ADDR, silent, ADDR)).toBe('pinned');
    expect(() => assertClaimsJoinAllowed(ADDR, silent)).toThrow(/MAINNET_CLAIMS_ADDRESS/);
  });

  it("a deploy's own join, and finishing a deploy, are not joins by address", async () => {
    const p = providers();
    await expect(ClaimsAPI.join(p.providers as never, ADDR, silent, { deploying: true })).rejects.toThrow(REACHED);
    expect(p.set).toHaveBeenCalledWith(ADDR);
    // finishDeploy on an already retired contract goes straight to its own join.
    const q = providers();
    await expect(ClaimsAPI.finishDeploy(q.providers as never, ADDR, silent)).rejects.toThrow(REACHED);
  });

  it('test networks: any address, as before', async () => {
    for (const n of ['undeployed', 'preview', 'preprod']) {
      setNetworkId(n);
      expect(assertClaimsJoinAllowed(ADDR, silent)).toBe('development');
      await expect(ClaimsAPI.join(providers().providers as never, ADDR, silent)).rejects.toThrow(REACHED);
    }
  });
});

// ─────────────────────────────────────────────── the CLI, options 34-36

describe('CLI options 34-36 on mainnet', () => {
  const menu = (over: Record<string, unknown> = {}) => {
    const lines: string[] = [];
    const asked: string[] = [];
    const logger = {
      info: (m: string) => void lines.push(m),
      warn: (m: string) => void lines.push(m),
      error: (m: string) => void lines.push(m),
    };
    const ctx = {
      rli: { question: async (q: string) => (asked.push(q), '') },
      logger,
      providers: {},
      indexerUri: 'http://indexer',
      hidden: async () => '',
      during: <T>(f: () => Promise<T>) => f(),
      api: undefined,
      ...over,
    };
    return { ctx: ctx as never, lines, asked };
  };

  it('34 is refused before the question when the claims build cannot be checked or does not match', async () => {
    await withRevision('4', async () => {
      const m = menu();
      await expect(handleClaimsChoice('34', m.ctx)).rejects.toThrow(/nothing checked this build/);
      expect(m.asked).toEqual([]);
      const r = notGenerated();
      const n = menu({ checkBuild: r.check });
      await expect(handleClaimsChoice('34', n.ctx)).rejects.toThrow(/no claims contract fingerprints yet/);
      expect(n.asked).toEqual([]);
    });
  });

  it('34 asks, once everything holds, and sends nothing on a no', async () => {
    const r = generated();
    await withRevision('4', async () => {
      const m = menu({ checkBuild: r.check });
      expect(await handleClaimsChoice('34', m.ctx)).toBe(true);
      expect(m.asked).toEqual(['Deploy a claims contract now? Type yes to send it, anything else to stop: ']);
      expect(m.lines).toContain('Nothing was sent.');
    });
  });

  it('35 and 36 check the claims build before asking for an address', async () => {
    for (const choice of ['35', '36']) {
      const none = menu();
      expect(await handleClaimsChoice(choice, none.ctx)).toBe(true);
      expect(none.lines).toContain(
        'This run cannot check the claims build against docs/fingerprints.md. Nothing was sent.',
      );
      expect(none.asked).toEqual([]);
      const r = generated();
      writeFileSync(path.join(r.claims, 'contract', 'index.js'), '// changed');
      const bad = menu({ checkBuild: r.check });
      await expect(handleClaimsChoice(choice, bad.ctx)).rejects.toThrow(/contract\/index\.js does not match/);
      expect(bad.asked).toEqual([]);
    }
  });

  it('35 with a matching build goes on to the address, and the pin refuses an unpinned one', async () => {
    const r = generated();
    const m = menu({
      checkBuild: r.check,
      providers: { privateStateProvider: { setContractAddress: () => undefined } },
      rli: { question: async () => ADDR },
    });
    await expect(handleClaimsChoice('35', m.ctx)).rejects.toThrow(/pins no address yet/);
    expect(m.lines.join('\n')).toMatch(/All 21 claims build artefacts match/);
  });
});

// ─────────────────────────────────────────────── fingerprints.mjs

describe('contract/fingerprints.mjs --claims and --check', () => {
  /** The script in a throwaway copy of the repository layout, with a `compact` that says 0.31.1. */
  const layout = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vc-fp-script-'));
    const main = fakeBuild(root, 'veilcore', MAIN_CIRCUITS);
    const claims = fakeBuild(root, 'veilcore-claims', CLAIMS_CIRCUITS);
    copyFileSync(FINGERPRINTS_MJS, path.join(root, 'contract', 'fingerprints.mjs'));
    mkdirSync(path.join(root, 'docs'));
    const doc = path.join(root, 'docs', 'fingerprints.md');
    writeFileSync(doc, `${mainPart(main)}\n\n${placeholder}\n`);
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'compact'), '#!/bin/sh\necho 0.31.1\n');
    chmodSync(path.join(bin, 'compact'), 0o755);
    const run = (mode: string) =>
      spawnSync(process.execPath, ['fingerprints.mjs', mode], {
        cwd: path.join(root, 'contract'),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
    return { main, claims, doc, run };
  };

  it('--claims writes the claims table and leaves the main table byte for byte', () => {
    const l = layout();
    const before = readFileSync(l.doc, 'utf8');
    const mainBefore = before.slice(0, before.indexOf(CLAIMS_HEADING));
    const r = l.run('--claims');
    expect(r.status).toBe(0);
    const after = readFileSync(l.doc, 'utf8');
    expect(after.slice(0, after.indexOf(CLAIMS_HEADING))).toBe(mainBefore);
    expect(after).not.toContain('Not yet generated');
    expect(after).toContain('compiler `0.31.1`');
    // What it wrote is exactly what keys-check reads for each contract.
    expect(parseFingerprints(after, 'main')).toEqual(parseFingerprints(before, 'main'));
    expect([...parseFingerprints(after, 'claims')].map(([f, h]) => `| \`${f}\` | \`${h}\` |`)).toEqual(
      rowsFor(l.claims),
    );
    // --check now passes for both; the main table regenerated keeps the claims table.
    expect(l.run('--check').stdout).toMatch(/main contract: all 13 .*\nclaims contract: all 21 /);
    expect(l.run('--main').status).toBe(0);
    expect(parseFingerprints(readFileSync(l.doc, 'utf8'), 'claims')).toEqual(parseFingerprints(after, 'claims'));
  });

  it('--claims refuses, writing nothing, when the main contract no longer matches its table', () => {
    const l = layout();
    writeFileSync(path.join(l.main, 'keys', 'anchor.prover'), 'a different toolchain');
    const before = readFileSync(l.doc, 'utf8');
    const r = l.run('--claims');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /MAIN contract does not match its committed fingerprints .*keys\/anchor\.prover differs.*Nothing written/,
    );
    expect(readFileSync(l.doc, 'utf8')).toBe(before);
  });

  it('--claims refuses without keys (a --skip-zk build), writing nothing', () => {
    const l = layout();
    for (const c of CLAIMS_CIRCUITS)
      for (const k of ['prover', 'verifier']) writeFileSync(path.join(l.claims, 'keys', `${c}.${k}`), '');
    const before = readFileSync(l.doc, 'utf8');
    const r = l.run('--claims');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/keys\/proveAttested\.prover is missing or empty/);
    expect(readFileSync(l.doc, 'utf8')).toBe(before);
  });

  it('--check fails while the claims table is not generated, and writes nothing', () => {
    const l = layout();
    const before = readFileSync(l.doc, 'utf8');
    const r = l.run('--check');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/main contract: all 13 artefacts match/);
    expect(r.stdout).toMatch(/claims contract: DOES NOT MATCH docs\/fingerprints\.md: the table lists nothing/);
    expect(readFileSync(l.doc, 'utf8')).toBe(before);
  });
});
