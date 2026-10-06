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
