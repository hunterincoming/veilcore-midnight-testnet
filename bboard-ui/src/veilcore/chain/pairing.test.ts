// The browser's bound pairing is the contract module's, byte for byte: the published
// vector, random inputs against contract/src/pairing.ts, and an evidence file the
// command-line and partner-kit reader accepts.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as node from '../../../../contract/src/pairing';
import { dnaPairBinding, isWeakSalt, newPairingSalt, pairingEvidence } from './pairing';

const hex = (n = 32) => randomBytes(n).toString('hex');

describe('bound pairing in the browser', () => {
  it('matches the published vector (veilcore-sdk conformance/vectors.json, pairings)', () => {
    expect(
      dnaPairBinding(
        '18bc28bc2feb83c05c28cc04bdda0aab7d88f668c329f7c8ae19574a79c67e8e',
        '80ffc834e847d281ceba9a196e5643e68bbd9951b81cc81892035b5bd748930b',
        '1c2a98a182af6fee2dece33938396d45bd76b72c869ef8f4af6b8af975be02b1',
      ),
    ).toBe('d58e4e9a8c031f45dda92d0e934a782807c2f477a6738916e26e8bb432d3dc43');
  });

  it('agrees with contract/src/pairing.ts on random inputs', () => {
    for (let i = 0; i < 50; i++) {
      const [r, id, s] = [hex(), hex(), hex()];
      const theirs = Buffer.from(
        node.dnaPairBinding(Buffer.from(r, 'hex'), Buffer.from(id, 'hex'), Buffer.from(s, 'hex')),
      ).toString('hex');
      expect(dnaPairBinding(r, id, s)).toBe(theirs);
    }
  });

  it('refuses anything that is not 64 lowercase hex', () => {
    expect(() => dnaPairBinding('AB'.repeat(32), hex(), hex())).toThrow(/lowercase hex/);
    expect(() => dnaPairBinding(hex(), hex(31), hex())).toThrow(/identity/);
  });

  it('salts are fresh and never one byte repeated', () => {
    const a = newPairingSalt();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newPairingSalt()).not.toBe(a);
    expect(isWeakSalt(new Uint8Array(32))).toBe(true);
    expect(isWeakSalt(new Uint8Array(32).fill(9))).toBe(true);
  });

  it('writes an evidence file the shared reader accepts, and a bad file name is left out', () => {
    const ev = pairingEvidence({
      network: 'preprod',
      contractAddress: 'C0'.repeat(32),
      txId: '0x' + hex(),
      identity: hex(),
      reportSha256: hex(),
      salt: newPairingSalt(),
      reportFile: 'report.pdf',
    });
    const read = node.readPairingEvidence(JSON.stringify(ev));
    expect(Buffer.from(read.salt).toString('hex')).toBe(ev.salt);
    expect(read.reportFile).toBe('report.pdf');
    expect(ev.contractAddress).toBe('c0'.repeat(32));
    expect(ev.txId).not.toMatch(/^0x/);
    const odd = pairingEvidence({ ...ev, identity: ev.record, reportFile: '../etc/passwd' });
    expect(odd.reportFile).toBeUndefined();
    expect(() => node.readPairingEvidence(JSON.stringify(odd))).not.toThrow();
  });
});
