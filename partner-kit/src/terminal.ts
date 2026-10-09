// Keeping secrets off the terminal when a library prints them past every logger.
// SPDX-License-Identifier: Apache-2.0
//
// The wallet SDK's node client (polkadot's WsProvider) prints "disconnected from
// wss://…?project_id=<id>" through console.error on every reconnect. With Blockfrost
// endpoints (blockfrostMainnet) that URL carries the project id, so it reached stderr,
// and any log collector reading it, whatever logger the partner configured (8 October
// 2026 review). The VeilCore CLI scrubs the terminal for the same reason
// (bboard-cli/src/logger-utils.ts, scrubTerminal); this is the kit's version.
//
// scrubTerminal wraps process.stdout.write and process.stderr.write once, for the life of
// the process, and replaces every secret given to it, now or later, with [redacted]. Hex
// secrets are matched in any case. SeedWallet.create and connect() call it with the
// secret parts of any endpoint URL; pass `scrubTerminal: false` to either to opt out.

const secrets = new Set<string>();
let installed = false;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` with every secret given to scrubTerminal replaced by [redacted]. */
export const scrubText = (text: string): string => {
  let out = text;
  for (const s of secrets) {
    const hex = /^[0-9a-fA-F]+$/.test(s);
    out = out.replace(new RegExp(escape(s), hex ? 'gi' : 'g'), '[redacted]');
  }
  return out;
};

/** Query parameters that carry a credential in a provider's URL (Blockfrost: project_id). */
const SECRET_PARAMS = /^(project_?id|api_?key|apikey|key|token|access_?token|auth|secret)$/i;

/** The credential values carried in these URLs' query strings (and user:password parts). */
export const urlSecrets = (urls: readonly (string | undefined)[]): string[] => {
  const found = new Set<string>();
  for (const u of urls) {
    if (u === undefined) continue;
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      continue;
    }
    for (const [k, v] of url.searchParams) if (SECRET_PARAMS.test(k) && v !== '') found.add(v);
    if (url.password !== '') found.add(decodeURIComponent(url.password));
  }
  return [...found];
};

/**
 * Replace `values` with [redacted] in everything this process writes to stdout and stderr
 * from now on, by any code. Values shorter than 8 characters are ignored (they would
 * redact ordinary text). Safe to call again: later values are added.
 */
export const scrubTerminal = (values: readonly (string | undefined)[]): void => {
  for (const v of values) {
    const t = v?.trim();
    if (t === undefined || t.length < 8) continue;
    secrets.add(t);
    const enc = encodeURIComponent(t);
    if (enc !== t) secrets.add(enc);
  }
  if (installed || secrets.size === 0) return;
  installed = true;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    stream.write = (chunk: unknown, ...rest: unknown[]): boolean => {
      if (typeof chunk === 'string') return write(scrubText(chunk), ...rest);
      if (chunk instanceof Uint8Array) {
        const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        const text = bytes.toString('utf8');
        // Only a chunk that is whole UTF-8 is rewritten; one cut mid-character passes as is.
        if (Buffer.from(text, 'utf8').equals(bytes)) return write(scrubText(text), ...rest);
      }
      return write(chunk, ...rest);
    };
  }
};
