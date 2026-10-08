// Mainnet mode for veilcore.org: what the site says about the network comes from the
// build mode, and a mainnet build cannot happen before the main contract exists.
//
//   - the pins are read from api/src/deploy-guard.ts and agree with what that module exports;
//   - deploy:mainnet's registry check accepts only a registry anchoring on mainnet at the pin;
//   - the mainnet strings leave no test-network wording anywhere in the English strings;
//   - `vite build --mode mainnet` fails, in plain words, without a pinned address;
//   - with a made-up 64-hex address it builds, and the public and app pages, driven in
//     headless Chromium, say "main network" and never "test network", "preprod" or "Preview";
//   - a preprod build still says "test network" exactly as before;
//   - the maintenance-key wording says "decided" only when docs/maintenance-policy.md's
//     status line says APPROVED, and the claims contract's lack of a key only once pinned;
//   - deploy:prod refuses once the registry anchors on mainnet;
//   - on the mainnet site a Preview-anchored record still shows as Preview, with its warning,
//     though the registry no longer sets priorPossession for it.
//
// The builds go to temporary folders; bboard-ui/dist is not touched. The browser part is
// skipped when Chromium is missing. Run: npx vitest run --maxWorkers=1 src/site-mainnet.test.ts
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { readMainnetPins, normaliseAddress } from '../../scripts/mainnet-pins.mjs';
import { checkDescriptor } from '../../scripts/site-mainnet-preflight.mjs';
import { checkTestSiteAllowed } from '../../scripts/site-prod-preflight.mjs';
import { readPolicyStatus } from '../../scripts/maintenance-policy.mjs';
import { en } from './i18n/en';
import { DATED_POSTS, mainnetStrings } from './i18n/en-mainnet';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(HERE, '..');
const API = 'https://veilcore-api-production.up.railway.app';

/** Wording a mainnet page must not carry. */
const TEST_WORDING = /test[ -]network|preprod|\bpreview\b|test server|test registry|test version/i;

const DUMMY = 'ab'.repeat(32);
const DUMMY_CLAIMS = 'cd'.repeat(32);
const guardText = (main: string, claims: string) =>
  `export const MAINNET_VEILCORE_ADDRESS = '${main}';\nexport const MAINNET_CLAIMS_ADDRESS = '${claims}';\n`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-site-mainnet-'));
const guardFile = (name: string, main: string, claims: string) => {
  const f = path.join(tmp, `${name}.ts`);
  fs.writeFileSync(f, guardText(main, claims));
  return f;
};

// The build runs as it does on deploy day: none of vitest's own environment (NODE_ENV=test
// makes Vite produce a development bundle that does not run in a browser).
const cleanEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|NODE_ENV$|TEST$|MODE$)/.test(k)));

const build = (mode: string, outDir: string, env: Record<string, string>) =>
  spawnSync('npx', ['vite', 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: UI,
    env: { ...cleanEnv(), NODE_ENV: 'production', ...env },
    encoding: 'utf8',
    timeout: 300_000,
  });

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('the pins', () => {
  it('are read from deploy-guard.ts and match what the module exports', async () => {
    const guard = await import('../../api/src/deploy-guard');
    const source = fs.readFileSync(path.resolve(UI, '../api/src/deploy-guard.ts'), 'utf8');
    const read = readMainnetPins(source);
    if (guard.MAINNET_VEILCORE_ADDRESS === '') {
      expect(read.ok).toBe(false);
      expect(!read.ok && read.problem).toMatch(/not pinned yet/);
    } else {
      expect(read).toEqual({
        ok: true,
        veilcore: normaliseAddress(guard.MAINNET_VEILCORE_ADDRESS),
        claims: guard.MAINNET_CLAIMS_ADDRESS ? normaliseAddress(guard.MAINNET_CLAIMS_ADDRESS) : '',
      });
    }
  });

  it('refuses an empty or malformed main address, accepts 0x and capitals', () => {
    expect(readMainnetPins(guardText('', ''))).toMatchObject({ ok: false });
    expect(readMainnetPins(guardText('1234', ''))).toMatchObject({ ok: false });
    expect(readMainnetPins(guardText(DUMMY, 'nope'))).toMatchObject({ ok: false });
    expect(readMainnetPins('nothing here')).toMatchObject({ ok: false });
    expect(readMainnetPins(guardText(`0x${DUMMY.toUpperCase()}`, ''))).toEqual({
      ok: true,
      veilcore: DUMMY,
      claims: '',
    });
    expect(readMainnetPins(guardText(DUMMY, DUMMY_CLAIMS))).toEqual({
      ok: true,
      veilcore: DUMMY,
      claims: DUMMY_CLAIMS,
    });
  });
});

describe("deploy:mainnet's registry check", () => {
  const at = (network: string, contractAddress: string) => ({
    anchors: [{ chain: 'midnight', network, contractAddress }],
  });
  it('accepts only mainnet at the pinned contract', () => {
    expect(checkDescriptor(at('mainnet', DUMMY), DUMMY)).toEqual({ ok: true });
    expect(checkDescriptor(at('mainnet', `0x${DUMMY.toUpperCase()}`), DUMMY)).toEqual({ ok: true });
    expect(checkDescriptor(at('preview', DUMMY), DUMMY)).toMatchObject({ ok: false });
    expect(checkDescriptor(at('mainnet', DUMMY_CLAIMS), DUMMY)).toMatchObject({ ok: false });
    expect(checkDescriptor({ anchors: [] }, DUMMY)).toMatchObject({ ok: false });
    expect(checkDescriptor(null, DUMMY)).toMatchObject({ ok: false });
    const preview = checkDescriptor(at('preview', 'f75d42dc'.padEnd(64, '0')), DUMMY);
    expect(!preview.ok && preview.problem).toMatch(/does not anchor on mainnet yet \(it says: preview\)/);
  });
});

describe("deploy:prod's registry check", () => {
  it('refuses once the registry anchors on mainnet, and says to use deploy:mainnet', () => {
    const at = (network: string) => ({ anchors: [{ chain: 'midnight', network, contractAddress: DUMMY }] });
    expect(checkTestSiteAllowed(at('preview'))).toEqual({ ok: true });
    expect(checkTestSiteAllowed(at('preprod'))).toEqual({ ok: true });
    expect(checkTestSiteAllowed({ anchors: [] })).toEqual({ ok: true });
    // B5 review: a descriptor that cannot say, or a capitalised network name, must not pass.
    expect(checkTestSiteAllowed({}).ok).toBe(false);
    expect(checkTestSiteAllowed({ anchors: 'mainnet' }).ok).toBe(false);
    expect(checkTestSiteAllowed({ anchors: [{ network: 'Mainnet' }] }).ok).toBe(false);
    expect(checkTestSiteAllowed({ anchors: [{ network: ' MAINNET ' }] }).ok).toBe(false);
    const refused = checkTestSiteAllowed(at('mainnet'));
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.problem).toMatch(/Use npm run deploy:mainnet instead/);
  });

  // The script itself, as npm run deploy:prod runs it, against a stand-in registry.
  const runAgainst = async (descriptor: unknown, status = 200) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(req.url === '/.well-known/veilcore-registry' ? JSON.stringify(descriptor) : '{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { spawn } = await import('node:child_process');
    const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
      const p = spawn(process.execPath, [path.resolve(UI, '../scripts/site-prod-preflight.mjs')], {
        env: { ...cleanEnv(), VITE_API_BASE: api },
      });
      let text = '';
      p.stdout.on('data', (d) => (text += d));
      p.stderr.on('data', (d) => (text += d));
      p.on('close', (code) => resolve({ code, text }));
    });
    server.close();
    return out;
  };

  it('the script stops deploy:prod against a mainnet registry and lets it run against Preview', async () => {
    const mainnet = await runAgainst({ anchors: [{ chain: 'midnight', network: 'mainnet', contractAddress: DUMMY }] });
    expect(mainnet.code).toBe(1);
    expect(mainnet.text).toMatch(/NOT DEPLOYED\. The registry anchors on mainnet now/);
    expect(mainnet.text).toMatch(/Use npm run deploy:mainnet instead/);
    const preview = await runAgainst({ anchors: [{ chain: 'midnight', network: 'preview', contractAddress: DUMMY }] });
    expect(preview.code, preview.text).toBe(0);
    const down = await runAgainst({}, 500);
    expect(down.code).toBe(1);
    expect(down.text).toMatch(/Could not read the registry/);
  }, 30_000);

  it('runs first in deploy:prod', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(UI, '../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['deploy:prod']).toMatch(/^VITE_API_BASE=\S+ node scripts\/site-prod-preflight\.mjs && /);
  });
});

describe('the maintenance policy status', () => {
  it('is read from the policy itself, which says PROPOSED today or APPROVED', () => {
    const now = readPolicyStatus();
    expect(now.ok, !now.ok ? now.problem : '').toBe(true);
    const policy = fs.readFileSync(path.resolve(UI, '../docs/maintenance-policy.md'), 'utf8');
    expect(now.ok && now.approved).toBe(/^\*\*Status: APPROVED/m.test(policy));
  });
  it('accepts only PROPOSED or APPROVED, on exactly one status line', () => {
    expect(readPolicyStatus('# P\n\n**Status: PROPOSED, 3 October 2026.**\n')).toMatchObject({
      ok: true,
      approved: false,
    });
    expect(readPolicyStatus('# P\n\n**Status: APPROVED, 9 October 2026.**\n')).toMatchObject({
      ok: true,
      approved: true,
    });
    expect(readPolicyStatus('# P\n\n**Status: DRAFT**\n')).toMatchObject({ ok: false });
    expect(readPolicyStatus('# P\n\nNo status here.\n')).toMatchObject({ ok: false });
    expect(readPolicyStatus('**Status: APPROVED**\n**Status: PROPOSED**\n')).toMatchObject({ ok: false });
    expect(readPolicyStatus('**Status: approved**\n')).toMatchObject({ ok: false });
  });
});

/** The English strings with the mainnet overlay, minus the dated posts (history: they name preprod). */
const mergedNow = (claimsOnMainnet: boolean, policyApproved: boolean) => {
  const merged: Record<string, string> = { ...en, ...mainnetStrings({ claimsOnMainnet, policyApproved }) };
  for (const k of DATED_POSTS) delete merged[k];
  return merged;
};

describe('the mainnet strings', () => {
  for (const claims of [true, false]) {
    for (const approved of [true, false]) {
      it(`leave no test-network wording in English outside the dated posts (claims ${claims ? 'pinned' : 'not pinned'}, policy ${approved ? 'approved' : 'proposed'})`, () => {
        const overlay = mainnetStrings({ claimsOnMainnet: claims, policyApproved: approved });
        for (const k of Object.keys(overlay)) expect(Object.prototype.hasOwnProperty.call(en, k), k).toBe(true);
        const left = Object.entries(mergedNow(claims, approved)).filter(([, v]) => TEST_WORDING.test(v));
        expect(left).toEqual([]);
      });
    }
  }
  it('keep the dated posts on the network they ran on', () => {
    const overlay = mainnetStrings({ claimsOnMainnet: true, policyApproved: true });
    for (const k of DATED_POSTS) expect(`${en[k]} ${overlay[k] ?? ''}`, k).toMatch(/test network/);
    expect(overlay['m.post0.text']).toMatch(/on Midnight's preprod test network/);
    expect(overlay['m.post2.text']).toMatch(/to Midnight's preprod test network/);
  });
  it('say the claims contract is not on the main network until it is pinned', () => {
    const s = (claimsOnMainnet: boolean) => mainnetStrings({ claimsOnMainnet, policyApproved: false });
    expect(s(false)['m.claims.status']).toMatch(/isn't on Midnight's main network yet/);
    expect(s(true)['m.claims.status']).toMatch(/on Midnight's main network/);
    expect(s(true)['m.claims.status']).not.toMatch(/isn't on Midnight's main network/);
  });
  it('call the maintenance policy decided only when it is approved; the claims contract has no key only once pinned', () => {
    const key = (claimsOnMainnet: boolean, policyApproved: boolean) => {
      const o = mainnetStrings({ claimsOnMainnet, policyApproved });
      return `${o['m.status.keyText']} | ${o['m.status.keyLink']}`;
    };
    for (const claims of [true, false]) {
      expect(key(claims, false)).toMatch(/A policy for using it is proposed, not decided\..*Read the proposed policy/);
      expect(key(claims, false)).not.toMatch(/approved/i);
      expect(key(claims, true)).toMatch(
        /Every use is announced publicly, under a written maintenance policy\..*Read the maintenance policy/,
      );
      expect(key(claims, true)).not.toMatch(/proposed/i);
    }
    expect(key(true, false)).toMatch(/The claims contract has no maintenance key/);
    expect(key(false, true)).not.toMatch(/claims contract/i);
  });
  it('never call the site a demo: records sealed on the mainnet site are real', () => {
    for (const claims of [true, false])
      for (const policy of [true, false]) {
        const o = mainnetStrings({ claimsOnMainnet: claims, policyApproved: policy });
        for (const [k, v] of Object.entries(o)) expect(v.match(/\bdemos?\b/i)?.[0], k).toBeUndefined();
      }
  });
  it('say records are anchored by hand for now, never that dating simply happens', () => {
    for (const claims of [true, false]) {
      const o = mainnetStrings({ claimsOnMainnet: claims, policyApproved: false });
      for (const k of ['m.hero.status', 'm.demo.lede', 'm.stat2.s', 'm.privacy.test.text'] as const)
        expect(o[k], k).toMatch(/by hand for now/);
      expect(Object.values(o).join('\n')).not.toMatch(/dated there, in batches|are dated on Midnight's main network/);
    }
  });
});

// ------------------------------------------------------------------ builds and browser

describe('builds', () => {
  const mainDist = path.join(tmp, 'dist-mainnet');
  const preDist = path.join(tmp, 'dist-preprod');

  it('a mainnet build without a pinned address fails, saying why', () => {
    const r = build('mainnet', path.join(tmp, 'dist-refused'), {
      VEILCORE_TEST_DEPLOY_GUARD: guardFile('empty', '', ''),
      VITE_API_BASE: API,
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(
      /The mainnet website was not built\. The main contract address is not pinned yet/,
    );
    expect(fs.existsSync(path.join(tmp, 'dist-refused', 'index.html'))).toBe(false);
  }, 300_000);

  it('a mainnet build without the registry address fails, saying why', () => {
    const r = build('mainnet', path.join(tmp, 'dist-refused2'), {
      VEILCORE_TEST_DEPLOY_GUARD: guardFile('dummy0', DUMMY, ''),
      VITE_API_BASE: '',
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/VITE_API_BASE \(the registry address\) is not set/);
  }, 300_000);

  it('builds in mainnet mode with a pinned address, and in preprod mode', () => {
    const m = build('mainnet', mainDist, {
      VEILCORE_TEST_DEPLOY_GUARD: guardFile('dummy', DUMMY, DUMMY_CLAIMS),
      VITE_API_BASE: API,
    });
    expect(m.status, m.stderr).toBe(0);
    const p = build('preprod', preDist, { VITE_API_BASE: API });
    expect(p.status, p.stderr).toBe(0);

    const mainHtml = fs.readFileSync(path.join(mainDist, 'index.html'), 'utf8');
    expect(mainHtml).toMatch(/only its fingerprint is dated, on Midnight's main network/);
    expect(mainHtml).not.toMatch(TEST_WORDING);
    expect(mainHtml).not.toMatch(/%VEILCORE_DESCRIPTION%/);
    const preHtml = fs.readFileSync(path.join(preDist, 'index.html'), 'utf8');
    expect(preHtml).toMatch(/Pre-launch: tested on a Midnight test network/);

    // The addresses are compiled into the mainnet bundle only.
    const js = (dir: string) =>
      fs
        .readdirSync(path.join(dir, 'assets'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => fs.readFileSync(path.join(dir, 'assets', f), 'utf8'))
        .join('\n');
    expect(js(mainDist)).toContain(DUMMY);
    expect(js(preDist)).not.toContain(DUMMY);
  }, 600_000);

  // ---------------------------------------------------------------- browser

  const require = createRequire(import.meta.url);
  const PW = ['/opt/node-tools/node_modules/playwright', '/home/claude/.npm-global/lib/node_modules/playwright'].find(
    (p) => fs.existsSync(p),
  );
  const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const haveBrowser = Boolean(PW) && fs.existsSync(CHROME);

  type Page = {
    on(event: 'pageerror', f: (e: Error) => void): void;
    goto(u: string, o?: object): Promise<unknown>;
    waitForTimeout(ms: number): Promise<void>;
    evaluate<R>(f: () => R): Promise<R>;
    close(): Promise<void>;
  };
  type Ctx = {
    newPage(): Promise<Page>;
    route(
      re: RegExp,
      f: (r: { request(): { url(): string }; fulfill(o: object): Promise<void> }) => Promise<void>,
    ): Promise<void>;
    addInitScript(f: (arg: string) => void, arg: string): Promise<void>;
    close(): Promise<void>;
  };
  type Browser = { newContext(o?: object): Promise<Ctx>; close(): Promise<void> };

  const serve = (dir: string) =>
    new Promise<http.Server>((resolve) => {
      const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
      const s = http.createServer((req, res) => {
        let p = path.join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
        if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html');
        res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
        fs.createReadStream(p).pipe(res);
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });

  const PAGES = [
    '/',
    '/founders',
    '/privacy',
    '/verify',
    '/verify/example',
    '/verify/VEIL-NONE',
    '/implementations',
    '/new',
    '/records',
    '/licenses',
  ];
  /** Not in PAGES: this page rightly says "test network" (the record's own anchor). */
  const PREVIEW_RECORD = '/verify/VEIL-PREVIEW';
  const PREVIEW_ANSWER = {
    found: true,
    id: 'VEIL-PREVIEW',
    cultivar: 'Old Preview Cross',
    recordFingerprint: 'ef'.repeat(32),
    disclosed: ['own'],
    anchored: true,
    anchor: { chain: 'midnight', network: 'preview', testNetwork: true, txHash: '12'.repeat(32) },
    priorPossession: false,
    unalteredSinceRegistryFirstSeen: true,
  };

  const textOf = async (dir: string, role: string) => {
    const { chromium } = require(PW as string) as { chromium: { launch(o: object): Promise<Browser> } };
    const browser = await chromium.launch({ executablePath: CHROME });
    const server = await serve(dir);
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // Nothing leaves the page: the registry answers "nothing here", everything else is refused.
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
      const u = r.request().url();
      if (u.startsWith(API)) {
        const body = /\/verify\/VEIL-PREVIEW/.test(u)
          ? PREVIEW_ANSWER
          : /\/verify\//.test(u)
            ? { found: false }
            : /\/api\/(records|licenses)/.test(u)
              ? []
              : {};
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    await ctx.addInitScript((r: string) => localStorage.setItem('veilcore.role.v1', r), role);
    const out: Record<string, string> = {};
    for (const p of [...PAGES, PREVIEW_RECORD]) {
      const pg = await ctx.newPage();
      const errors: string[] = [];
      pg.on('pageerror', (e) => errors.push(e.message));
      await pg.goto(origin + p, { waitUntil: 'networkidle' });
      await pg.waitForTimeout(400);
      // Folded text on phones is still in the page; innerText of <details> bodies is not,
      // so read textContent of the whole body as well.
      out[p] = await pg.evaluate(() => `${document.body.innerText}\n${document.body.textContent ?? ''}`);
      if (out[p].trim() === '') throw new Error(`${p} rendered nothing: ${errors.join(' | ')}`);
      await pg.close();
    }
    await ctx.close();
    await browser.close();
    server.close();
    return out;
  };

  describe.skipIf(!haveBrowser)('pages in a browser', () => {
    let mainnet: Record<string, string> = {};
    let preprod: Record<string, string> = {};
    beforeAll(async () => {
      if (!fs.existsSync(path.join(mainDist, 'index.html'))) return;
      mainnet = await textOf(mainDist, 'breeder');
      preprod = await textOf(preDist, 'breeder');
    }, 300_000);

    it('the mainnet site never says test network, preprod or Preview, except in the dated posts', () => {
      expect(Object.keys(mainnet)).toEqual([...PAGES, PREVIEW_RECORD]);
      const dated = mainnetStrings({ claimsOnMainnet: true, policyApproved: false });
      for (const p of PAGES) {
        let text = mainnet[p];
        for (const k of DATED_POSTS) text = text.split(dated[k] ?? '\u0000').join('');
        expect(text.match(TEST_WORDING)?.[0], p).toBeUndefined();
      }
      // The dated posts are on the home page, as history.
      expect(mainnet['/']).toContain(dated['m.post0.text']);
    });

    it('the mainnet site calls records real, never a demo; only licenses and lab agreements are simulated', () => {
      // Records sealed on the mainnet site are anchored there, so nothing calls the site a
      // demo or asks for made-up details. "demonstrated" is not "demo".
      for (const p of PAGES) {
        expect(mainnet[p].match(/\bdemos?\b/i)?.[0], p).toBeUndefined();
        expect(mainnet[p].match(/made-up details|use made-up data/i)?.[0], p).toBeUndefined();
      }
      expect(mainnet['/']).toMatch(
        /Records sealed on this site are real records; licenses and lab agreements here are still simulated\./,
      );
      expect(mainnet['/']).toMatch(/Make a record/);
      expect(mainnet['/privacy']).toMatch(/Site privacy/);
      expect(mainnet['/privacy']).toMatch(/Once anchored, it is permanent: nobody, including us, can delete it\./);
      expect(mainnet['/privacy']).toMatch(
        /We can delete what our server holds for your records: email hunter@veilcore\.org/,
      );
      expect(mainnet['/licenses']).toMatch(/Simulated in this web app/);
      for (const p of ['/records', '/licenses', '/new']) expect(mainnet[p], p).toMatch(/Web app/);
      // The test-network site is still a demo, and says so.
      expect(preprod['/']).toMatch(/Try the demo/);
      expect(preprod['/privacy']).toMatch(/Use made-up data/);
    });

    it('a record anchored on Preview still shows as Preview, with its warning, on the mainnet site', () => {
      // The registry now answers priorPossession: false for it (only a mainnet anchor
      // counts), with anchored: true and the anchor's network; the page reads those.
      expect(mainnet[PREVIEW_RECORD]).toMatch(/anchored on Midnight Preview \(test network\)/);
      expect(mainnet[PREVIEW_RECORD]).toMatch(/A test network can be reset and its dates carry no evidential weight/);
      expect(mainnet[PREVIEW_RECORD]).not.toMatch(/Prior possession: not anchored yet/);
    });

    it('the mainnet site says main network, with the contract addresses', () => {
      expect(mainnet['/']).toMatch(
        /Now on Midnight's main network: we anchor records there in batches, by hand for now\./,
      );
      // Built from the real policy, approved by both founders on 7 October 2026.
      expect(mainnet['/']).toMatch(/Every use is announced publicly, under a written maintenance policy\./);
      expect(mainnet['/']).toMatch(/The claims contract has no maintenance key/);
      expect(mainnet['/']).toContain(DUMMY);
      expect(mainnet['/']).toContain(DUMMY_CLAIMS);
      expect(mainnet['/']).toMatch(/Main network/);
      expect(mainnet['/']).toMatch(/licenses and lab agreements are simulated/i);
      for (const p of ['/records', '/licenses', '/new']) {
        expect(mainnet[p], p).toMatch(/Main network/);
        expect(mainnet[p], p).toMatch(/Web app/);
      }
      expect(mainnet['/privacy']).toMatch(/Dated on Midnight's main network/);
      expect(mainnet['/licenses']).toMatch(/Simulated in this web app/);
      expect(mainnet['/verify/example']).toMatch(/Example: a made-up record\./);
      expect(mainnet['/verify/example']).toMatch(/Midnight’s main network/);
    });

    it('the preprod site still says test network', () => {
      expect(preprod['/']).toMatch(
        /Launching on Midnight's main network\. Today records are dated on a Midnight test network/,
      );
      expect(preprod['/']).not.toContain(DUMMY);
      for (const p of ['/records', '/licenses', '/new']) expect(preprod[p], p).toMatch(/Test network/);
      expect(preprod['/privacy']).toMatch(/Stored on our test server/);
    });
  });
});
