// The verifier's side of "prove you hold it" (design.md, verifier rule 8).
//
// 1. The verifier makes a challenge here: 32 fresh random bytes, kept in this tab, used once.
// 2. The holder answers it from their own browser (proveOwnership), and sends back the
//    transaction id.
// 3. This page looks that transaction up on the network: it must have succeeded and be a
//    single proveOwnership call on the demo contract. In the contract state right after
//    it, the proof must answer THIS challenge and come from the record's identity, which
//    must be anchored and still live. Nothing here takes the holder's word.
//
// What it shows: whoever answered holds the secret of that on-chain identity now. With
// the identity's anchor transaction, it shows they have held it since that block. The
// link between the identity and this record's content is the holder's statement until
// the sealed record format carries the identity.
//
// Step 3 is the partner kit's own checkOwnership (partner-kit/src/verify.ts), the one
// labs and registries call: the website judges an answer exactly as a partner would.
// It is imported from its module, not from the package: the package's entry also loads
// the kit's Node-only parts (files, wallet, encrypted private state). What this file adds
// is the tab's challenge book (made here, used once).
// SPDX-License-Identifier: Apache-2.0

import { ledger } from '../../../../contract/src/managed/veilcore/contract/index.js';
import { acceptOwnership } from '../../../../contract/src/verify';
import { callState } from '../../../../api/src/presentation-lookup';
import { checkOwnership as kitCheckOwnership } from '../../../../partner-kit/src/verify';
import { NETWORK } from '../../config/network';
import { CHAIN_CONTRACT, INDEXER_HTTP } from './config';

const BOOK = 'veilcore.verifier-challenges.v1';
const LIFETIME_MS = 24 * 60 * 60_000;

type Book = Record<string, { issuedAt: number; used?: boolean }>;

const read = (): Book => {
  try {
    const raw = sessionStorage.getItem(BOOK);
    return raw ? (JSON.parse(raw) as Book) : {};
  } catch {
    return {};
  }
};
const write = (b: Book): void => {
  try {
    sessionStorage.setItem(BOOK, JSON.stringify(b));
  } catch {
    /* private mode: the challenge works for this page only */
  }
};
const memory: Book = {};

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** A fresh challenge, remembered by this tab. */
export const newChallenge = (now = Date.now()): string => {
  const c = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const book = { ...read(), [c]: { issuedAt: now } };
  for (const [k, v] of Object.entries(book)) if (now - v.issuedAt > LIFETIME_MS) delete book[k];
  memory[c] = { issuedAt: now };
  write(book);
  return c;
};

const lookupChallenge = (c: string) => read()[c] ?? memory[c];
const useChallenge = (c: string): void => {
  memory[c] = { ...(memory[c] ?? { issuedAt: Date.now() }), used: true };
  const b = read();
  if (b[c]) {
    b[c] = { ...b[c], used: true };
    write(b);
  }
};

export type OwnershipVerdict = { readonly accepted: boolean; readonly reason: string };

export type CheckDeps = {
  /**
   * Tests: judge the answer from these states instead of asking the network. Without
   * them the partner kit's checkOwnership asks the indexer.
   */
  readonly stateAfter?: (txId: string, entryPoint: string) => Promise<ReturnType<typeof ledger>>;
  readonly latest?: () => Promise<ReturnType<typeof ledger>>;
};

const defaultStateAfter = (txId: string, entryPoint: string) =>
  callState(INDEXER_HTTP ?? '', CHAIN_CONTRACT ?? '', txId, entryPoint);

const onNetwork = async (txId: string, identity: string, challenge: string): Promise<OwnershipVerdict> => {
  const v = await kitCheckOwnership({
    network: NETWORK,
    indexer: INDEXER_HTTP,
    address: CHAIN_CONTRACT,
    txId,
    record: hexToBytes(identity),
    challenge: hexToBytes(challenge),
  });
  return { accepted: v.accepted, reason: v.reason };
};

const fromStates = async (
  deps: Required<CheckDeps>,
  txId: string,
  identity: string,
  challenge: string,
): Promise<OwnershipVerdict> =>
  acceptOwnership(
    await deps.stateAfter(txId, 'proveOwnership'),
    hexToBytes(identity),
    hexToBytes(challenge),
    await deps.latest(),
  );

/** Check a holder's answer to this tab's challenge. */
export const checkOwnership = async (
  input: { txId: string; identity: string; challenge: string },
  deps: CheckDeps = {},
): Promise<OwnershipVerdict> => {
  const challenge = input.challenge.trim().toLowerCase();
  const identity = input.identity.trim().toLowerCase();
  const txId = input.txId.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(identity))
    return { accepted: false, reason: 'This record has no on-chain identity to check.' };
  const issued = lookupChallenge(challenge);
  if (!issued) return { accepted: false, reason: 'This page did not make that challenge. Make a new one and send it.' };
  if (issued.used) return { accepted: false, reason: 'That challenge was already answered once. Make a new one.' };
  if (!/^[0-9a-f]+$/.test(txId)) return { accepted: false, reason: 'That is not a transaction id.' };

  let v: OwnershipVerdict;
  try {
    v =
      deps.stateAfter && deps.latest
        ? await fromStates({ stateAfter: deps.stateAfter, latest: deps.latest }, txId, identity, challenge)
        : await onNetwork(txId, identity, challenge);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      accepted: false,
      reason: /Failed to fetch|NetworkError|Load failed|timed? ?out|aborted/i.test(msg)
        ? 'could not reach the Midnight network’s indexer; try again in a few minutes'
        : msg,
    };
  }
  if (v.accepted) useChallenge(challenge);
  return v;
};

/** Check that a transaction anchored this identity: the state right after it names it. */
export const checkAnchor = async (txId: string, identity: string, deps: CheckDeps = {}): Promise<boolean> => {
  try {
    const after = await (deps.stateAfter ?? defaultStateAfter)(txId.trim().toLowerCase().replace(/^0x/, ''), 'anchor');
    const got = Array.from(after.lastAnchor, (b) => b.toString(16).padStart(2, '0')).join('');
    return got === identity.toLowerCase() && after.recoveryOf.member(after.lastAnchor);
  } catch {
    return false;
  }
};
