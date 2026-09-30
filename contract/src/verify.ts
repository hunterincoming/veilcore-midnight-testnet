// The reference verifier: the rules in docs/design.md ("Verifier rules"), as code.
// Reads only chain state (the contract's Ledger), so a verifier needs nothing from
// VeilCore or its registry.
// SPDX-License-Identifier: Apache-2.0

import {
  type Ledger,
  pureCircuits,
} from "./managed/veilcore/contract/index.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const same = (a: Uint8Array, b: Uint8Array): boolean => hex(a) === hex(b);

/** Rule 1. The identity (origin) a commitment belongs to. */
export const identityOf = (ledger: Ledger, record: Uint8Array): Uint8Array =>
  ledger.originOf.member(record) ? ledger.originOf.lookup(record) : record;

/** Rule 1. Whether a commitment is its identity's current head, and so may act. */
export const isLive = (ledger: Ledger, record: Uint8Array): boolean => {
  const origin = identityOf(ledger, record);
  return ledger.headOf.member(origin)
    ? same(ledger.headOf.lookup(origin), record)
    : same(origin, record);
};

/** Whether a commitment belongs to an anchored identity. */
export const isAnchored = (ledger: Ledger, record: Uint8Array): boolean =>
  ledger.recoveryOf.member(identityOf(ledger, record));

/** Every commitment an identity has had: its origin, then each successor. */
export const commitmentsOf = (
  ledger: Ledger,
  record: Uint8Array,
): Uint8Array[] => {
  const origin = identityOf(ledger, record);
  const successors = [...ledger.originOf]
    .filter(([, o]) => same(o, origin))
    .map(([s]) => s);
  return [origin, ...successors];
};

/** Rule 3. How many obligations are in force against a record's identity. */
export const openObligations = (ledger: Ledger, record: Uint8Array): bigint => {
  const id = identityOf(ledger, record);
  return ledger.obligationCountOf.member(id)
    ? ledger.obligationCountOf.lookup(id).read()
    : 0n;
};

export type LineageReport = {
  /** The identity checked. */
  readonly identity: Uint8Array;
  /** Every ancestor identity reachable through confirmed parentage, nearest first. */
  readonly ancestors: readonly Uint8Array[];
  /** Rule 4. Ancestors with no confirmed parent. Check these against origins you recognise. */
  readonly roots: readonly Uint8Array[];
  /** Rule 4. The pedigree loops back on itself, so part of it ends in no root at all. */
  readonly cyclic: boolean;
  /** Rule 3. The record itself, and ancestors, carrying an obligation in force. */
  readonly encumbered: readonly Uint8Array[];
  /** No obligation in force on the record or any ancestor. Not the same as complete (rule 4). */
  readonly clean: boolean;
  /** Clean, acyclic, and every root is one the caller recognises. */
  readonly accepted: boolean;
};

/**
 * Rules 2 to 4. Walk a record's confirmed pedigree from chain state, never from what a
 * seller hands over, and report obligations, roots and cycles. `recognisedRoots` are the
 * origins the verifier trusts as the start of a line (a breeder, a gene bank); without
 * them nothing is `accepted`, since anyone can anchor fresh material with no history.
 */
export const checkLineage = (
  ledger: Ledger,
  record: Uint8Array,
  recognisedRoots: readonly Uint8Array[] = [],
): LineageReport => {
  const identity = identityOf(ledger, record);
  const seen = new Set<string>([hex(identity)]);
  const ancestors: Uint8Array[] = [];
  const roots: Uint8Array[] = [];
  let cyclic = false;
  let frontier: Uint8Array[] = [identity];
  while (frontier.length > 0) {
    const next: Uint8Array[] = [];
    for (const child of frontier) {
      const parents = ledger.parentsOf.member(child)
        ? [...ledger.parentsOf.lookup(child)]
        : [];
      if (parents.length === 0 && !same(child, identity)) roots.push(child);
      for (const parent of parents) {
        if (seen.has(hex(parent))) {
          cyclic = true;
          continue;
        }
        seen.add(hex(parent));
        ancestors.push(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }
  const owes = (id: Uint8Array): boolean =>
    ledger.obligationCountOf.member(id) &&
    ledger.obligationCountOf.lookup(id).read() > 0n;
  const encumbered = [identity, ...ancestors].filter(owes);
  const clean = encumbered.length === 0;
  const known = new Set(recognisedRoots.map((r) => hex(identityOf(ledger, r))));
  const rootsKnown = roots.length > 0 && roots.every((r) => known.has(hex(r)));
  return {
    identity,
    ancestors,
    roots,
    cyclic,
    encumbered,
    clean,
    accepted: clean && !cyclic && rootsKnown,
  };
};

/**
 * Rule 5. Accept a licence presentation.
 *
 * `ledger` is the contract state at the END of the block holding the presentation
 * (from the indexer); `tag` is the lastPresentation that transaction published. The
 * verifier chose `challenge` (32 fresh random bytes, kept private) and asked about
 * `issuer`, any commitment of the licensing identity. A presentation that landed while
 * a revocation was waiting for a seal may use a revoked licence: reject it and ask for
 * a new one after the next seal.
 */
export const acceptPresentation = (
  ledger: Ledger,
  issuer: Uint8Array,
  challenge: Uint8Array,
  tag: Uint8Array,
): { readonly accepted: boolean; readonly reason: string } => {
  if (challenge.length !== 32 || challenge.every((b) => b === 0))
    return { accepted: false, reason: "not a usable challenge" };
  const matches = commitmentsOf(ledger, issuer).some((c) =>
    same(pureCircuits.presentationTag(c, challenge), tag),
  );
  if (!matches)
    return {
      accepted: false,
      reason: "the tag does not answer this challenge for this issuer",
    };
  if (ledger.unsealedChanges)
    return {
      accepted: false,
      reason:
        "a revocation was waiting for a seal; ask again after the next seal",
    };
  return {
    accepted: true,
    reason: "a live licence from this issuer, as of this block",
  };
};
