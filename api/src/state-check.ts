// SPDX-License-Identifier: Apache-2.0
/**
 * What a verifier checks about the contract state it judges, beyond its ledger data
 * (8 October 2026 review).
 *
 * A contract's state carries its circuits' verifier keys and its maintenance authority as
 * well as its data. While the main contract keeps an authority (docs/maintenance-policy.md),
 * whoever holds it can replace a circuit's verifier key, call the replaced circuit, and put
 * the original key back. Judging only `.data` would never show that. So:
 *
 *  - every circuit's verifier key in the state a verdict rests on is compared with the
 *    pinned build (docs/fingerprints.md, generated into partner-kit/src/fingerprints.ts).
 *    Any difference, a missing circuit or an extra one, refuses the verdict;
 *  - the maintenance authority in that state (committee size, threshold, replay counter)
 *    is reported with the verdict. Every maintenance update raises the counter, so a key
 *    swapped and restored between two of a verifier's checks shows there even though
 *    both states carry the pinned keys. A caller that knows the counter to expect can
 *    require it.
 */
import { createHash } from 'node:crypto';
import { FINGERPRINTS } from '../../partner-kit/src/fingerprints.js';

/** Circuit name -> SHA-256 (hex) of its verifier key, as docs/fingerprints.md records it. */
export type KeyPins = Readonly<Record<string, string>>;

/** The parts of a contract state these checks read (ContractState has them). */
export type StateWithKeys = {
  operations(): readonly (string | Uint8Array)[];
  operation(name: string): { readonly verifierKey?: Uint8Array } | undefined;
  readonly maintenanceAuthority: {
    readonly committee: readonly unknown[];
    readonly threshold: number;
    readonly counter: bigint;
  };
};

/** The maintenance authority in a state, as a verifier reports it. */
export type AuthorityReport = {
  /** How many keys may sign a maintenance update. */
  readonly committee: number;
  /** How many of them must. */
  readonly threshold: number;
  /** Raised by every maintenance update (a key inserted, removed, or the authority replaced). */
  readonly counter: bigint;
  /** Nobody can sign: more signatures needed than there are keys (api/src/maintenance.ts). */
  readonly retired: boolean;
};

export type PinnedContract = keyof typeof FINGERPRINTS;

/** The pinned verifier-key fingerprints of one of VeilCore's contracts. */
export const pinnedVerifierKeys = (contract: PinnedContract): KeyPins => {
  const table: Readonly<Record<string, string>> = FINGERPRINTS[contract];
  const out: Record<string, string> = {};
  for (const [file, sha] of Object.entries(table)) {
    const c = /^keys\/(.+)\.verifier$/.exec(file)?.[1];
    if (c !== undefined) out[c] = sha;
  }
  return out;
};

const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const opName = (n: string | Uint8Array): string => (typeof n === 'string' ? n : Buffer.from(n).toString('utf8'));

/**
 * The circuits whose verifier key in `state` is not the pinned one: a different key, no
 * key, a pinned circuit missing from the state, or a circuit the pins do not name. Empty
 * when the state carries exactly the pinned build's keys.
 */
export const verifierKeyMismatches = (state: StateWithKeys, pins: KeyPins): string[] => {
  const bad = new Set<string>();
  const present = state.operations().map(opName);
  for (const name of present) {
    const want = pins[name];
    if (want === undefined) {
      bad.add(name);
      continue;
    }
    let vk: Uint8Array | undefined;
    try {
      vk = state.operation(name)?.verifierKey;
    } catch {
      vk = undefined;
    }
    if (!(vk instanceof Uint8Array) || sha256Hex(vk) !== want.toLowerCase()) bad.add(name);
  }
  for (const name of Object.keys(pins)) if (!present.includes(name)) bad.add(name);
  return [...bad].sort();
};

/** The maintenance authority a state carries. */
export const authorityReport = (state: StateWithKeys): AuthorityReport => {
  const a = state.maintenanceAuthority;
  return {
    committee: a.committee.length,
    threshold: a.threshold,
    counter: a.counter,
    retired: a.threshold > a.committee.length,
  };
};

/** One line for a verdict's reason. */
export const describeAuthority = (a: AuthorityReport): string =>
  a.retired
    ? `maintenance authority retired (empty committee), counter ${a.counter}`
    : `maintenance authority live: ${a.committee} key(s), threshold ${a.threshold}, counter ${a.counter}`;

/**
 * The state a verdict rests on is not the pinned build, or its maintenance authority is
 * not the one the caller required. Nothing was accepted.
 */
export class ContractStateMismatchError extends Error {
  readonly circuits: readonly string[];
  readonly authority: AuthorityReport;
  constructor(message: string, circuits: readonly string[], authority: AuthorityReport) {
    super(message);
    this.name = 'ContractStateMismatchError';
    this.circuits = circuits;
    this.authority = authority;
  }
}

/** What to require of a state, besides its data. */
export type StateRequirements = {
  /** Refuse unless every circuit's verifier key is exactly these. Omit to only report. */
  readonly verifierKeys?: KeyPins;
  /** Refuse unless the maintenance authority's counter is exactly this. */
  readonly authorityCounter?: bigint;
};

/** Throw ContractStateMismatchError unless `state` meets `req`; otherwise report its authority. */
export const checkContractState = (
  state: StateWithKeys,
  req: StateRequirements,
  what = 'that transaction',
): { readonly authority: AuthorityReport; readonly keys: 'pinned' | 'unchecked' } => {
  const authority = authorityReport(state);
  if (req.verifierKeys !== undefined) {
    const bad = verifierKeyMismatches(state, req.verifierKeys);
    if (bad.length > 0)
      throw new ContractStateMismatchError(
        `Refused: the contract's verifier keys at ${what} are not the pinned build's (${bad.join(', ')}). ` +
          `The maintenance authority may have changed the circuits; ${describeAuthority(authority)}.`,
        bad,
        authority,
      );
  }
  if (req.authorityCounter !== undefined && authority.counter !== req.authorityCounter)
    throw new ContractStateMismatchError(
      `Refused: the contract's maintenance authority counter at ${what} is ${authority.counter}, not ` +
        `${req.authorityCounter}: it has been used since. ${describeAuthority(authority)}.`,
      [],
      authority,
    );
  return { authority, keys: req.verifierKeys === undefined ? 'unchecked' : 'pinned' };
};

/**
 * The requirements a lookup on `network` runs with. On mainnet the verifier keys are
 * ALWAYS the pinned build's: a caller's own `verifierKeys` table is ignored there, so a
 * caller can add a stricter check (a required authority counter, a second indexer) but
 * never replace or loosen the mainnet pins. Elsewhere the caller's requirements stand.
 */
export const withMainnetPins = <T extends StateRequirements>(
  check: T,
  contract: PinnedContract,
  network: string | null,
): T => (network === 'mainnet' ? { ...check, verifierKeys: pinnedVerifierKeys(contract) } : check);
