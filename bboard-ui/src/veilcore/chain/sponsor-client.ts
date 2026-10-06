// Talking to the sponsor service, which pays the network fee for a sealed transaction.
// It is sent only the sealed transaction (what the chain would publish anyway), a proof
// of work, and a sponsor ticket: a random token made for this and nothing else. Never
// the holder key: that would let one log join this holder's records to an on-chain
// identity. Never a secret.
// SPDX-License-Identifier: Apache-2.0

import { SPONSOR_URL } from './config';

const TICKET_KEY = 'veilcore.sponsor-ticket.v1';

const randomHex = (n: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

/** This browser's sponsor ticket, made on first use. */
export const sponsorTicket = (): string => {
  try {
    let t = localStorage.getItem(TICKET_KEY);
    if (!t || !/^[0-9a-f]{32,64}$/.test(t)) {
      t = randomHex(16);
      localStorage.setItem(TICKET_KEY, t);
    }
    return t;
  } catch {
    return randomHex(16);
  }
};

export class SponsorRefusal extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'SponsorRefusal';
  }
}

const base = (): string => {
  if (!SPONSOR_URL) throw new SponsorRefusal('No sponsor service is configured.', 'not-configured', 0);
  return SPONSOR_URL;
};

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export type SponsorStatus = { synced?: boolean; accepting?: boolean; queueDepth?: number };

export const sponsorStatus = async (fetchFn: typeof fetch = fetch): Promise<SponsorStatus | undefined> => {
  try {
    const r = await fetchFn(`${base()}/sponsor/status`, { signal: AbortSignal.timeout(8000) });
    return r.ok ? ((await r.json()) as SponsorStatus) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Send a sealed transaction to the sponsor. `pow` does the proof of work (in the
 * proving worker). Resolves with the network's transaction id.
 */
export const sendToSponsor = async (
  sealed: Uint8Array,
  pow: (challenge: string, tx: Uint8Array, difficulty: number) => Promise<string>,
  fetchFn: typeof fetch = fetch,
): Promise<{ txId: string }> => {
  const ch = await fetchFn(`${base()}/sponsor/challenge`, { signal: AbortSignal.timeout(15_000) });
  if (!ch.ok)
    throw new SponsorRefusal('The sponsor is not answering. Try again in a few minutes.', 'unreachable', ch.status);
  const { challenge, difficulty } = (await ch.json()) as { challenge: string; difficulty: number };
  const nonce = await pow(challenge, sealed, difficulty);
  const res = await fetchFn(`${base()}/sponsor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx: b64(sealed), ticket: sponsorTicket(), challenge, nonce }),
    signal: AbortSignal.timeout(180_000),
  });
  let body: { ok?: boolean; txId?: string; reason?: string; code?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  if (!res.ok || body.ok !== true || typeof body.txId !== 'string') {
    const retry = Number(res.headers.get('retry-after') ?? '') || undefined;
    throw new SponsorRefusal(
      body.reason ?? `The sponsor answered ${res.status}.`,
      body.code ?? 'error',
      res.status,
      retry,
    );
  }
  return { txId: body.txId };
};
