// What the sponsor agrees to pay for. A pure function: transaction bytes in, accept or
// refuse (with the reason) out. Nothing here touches a wallet or the network.
//
// Fail closed: anything this cannot read, or reads and does not recognise, is refused.
// The sponsor only ever adds its own fee payment to a transaction the visitor's browser
// has already proven and sealed (bound). It never alters the visitor's part; the most it
// can do is decline to pay for it. So the questions are only "is this one of the few
// VeilCore calls we pay for, and nothing else?" and "is it still valid?".
//
// SPDX-License-Identifier: Apache-2.0

import { ContractCall, ContractDeploy, MaintenanceUpdate, Transaction } from '@midnight-ntwrk/ledger-v8';

/** The circuits a visitor may have paid for in phase 1. */
export const PHASE1_PUBLIC_CIRCUITS = ['anchor', 'proveOwnership', 'pairDna'] as const;

/**
 * Circuits the public endpoint never pays for, whatever the configuration says.
 * anchorBatch and sealRevocations are run by our own background job only.
 */
export const NEVER_PUBLIC = new Set(['anchorBatch', 'sealRevocations']);

export type PolicyConfig = {
  /** The VeilCore contract address on this network, hex, no 0x. */
  readonly contractAddress: string;
  /** Circuits the public endpoint pays for. */
  readonly allowedCircuits: ReadonlySet<string>;
  /** Largest transaction accepted, in bytes. */
  readonly maxBytes: number;
  /** Furthest ahead a transaction's expiry may be, in ms. */
  readonly maxTtlMs: number;
};

export type Refusal = {
  readonly ok: false;
  /** Stable machine code, for counters and tests. */
  readonly code:
    | 'empty'
    | 'too-large'
    | 'unreadable'
    | 'not-standard'
    | 'shielded-offer'
    | 'intent-count'
    | 'unshielded-offer'
    | 'dust-actions'
    | 'action-count'
    | 'deploy'
    | 'maintenance'
    | 'not-a-call'
    | 'wrong-contract'
    | 'circuit-not-allowed'
    | 'expired'
    | 'ttl-too-far';
  /** Plain words, safe to show the visitor. */
  readonly reason: string;
};

export type Acceptance = {
  readonly ok: true;
  readonly circuit: string;
  /** Identifiers of the visitor's transaction; any of them can be watched for. */
  readonly identifiers: readonly string[];
  readonly ttl: Date;
  readonly bytes: number;
};

export type Verdict = Acceptance | Refusal;

/** A sealed (bound), proven transaction, as the network accepts it. */
export type SealedTx = Transaction<
  import('@midnight-ntwrk/ledger-v8').SignatureEnabled,
  import('@midnight-ntwrk/ledger-v8').Proof,
  import('@midnight-ntwrk/ledger-v8').Binding
>;

/** Read bytes only as a proven, bound transaction. Anything else throws. */
export const readSealed = (bytes: Uint8Array): SealedTx =>
  Transaction.deserialize('signature', 'proof', 'binding', bytes);

const refuse = (code: Refusal['code'], reason: string): Refusal => ({ ok: false, code, reason });

const norm = (hex: string): string => hex.toLowerCase().replace(/^0x/, '');

const entryName = (ep: Uint8Array | string): string =>
  typeof ep === 'string' ? ep : new TextDecoder('utf-8', { fatal: false }).decode(ep);

/** True when a Zswap offer is present at all (any inputs, outputs or transients). */
const hasZswap = (o: unknown): boolean => o !== undefined && o !== null;

/**
 * Check a transaction the sponsor has been asked to pay for. Returns the parsed
 * transaction as well, so the caller pays for exactly what was checked.
 */
export const inspect = (
  bytes: Uint8Array,
  config: PolicyConfig,
  now: Date,
  read: (b: Uint8Array) => SealedTx = readSealed,
): { verdict: Verdict; tx?: SealedTx } => {
  if (bytes.length === 0) return { verdict: refuse('empty', 'No transaction was sent.') };
  if (bytes.length > config.maxBytes) {
    return { verdict: refuse('too-large', `The transaction is larger than ${config.maxBytes} bytes.`) };
  }

  let tx: SealedTx;
  try {
    tx = read(bytes);
  } catch {
    return {
      verdict: refuse('unreadable', 'That is not a proven, sealed transaction. It must be proved and bound before sending.'),
    };
  }

  try {
    const verdict = check(tx, bytes.length, config, now);
    return verdict.ok ? { verdict, tx } : { verdict };
  } catch {
    // A structure this code did not expect: refuse rather than guess.
    return { verdict: refuse('unreadable', 'The transaction could not be checked.') };
  }
};

const check = (tx: SealedTx, size: number, config: PolicyConfig, now: Date): Verdict => {
  if (tx.rewards !== undefined || tx.intents === undefined) {
    return refuse('not-standard', 'Only ordinary contract calls are paid for.');
  }
  if (hasZswap(tx.guaranteedOffer) || (tx.fallibleOffer !== undefined && tx.fallibleOffer.size > 0)) {
    return refuse('shielded-offer', 'The transaction moves shielded tokens. Only contract calls are paid for.');
  }
  if (tx.intents.size !== 1) {
    return refuse('intent-count', 'The transaction must contain exactly one part.');
  }
  const [intent] = [...tx.intents.values()];
  if (intent.guaranteedUnshieldedOffer !== undefined || intent.fallibleUnshieldedOffer !== undefined) {
    return refuse('unshielded-offer', 'The transaction moves unshielded tokens. Only contract calls are paid for.');
  }
  if (intent.dustActions !== undefined) {
    return refuse('dust-actions', 'The transaction carries its own fee actions; the sponsor adds those itself.');
  }
  if (intent.actions.length !== 1) {
    return refuse('action-count', 'The transaction must contain exactly one contract call.');
  }
  const action = intent.actions[0];
  if (action instanceof ContractDeploy) return refuse('deploy', 'Deploying a contract is never paid for.');
  if (action instanceof MaintenanceUpdate) return refuse('maintenance', 'Contract maintenance is never paid for.');
  if (!(action instanceof ContractCall)) return refuse('not-a-call', 'Only contract calls are paid for.');

  if (norm(action.address) !== norm(config.contractAddress)) {
    return refuse('wrong-contract', 'That call is not on the VeilCore contract.');
  }
  const circuit = entryName(action.entryPoint);
  if (NEVER_PUBLIC.has(circuit) || !config.allowedCircuits.has(circuit)) {
    return refuse('circuit-not-allowed', `The sponsor does not pay for "${circuit.slice(0, 40)}".`);
  }

  const ttl = intent.ttl;
  if (!(ttl instanceof Date) || Number.isNaN(ttl.getTime()) || ttl.getTime() <= now.getTime()) {
    return refuse('expired', 'The transaction has already expired. Try again.');
  }
  if (ttl.getTime() - now.getTime() > config.maxTtlMs) {
    return refuse('ttl-too-far', 'The transaction expires too far in the future.');
  }

  return { ok: true, circuit, identifiers: tx.identifiers(), ttl, bytes: size };
};

/** Validate an allow-list from configuration: never one of the job-only circuits. */
export const allowList = (names: readonly string[]): ReadonlySet<string> => {
  for (const n of names) {
    if (NEVER_PUBLIC.has(n)) throw new Error(`"${n}" is run by the anchoring job only and can never be public.`);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(n)) throw new Error(`"${n}" is not a circuit name.`);
  }
  return new Set(names);
};
