// The browser prover uses only the key and circuit files VeilCore published.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchesFingerprint } from './zk-material';

const ZKIR = resolve(import.meta.dirname, '..', '..', '..', '..', 'contract', 'src', 'managed', 'veilcore', 'zkir');

describe('proving files are checked against the published fingerprints', () => {
  it('accepts the published circuit, byte for byte', () => {
    for (const c of ['anchor', 'proveOwnership', 'pairDna']) {
      expect(matchesFingerprint(`zkir/${c}.zkir`, readFileSync(resolve(ZKIR, `${c}.zkir`)))).toBe(true);
    }
  });

  it('refuses a changed byte, the wrong circuit, and a name with no fingerprint', () => {
    const anchor = new Uint8Array(readFileSync(resolve(ZKIR, 'anchor.zkir')));
    const changed = anchor.slice();
    changed[changed.length - 2] ^= 1;
    expect(matchesFingerprint('zkir/anchor.zkir', changed)).toBe(false);
    expect(matchesFingerprint('zkir/pairDna.zkir', anchor)).toBe(false);
    expect(matchesFingerprint('zkir/nothing.zkir', anchor)).toBe(false);
  });
});
