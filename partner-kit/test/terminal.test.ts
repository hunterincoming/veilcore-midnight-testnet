// The Blockfrost project id rides in the endpoint URLs, and the wallet SDK's node client
// prints that URL to stderr on every reconnect, past any logger (8 October 2026 review,
// pocs/client/blockfrost-id-leak.mjs). With a FAKE id and a local server that drops the
// connection: SeedWallet.create and connect() keep it off the terminal.
// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { SeedWallet } from '../src/wallet';
import { blockfrostMainnet, endpointsFor } from '../src/network';
import { scrubTerminal, scrubText, urlSecrets } from '../src/terminal';

const FAKE_ID = 'mainnetFAKEPROJECTID0000';

/** Everything written to stdout and stderr while `f` runs, as it would reach the terminal. */
const seen: string[] = [];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
beforeAll(() => {
  const capture = (c: unknown): boolean => (seen.push(Buffer.isBuffer(c) ? c.toString('utf8') : String(c)), true);
  process.stdout.write = capture;
  process.stderr.write = capture;
});
afterAll(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
});

describe('credentials in endpoint URLs', () => {
  it('are found in Blockfrost URLs (and in user:password parts)', () => {
    const e = blockfrostMainnet(FAKE_ID);
    expect(urlSecrets(Object.values(e))).toEqual([FAKE_ID]);
    expect(urlSecrets(['https://u:hunter2secret@host/x', 'not a url', undefined])).toEqual(['hunter2secret']);
    expect(urlSecrets(Object.values(endpointsFor('preview')))).toEqual([]);
    expect(urlSecrets(Object.values(endpointsFor('preprod', {}, { blockfrostProjectId: FAKE_ID })))).toEqual([FAKE_ID]);
  });

  it('SeedWallet.create with Blockfrost endpoints installs the scrubbing for its id', async () => {
    expect(scrubText(`x ${FAKE_ID}`)).toBe(`x ${FAKE_ID}`); // nothing given yet
    const endpoints = { ...blockfrostMainnet(FAKE_ID), proofServer: 'http://127.0.0.1:6300' };
    await SeedWallet.create({ network: 'mainnet', endpoints, seed: '5e'.repeat(32) }); // never started
    expect(scrubText(`disconnected from wss://rpc/?project_id=${FAKE_ID}`)).toBe(
      'disconnected from wss://rpc/?project_id=[redacted]',
    );
  });

  it('the node client reconnecting, in a real process: the id never reaches stderr (the PoC)', async () => {
    // vitest intercepts console in its workers, so the PoC runs as its own node process:
    // polkadot's WsProvider (the wallet SDK's node client) on a URL of the Blockfrost shape,
    // against a local server that drops the connection, after scrubTerminal.
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss.on('listening', r));
    wss.on('connection', (s) => setTimeout(() => s.close(1011, 'bye'), 50));
    const { port } = wss.address() as { port: number };
    const url = `ws://127.0.0.1:${port}/?project_id=${FAKE_ID}`;
    const terminal = new URL('../src/terminal.ts', import.meta.url).pathname;
    const script = `
      const { scrubTerminal, urlSecrets } = await import(${JSON.stringify(terminal)});
      const { WsProvider } = await import('@polkadot/rpc-provider');
      if (process.argv[1] === 'scrub') scrubTerminal(urlSecrets([${JSON.stringify(url)}]));
      const p = new WsProvider(${JSON.stringify(url)}, 300);
      await new Promise((r) => setTimeout(r, 1200));
      await p.disconnect().catch(() => {});
      process.exit(0);`;
    const run = (mode: string) =>
      new Promise<string>((resolve) => {
        const child = spawn(
          process.execPath,
          ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script, mode],
          { cwd: path.dirname(terminal) },
        );
        let err = '';
        child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
        child.stdout.on('data', (d: Buffer) => (err += d.toString('utf8')));
        child.on('exit', () => resolve(err));
      });
    try {
      expect(await run('plain')).toContain(FAKE_ID); // the leak, as the review found it
      const scrubbed = await run('scrub');
      expect(scrubbed).toMatch(/project_id=\[redacted\]/);
      expect(scrubbed).not.toContain(FAKE_ID);
    } finally {
      await new Promise((r) => wss.close(r));
    }
  });

  it('a credential is matched however a library writes it', () => {
    expect(scrubText(`url ?project_id=${FAKE_ID}`)).toBe('url ?project_id=[redacted]');
    process.stderr.write(Buffer.from(`as bytes: ${FAKE_ID}\n`));
    console.error('as console.error:', `wss://rpc.midnight-mainnet.blockfrost.io/?project_id=${FAKE_ID}`);
    expect(seen.join('')).not.toContain(FAKE_ID);
  });
});

// Verification review: a secret split across two writes reached the terminal whole.
describe('a secret split across writes', () => {
  it('is caught: the possible start of a secret waits for the next write', () => {
    scrubTerminal([FAKE_ID]); // installed already by SeedWallet.create above; this adds nothing new
    seen.length = 0;
    process.stderr.write('disconnected from wss://rpc/?project_id=mainnetFAKE');
    process.stderr.write(Buffer.from('PROJECTID0000: 1006\n'));
    const out = seen.join('');
    expect(out).not.toContain(FAKE_ID);
    expect(out).not.toContain('mainnetFAKE');
    expect(out).toBe('disconnected from wss://rpc/?project_id=[redacted]: 1006\n');
  });

  it('loses nothing: a held tail that never becomes a secret is written shortly after', async () => {
    seen.length = 0;
    process.stdout.write('a prompt ending like the id: mainnet');
    expect(seen.join('')).toBe('a prompt ending like the id: ');
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.join('')).toBe('a prompt ending like the id: mainnet');
    let called = false;
    process.stdout.write('mainnetF', () => (called = true));
    await new Promise((r) => setTimeout(r, 60));
    expect(called).toBe(true);
    expect(seen.join('')).toBe('a prompt ending like the id: mainnetmainnetF');
  });
});
