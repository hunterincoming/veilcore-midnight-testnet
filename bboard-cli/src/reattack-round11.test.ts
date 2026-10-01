// Independent re-attack of the round 11 CLI fixes. A passing test is a demonstrated
// finding (or, where named HELD, a fix that held).
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import pino from 'pino';
import { ChallengeFile } from './challenge-file';
import { redactThisSession, scrub } from './logger-utils';
import { createPrompt } from './prompt';

const PW = 'Correct-Horse-Battery-9!';

describe('ChallengeBook persistence', () => {
  it('two CLI runs open at once: a challenge one run used stays used for the other', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ch-'));
    // Run A starts and issues a challenge.
    const fileA = new ChallengeFile('preview', PW, dir);
    const bookA = (await fileA.load()).book;
    const ch = bookA.issue('ownership').challenge;
    await fileA.save(bookA);

    // Run B is started in a second terminal (it loads ch as issued, unused).
    const fileB = new ChallengeFile('preview', PW, dir);
    const bookB = (await fileB.load()).book;
    expect(bookB.check(ch, 'ownership').ok).toBe(true);

    // Run A accepts the proof and consumes ch (useUp in index.ts), saving the file.
    expect((await fileA.consume(bookA, ch, 'ownership')).ok).toBe(true);
    expect((await new ChallengeFile('preview', PW, dir).load()).book.check(ch, 'ownership').ok).toBe(false);

    // Run B does anything that saves (option 26 issues a new challenge): its stale book
    // overwrites the file.
    bookB.issue('licence');
    await fileB.save(bookB);

    // The save merged what was on disk: a later run refuses ch.
    const later = (await new ChallengeFile('preview', PW, dir).load()).book;
    expect(later.check(ch, 'ownership').ok).toBe(false);
    // Run B refuses it too, through the same locked consume index.ts uses.
    expect((await fileB.consume(bookB, ch, 'ownership')).ok).toBe(false);
  });
});

describe('ChallengeBook persistence, at the same moment', () => {
  it('two runs consuming one challenge at once: exactly one is accepted', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-ch-'));
    const fileA = new ChallengeFile('preview', PW, dir);
    const bookA = (await fileA.load()).book;
    const ch = bookA.issue('licence').challenge;
    await fileA.save(bookA);
    const fileB = new ChallengeFile('preview', PW, dir);
    const bookB = (await fileB.load()).book;
    const [a, b] = await Promise.all([fileA.consume(bookA, ch, 'licence'), fileB.consume(bookB, ch, 'licence')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe('log scrubber', () => {
  it('a typed password containing " or \\ is redacted from pino output (JSON escaping)', () => {
    const pw = 'Abc"defg\\hij12345';
    redactThisSession(pw);
    const lines: string[] = [];
    const logger = pino({}, { write: (l: string) => void lines.push(scrub(l)) });
    logger.error(`open failed for password ${pw}`);
    expect(lines[0]).toContain('[redacted]');
    expect(lines[0]).not.toContain('hij12345');
  });

  it('HELD: a 64-hex secret is redacted in either case and inside longer text', () => {
    const k = 'ab'.repeat(32);
    redactThisSession(k);
    expect(scrub(`x${k.toUpperCase()}y`)).toBe('x[redacted]y');
  });
});

describe('hidden prompt', () => {
  const harness = () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: () => void };
    let shown = '';
    const out = new Writable({
      write(c, _e, d) {
        shown += c.toString();
        d();
      },
    }) as unknown as NodeJS.WriteStream;
    const p = createPrompt(input, out);
    return { input, p, shown: () => shown };
  };

  it('HELD: menu answers still work around a hidden answer, and the hidden one is not echoed', async () => {
    const { input, p, shown } = harness();
    const q1 = p.rli.question('Menu: ');
    input.write('4\r');
    expect(await q1).toBe('4');
    const h = p.askHidden('Secret: ');
    input.write('ab'.repeat(32) + '\r');
    expect(await h).toBe('ab'.repeat(32));
    const q2 = p.rli.question('Menu: ');
    input.write('7\r');
    expect(await q2).toBe('7');
    expect(shown()).not.toContain('abab');
    p.rli.close();
  });
});
