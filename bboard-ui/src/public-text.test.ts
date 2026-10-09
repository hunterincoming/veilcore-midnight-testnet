// What the public pages print: holder-typed names cleaned and capped, times in UTC.
// Run: npx vitest run src/public-text.test.ts
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayName, MAX_NAME_CHARS } from './veilcore/display-name';
import { utcDate, utcStamp } from './veilcore/time';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('displayName', () => {
  it('drops check marks, emoji, bidi and control characters, keeps letters in any script', () => {
    expect(displayName('✅ Verified‮ by USDA ✔️\u{1F389}')).toBe('Verified by USDA');
    expect(displayName('☑ Lab approved √ ✓')).toBe('Lab approved');
    expect(displayName('Blue​ Dream\u0007\nKush')).toBe('Blue Dream Kush');
    expect(displayName('コシヒカリ 2号')).toBe('コシヒカリ 2号');
    expect(displayName('Gorilla Glue® ™ ©')).toBe('Gorilla Glue® ™ ©');
    expect(displayName(undefined)).toBe('');
    expect(displayName('✅✅')).toBe('');
  });
  it('caps the length', () => {
    const out = displayName('x'.repeat(500));
    expect(Array.from(out).length).toBe(MAX_NAME_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('times', () => {
  it('print UTC and say so', () => {
    expect(utcStamp(Date.UTC(2020, 0, 1, 0, 0))).toBe('2020-01-01 00:00 UTC');
    expect(utcStamp('2026-10-08T23:59:30-04:00')).toBe('2026-10-09 03:59 UTC');
    expect(utcDate(Date.UTC(2020, 0, 1, 23, 0))).toBe('2020-01-01 (UTC)');
    expect(utcStamp('not a date')).toBe('an unknown time');
  });
});

describe('public files', () => {
  it('robots.txt allows everything and names nothing', () => {
    const robots = fs.readFileSync(path.resolve(HERE, '../public/robots.txt'), 'utf8');
    expect(robots).toBe('User-agent: *\nAllow: /\n');
  });
});
