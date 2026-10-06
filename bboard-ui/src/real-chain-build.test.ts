// Real transactions from the website stay behind VITE_REAL_CHAIN=1 (docs/real-chain-plan.md).
//
//   1. The slots (real-chain/slots.mjs) fit the pages as they are now, and refuse to guess.
//   2. A build WITHOUT the flag carries none of the chain code: no worker, no prover, no
//      sponsor, no record keys, no parameters. Given a build of main
//      (REAL_CHAIN_BASELINE_DIST=<its dist>), it must be byte for byte the same.
//      real-chain/compare-with-main.mjs makes both builds and compares them.
//   3. A build WITH the flag has the panels and the proving worker, refuses mainnet, and
//      refuses a flag left in bboard-ui/.env.<mode>.
//   4. In headless Chromium, under the headers a real-chain deploy would send: the page
//      loads with no policy violation, and the proving worker starts only through the
//      'veilcore-worker' Trusted Types policy.
//
// Needs dist from `vite build --mode preprod` for part 2 (skipped without it). Run alone:
// npx vitest run --maxWorkers=1 src/real-chain-build.test.ts
// SPDX-License-Identifier: Apache-2.0

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { SLOTS, SLOT_FILES, applySlots } from '../real-chain/slots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(HERE, '..');
const DIST = path.join(UI, 'dist');
const API = 'https://veilcore-api-production.up.railway.app';
const SPONSOR = 'https://sponsor.example';
const CONTRACT = 'c0'.repeat(32);

/** What only the real-chain feature puts in a build. None of it may be in a plain one. */
const CHAIN_MARKERS = [
  'prover.worker',
  'veilcore-worker',
  '/sponsor/challenge',
  'veilcore.sponsor-ticket',
  'veilcore.record-keys',
  'veilcore.verifier-challenges',
  'bls_midnight_2p',
  'midnight_zkir_wasm',
  'Anchor this record on',
  'on-chain keys in this browser',
  'Ask the holder to prove they hold this record',
];

const filesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });

const markersIn = (dir: string): string[] => {
  const found = new Set<string>();
  for (const f of filesUnder(dir)) {
    if (/\.(png|jpe?g|woff2?|ico|svg)$/.test(f)) continue;
    const text = fs.readFileSync(f, 'latin1');
    for (const m of CHAIN_MARKERS) if (text.includes(m)) found.add(`${m} (${path.relative(dir, f)})`);
    if (/prover\.worker|zkir/.test(path.basename(f))) found.add(`file ${path.relative(dir, f)}`);
  }
  return [...found];
};

// Builds run as on deploy day: none of vitest's own environment, and no real-chain
// setting inherited from the shell unless a test gives one.
const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(VITEST|NODE_ENV$|TEST$|MODE$|VITE_REAL_CHAIN|VITE_SPONSOR_URL|VITE_INDEXER)/.test(k),
    ),
  );
const build = (mode: string, outDir: string, env: Record<string, string>) =>
  spawnSync('npx', ['vite', 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: UI,
    env: { ...cleanEnv(), NODE_ENV: 'production', VITE_API_BASE: API, ...env },
    encoding: 'utf8',
    timeout: 300_000,
  });
const REAL_ENV = { VITE_REAL_CHAIN: '1', VITE_REAL_CHAIN_CONTRACT_ADDRESS: CONTRACT, VITE_SPONSOR_URL: SPONSOR };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-real-chain-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('slots: where the panels go', () => {
  it('each fits the page as it is now, exactly once', () => {
    for (const rel of SLOT_FILES) {
      const src = fs.readFileSync(path.join(HERE, rel), 'utf8');
      const out = applySlots(rel, src);
      for (const s of SLOTS.filter((x) => x.file === rel)) {
        expect(out.split(s.code).length - 1, s.name).toBe(1);
        for (const i of s.imports) expect(out.startsWith(i) || out.includes(`\n${i}\n`), s.name).toBe(true);
      }
    }
  });

  it('refuses an anchor that is gone or appears twice, naming the slot', () => {
    const rel = 'components/RecordDetail.tsx';
    const src = fs.readFileSync(path.join(HERE, rel), 'utf8');
    const anchor = '<SettlementStatus record={record} />';
    expect(() => applySlots(rel, src.replace(anchor, '<SettlementStatus record={r} />'))).toThrow(
      /record-detail: anchor panel.*anchor is gone/,
    );
    expect(() => applySlots(rel, src.replace(anchor, `${anchor}${anchor}`))).toThrow(/appears 2 times/);
  });

  it('leaves every other file alone', () => {
    expect(applySlots('components/AppHeader.tsx', 'x')).toBe('x');
  });
});

const haveDist = fs.existsSync(path.join(DIST, 'index.html'));

describe.skipIf(!haveDist)('a build without the flag (bboard-ui/dist)', () => {
  it('carries none of the chain code', () => {
    expect(markersIn(DIST)).toEqual([]);
    expect(fs.existsSync(path.join(DIST, 'params'))).toBe(false);
  });

  const baseline = process.env.REAL_CHAIN_BASELINE_DIST;
  it.skipIf(!baseline)('is byte for byte the build of main (REAL_CHAIN_BASELINE_DIST)', () => {
    const base = path.resolve(baseline as string);
    const rel = (d: string) =>
      filesUnder(d)
        .map((f) => path.relative(d, f))
        .sort();
    expect(rel(DIST)).toEqual(rel(base));
    for (const f of rel(base)) {
      expect(fs.readFileSync(path.join(DIST, f)).equals(fs.readFileSync(path.join(base, f))), f).toBe(true);
    }
  });
});

const REAL_DIST = path.join(tmp, 'real');

describe('a build with the flag', () => {
  let built: ReturnType<typeof build>;
  beforeAll(() => {
    built = build('preprod', REAL_DIST, REAL_ENV);
  }, 320_000);

  it('builds, with the panels, the proving worker and the configured contract', () => {
    expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
    const found = markersIn(REAL_DIST).join('\n');
    for (const m of ['prover.worker', 'veilcore-worker', '/sponsor/challenge', 'Anchor this record on'])
      expect(found).toContain(m);
    const all = filesUnder(path.join(REAL_DIST, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    expect(all).toContain(CONTRACT);
    expect(all).toContain(SPONSOR);
  });

  it('refuses mainnet', () => {
    const r = build('mainnet', path.join(tmp, 'real-mainnet'), REAL_ENV);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/test network only/);
  });

  it('refuses a flag left in bboard-ui/.env.<mode>', () => {
    const envFile = path.join(UI, '.env.realchaincheck');
    fs.writeFileSync(envFile, 'VITE_NETWORK_ID=preprod\nVITE_REAL_CHAIN=1\n');
    try {
      const r = build('realchaincheck', path.join(tmp, 'real-envfile'), {});
      expect(r.status).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toMatch(/VITE_REAL_CHAIN is set in bboard-ui\/\.env\.realchaincheck/);
    } finally {
      fs.rmSync(envFile, { force: true });
    }
  });
});

// ------------------------------------------------------------------ in a browser

const PW = ['/opt/node-tools/node_modules/playwright', '/home/claude/.npm-global/lib/node_modules/playwright'].find(
  (p) => fs.existsSync(p),
);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const haveBrowser = Boolean(PW) && fs.existsSync(CHROME);

type PwRoute = { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> };
type PwPage = {
  goto(url: string, o?: object): Promise<unknown>;
  evaluate<T, A>(fn: (a: A) => T | Promise<T>, arg: A): Promise<T>;
  route(m: string, h: (r: PwRoute) => unknown): Promise<void>;
  on(ev: string, fn: (e: Error) => void): void;
  exposeFunction(name: string, fn: (v: string) => void): Promise<void>;
  addInitScript(fn: () => void): Promise<void>;
};
type PwBrowser = { newPage(): Promise<PwPage>; close(): Promise<void> };

/** The headers scripts/vercel-config.mjs makes for a real-chain deploy. */
const realChainHeaders = (): Record<string, string> => {
  const dir = fs.mkdtempSync(path.join(tmp, 'vcfg-'));
  fs.mkdirSync(path.join(dir, '.vercel/output'), { recursive: true });
  const r = spawnSync(process.execPath, [path.resolve(UI, '../scripts/vercel-config.mjs')], {
    cwd: dir,
    env: { ...cleanEnv(), VITE_API_BASE: API, ...REAL_ENV },
  });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.vercel/output/config.json'), 'utf8')) as {
    routes: { headers?: Record<string, string> }[];
  };
  return cfg.routes[0].headers ?? {};
};

describe.skipIf(!haveBrowser)('browser: the real-chain build under its deploy headers', () => {
  let browser: PwBrowser | undefined;
  let server: http.Server | undefined;
  let origin = '';
  let headers: Record<string, string> = {};
  let workerPath = '';

  beforeAll(async () => {
    if (!fs.existsSync(path.join(REAL_DIST, 'index.html'))) build('preprod', REAL_DIST, REAL_ENV);
    workerPath = `/assets/${fs.readdirSync(path.join(REAL_DIST, 'assets')).find((f) => f.startsWith('prover.worker'))}`;
    headers = realChainHeaders();
    // Plain http on 127.0.0.1: upgrade-insecure-requests is the one directive left out.
    const served = {
      ...headers,
      'Content-Security-Policy': headers['Content-Security-Policy']
        .split('; ')
        .filter((d) => d !== 'upgrade-insecure-requests')
        .join('; '),
    };
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      let p = path.join(REAL_DIST, decodeURIComponent(u.pathname));
      if (!p.startsWith(REAL_DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory())
        p = path.join(REAL_DIST, 'index.html');
      const types: Record<string, string> = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.wasm': 'application/wasm',
      };
      res.writeHead(200, { ...served, 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', () => r()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { chromium } = createRequire(import.meta.url)(PW as string) as {
      chromium: { launch: (o: object) => Promise<PwBrowser> };
    };
    browser = await chromium.launch({ executablePath: CHROME });
  }, 360_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  const open = async () => {
    const pg = await (browser as PwBrowser).newPage();
    const violations: string[] = [];
    const errors: string[] = [];
    await pg.exposeFunction('__csp', (v: string) => violations.push(v));
    await pg.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) =>
        (window as unknown as { __csp: (s: string) => void }).__csp(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    pg.on('pageerror', (e: Error) => errors.push(String(e)));
    // Nothing leaves the page: the registry, the indexer and the sponsor are not needed here.
    await pg.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
    await pg.goto(`${origin}/`, { waitUntil: 'load' });
    return { pg, violations, errors };
  };

  it('allows the indexer and the sponsor, and the worker policy by name', () => {
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain(`connect-src 'self' ${API} ${SPONSOR} https://indexer.preprod.midnight.network`);
    expect(csp).toContain('wss://indexer.preprod.midnight.network');
    expect(csp).toMatch(/trusted-types veilcore-docs dompurify veilcore-worker;/);
    expect(csp).toMatch(/require-trusted-types-for 'script'/);
  });

  it('loads the home page with no error and no policy violation', async () => {
    const { violations, errors } = await open();
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
  }, 60_000);

  it('starts the proving worker through the policy (prover.ts), and it works', async () => {
    const { pg, violations } = await open();
    const out = await pg.evaluate(async (workerPath) => {
      const tt = (
        window as unknown as {
          trustedTypes: { createPolicy: (n: string, r: object) => { createScriptURL: (u: string) => string } };
        }
      ).trustedTypes;
      const url = new URL(workerPath, location.href).href;
      const policy = tt.createPolicy('veilcore-worker', { createScriptURL: (u: string) => u });
      const w = new Worker(policy.createScriptURL(url), { type: 'module' });
      const reply = (pred: (d: Record<string, unknown>) => boolean) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('no answer from the worker')), 30_000);
          w.addEventListener('message', (e: MessageEvent<Record<string, unknown>>) => {
            if (pred(e.data)) {
              clearTimeout(t);
              resolve(e.data);
            }
          });
          w.addEventListener('error', (e) => reject(new Error(e.message || 'worker error')));
        });
      await reply((d) => d.ready === true);
      const answer = reply((d) => d.id === 1);
      w.postMessage({ id: 1, op: 'pow', challenge: '00', tx: new Uint8Array([1, 2, 3]), difficulty: 6 });
      return answer;
    }, workerPath);
    expect(out).toMatchObject({ id: 1, ok: true });
    expect(typeof out.value).toBe('string');
    expect(violations).toEqual([]);
  }, 90_000);

  it('refuses a worker started without the policy, or under another policy name', async () => {
    const { pg } = await open();
    const r = await pg.evaluate((workerPath) => {
      const url = new URL(workerPath, location.href).href;
      const tries: string[] = [];
      try {
        new Worker(url, { type: 'module' });
        tries.push('plain: started');
      } catch (e) {
        tries.push(`plain: ${(e as Error).name}`);
      }
      try {
        (
          window as unknown as { trustedTypes: { createPolicy: (n: string, r: object) => unknown } }
        ).trustedTypes.createPolicy('something-else', { createScriptURL: (u: string) => u });
        tries.push('other policy: made');
      } catch (e) {
        tries.push(`other policy: ${(e as Error).name}`);
      }
      return tries;
    }, workerPath);
    expect(r).toEqual(['plain: TypeError', 'other policy: TypeError']);
  }, 60_000);
});
