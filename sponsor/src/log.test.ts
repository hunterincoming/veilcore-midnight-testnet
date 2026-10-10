import { describe, expect, it } from 'vitest';
import { scrubOutput } from './log.js';

describe('output scrubbing', () => {
  it('removes the Blockfrost project id from everything written, plain or URL-encoded, text or bytes', () => {
    const out: string[] = [];
    const stream = { write: (chunk: unknown) => (out.push(String(chunk)), true) };
    scrubOutput(['preprodSecretId123'], [stream as never]);
    stream.write('reconnecting to wss://rpc.midnight-preprod.blockfrost.io/?project_id=preprodSecretId123\n' as never);
    stream.write(Buffer.from('id=preprodSecretId123') as never);
    expect(out.join('')).not.toContain('preprodSecretId123');
    expect(out[0]).toContain('project_id=[redacted]');
  });

  it('does nothing with no secret, or one too short to be one', () => {
    const stream = { write: (chunk: unknown) => Boolean(chunk) };
    const before = stream.write;
    scrubOutput(['short'], [stream as never]);
    expect(stream.write).toBe(before);
  });
});
