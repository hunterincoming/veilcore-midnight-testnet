// One JSON line per event on stdout. Never a request body, a transaction, a ticket, an
// address or a secret: counters and outcomes only.
// SPDX-License-Identifier: Apache-2.0

export type Level = 'info' | 'warn' | 'error';

export const log = (level: Level, msg: string, extra: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  if (level === 'error') console.error(line);
  else console.log(line);
};

/**
 * Keep values out of everything this process writes to stdout and stderr: this log, and
 * libraries that print on their own (the wallet SDK prints its node URL, with the
 * Blockfrost project id in it, on every reconnect). Called once at start-up.
 */
type Writable = { write: (...a: never[]) => boolean };

export const scrubOutput = (
  secrets: readonly string[],
  streams: readonly Writable[] = [process.stdout, process.stderr],
): void => {
  const list = secrets.filter((x) => x.length >= 8);
  if (list.length === 0) return;
  const clean = (chunk: unknown): unknown => {
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) return chunk;
    let text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    for (const x of list) text = text.split(x).join('[redacted]').split(encodeURIComponent(x)).join('[redacted]');
    return text;
  };
  for (const stream of streams) {
    const write = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => write(clean(chunk), ...rest)) as typeof stream.write;
  }
};
