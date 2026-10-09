// The three real calls the demo makes, from this browser, paid for by the sponsor:
//   anchor          create the record's on-chain identity, commit(recordSecret), with a
//                   recovery commitment fixed now
//   proveOwnership  show, to the verifier who chose the challenge, that this browser holds
//                   the record secret of an anchored identity
//   pairDna         date a bound pairing of a DNA report against that identity (the binding
//                   from chain/pairing.ts, never the report's fingerprint)
//
// Each call: run the circuit here against the contract's current state (it refuses here,
// before anything is sent, if the contract would), prove it in the worker, seal it, hand
// it to the sponsor, then wait for the network to include it.
// SPDX-License-Identifier: Apache-2.0

import { createUnprovenCallTx, submitTxAsync } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { NETWORK } from '../../config/network';
import { CompiledVeilcore, PROVABLE_CIRCUITS } from '../../../../contract/src/veilcore';
import { createVeilcorePrivateState } from '../../../../contract/src/witnesses';
import { recoveryCommitmentOf } from './identity';
import { CHAIN_CONTRACT, chainNotReady, type BrowserCircuit } from './config';
import { makeProviders, PRIVATE_STATE_ID, type Hooks } from './providers';
import { setProverProgress } from './prover';
import { browserCallDeps, type CallDeps } from './prover-choice';

export type ChainReceipt = {
  readonly circuit: BrowserCircuit;
  readonly txId: string;
  readonly txHash: string;
  readonly blockHeight: number;
  /** Block time (ms), the chain's own clock. */
  readonly blockTime?: number;
};

const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('Expected 32 bytes of hex.');
  return Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
};
export { identityOf, recoveryCommitmentOf, toHex } from './identity';

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const operationName = (o: string | Uint8Array): string => (typeof o === 'string' ? o : new TextDecoder().decode(o));

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);

const NETWORK_TROUBLE = /Failed to fetch|NetworkError|Load failed|ERR_[A-Z_]+|ECONNREFUSED|ENOTFOUND|fetch failed/i;

/** Say plainly whether anything was sent, whatever went wrong. */
const plainError = (e: unknown, sentAs: string | undefined): Error => {
  const msg = e instanceof Error ? e.message : String(e);
  if (sentAs !== undefined && !msg.includes(sentAs)) {
    return new Error(
      `${NETWORK_TROUBLE.test(msg) ? 'Lost contact with the network' : msg}. The transaction WAS sent (${sentAs}); ` +
        'check it on the network before trying again.',
      { cause: e },
    );
  }
  if (NETWORK_TROUBLE.test(msg)) {
    return new Error(
      'Could not reach the Midnight network or the sponsor. Nothing was sent. Try again in a few minutes.',
      {
        cause: e,
      },
    );
  }
  return e instanceof Error ? e : new Error(msg);
};

export type CallOptions = {
  readonly progress?: (msg: string) => void;
  readonly deps?: CallDeps;
  /** Tests: see the sealed bytes. */
  readonly onSealed?: (bytes: Uint8Array) => void;
  /** How long to wait for the network to include the call. */
  readonly landingTimeoutMs?: number;
};

const call = async (
  circuit: BrowserCircuit,
  args: Uint8Array[],
  recordSecret: Uint8Array,
  opts: CallOptions,
): Promise<ChainReceipt> => {
  const why = chainNotReady();
  if (why && !opts.deps) throw new Error(why);
  // The Midnight libraries serialise for one network; set it here, only when a call is made.
  setNetworkId(NETWORK);
  const contractAddress = CHAIN_CONTRACT ?? '';
  const progress = opts.progress ?? (() => undefined);
  let sentAs: string | undefined;
  const hooks: Hooks = { progress, onSealed: opts.onSealed, onSent: (id) => (sentAs = id) };
  const deps = opts.deps ?? browserCallDeps();
  const providers = makeProviders(`veilcore-zk-${contractAddress.slice(0, 16)}`, hooks, deps);

  providers.privateStateProvider.setContractAddress(contractAddress);
  setProverProgress(progress);
  try {
    progress('Reading the contract from the network…');
    const state = await withTimeout(
      providers.publicDataProvider.queryContractState(contractAddress),
      45_000,
      'Could not reach the Midnight network’s indexer. Nothing was sent. Try again in a few minutes.',
    );
    if (!state) throw new Error('The demo contract was not found on the network.');
    // Refuse a contract carrying a circuit this build does not know (the same guard the
    // operator tool uses when joining): one added by maintenance would otherwise pass.
    const onChain = state.operations().map(operationName);
    const extra = onChain.filter((c) => !PROVABLE_CIRCUITS.includes(c));
    if (extra.length > 0 || !onChain.includes(circuit)) {
      throw new Error('The contract on the network is not the one this site was built for. Nothing was sent.');
    }

    // The proving files this site serves must be the contract's own: otherwise the proof is
    // made (a minute on a phone) and then refused. Compared before anything is proven.
    progress('Checking this site’s proving files against the contract…');
    const served = await providers.zkConfigProvider.getVerifierKey(circuit);
    const onChainKey = state.operation(circuit)?.verifierKey;
    if (!onChainKey || !sameBytes(served, onChainKey)) {
      throw new Error('This site’s proving files are not the ones the contract on the network uses. Nothing was sent.');
    }

    await providers.privateStateProvider.set(PRIVATE_STATE_ID, createVeilcorePrivateState(recordSecret));

    progress('Preparing the transaction on your device…');
    const unproven = await createUnprovenCallTx(
      providers as never,
      {
        compiledContract: CompiledVeilcore,
        contractAddress,
        circuitId: circuit,
        args,
        privateStateId: PRIVATE_STATE_ID,
      } as never,
    );

    progress('Proving on your device. This can take a minute on a phone…');
    const txId = await submitTxAsync(providers as never, {
      unprovenTx: unproven.private.unprovenTx,
      circuitId: circuit,
    });

    progress('Waiting for the network to include it (usually under a minute)…');
    const fin = await withTimeout(
      providers.publicDataProvider.watchForTxData(txId),
      opts.landingTimeoutMs ?? 5 * 60_000,
      `Sent, but not seen on the network yet. Transaction ${txId}: check it again in a few minutes before trying again.`,
    );
    if (fin.status !== SucceedEntirely) {
      throw new Error(`The network included the call but it did not succeed (${String(fin.status)}).`);
    }
    return { circuit, txId, txHash: fin.txHash, blockHeight: fin.blockHeight, blockTime: fin.blockTimestamp };
  } catch (e) {
    throw plainError(e, sentAs);
  } finally {
    // The secret was only ever in memory for this call; drop it.
    await providers.privateStateProvider.clear().catch(() => undefined);
    setProverProgress(undefined);
  }
};

/** Anchor a record: its identity goes on chain, with the recovery commitment fixed now. */
export const anchorOnChain = (recordSecret: Uint8Array, recoverySecret: Uint8Array, opts: CallOptions = {}) =>
  call('anchor', [recoveryCommitmentOf(recoverySecret)], recordSecret, opts);

/** Prove possession to a verifier, answering their challenge (64 hex characters). */
export const proveOwnershipOnChain = (recordSecret: Uint8Array, challengeHex: string, opts: CallOptions = {}) =>
  call('proveOwnership', [hexToBytes(challengeHex)], recordSecret, opts);

/**
 * Date a bound pairing (chain/pairing.ts) against the anchored record. `bindingHex` is
 * dnaPairBinding(reportSha256, identity, salt): never pass a report's own fingerprint,
 * which anyone watching could copy and pair to their own record first.
 */
export const pairDnaOnChain = (recordSecret: Uint8Array, bindingHex: string, opts: CallOptions = {}) =>
  call('pairDna', [hexToBytes(bindingHex)], recordSecret, opts);
