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
// secrets are matched in any case. A secret split across two writes is caught too: the
// end of a write that could be the start of a secret is held back until the next write
// (or at most HOLD_MS, or the process's exit) shows whether it is. SeedWallet.create and
// connect() call it with the secret parts of any endpoint URL; pass
// `scrubTerminal: false` to either to opt out.
//
// What it does NOT cover: anything written to file descriptors 1 and 2 without going
// through process.stdout / process.stderr. pino's default destination (sonic-boom) does
// exactly that, so a pino logger given these URLs prints them unredacted: give such a
// logger its own redaction, or a destination that writes through process.stdout.

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

/** How long the possible start of a secret is held back before it is written as it is. */
const HOLD_MS = 25;

/**
 * How many characters at the end of `text` could be the start of a secret, and so must
 * wait for the next write before they are known to be harmless.
 */
const heldTail = (text: string): number => {
  let keep = 0;
  for (const s of secrets) {
    const hex = /^[0-9a-fA-F]+$/.test(s);
    const want = hex ? s.toLowerCase() : s;
    for (let k = Math.min(s.length - 1, text.length); k > keep; k--) {
      const tail = text.slice(text.length - k);
      if ((hex ? tail.toLowerCase() : tail) === want.slice(0, k)) {
        keep = k;
        break;
      }
    }
  }
  return keep;
};

/**
 * Replace `values` with [redacted] in everything written through process.stdout and
 * process.stderr from now on, by any code (console included; not a writer that goes to
 * file descriptors 1 and 2 directly, such as pino's default destination). Values shorter
 * than 8 characters are ignored (they would redact ordinary text). Safe to call again:
 * later values are added.
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
    let pending = '';
    let timer: NodeJS.Timeout | undefined;
    const flush = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (pending === '') return;
      const p = pending;
      pending = '';
      write(scrubText(p));
    };
    process.once('exit', flush);
    stream.write = (chunk: unknown, ...rest: unknown[]): boolean => {
      const cb = typeof rest[rest.length - 1] === 'function' ? (rest.pop() as () => void) : undefined;
      const encoding = typeof rest[0] === 'string' ? rest[0].toLowerCase() : undefined;
      let text: string | undefined;
      if (typeof chunk === 'string' && (encoding === undefined || encoding === 'utf8' || encoding === 'utf-8'))
        text = chunk;
      else if (chunk instanceof Uint8Array) {
        const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        const decoded = bytes.toString('utf8');
        // Only a chunk that is whole UTF-8 is rewritten; one cut mid-character passes as is.
        if (Buffer.from(decoded, 'utf8').equals(bytes)) text = decoded;
      }
      if (text === undefined) {
        flush();
        return cb === undefined ? write(chunk, ...rest) : write(chunk, ...rest, cb);
      }
      const all = scrubText(pending + text);
      const keep = heldTail(all);
      pending = all.slice(all.length - keep);
      const out = all.slice(0, all.length - keep);
      if (timer !== undefined) clearTimeout(timer);
      timer = pending === '' ? undefined : setTimeout(flush, HOLD_MS).unref();
      if (out !== '') return cb === undefined ? write(out) : write(out, cb);
      if (cb !== undefined) process.nextTick(cb);
      return true;
    };
  }
};
